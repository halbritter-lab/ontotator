import pytest
from test_packages import _create_sample_package
from test_reviews import _setup_review_test_env

from ontocurator.application.reviews import DecisionCommand
from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontocurator.packages.reader import read_package
from ontocurator.packages.writer import write_package


def review(ctx, reviewer="one"):
    snap = ctx["snap_a"]
    ref = AnnotationRef(
        annotation_id=snap.annotation.annotation_id, version=snap.version
    )
    targets = ReviewTargetSet.create([ref])
    key = WorkspaceKey(
        package_id="pkg-rev-1",
        document_id="doc-1",
        annotator_id=reviewer,
        mode="review",
        target_set_id=targets.target_set_id,
    )
    view = ctx["ws_svc"].open(key, targets)
    return view.key, ref


def test_decision_identity_is_workspace_scoped(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    ids = []
    for reviewer in ["one", "two"]:
        key, ref = review(ctx, reviewer)
        draft = ctx["rev_svc"].decide(
            key,
            MutationEnvelope(
                mutation_id="dec",
                expected_revision=0,
                payload=DecisionCommand(target=ref, outcome="confirmed").model_dump(),
            ),
        )
        ids.append(draft.decisions[0].decision_id)
    assert len(set(ids)) == 2


def test_missing_replacement_fails_closed(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    key, ref = review(ctx)
    with pytest.raises(DomainError):
        ctx["rev_svc"].decide(
            key,
            MutationEnvelope(
                mutation_id="dec",
                expected_revision=0,
                payload=DecisionCommand(
                    target=ref,
                    outcome="changed",
                    replacement=AnnotationRef(annotation_id="absent", version="absent"),
                ).model_dump(),
            ),
        )


def test_workspace_rejects_forged_target_identity(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    key, _ = review(ctx)
    forged = ReviewTargetSet(target_set_id=key.target_set_id, targets=[])
    with pytest.raises(DomainError):
        ctx["ws_svc"].open(key, forged)


def test_edit_invalidates_replacement_approval(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    key, ref = review(ctx)
    draft = ctx["edit_svc"].apply(
        key,
        MutationEnvelope(
            mutation_id="new",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "replacement",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001252",
            },
        ),
    )
    replacement = AnnotationRef(
        annotation_id="replacement", version=draft.annotations[0].version
    )
    ctx["rev_svc"].decide(
        key,
        MutationEnvelope(
            mutation_id="dec",
            expected_revision=1,
            payload=DecisionCommand(
                target=ref, outcome="changed", replacement=replacement
            ).model_dump(),
        ),
    )
    draft = ctx["edit_svc"].apply(
        key,
        MutationEnvelope(
            mutation_id="edit",
            expected_revision=2,
            payload={
                "command": "set_term",
                "annotation_id": "replacement",
                "term_id": "HP:0001250",
            },
        ),
    )
    assert draft.decisions == []


def test_package_rejects_snapshot_document_digest_mismatch(tmp_path):
    from ontocurator.domain.annotations import snapshot

    pkg = _create_sample_package()
    original = next(iter(pkg.annotations.values()))
    doc = pkg.documents["doc-1"].model_copy(update={"text_sha256": "forged"})
    forged = snapshot(
        original.annotation, original.evidence, doc, pkg.manifest.task_profile
    )
    pkg.annotations = {(forged.annotation.annotation_id, forged.version): forged}
    pkg.submissions = {}
    path = tmp_path / "bad.zip"
    write_package(pkg, path)
    with pytest.raises(InvalidPackage):
        read_package(path)


def test_search_selection_is_bound_to_workspace_and_recorded(tmp_path):
    from ontocurator.packages.models import SearchEventRecord

    ctx = _setup_review_test_env(tmp_path)
    key, _ = review(ctx)
    event = SearchEventRecord(
        event_id="search",
        workspace_key=key,
        annotation_id="new",
        query="seizure",
        route="lexical",
        candidates=["HP:0001250", "HP:0001252"],
        ranked_ids=["HP:0001252", "HP:0001250"],
        layer_id="hpo-layer",
        ontology_release="test",
        index_identity="test",
        timestamp="2026-10-01",
    )
    ctx["repo"].save_search_event(event)
    ctx["edit_svc"].apply(
        key,
        MutationEnvelope(
            mutation_id="select",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "new",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": "HP:0001250",
                "search_event_id": "search",
            },
        ),
    )
    assert ctx["repo"].get_search_event("search") == event
    saved = next(
        e
        for e in ctx["repo"].get_search_events_for_workspace(key)
        if e.event_id != "search"
    )
    assert (
        saved.selected_term_id,
        saved.displayed_position,
        saved.ranked_position,
    ) == (
        "HP:0001250",
        1,
        2,
    )
    foreign, _ = review(ctx, "other")
    with pytest.raises(DomainError):
        ctx["edit_svc"].apply(
            foreign,
            MutationEnvelope(
                mutation_id="select",
                expected_revision=0,
                payload={
                    "command": "create_annotation",
                    "annotation_id": "new",
                    "layer_id": "hpo-layer",
                    "type_id": "phenotype",
                    "term_id": "HP:0001250",
                    "search_event_id": "search",
                },
            ),
        )


@pytest.mark.parametrize(
    "mutation",
    ["ontology", "evidence_document", "bounds", "submitted_snapshot", "target_hash"],
)
def test_package_rejects_self_consistent_but_unbound_content(tmp_path, mutation):
    from ontocurator.domain.canonical import canonical_hash
    from ontocurator.domain.profiles import profile_hash

    pkg = _create_sample_package()
    if mutation == "ontology":
        pkg.manifest.task_profile.ontologies[0].sha256 = "wrong-ontology"
        pkg.manifest.task_profile_sha256 = profile_hash(pkg.manifest.task_profile)
    elif mutation in {"evidence_document", "bounds"}:
        ev = next(iter(pkg.evidence.values()))
        pkg.annotations = {}
        pkg.submissions = {}
        if mutation == "evidence_document":
            ev.document_id = "missing"
        else:
            ev.mention.segments[0].end = 10000
        ev.version = canonical_hash(
            {
                "document_id": ev.document_id,
                "mention": ev.mention.model_dump(),
                "text_sha256": ev.text_sha256,
            }
        )
        pkg.evidence = {(ev.mention.evidence_id, ev.version): ev}
    elif mutation == "submitted_snapshot":
        next(iter(pkg.submissions.values())).snapshots[0].ontology_sha256 = "forged"
        # detach mutation from the top-level canonical row
        pkg.annotations = _create_sample_package().annotations
    else:
        next(iter(pkg.submissions.values())).targets.target_set_id = "forged"
    path = tmp_path / "invalid.zip"
    write_package(pkg, path)
    with pytest.raises(InvalidPackage):
        read_package(path)


def test_review_versions_have_separate_decisions(tmp_path):
    from ontocurator.domain.annotations import snapshot
    from ontocurator.domain.workspace import Draft

    ctx = _setup_review_test_env(tmp_path)
    first = ctx["snap_a"]
    second = snapshot(
        first.annotation.model_copy(update={"term_id": "HP:0001250"}),
        first.evidence,
        ctx["doc"],
        ctx["profile"],
    )
    refs = [
        AnnotationRef(annotation_id=s.annotation.annotation_id, version=s.version)
        for s in [first, second]
    ]
    targets = ReviewTargetSet.create(refs)
    from ontocurator.domain.scopes import build_scope

    scope = build_scope(ctx["profile"], "review")
    key = WorkspaceKey(
        package_id="pkg-rev-1",
        document_id="doc-1",
        annotator_id="one",
        mode="review",
        scope_id=scope.scope_id,
        target_set_id=targets.target_set_id,
    )
    draft = Draft(key=key, targets=targets, revision=0)

    # Both immutable versions are members of the same document.
    ctx["repo"].list_annotations_for_document = lambda *_: [first, second]
    for ref in refs:
        ctx["rev_svc"]._execute_decision(
            draft, DecisionCommand(target=ref, outcome="confirmed"), key
        )
    assert len(draft.decisions) == 2
    assert len({d.decision_id for d in draft.decisions}) == 2


def test_submission_fails_when_target_disappears(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    key, ref = review(ctx)
    ctx["rev_svc"].decide(
        key,
        MutationEnvelope(
            mutation_id="dec",
            expected_revision=0,
            payload=DecisionCommand(target=ref, outcome="confirmed").model_dump(),
        ),
    )
    ctx["repo"].list_annotations_for_document = lambda *_: []
    with pytest.raises(DomainError, match="TARGET_NOT_FOUND"):
        ctx["sub_svc"].submit(
            key,
            MutationEnvelope(
                mutation_id="submit",
                expected_revision=1,
                payload={"checked_layer_ids": ["hpo-layer"]},
            ),
        )


def test_imported_submission_read_and_resume_are_scoped(tmp_path):
    ctx = _setup_review_test_env(tmp_path)
    key, ref = review(ctx)
    ctx["rev_svc"].decide(
        key,
        MutationEnvelope(
            mutation_id="dec",
            expected_revision=0,
            payload=DecisionCommand(target=ref, outcome="confirmed").model_dump(),
        ),
    )
    submission = ctx["sub_svc"].submit(
        key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=1,
            payload={"checked_layer_ids": ["hpo-layer"]},
        ),
    )
    pkg = ctx["exp_svc"].for_workspace(key)
    pkg.manifest.package_id = "imported"
    ctx["repo"].import_package(pkg)
    local_key = key.model_copy(update={"package_id": "imported"})
    assert ctx["sub_svc"].read(local_key, submission.submission_id) == submission
    with pytest.raises(DomainError):
        ctx["sub_svc"].read(
            local_key.model_copy(update={"annotator_id": "foreign"}),
            submission.submission_id,
        )
    view = ctx["ws_svc"].open(local_key, submission.targets)
    assert len(view.draft.decisions) == 1
    assert view.draft.annotations == []
    assert view.draft.revision == submission.draft_revision


def test_sequential_search_selections_survive_two_export_imports(tmp_path):
    from pg_harness import database_for

    from ontocurator.ontology.registry import OntologyRegistry
    from ontocurator.packages.models import SearchEventRecord
    from ontocurator.storage.repository import Repository

    ctx = _setup_review_test_env(tmp_path)
    key, _ = review(ctx)
    query = SearchEventRecord(
        event_id="query",
        workspace_key=key,
        annotation_id="new",
        query="hypotonia",
        route="lexical",
        candidates=["HP:0001250", "HP:0001252"],
        ranked_ids=["HP:0001252", "HP:0001250"],
        layer_id="hpo-layer",
        ontology_release="test",
        index_identity="test",
        timestamp="2026-10-01",
    )
    ctx["repo"].save_search_event(query)
    db = database_for(tmp_path / "recipient.db")
    recipient = Repository(db)
    reg = OntologyRegistry()
    reg.register_service(ctx["ontology"])

    for revision, term in enumerate(["HP:0001250", "HP:0001252"]):
        if revision == 0:
            payload = {
                "command": "create_annotation",
                "annotation_id": "new",
                "layer_id": "hpo-layer",
                "type_id": "phenotype",
                "term_id": term,
                "search_event_id": "query",
            }
        else:
            payload = {
                "command": "set_term",
                "annotation_id": "new",
                "term_id": term,
                "search_event_id": "query",
            }
        envelope = MutationEnvelope(
            mutation_id=f"select-{revision}",
            expected_revision=revision,
            payload=payload,
        )
        ctx["edit_svc"].apply(key, envelope)

        ctx["edit_svc"].apply(key, envelope)  # Retry must not duplicate the audit row.
        exported = ctx["exp_svc"].for_workspace(key)
        path = tmp_path / f"export-{revision}.zip"
        write_package(exported, path)
        recipient.import_package(read_package(path, registry=reg))
    rows = ctx["repo"].get_search_events_for_workspace(key)
    assert len(rows) == 3
    assert ctx["repo"].get_search_event("query") == query
    selections = [e for e in rows if e.event_id != "query"]
    assert {e.selected_term_id for e in selections} == {"HP:0001250", "HP:0001252"}
    assert {e.source_search_event_id for e in selections} == {"query"}
    assert all(recipient.get_search_event(e.event_id) == e for e in rows)
