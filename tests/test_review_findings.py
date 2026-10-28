"""Regression tests for backend review findings (packages, storage, API, ontology)."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest
from auth_harness import AutoLoginClient, upload_package
from pg_harness import database_for, database_url_for
from support.v2_exports import package_export_zip
from support.v2_reader import read_package
from support.v2_writer import write_package, write_package_to_stream

from ontotator.domain.documents import Document
from ontotator.domain.errors import DomainError, InvalidPackage
from ontotator.packages.models import ValidatedPackage
from ontotator.storage.repository import Repository

FIXTURES = Path(__file__).parent / "fixtures"
HP_PATH = FIXTURES / "hp.json"


def _sample_package() -> ValidatedPackage:
    from support.v2_samples import _create_sample_package

    return _create_sample_package()


def _rewrite_zip(source: bytes, mutate) -> bytes:  # type: ignore[no-untyped-def]
    with zipfile.ZipFile(io.BytesIO(source)) as z:
        members = {name: z.read(name) for name in z.namelist()}
    mutate(members)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return out.getvalue()


# --- Finding 1: JSONL splitting ------------------------------------------- #


def test_jsonl_roundtrip_preserves_unicode_line_separators(tmp_path: Path) -> None:
    pkg = _sample_package()
    text = "Line one\u2028still one\u2029para\x85next\x0bvt\x0cff\x1cfs end."
    doc = Document(
        document_id="doc-sep",
        text=text,
        language="de",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    pkg.documents[doc.document_id] = doc
    pkg.manifest.document_order = [*pkg.manifest.document_order, doc.document_id]

    target = tmp_path / "sep.zip"
    write_package(pkg, target)
    with zipfile.ZipFile(target) as z:
        raw = z.read("documents.jsonl").decode("utf-8")
    assert "\u2028" in raw  # written verbatim by the writer

    loaded = read_package(target)
    assert loaded.documents["doc-sep"].text == text


def test_jsonl_reader_tolerates_crlf_records(tmp_path: Path) -> None:
    buf = io.BytesIO()
    write_package_to_stream(_sample_package(), buf)

    def to_crlf(members: dict[str, bytes]) -> None:
        manifest = json.loads(members["manifest.json"])
        for name in list(members):
            if name.endswith(".jsonl"):
                members[name] = members[name].replace(b"\n", b"\r\n")
                manifest["file_hashes"][name] = hashlib.sha256(
                    members[name]
                ).hexdigest()
        members["manifest.json"] = json.dumps(manifest).encode("utf-8")

    data = _rewrite_zip(buf.getvalue(), to_crlf)
    loaded = read_package(io.BytesIO(data))
    assert set(loaded.documents) == {"doc-1"}


# --- Finding 3: mandatory file hashes -------------------------------------- #


@pytest.mark.parametrize("member", ["documents.jsonl", "search-events.jsonl"])
def test_reader_rejects_member_without_manifest_hash(member: str) -> None:
    buf = io.BytesIO()
    write_package_to_stream(_sample_package(), buf)

    def drop_hash(members: dict[str, bytes]) -> None:
        manifest = json.loads(members["manifest.json"])
        del manifest["file_hashes"][member]
        members["manifest.json"] = json.dumps(manifest).encode("utf-8")

    with pytest.raises(InvalidPackage, match="missing the required SHA-256"):
        read_package(io.BytesIO(_rewrite_zip(buf.getvalue(), drop_hash)))


def test_reimport_same_manifest_with_different_dataset_is_rejected(
    tmp_path: Path,
) -> None:
    repo = Repository(database_for(tmp_path / "db.sqlite"))
    buf = io.BytesIO()
    write_package_to_stream(_sample_package(), buf)
    original = read_package(io.BytesIO(buf.getvalue()))
    repo.import_package(original)
    # Identical archive is idempotent.
    assert repo.import_package(read_package(io.BytesIO(buf.getvalue()))) == (
        original.manifest.package_id
    )

    # Same manifest object (no file hashes) but an extra search event: the
    # dataset content changed and must not be accepted silently.
    changed = original.model_copy(deep=True)
    extra = changed.search_events[0].model_copy(update={"event_id": "ev-extra"})
    changed.search_events.append(extra)
    with pytest.raises(InvalidPackage, match="different"):
        repo.import_package(changed)

    # Re-written archive: hashes differ, so the manifest hash differs.
    buf2 = io.BytesIO()
    write_package_to_stream(changed, buf2)
    with pytest.raises(InvalidPackage, match="different"):
        repo.import_package(read_package(io.BytesIO(buf2.getvalue())))


# --- Finding 6/7: workspace identity and status isolation ------------------ #


def _editing_env(tmp_path: Path):  # type: ignore[no-untyped-def]
    from test_editing import _setup_test_env

    return _setup_test_env(tmp_path)


def _submit_independent(repo, ontology, annotator_id: str) -> None:  # type: ignore[no-untyped-def]
    from ontotator.application.editing import EditorService
    from ontotator.application.submissions import SubmissionService
    from ontotator.application.workspaces import WorkspaceService
    from ontotator.domain.workspace import MutationEnvelope, WorkspaceKey

    key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id=annotator_id,
        mode="independent",
        target_set_id="targets-0",
    )
    key = WorkspaceService(repo, ontology).open(key).key
    EditorService(repo, ontology).apply(
        key,
        MutationEnvelope(
            mutation_id=f"check-{annotator_id}",
            expected_revision=0,
            payload={
                "command": "check_layer",
                "layer_id": "hpo-layer",
                "checked": True,
            },
        ),
    )
    SubmissionService(repo, ontology).submit(
        key,
        MutationEnvelope(
            mutation_id=f"submit-{annotator_id}",
            expected_revision=1,
            payload={"document_checked": True},
        ),
    )


def test_document_status_is_exact_per_annotator(tmp_path: Path) -> None:
    repo, ontology, *_ = _editing_env(tmp_path)
    _submit_independent(repo, ontology, "JP")

    status = repo.get_document_status
    assert status("pkg-1", "doc-1", "JP", "independent") == "completed"
    assert status("pkg-1", "doc-1", "jp", "independent") == "not_started"
    assert status("pkg-1", "doc-1", "J_", "independent") == "not_started"
    assert status("pkg-1", "doc-1", "%", "independent") == "not_started"
    assert status("pkg-1", "doc-1", "JP", "review") == "not_started"


def test_workspace_key_encoding_is_unambiguous_and_backward_compatible(
    tmp_path: Path,
) -> None:
    from ontotator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
    from ontotator.storage.repository import _key_str

    legacy = WorkspaceKey(
        project_key="p",
        document_id="d",
        annotator_id="a",
        mode="independent",
        scope_id="s",
        target_set_id="targets-0",
    )
    assert _key_str(legacy) == "p:d:a:independent:s:targets-0"

    first = legacy.model_copy(update={"project_key": "p:d", "document_id": "a"})
    second = legacy.model_copy(update={"document_id": "d:a", "annotator_id": "a"})
    second = second.model_copy(update={"project_key": "p"})
    # Both join to the same legacy string, so the encoding must separate them.
    assert ":".join(
        [first.project_key, first.document_id, first.annotator_id]
    ) == ":".join([second.project_key, second.document_id, second.annotator_id])
    assert _key_str(first) != _key_str(second)
    assert ":" not in _key_str(first)

    from test_storage import _sample_package as _project

    repo = Repository(database_for(tmp_path / "db.sqlite"))
    # Drafts belong to a project (D-e); both keys' projects must exist.
    repo.import_package(_project(first.project_key))
    repo.import_package(_project(second.project_key))
    repo.open_draft(first)

    def bump(draft: Draft) -> Draft:
        draft.checked_layer_ids = ["x"]
        return draft

    repo.run_mutation(
        first, MutationEnvelope(mutation_id="m", expected_revision=0, payload={}), bump
    )
    assert repo.open_draft(first).revision == 1
    assert repo.open_draft(second).revision == 0


# --- Finding 4/5: term validation and evidence identity -------------------- #


class _Session:
    """Small helper driving EditorService/SubmissionService with revisions."""

    def __init__(self, tmp_path: Path, with_source_term: str | None = None) -> None:
        from ontotator.application.editing import EditorService
        from ontotator.application.submissions import SubmissionService
        from ontotator.application.workspaces import WorkspaceService
        from ontotator.domain.workspace import WorkspaceKey

        repo, ontology, _ws, _edit, doc = _editing_env(tmp_path)
        project_key = "pkg-1"
        if with_source_term is not None:
            project_key = "pkg-src"
            self.source = self._import_source_package(repo, doc, with_source_term)
        self.repo = repo
        self.editor = EditorService(repo, ontology)
        self.submissions = SubmissionService(repo, ontology)
        key = WorkspaceKey(
            project_key=project_key,
            document_id="doc-1",
            annotator_id="annotator-1",
            mode="independent",
            target_set_id="targets-0",
        )
        self.key = WorkspaceService(repo, ontology).open(key).key
        self.revision = 0
        self.counter = 0

    @staticmethod
    def _import_source_package(repo, doc, term_id: str):  # type: ignore[no-untyped-def]
        from ontotator.domain.annotations import (
            ActorRef,
            Annotation,
            Provenance,
            snapshot,
        )

        manifest = repo.get_manifest("pkg-1")
        profile = repo.get_task_profile("pkg-1")
        ann = Annotation(
            annotation_id="src-1",
            document_id=doc.document_id,
            layer_id="hpo-layer",
            type_id="phenotype",
            term_id=term_id,
            axes_values={},
            provenance=Provenance(
                actor=ActorRef(actor_id="model", kind="tool"), method="ner"
            ),
        )
        snap = snapshot(ann, [], doc, profile)
        pkg = ValidatedPackage(
            manifest=manifest.model_copy(update={"package_id": "pkg-src"}),
            documents={doc.document_id: doc},
            annotations={(ann.annotation_id, snap.version): snap},
        )
        repo.import_package(pkg)
        return snap

    def apply(self, **payload):  # type: ignore[no-untyped-def]
        from ontotator.domain.workspace import MutationEnvelope

        self.counter += 1
        draft = self.editor.apply(
            self.key,
            MutationEnvelope(
                mutation_id=f"m-{self.counter}",
                expected_revision=self.revision,
                payload=payload,
            ),
        )
        self.revision = draft.revision
        return draft

    def submit(self):  # type: ignore[no-untyped-def]
        from ontotator.domain.workspace import MutationEnvelope

        self.apply(command="check_layer", layer_id="hpo-layer", checked=True)
        self.counter += 1
        return self.submissions.submit(
            self.key,
            MutationEnvelope(
                mutation_id=f"m-{self.counter}",
                expected_revision=self.revision,
                payload={"document_checked": True},
            ),
        )


@pytest.mark.parametrize(
    ("term_id", "code"),
    [("HP:0000123", "OBSOLETE_TERM"), ("HP:9999999", "UNKNOWN_TERM")],
)
def test_create_with_unverified_source_still_validates_term(
    tmp_path: Path, term_id: str, code: str
) -> None:
    from ontotator.domain.errors import DomainError

    session = _Session(tmp_path)
    with pytest.raises(DomainError) as exc:
        session.apply(
            command="create_annotation",
            annotation_id="a-1",
            term_id=term_id,
            source_annotation_id="does-not-exist",
            source_version="v0",
        )
    assert exc.value.code == code


def test_create_with_source_of_other_term_still_validates(tmp_path: Path) -> None:
    from ontotator.domain.errors import DomainError

    session = _Session(tmp_path, with_source_term="HP:0001252")
    with pytest.raises(DomainError) as exc:
        session.apply(
            command="create_annotation",
            annotation_id="a-1",
            term_id="HP:0000123",
            source_annotation_id="src-1",
            source_version=session.source.version,
        )
    assert exc.value.code == "OBSOLETE_TERM"


def test_adopted_obsolete_term_is_visible_but_blocks_submit(tmp_path: Path) -> None:
    from ontotator.domain.errors import DomainError

    session = _Session(tmp_path, with_source_term="HP:0000123")
    draft = session.apply(
        command="create_annotation",
        annotation_id="a-1",
        note="Finding inferred from the complete document",
        term_id="HP:0000123",
        source_annotation_id="src-1",
        source_version=session.source.version,
    )
    assert draft.annotations[0].annotation.term_id == "HP:0000123"
    with pytest.raises(DomainError) as exc:
        session.submit()
    assert exc.value.code == "OBSOLETE_TERM"
    assert "a-1" in str(exc.value)


# Document text: "The patient showed severe hypotonia and seizure activity."
HYPOTONIA = {"start": 26, "end": 35}
SEIZURE = {"start": 40, "end": 47}
SEVERE_HYPOTONIA = {"start": 19, "end": 35}


def test_attach_existing_evidence_id_with_other_segments_is_rejected(
    tmp_path: Path,
) -> None:
    from ontotator.domain.errors import DomainError

    session = _Session(tmp_path)
    session.apply(
        command="create_annotation",
        annotation_id="a-1",
        term_id="HP:0001252",
        evidence_id="ev-1",
        segments=[HYPOTONIA],
    )
    session.apply(
        command="create_annotation",
        annotation_id="a-2",
        term_id="HP:0001250",
        note="Finding recorded before attaching its evidence",
    )
    with pytest.raises(DomainError) as exc:
        session.apply(
            command="attach_mention",
            annotation_id="a-2",
            evidence_id="ev-1",
            segments=[SEIZURE],
        )
    assert exc.value.code == "EVIDENCE_ID_CONFLICT"
    # Identical segments share the evidence.
    draft = session.apply(
        command="attach_mention",
        annotation_id="a-2",
        evidence_id="ev-1",
        segments=[HYPOTONIA],
    )
    refs = {
        r.evidence_id for a in draft.annotations for r in a.annotation.evidence_refs
    }
    assert refs == {"ev-1"}


def _shared_evidence_session(tmp_path: Path) -> _Session:
    session = _Session(tmp_path)
    session.apply(
        command="create_annotation",
        annotation_id="a-1",
        term_id="HP:0001252",
        evidence_id="ev-1",
        segments=[HYPOTONIA],
    )
    session.apply(
        command="create_annotation",
        annotation_id="a-2",
        term_id="HP:0001250",
        note="Finding recorded before attaching its evidence",
    )
    session.apply(
        command="attach_mention",
        annotation_id="a-2",
        evidence_id="ev-1",
        segments=[HYPOTONIA],
    )
    return session


def test_copy_on_write_evidence_id_never_collides(tmp_path: Path) -> None:
    session = _shared_evidence_session(tmp_path)
    # An unrelated mention whose id equals the old counter-based COW id.
    session.apply(
        command="create_annotation",
        annotation_id="a-3",
        term_id="HP:0001284",
        evidence_id="ev-1-cow-3",
        segments=[SEIZURE],
    )
    draft = session.apply(
        command="edit_mention",
        evidence_id="ev-1",
        annotation_id="a-1",
        segments=[SEVERE_HYPOTONIA],
    )
    ids = [e.mention.evidence_id for e in draft.evidence]
    assert len(ids) == len(set(ids))
    by_ann = {a.annotation.annotation_id: a for a in draft.annotations}
    assert by_ann["a-3"].evidence[0].mention.segments[0].start == SEIZURE["start"]
    new_ref = by_ann["a-1"].annotation.evidence_refs[0].evidence_id
    assert new_ref not in {"ev-1", "ev-1-cow-3"}
    assert by_ann["a-2"].annotation.evidence_refs[0].evidence_id == "ev-1"


def test_editing_shared_evidence_requires_annotation_id(tmp_path: Path) -> None:
    from ontotator.domain.errors import DomainError

    session = _shared_evidence_session(tmp_path)
    with pytest.raises(DomainError) as exc:
        session.apply(
            command="edit_mention",
            evidence_id="ev-1",
            segments=[SEVERE_HYPOTONIA],
        )
    assert exc.value.code == "SHARED_EVIDENCE_REQUIRES_ANNOTATION"


# --- Finding 2/11/12: ontology upload, registry, layering ------------------ #


def _app(tmp_path: Path, **overrides):  # type: ignore[no-untyped-def]

    from ontotator.api.app import create_app
    from ontotator.config import AppConfig

    workspace = tmp_path / "workspace"
    config = AppConfig(
        workspace_dir=workspace,
        database_url=database_url_for(workspace / "editor.db"),
        **overrides,
    )
    app = create_app(config)
    return AutoLoginClient(app), config


def _obo(  # type: ignore[no-untyped-def]
    version: str,
    labels: dict[str, str],
    is_a: dict[str, str] | None = None,
    **meta_by_id,
) -> bytes:
    nodes = []
    for term_id, label in labels.items():
        node: dict[str, object] = {
            "id": "http://purl.obolibrary.org/obo/" + term_id.replace(":", "_"),
            "lbl": label,
            "type": "CLASS",
        }
        if term_id in meta_by_id:
            node["meta"] = meta_by_id[term_id]
        nodes.append(node)
    graph = {
        "id": "http://purl.obolibrary.org/obo/hp.json",
        "meta": {
            "version": f"http://purl.obolibrary.org/obo/hp/releases/{version}/hp.json"
        },
        "nodes": nodes,
        "edges": [
            {
                "sub": "http://purl.obolibrary.org/obo/" + child.replace(":", "_"),
                "pred": "is_a",
                "obj": "http://purl.obolibrary.org/obo/" + parent.replace(":", "_"),
            }
            for child, parent in (is_a or {}).items()
        ],
    }
    return json.dumps({"graphs": [graph]}).encode("utf-8")


def test_ontology_upload_is_content_addressed_and_never_overwrites(
    tmp_path: Path,
) -> None:
    from auth_harness import HARNESS

    client, _ = _app(tmp_path)
    store = client.app.state.ontology_store
    blobs = client.app.state.repo.db.blobs
    labels = {"HP:0000001": "All", "HP:0000118": "Pheno"}
    rooted = {"HP:0000118": "HP:0000001"}
    old_release = _obo("2025-01-01", labels, rooted)
    new_release = _obo(
        "2026-01-01",
        {**labels, "HP:0001250": "Seizure"},
        {**rooted, "HP:0001250": "HP:0000118"},
    )

    first = store.add(HARNESS, "hp.json", old_release)
    second = store.add(HARNESS, "hp.json", new_release)
    # Stored in the blob store by content: two releases never share a file.
    first_path = blobs.path(first.sha256)
    second_path = blobs.path(second.sha256)
    assert first_path != second_path
    old_sha = hashlib.sha256(old_release).hexdigest()
    assert first_path.name == old_sha
    assert first_path.read_bytes() == old_release
    assert second_path.read_bytes() == new_release

    again = store.add(HARNESS, "renamed.json", old_release)
    assert again.sha256 == old_sha
    assert again.filename == "hp.json"

    listed = {o["sha256"] for o in client.get("/api/v1/ontologies").json()}
    assert old_sha in listed


def test_registry_for_layer_does_not_mutate_shared_service(tmp_path: Path) -> None:
    from layered_fixtures import make_layered_package

    from ontotator.ontology.registry import OntologyRegistry

    registry = OntologyRegistry()
    sha = registry.register_path(HP_PATH)
    shared = registry.get_service(sha)
    assert shared is not None and shared.ref.release == "unknown"
    profile = make_layered_package("single").manifest.task_profile
    assert profile is not None

    bound = registry.for_layer(profile, "hpo-layer")
    assert bound.ref.release == "2026-06-23"
    assert shared.ref.release == "unknown"
    assert bound.ontology is shared.ontology


def test_registry_resolves_resource_path_against_workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from layered_fixtures import make_layered_package

    from ontotator.ontology.registry import OntologyRegistry

    workspace = tmp_path / "ws"
    (workspace / "ontologies").mkdir(parents=True)
    (workspace / "ontologies" / "hp.json").write_bytes(HP_PATH.read_bytes())
    elsewhere = tmp_path / "cwd"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    profile = make_layered_package("single").manifest.task_profile
    assert profile is not None

    registry = OntologyRegistry(base_dir=workspace)
    assert registry.for_layer(profile, "hpo-layer").ref.release == "2026-06-23"

    # Resource paths may not escape the workspace.
    escaping = profile.model_copy(deep=True)
    escaping.ontologies[0].resource_path = "../ws/ontologies/hp.json"
    from ontotator.domain.errors import DomainError

    with pytest.raises(DomainError):
        OntologyRegistry(base_dir=workspace / "ontologies").for_layer(
            escaping, "hpo-layer"
        )


def test_failed_eager_ontology_load_is_logged_and_listed(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    broken = tmp_path / "broken.json"
    broken.write_text('{"graphs": []}', encoding="utf-8")
    with caplog.at_level("WARNING"):
        client, _ = _app(tmp_path, ontology_paths=[broken, HP_PATH])
    assert any("broken.json" in r.getMessage() for r in caplog.records)

    listed = client.get("/api/v1/ontologies").json()
    failed = [o for o in listed if o["status"] == "failed"]
    loaded = [o for o in listed if o["status"] == "loaded"]
    assert len(failed) == 1 and failed[0]["error"]
    assert failed[0]["sha256"] == hashlib.sha256(broken.read_bytes()).hexdigest()
    assert len(loaded) == 1 and loaded[0]["term_count"] == 11


def test_routes_use_public_repository_and_registry_api() -> None:
    from ontotator.api import routes

    source = Path(routes.__file__).read_text(encoding="utf-8")
    assert "repo.db" not in source
    assert "registry._" not in source


# --- Finding 10: ontology alt_ids, replacements, lookup -------------------- #

OBO = "http://www.geneontology.org/formats/oboInOwl#"
IAO_REPLACED_BY = "http://purl.obolibrary.org/obo/IAO_0100001"


def _alt_ontology_bytes() -> bytes:
    return _obo(
        "2026-02-01",
        {
            "HP:0000001": "All",
            "HP:0001252": "Hypotonia",
            "HP:0000002": "Old hypotonia",
            "HP:00000AB": "Upper",
            "HP:00000ab": "Lower",
            "HP:0001250": "Seizure",
        },
        **{
            "HP:0001252": {
                "basicPropertyValues": [
                    {"pred": OBO + "hasAlternativeId", "val": "HP:0001290"},
                    {"pred": OBO + "hasAlternativeId", "val": "HP:0008936"},
                ]
            },
            "HP:0000002": {
                "deprecated": True,
                "basicPropertyValues": [
                    {
                        "pred": IAO_REPLACED_BY,
                        "val": "http://purl.obolibrary.org/obo/HP_0001252",
                    },
                    {"pred": OBO + "consider", "val": "HP:0001250"},
                ],
            },
            "HP:0001250": {
                "synonyms": [
                    {"pred": "hasExactSynonym", "val": "seizure"},
                    {"pred": "hasRelatedSynonym", "val": "SEIZURE"},
                ]
            },
        },
    )


def _alt_ontology(tmp_path: Path):  # type: ignore[no-untyped-def]
    from ontotator.vendor.hpo_span_annotator.hpo import load

    path = tmp_path / "alt.json"
    path.write_bytes(_alt_ontology_bytes())
    return load(path)


def test_alt_ids_resolve_to_primary_and_obsolete_terms_expose_replacements(
    tmp_path: Path,
) -> None:
    ontology = _alt_ontology(tmp_path)
    alt = ontology.get("HP:0001290")
    assert alt is not None and alt.hpo_id == "HP:0001252"
    assert ontology.get("hp:0008936").hpo_id == "HP:0001252"  # type: ignore[union-attr]
    assert ontology.get("HP:0001252").alt_ids == ["HP:0001290", "HP:0008936"]  # type: ignore[union-attr]

    obsolete = ontology.get("HP:0000002")
    assert obsolete is not None and obsolete.obsolete
    assert obsolete.replaced_by == "HP:0001252"
    assert obsolete.consider == ["HP:0001250"]
    detail = ontology.detail("HP:0000002")
    assert detail is not None
    assert detail["replaced_by"] == "HP:0001252"
    assert detail["consider"] == ["HP:0001250"]


def test_case_insensitive_lookup_only_when_unambiguous(tmp_path: Path) -> None:
    ontology = _alt_ontology(tmp_path)
    assert ontology.get("HP:00000AB").label == "Upper"  # type: ignore[union-attr]
    assert ontology.get("HP:00000ab").label == "Lower"  # type: ignore[union-attr]
    assert ontology.get("hp:00000Ab") is None
    assert ontology.get("hp:0001252").hpo_id == "HP:0001252"  # type: ignore[union-attr]


def test_exact_route_returns_each_term_once(tmp_path: Path) -> None:
    ontology = _alt_ontology(tmp_path)
    hits = ontology.exact("Seizure")
    assert [h["hpo_id"] for h in hits] == ["HP:0001250"]
    assert hits[0]["match_kind"] == "label"


def test_validate_term_reports_alt_and_replacement_metadata(tmp_path: Path) -> None:
    from ontotator.domain.documents import OntologyRef
    from ontotator.ontology.service import OntologyService

    path = tmp_path / "alt.json"
    path.write_bytes(_alt_ontology_bytes())
    service = OntologyService.load(
        path,
        OntologyRef(release="x", sha256=hashlib.sha256(path.read_bytes()).hexdigest()),
    )
    via_alt = service.validate_term("HP:0001290")
    assert via_alt.status == "valid"
    assert via_alt.term_id == "HP:0001252"
    assert via_alt.alt_ids == ["HP:0001290", "HP:0008936"]
    obsolete = service.validate_term("HP:0000002")
    assert obsolete.status == "obsolete"
    assert obsolete.replaced_by == "HP:0001252"
    assert obsolete.consider == ["HP:0001250"]


def test_review_confirms_proposal_recorded_with_alt_id(tmp_path: Path) -> None:
    from ontotator.application.reviews import ReviewService
    from ontotator.application.workspaces import WorkspaceService
    from ontotator.domain.annotations import (
        ActorRef,
        Annotation,
        AnnotationRef,
        Provenance,
        snapshot,
    )
    from ontotator.domain.documents import OntologyRef
    from ontotator.domain.review import ReviewTargetSet
    from ontotator.domain.workspace import MutationEnvelope, WorkspaceKey
    from ontotator.ontology.service import OntologyService

    path = tmp_path / "alt.json"
    path.write_bytes(_alt_ontology_bytes())
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    service = OntologyService.load(path, OntologyRef(release="2026-02-01", sha256=sha))

    from support.v2_samples import _create_sample_profile

    profile = _create_sample_profile()
    profile.ontologies[0].sha256 = sha
    from ontotator.domain.profiles import profile_hash
    from ontotator.packages.models import PackageManifest

    text = "Severe hypotonia."
    doc = Document(
        document_id="doc-1",
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    ann = Annotation(
        annotation_id="p-1",
        document_id="doc-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001290",
        axes_values={"assertion": "present"},
        provenance=Provenance(actor=ActorRef(actor_id="m", kind="tool"), method="ner"),
    )
    snap = snapshot(ann, [], doc, profile)
    repo = Repository(database_for(tmp_path / "db.sqlite"))
    repo.import_package(
        ValidatedPackage(
            manifest=PackageManifest(
                package_id="pkg-alt",
                format_version="ontotator-work-package/v2",
                document_order=["doc-1"],
                task_profile=profile,
                task_profile_sha256=profile_hash(profile),
                created_at="2026-10-01T00:00:00Z",
            ),
            documents={"doc-1": doc},
            annotations={("p-1", snap.version): snap},
        )
    )
    targets = ReviewTargetSet.create(
        [AnnotationRef(annotation_id="p-1", version=snap.version)]
    )
    key = WorkspaceKey(
        project_key="pkg-alt",
        document_id="doc-1",
        annotator_id="rev",
        mode="review",
        target_set_id=targets.target_set_id,
    )
    view = WorkspaceService(repo, service).open(
        key, targets, pending_proposal_set_ids=[]
    )
    assert view.term_statuses["hpo-layer:HP:0001290"] == "valid"
    draft = ReviewService(repo, ontology=service).decide(
        view.key,
        MutationEnvelope(
            mutation_id="d-1",
            expected_revision=0,
            payload={
                "target": {"annotation_id": "p-1", "version": snap.version},
                "outcome": "confirmed",
            },
        ),
    )
    assert draft.decisions[0].outcome == "confirmed"


def test_term_labels_expose_status_and_replacement(tmp_path: Path) -> None:
    client, _ = _app(tmp_path, ontology_paths=[HP_PATH])
    from test_api import _create_sample_package_bytes

    resp = upload_package(
        client,
        files={"file": ("p.zip", _create_sample_package_bytes("single"), "x")},
    )
    assert resp.status_code == 200, resp.text
    labels = client.post(
        "/api/v1/terms/labels",
        json={
            "project_key": "pkg-scenario-a",
            "terms": [
                {"layer_id": "hpo-layer", "term_id": "HP:0000123"},
                {"layer_id": "hpo-layer", "term_id": "hp:0001252"},
            ],
        },
    ).json()
    assert labels[0]["status"] == "obsolete"
    assert labels[0]["replaced_by"] is None
    assert labels[0]["consider"] == [] and labels[0]["alt_ids"] == []
    assert labels[1]["status"] == "valid"
    assert labels[1]["term_id"] == "hp:0001252"
    assert labels[1]["primary_term_id"] == "HP:0001252"


def test_lexical_prefix_query_ranks_matching_label_first(tmp_path: Path) -> None:
    """'hypoton' displayed Seizure above Hypotonia only because scored lexical
    results are shuffled for display by design; the recorded rank is correct."""
    from ontotator.vendor.hpo_span_annotator.hpo import load
    from ontotator.vendor.hpo_span_annotator.lexical import LexicalIndex
    from ontotator.vendor.hpo_span_annotator.search import SearchEngine

    ontology = load(HP_PATH)
    lexical = LexicalIndex(ontology)
    lexical.build()
    result = SearchEngine(ontology, lexical).search("hypoton", path="lexical", k=5)
    by_rank = sorted(result["hits"], key=lambda h: h["rank"])
    assert result["shuffled"] is True
    assert by_rank[0]["hpo_id"] == "HP:0001252"
    exact = SearchEngine(ontology, lexical).search("hypoton", path="exact", k=5)
    assert [h["hpo_id"] for h in exact["hits"]] == ["HP:0001252"]


# --- Finding 13: package-wide annotator export ----------------------------- #


def _annotate(client, annotator: str, document_id: str, term_id: str) -> str:  # type: ignore[no-untyped-def]
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "pkg-scenario-a",
            "document_id": document_id,
            "annotator_id": annotator,
            "mode": "independent",
        },
    )
    assert opened.status_code == 200, opened.text
    ws_id = opened.json()["workspace_id"]
    key = opened.json()["view"]["key"]
    search = client.post(
        "/api/v1/search",
        json={
            "workspace_key": key,
            "annotation_id": f"ann-{annotator}",
            "layer_id": "hpo-layer",
            "query": "hypotonia",
            "route": "exact",
            "k": 5,
        },
    )
    assert search.status_code == 200, search.text
    steps = [
        {
            "command": "create_annotation",
            "note": "Finding inferred from the complete document",
            "annotation_id": f"ann-{annotator}",
            "layer_id": "hpo-layer",
            "term_id": term_id,
            "axes": {
                "assertion": "present",
                "experiencer": "patient",
                "temporality": "current",
            },
            "chosen_axis_ids": ["assertion", "experiencer", "temporality"],
        },
        {"command": "check_layer", "layer_id": "hpo-layer", "checked": True},
    ]
    for revision, payload in enumerate(steps):
        resp = client.post(
            f"/api/v1/workspaces/{ws_id}/commands",
            json={
                "mutation_id": f"{annotator}-{document_id}-{revision}",
                "expected_revision": revision,
                "payload": payload,
            },
        )
        assert resp.status_code == 200, resp.text
    resp = client.post(
        f"/api/v1/workspaces/{ws_id}/submit",
        json={
            "mutation_id": f"{annotator}-{document_id}-submit",
            "expected_revision": len(steps),
            "payload": {"document_checked": True},
        },
    )
    assert resp.status_code == 200, resp.text
    return ws_id


def test_package_export_contains_all_work_of_one_annotator_and_reimports(
    tmp_path: Path,
) -> None:
    from test_api import _create_sample_package_bytes

    from ontotator.ontology.registry import OntologyRegistry

    client, _ = _app(tmp_path / "a", ontology_paths=[HP_PATH])
    archive = _create_sample_package_bytes("single")
    uploaded = upload_package(client, files={"file": ("p.zip", archive, "x")})
    assert uploaded.status_code == 200, uploaded.text
    _annotate(client, "dr. Müller/1", "doc-beta", "HP:0001252")
    _annotate(client, "dr. Müller/1", "doc-alpha", "HP:0001250")
    _annotate(client, "other", "doc-beta", "HP:0001250")

    exported = package_export_zip(
        client.app, "pkg-scenario-a", "dr. Müller/1", "independent"
    )

    registry = OntologyRegistry()
    registry.register_path(HP_PATH)
    pkg = read_package(io.BytesIO(exported), registry=registry)
    assert pkg.manifest.origin_package_id == "pkg-scenario-a"
    assert pkg.manifest.document_order == ["doc-beta", "doc-alpha"]
    assert {s.origin_key.annotator_id for s in pkg.submissions.values()} == {
        "dr. Müller/1"
    }
    assert {s.origin_key.document_id for s in pkg.submissions.values()} == {
        "doc-beta",
        "doc-alpha",
    }
    assert {a.annotation.term_id for a in pkg.annotations.values()} == {
        "HP:0001252",
        "HP:0001250",
    }
    assert pkg.search_events
    assert {e.workspace_key.annotator_id for e in pkg.search_events} == {"dr. Müller/1"}

    other = package_export_zip(client.app, "pkg-scenario-a", "other")
    other_pkg = read_package(io.BytesIO(other), registry=registry)
    # IAA: both exports pin the same origin package, documents and profile.
    assert other_pkg.manifest.origin_manifest_hash == pkg.manifest.origin_manifest_hash
    assert other_pkg.manifest.task_profile_sha256 == pkg.manifest.task_profile_sha256
    assert {d: doc.text_sha256 for d, doc in other_pkg.documents.items()} == {
        d: doc.text_sha256 for d, doc in pkg.documents.items()
    }

    fresh, _ = _app(tmp_path / "b", ontology_paths=[HP_PATH])
    for data in (exported, other):
        imported = upload_package(fresh, files={"file": ("e.zip", data, "x")})
        assert imported.status_code == 200, imported.text
    # Re-importing the identical export is idempotent.
    again = upload_package(fresh, files={"file": ("e.zip", exported, "x")})
    assert again.status_code == 200, again.text


def test_package_export_without_work_is_rejected(tmp_path: Path) -> None:
    from test_api import _create_sample_package_bytes

    client, _ = _app(tmp_path, ontology_paths=[HP_PATH])
    archive = _create_sample_package_bytes("single")
    upload_package(client, files={"file": ("p.zip", archive, "x")})

    with pytest.raises(DomainError) as error:
        package_export_zip(client.app, "pkg-scenario-a", "nobody")
    assert error.value.code == "NO_ANNOTATOR_WORK"
