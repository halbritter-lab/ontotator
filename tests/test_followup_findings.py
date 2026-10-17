"""Regression tests for the follow-up review findings."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest
from pg_harness import database_for
from support.v2_exports import ExportService
from test_storage import _sample_package

from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import (
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.storage.repository import Repository


def _colon_key() -> WorkspaceKey:
    return WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="orcid:0000-0001",
        mode="independent",
        scope_id=build_scope(
            _sample_package().manifest.task_profile, "independent"
        ).scope_id,
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )


# --- Finding 2/3: package export loads once and keeps resubmissions --------- #


def _submit(repo: Repository, key: WorkspaceKey, revision: int, sub_id: str) -> None:
    package = _sample_package()
    repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id=f"{sub_id}-submit", expected_revision=revision, payload={}
        ),
        lambda draft: Submission(
            submission_id=sub_id,
            origin_key=key,
            targets=draft.targets,
            draft_revision=draft.revision + 1,
            snapshots=list(package.annotations.values()),
            decisions=[],
            created_at=f"2026-01-01T00:00:0{revision}+00:00",
        ),
    )


def test_package_export_loads_package_once_and_keeps_resubmissions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = Repository(database_for(tmp_path / "db"))
    repo.import_package(_sample_package())
    independent = _colon_key().model_copy(update={"annotator_id": "a"})
    review = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="a",
        mode="review",
        scope_id=build_scope(
            _sample_package().manifest.task_profile, "review"
        ).scope_id,
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )
    for key in (independent, review):
        repo.open_draft(key)
    _submit(repo, independent, 0, "sub-first")
    _submit(repo, independent, 1, "sub-resubmit")

    calls: list[str] = []
    original = repo.export_package

    def counting(project_key: str, *, include_captured_conditions: bool = True):  # type: ignore[no-untyped-def]
        calls.append(project_key)
        return original(
            project_key, include_captured_conditions=include_captured_conditions
        )

    monkeypatch.setattr(repo, "export_package", counting)
    exported = ExportService(repo).for_package("pkg-1", "a")
    assert calls == ["pkg-1"]
    assert len(repo.list_workspace_keys("pkg-1", "a")) == 2

    # Resubmissions stay in the export (audit trail); the latest one per
    # workspace is the one with the highest draft_revision.
    subs = sorted(exported.submissions.values(), key=lambda s: s.draft_revision)
    assert [s.submission_id for s in subs] == ["sub-first", "sub-resubmit"]
    assert subs[0].origin_key == subs[1].origin_key
    assert subs[0].draft_revision < subs[1].draft_revision
    assert subs[0].created_at < subs[1].created_at


# --- Finding 8: ontology parsing does not hold the shared registry lock ---- #


def test_registry_parses_outside_shared_lock_and_only_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ontocurator.ontology import registry as registry_module
    from ontocurator.ontology.registry import OntologyRegistry

    hp = Path(__file__).parent / "fixtures" / "hp.json"
    reg = OntologyRegistry()
    sha = reg.register_path(hp)
    original_load = registry_module.OntologyService.load
    started = threading.Event()
    release = threading.Event()
    loads: list[Path] = []

    def slow_load(path, ref, **kwargs):  # type: ignore[no-untyped-def]
        loads.append(path)
        started.set()
        assert release.wait(10)
        return original_load(path, ref, **kwargs)

    monkeypatch.setattr(registry_module.OntologyService, "load", slow_load)
    results: list[object] = []
    workers = [
        threading.Thread(target=lambda: results.append(reg.get_service(sha)))
        for _ in range(2)
    ]
    for w in workers:
        w.start()
    assert started.wait(10)

    # While one ontology is being parsed other requests are not blocked.
    probe = threading.Thread(target=lambda: results.append(reg.has_ontology(sha)))
    probe.start()
    probe.join(2)
    blocked = probe.is_alive()
    release.set()
    for w in workers:
        w.join(10)
    probe.join(10)
    assert not blocked, "shared registry lock held during parsing"
    services = [r for r in results if r is not True]
    assert len(services) == 2 and services[0] is services[1]
    assert len(loads) == 1


# --- Finding 10: verified adoption stores the primary term id ------------- #


def test_verified_adoption_normalizes_term_id_and_keeps_source(
    tmp_path: Path,
) -> None:
    from test_review_findings import _Session

    session = _Session(tmp_path, with_source_term="hp:0001252")
    draft = session.apply(
        command="create_annotation",
        annotation_id="a-1",
        evidence_id="current-hypotonia",
        segments=[{"start": 26, "end": 35}],
        term_id="hp:0001252",
        source_annotation_id="src-1",
        source_version=session.source.version,
    )
    ann = draft.annotations[0].annotation
    assert ann.term_id == "HP:0001252"
    assert ann.provenance.source_refs == [f"src-1:{session.source.version}"]
