"""Final-result panel data and agreement in the Final cell (documents overview
spec V6, V9, VD16, "Final-result panel", plan O3b).

Service-level tests call ``DocumentRowsService.final_panel`` / ``page``
directly; the HTTP tests at the end need the route (``final-panel``).
"""

from __future__ import annotations

from typing import Any

import pytest
from document_rows_support import rows_of
from document_rows_support import service as rows_service
from sqlalchemy import insert, select, update
from test_document_rows_next_step import (
    SECOND,
    add_correction,
    second_root,
    set_status,
)
from test_document_rows_stages import submit_with_findings
from test_document_rows_submissions import (
    _lead_service,
    _row_of,
    _submit_consolidation,
)
from test_work_rounds import create_consolidation_fixture
from work_plan_support import BASE, assign, doc, plan_env, select_final, write

from ontocurator.application import document_row_panel
from ontocurator.application.document_rows import RowQuery
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.errors import AccessDenied
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.domain.workspace import Submission, WorkspaceKey
from ontocurator.storage.overview_tables import TextChangeResolutionRow
from ontocurator.storage.repository import _key_str
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    SubmissionRow,
    UserLanguageRow,
    UserRow,
)

pytest_plugins = ("test_work_rounds",)

SEIZURE = "HP:0001250"
HYPOTONIA = "HP:0001252"
FEVER = "HP:0001945"
ATAXIA = "HP:0001251"


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def _text(env: Any, document_id: str) -> str:
    with env.db.transaction() as conn:
        return str(
            conn.execute(
                select(DocumentRow.text).where(
                    DocumentRow.project_id == env.pid,
                    DocumentRow.document_id == document_id,
                )
            ).scalar_one()
        )


def span_of(env: Any, document_id: str, word: str) -> tuple[int, int]:
    start = _text(env, document_id).index(word)
    return start, start + len(word)


def finding(
    annotation_id: str,
    term_id: str,
    span: tuple[int, int] | None,
    **axes: str | None,
) -> dict[str, Any]:
    return {"id": annotation_id, "term": term_id, "span": span, "axes": axes}


def submit_findings(
    env: Any, assignment_id: int, sid: str, findings: list[dict[str, Any]]
) -> None:
    """Record a submission with real snapshots and mark the assignment submitted."""
    repo = env.app.state.repo
    with env.db.transaction() as conn:
        row = conn.execute(
            select(AssignmentRow.document_id, UserRow.pseudonym)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(AssignmentRow.id == assignment_id)
        ).one()
    document = repo.get_document("proj", row.document_id)
    profile = repo.get_task_profile("proj")
    snapshots = []
    for item in findings:
        evidence = []
        if item["span"] is not None:
            mention = EvidenceMention(
                evidence_id=f"ev-{item['id']}",
                segments=[Segment(start=item["span"][0], end=item["span"][1])],
            )
            evidence.append(EvidenceSnapshot.create(mention, document))
        axes = {"assertion": "present", "experiencer": "patient"} | item["axes"]
        annotation = Annotation(
            annotation_id=item["id"],
            document_id=row.document_id,
            layer_id="hpo",
            type_id="phenotype",
            term_id=item["term"],
            axes_values=axes,
            evidence_refs=[
                EvidenceRef(evidence_id=e.mention.evidence_id, version=e.version)
                for e in evidence
            ],
            provenance=Provenance(
                actor=ActorRef(actor_id=row.pseudonym, kind="human"),
                method="manual",
            ),
        )
        snapshots.append(snapshot(annotation, evidence, document, profile))
    key = WorkspaceKey(
        project_key="proj",
        document_id=row.document_id,
        annotator_id=row.pseudonym,
        mode="independent",
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=sid,
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=snapshots,
        decisions=[],
        created_at="2026-10-16T10:00:00Z",
    )
    with env.db.transaction() as conn:
        repo._insert_submission(
            conn, env.pid, record, local_key=_key_str(key), imported=False
        )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(status="submitted", last_submission_id=sid)
        )


def panel(env: Any, case: str = "c1", language: str = "en") -> dict[str, Any]:
    return rows_service(env).final_panel("proj", case, language)


def by_id(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["submission_id"]: item for item in result["submissions"]}


def final_cell(env: Any, case: str = "c1", language: str = "en") -> dict[str, Any]:
    page = rows_service(env).page("proj", RowQuery())
    return dict(rows_of(page)[(case, language)]["stages"]["final"])


def accepted_correction(env: Any, parent: str, document_id: str) -> None:
    add_correction(env, parent, document_id, "accepted")


def test_one_submission_label_rule_accept(env):
    target = doc("c1", "en")
    seizure = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "s1",
        [finding("a1", SEIZURE, seizure), finding("a2", HYPOTONIA, None)],
    )
    result = panel(env)
    assert result["label_rule"] == "accept"
    assert result["accept_submission_id"] == "s1"
    assert result["agreement"] is None
    assert result["changed_passages"] is None
    assert result["causes"] == []
    (only,) = result["submissions"]
    assert only["submission_id"] == "s1" and only["finding_count"] == 2
    assert (only["eligible"], only["comparable"], only["only_here"]) == (
        True,
        True,
        None,
    )
    # RowSubmissionView fields flow through (guidelines included).
    assert "guideline_version" in only and "author" in only
    cell = final_cell(env)
    assert (cell["state"], cell["detail"]["submitted"]) == ("choose", 1)
    assert cell["detail"]["matching"] is None and cell["detail"]["compared"] is None
    assert cell["detail"]["label_rule"] == "accept"


def test_several_is_compare_with_agreement(env):
    target = doc("c1", "en")
    neonatal = span_of(env, target, "Neonatalzeit")
    heavy = span_of(env, target, "schwere")
    first = span_of(env, target, "Krampfanfälle")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "s1",
        [
            finding("a1", SEIZURE, (neonatal[0], neonatal[0] + 6)),
            finding("a2", HYPOTONIA, heavy, assertion="present"),
            finding("a3", FEVER, None),
        ],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        "s2",
        [
            # Overlaps a1 by one character; a missing axis equals its default.
            finding("b1", SEIZURE, (neonatal[0] + 5, neonatal[1]), assertion=None),
            # Same term and position, other context.
            finding("b2", HYPOTONIA, heavy, assertion="absent"),
            finding("b3", ATAXIA, first),
        ],
    )
    result = panel(env)
    assert result["label_rule"] == "compare"
    assert result["accept_submission_id"] is None
    assert result["agreement"] == {
        "compared_version": 1,
        "total": 4,
        "matching": 1,
        "context_differences": 1,
    }
    subs = by_id(result)
    assert [s["submission_id"] for s in result["submissions"]] == ["s1", "s2"]
    assert (subs["s1"]["only_here"], subs["s2"]["only_here"]) == (1, 1)
    assert all(s["comparable"] and s["eligible"] for s in subs.values())
    cell = final_cell(env)
    assert (cell["state"], cell["detail"]["submitted"]) == ("choose", 2)
    assert (cell["detail"]["matching"], cell["detail"]["compared"]) == (1, 4)
    assert cell["detail"]["label_rule"] == "compare"


def test_other_version_submissions_not_compared_but_eligible(env):
    old = doc("c1", "en")
    submit_findings(
        env,
        assign(env, old, "ana", "annotate"),
        "s0",
        [finding("o1", SEIZURE, None)],
    )
    accepted_correction(env, old, "c1-en-v2")
    for username, sid in (("anno", "s1"), ("anno2", "s2")):
        submit_findings(
            env,
            assign(env, "c1-en-v2", username, "annotate"),
            sid,
            [finding(f"{sid}-1", SEIZURE, None)],
        )
    result = panel(env)
    subs = by_id(result)
    assert subs["s0"]["version"] == 1
    assert (subs["s0"]["eligible"], subs["s0"]["comparable"]) == (True, False)
    assert subs["s0"]["only_here"] is None
    assert all(subs[sid]["comparable"] for sid in ("s1", "s2"))
    assert result["agreement"] == {
        "compared_version": 2,
        "total": 1,
        "matching": 1,
        "context_differences": 0,
    }
    assert (subs["s1"]["only_here"], subs["s2"]["only_here"]) == (0, 0)
    assert result["label_rule"] == "compare"


def test_review_changes_causes_and_changed_passages(env):
    old = doc("c1", "en")
    text = _text(env, old)
    submit_findings(
        env,
        assign(env, old, "anno", "annotate"),
        "s1",
        [
            finding("a1", SEIZURE, span_of(env, old, "Neonatalzeit")),
            finding("a2", HYPOTONIA, span_of(env, old, "schwere")),
            finding("a3", FEVER, None),
        ],
    )
    select_final(env, old, "s1")
    assert panel(env)["changed_passages"] is None
    accepted_correction(env, old, "c1-en-v2")
    changed = text.replace("Neonatalzeit", "Säuglingszeit")
    import hashlib

    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(
                DocumentRow.project_id == env.pid,
                DocumentRow.document_id == "c1-en-v2",
            )
            .values(
                text=changed,
                text_sha256=hashlib.sha256(changed.encode("utf-8")).hexdigest(),
            )
        )
    result = panel(env)
    assert result["changed_passages"] == 1
    codes = [cause["code"] for cause in result["causes"]]
    assert "SELECTED_TEXT_CORRECTED" in codes
    cause = next(c for c in result["causes"] if c["code"] == "SELECTED_TEXT_CORRECTED")
    assert cause["document_id"] == "c1-en-v2" and cause["version"] == 2


def test_replace_a_final_on_the_old_text(env):
    """A final in state ``old_text`` (chosen on v1, text corrected to v2) is
    replaced by a newer submission: a plain selection at the current
    revision, no acknowledged causes (the panel's "Use as final")."""
    old = doc("c1", "en")
    submit_findings(
        env, assign(env, old, "anno", "annotate"), "s1", [finding("a1", SEIZURE, None)]
    )
    first = select_final(env, old, "s1")
    accepted_correction(env, old, "c1-en-v2")
    submit_findings(
        env,
        assign(env, "c1-en-v2", "anno2", "annotate"),
        "s2",
        [finding("b1", SEIZURE, None)],
    )

    def final_cell() -> dict[str, Any]:
        page = rows_service(env).page("proj", RowQuery())
        return dict(rows_of(page)[("c1", "en")]["stages"]["final"])

    assert final_cell()["state"] == "old_text"
    response = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": "c1-en-v2",
            "submission_id": "s2",
            "expected_revision": first["revision"],
            "acknowledged_cause_ids": [],
        },
    )
    assert response.status_code == 200, response.text
    replaced = response.json()
    assert (replaced["document_id"], replaced["submission_id"]) == ("c1-en-v2", "s2")
    assert replaced["revision"] == first["revision"] + 1
    cell = final_cell()
    assert cell["state"] == "final"
    assert "SELECTED_TEXT_CORRECTED" not in [c["code"] for c in panel(env)["causes"]]


def test_panel_is_lead_only_and_uses_shared_lock(env, monkeypatch):
    from ontocurator.application import document_rows

    submit_findings(env, assign(env, doc("c1", "en"), "anno", "annotate"), "s1", [])
    seen: list[bool] = []
    original = document_rows.authorize_final_results

    def spy(conn: Any, actor: Any, key: str, *, exclusive: bool) -> int:
        seen.append(exclusive)
        return original(conn, actor, key, exclusive=exclusive)

    monkeypatch.setattr(document_rows, "authorize_final_results", spy)
    assert panel(env)["submissions"][0]["submission_id"] == "s1"
    assert seen == [False]
    with pytest.raises(AccessDenied):
        rows_service(env, "anno").final_panel("proj", "c1", "en")


def test_rows_page_fills_match_for_shown_choose_rows_only(env, monkeypatch):
    from ontocurator.application import document_row_page

    for case in ("c1", "c2"):
        target = doc(case, "en")
        for username, sid in (("anno", f"{case}-s1"), ("anno2", f"{case}-s2")):
            submit_findings(
                env,
                assign(env, target, username, "annotate"),
                sid,
                [finding(f"{sid}-1", SEIZURE, None)],
            )
    calls: list[tuple[str, ...]] = []
    original = document_row_panel.compare

    def spy(findings: Any, order: Any) -> Any:
        calls.append(tuple(order))
        return original(findings, order)

    monkeypatch.setattr(document_row_panel, "compare", spy)
    monkeypatch.setattr(document_row_page, "PAGE_SIZE", 1)
    first = rows_of(rows_service(env).page("proj", RowQuery()))
    assert set(first) == {("c1", "en"), ("c1", "de"), ("c1", "fr")}
    detail = first[("c1", "en")]["stages"]["final"]["detail"]
    assert (detail["matching"], detail["compared"]) == (1, 1)
    # Rows not in state choose stay empty; c2 (page 2) was not compared.
    assert first[("c1", "de")]["stages"]["final"]["detail"]["matching"] is None
    assert calls == [("c1-s1", "c1-s2")]
    calls.clear()
    second = rows_of(rows_service(env).page("proj", RowQuery(page=2)))
    detail = second[("c2", "en")]["stages"]["final"]["detail"]
    assert (detail["matching"], detail["compared"]) == (1, 1)
    assert calls == [("c2-s1", "c2-s2")]


# --- consolidation fixture (project pkg-1) -------------------------------- #


def _consolidated(rounds: Any) -> tuple[Any, Any, str, tuple[str, str], list[str]]:
    repo, ontology, reviewer, result, inputs, access, actor = (
        create_consolidation_fixture(rounds)
    )
    output = _submit_consolidation(ontology, reviewer, result)
    key = tuple(_row_of(repo, "doc-1"))
    lead = _lead_service(repo, access, actor)
    return (
        repo,
        lead,
        output.submission_id,
        (key[0], key[1]),
        [item.submission_id for item in inputs],
    )


def test_consolidation_of_all_others_is_accept(rounds):
    _repo, lead, consolidation, key, inputs = _consolidated(rounds)
    result = lead.final_panel("pkg-1", *key)
    assert result["label_rule"] == "accept"
    assert result["accept_submission_id"] == consolidation
    subs = by_id(result)
    assert set(subs) == {*inputs, consolidation}
    assert all(s["eligible"] and s["comparable"] for s in subs.values())
    # "Compare all 3…" needs the agreement of all three.
    # Each input holds one HP:0001252 finding without evidence; the
    # consolidation confirms both and keeps two: one cluster all three
    # share, one only the consolidation has.
    assert result["agreement"] == {
        "compared_version": 1,
        "total": 2,
        "matching": 1,
        "context_differences": 0,
    }
    assert [subs[sid]["only_here"] for sid in [*inputs, consolidation]] == [0, 0, 1]
    # The Final cell shows "3 submissions" without a match count (accept).
    page = lead.page("pkg-1", RowQuery())
    final = rows_of(page)[key]["stages"]["final"]
    assert (final["state"], final["detail"]["submitted"]) == ("choose", 3)
    assert final["detail"]["matching"] is None
    assert final["detail"]["label_rule"] == "accept"


def test_eligible_count_only_on_target_without_carried_moved_handed_over(rounds):
    """VD16: a carried v1 submission and a v2 consolidation of both v2
    submissions -> accept, "3 submissions"; the v1 submission stays listed."""
    repo, lead, consolidation, key, _inputs = _consolidated(rounds)
    with repo.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "pkg-1")
        ).scalar_one()
        current = dict(
            conn.execute(
                select(*DocumentRow.__table__.c).where(
                    DocumentRow.project_id == pid, DocumentRow.document_id == "doc-1"
                )
            )
            .mappings()
            .one()
        )
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.project_id == pid, DocumentRow.document_id == "doc-1")
            .values(version=2)
        )
        conn.execute(
            insert(DocumentRow).values(
                {**current, "document_id": "doc-0", "version": 1, "position": None}
            )
        )
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.project_id == pid, DocumentRow.document_id == "doc-1")
            .values(
                origin="correction",
                derived_from="doc-0",
                translation_status="accepted",
            )
        )
        old_key = WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-0",
            annotator_id="anna",
            mode="independent",
            target_set_id="targets-0",
        )
        record = Submission(
            submission_id="old-v1",
            origin_key=old_key,
            targets=ReviewTargetSet.create([]),
            draft_revision=1,
            snapshots=[],
            decisions=[],
            created_at="2026-10-16T09:00:00Z",
        )
        repo._insert_submission(
            conn, pid, record, local_key=_key_str(old_key), imported=False
        )
        conn.execute(
            insert(TextChangeResolutionRow).values(
                project_id=pid,
                case_id=key[0],
                language=key[1],
                submission_id="old-v1",
                resolution="carried",
                from_document_id="doc-0",
                to_document_id="doc-1",
            )
        )
    result = lead.final_panel("pkg-1", *key)
    assert result["label_rule"] == "accept"
    assert result["accept_submission_id"] == consolidation
    old = by_id(result)["old-v1"]
    assert (old["eligible"], old["comparable"], old["only_here"]) == (
        True,
        False,
        None,
    )
    assert old["version"] == 1
    assert result["agreement"]["compared_version"] == 2
    final = rows_of(lead.page("pkg-1", RowQuery()))[key]["stages"]["final"]
    assert (final["state"], final["detail"]["submitted"]) == ("choose", 3)

    # A submitted annotate assignment on the target counts until its last
    # submission is handed over.
    with repo.db.transaction() as conn:
        uid = conn.execute(
            insert(UserRow)
            .values(username="cara", display_name="cara", pseudonym="cara")
            .returning(UserRow.id)
        ).scalar_one()
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=uid, role="annotator"
            )
        )
        conn.execute(insert(UserLanguageRow).values(user_id=uid, language="en"))
    extra = AssignmentService(repo.db).assign(
        Actor.cli(), "pkg-1", "doc-1", "cara", "annotate"
    )
    new_key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="cara",
        mode="independent",
        target_set_id="targets-0",
    )
    with repo.db.transaction() as conn:
        repo._insert_submission(
            conn,
            pid,
            Submission(
                submission_id="extra-v2",
                origin_key=new_key,
                targets=ReviewTargetSet.create([]),
                draft_revision=1,
                snapshots=[],
                decisions=[],
                created_at="2026-10-16T11:00:00Z",
            ),
            local_key=_key_str(new_key),
            imported=False,
        )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == extra.id)
            .values(status="submitted", last_submission_id="extra-v2")
        )
    result = lead.final_panel("pkg-1", *key)
    assert by_id(result)["extra-v2"]["comparable"] is True
    assert result["label_rule"] == "compare"
    final = rows_of(lead.page("pkg-1", RowQuery()))[key]["stages"]["final"]
    assert final["detail"]["submitted"] == 4
    assert final["detail"]["label_rule"] == "compare"
    with repo.db.transaction() as conn:
        conn.execute(
            insert(TextChangeResolutionRow).values(
                project_id=pid,
                case_id=key[0],
                language=key[1],
                submission_id="extra-v2",
                resolution="handed_over",
                from_document_id="doc-1",
                to_document_id="doc-0",
            )
        )
    result = lead.final_panel("pkg-1", *key)
    extra_view = by_id(result)["extra-v2"]
    assert (extra_view["comparable"], extra_view["only_here"]) == (False, None)
    assert result["label_rule"] == "accept"
    assert result["accept_submission_id"] == consolidation
    final = rows_of(lead.page("pkg-1", RowQuery()))[key]["stages"]["final"]
    assert final["detail"]["submitted"] == 3
    assert final["detail"]["label_rule"] == "accept"


def test_parallel_roots_cell_and_panel_compare_the_same_root(env, tmp_path):
    """VD16: the Final cell counts, and the panel compares, the target with
    the most eligible submissions; the other root's stay listed."""
    second_root(env, tmp_path)
    for document_id in (doc("c1", "fr"), SECOND):
        set_status(env, document_id, "accepted")
    write(env, {RowKey("c1", "fr"): PlanFlags(False, True)})
    submit_findings(
        env,
        assign(env, doc("c1", "fr"), "anno", "annotate"),
        "a1",
        [finding("a1-1", SEIZURE, None)],
    )
    for username, sid in (("anno2", "b1"), ("ana", "b2"), ("ben", "b3")):
        submit_findings(
            env,
            assign(env, SECOND, username, "annotate"),
            sid,
            [finding(f"{sid}-1", SEIZURE, None)],
        )
    result = panel(env, "c1", "fr")
    subs = by_id(result)
    assert {sid for sid, s in subs.items() if s["comparable"]} == {"b1", "b2", "b3"}
    assert subs["a1"]["comparable"] is False and subs["a1"]["only_here"] is None
    assert result["label_rule"] == "compare"
    assert result["agreement"] is not None
    assert (result["agreement"]["total"], result["agreement"]["matching"]) == (1, 1)
    cell = final_cell(env, "c1", "fr")
    assert cell["state"] == "choose"
    assert cell["detail"]["submitted"] == 3
    assert cell["detail"]["label_rule"] == "compare"
    assert (cell["detail"]["matching"], cell["detail"]["compared"]) == (1, 1)


def test_undecodable_payload_leaves_agreement_empty(env):
    target = doc("c1", "en")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "s1",
        [finding("s1-1", SEIZURE, None)],
    )
    # A stored payload whose snapshots do not decode.
    submit_with_findings(env, assign(env, target, "anno2", "annotate"), "s2", 1)
    result = panel(env)
    assert result["label_rule"] == "compare"
    assert result["agreement"] is None
    assert {s["only_here"] for s in result["submissions"]} == {None}
    cell = final_cell(env)
    assert cell["detail"]["label_rule"] == "compare"
    assert cell["detail"]["matching"] is None


def test_own_result_not_selectable_flag(rounds):
    repo, lead, consolidation, key, inputs = _consolidated(rounds)
    subs = by_id(lead.final_panel("pkg-1", *key))
    assert all(s["eligible"] for s in subs.values())
    with repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "pkg-1")
            .values(adjudicator_not_annotator=True)
        )
    subs = by_id(lead.final_panel("pkg-1", *key))
    own = [sid for sid, s in subs.items() if s["is_me"]]
    assert own == [inputs[0]]
    assert subs[inputs[0]]["eligible"] is False
    assert subs[inputs[0]]["comparable"] is True
    assert subs[inputs[1]]["eligible"] is True
    assert subs[consolidation]["eligible"] is True


def test_unknown_row_is_case_not_found(env):
    from ontocurator.domain.errors import DomainError

    with pytest.raises(DomainError) as caught:
        rows_service(env).final_panel("proj", "missing", "de")
    assert caught.value.code == "CASE_NOT_FOUND"


# --- HTTP (route added in part 2) ------------------------------------------ #


def test_final_panel_http_is_lead_only(env):
    from auth_harness import logged_in

    submit_findings(env, assign(env, doc("c1", "en"), "anno", "annotate"), "s1", [])
    response = env.lead.get(f"{BASE}/document-rows/c1/en/final-panel")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["label_rule"] == "accept"
    assert body["submissions"][0]["eligible"] is True
    # The table's Final cell carries the same label rule (StageCellDetailView).
    page = env.lead.get(f"{BASE}/document-rows")
    assert page.status_code == 200, page.text
    cells = {
        (row["case_id"], row["language"]): row["stages"]["final"]
        for group in page.json()["groups"]
        for row in group["rows"]
    }
    assert cells[("c1", "en")]["state"] == "choose"
    assert cells[("c1", "en")]["detail"]["label_rule"] == "accept"
    assert {
        cell["detail"]["label_rule"]
        for cell in cells.values()
        if cell["state"] != "choose"
    } <= {None}
    annotator = logged_in(env.app, "anno", assignments=[])
    denied = annotator.get(f"{BASE}/document-rows/c1/en/final-panel")
    assert denied.status_code == 403, denied.text


def test_final_panel_http_unknown_row_is_404(env):
    response = env.lead.get(f"{BASE}/document-rows/missing/de/final-panel")
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "CASE_NOT_FOUND"


def test_submission_rows_untouched(env):
    """The stored payloads are read only (nothing stored by the panel)."""
    submit_findings(env, assign(env, doc("c1", "en"), "anno", "annotate"), "s1", [])
    with env.db.transaction() as conn:
        before = conn.execute(select(SubmissionRow.payload)).all()
    panel(env)
    with env.db.transaction() as conn:
        assert conn.execute(select(SubmissionRow.payload)).all() == before


def test_label_rule_consolidation_needs_every_other_submission_as_input():
    """A consolidation input from a draft (no submission ID) does not cover
    an eligible submission, so the rule stays "compare"."""
    from datetime import UTC, datetime, timedelta

    from ontocurator.application.document_row_panel import Candidate, label_rule

    at = datetime(2026, 10, 21, tzinfo=UTC)
    eligible = [
        Candidate("a", "d"),
        Candidate("b", "d"),
        Candidate("c", "d", consolidation_round="r"),
    ]
    times = {"a": at, "b": at + timedelta(1), "c": at + timedelta(2)}
    assert label_rule(eligible, times, {"r": {"a", "b"}}) == ("accept", "c")
    assert label_rule(eligible, times, {"r": {"a"}}) == ("compare", None)
    assert label_rule(eligible, times, {}) == ("compare", None)
    assert label_rule(eligible[:1], times, {}) == ("accept", "a")
    assert label_rule([], times, {}) == ("compare", None)


# --- Full agreement (W1, acceptance fixes U7) ------------------------------ #


def test_all_match_identical_findings_selects_earliest(env):
    target = doc("c1", "en")
    seizure = span_of(env, target, "Neonatalzeit")
    same = [finding("x1", SEIZURE, seizure), finding("x2", HYPOTONIA, None)]
    submit_findings(env, assign(env, target, "anno", "annotate"), "s1", same)
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        "s2",
        [finding("y1", SEIZURE, seizure), finding("y2", HYPOTONIA, None)],
    )
    result = panel(env)
    assert result["label_rule"] == "compare"
    assert result["all_match"] is True
    assert result["all_match_submission_id"] == "s1"


def test_all_match_skips_the_leads_own_submission(env):
    from auth_harness import grant

    assert grant(env.app, "leader", "proj", ["lead", "annotator"])
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(adjudicator_not_annotator=True)
        )
    target = doc("c1", "en")
    seizure = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "leader", "annotate"),
        "own",
        [finding("x1", SEIZURE, seizure)],
    )
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "other",
        [finding("y1", SEIZURE, seizure)],
    )
    result = panel(env)
    subs = by_id(result)
    assert subs["own"]["eligible"] is False
    assert result["all_match"] is True
    assert result["all_match_submission_id"] == "other"


def test_all_match_false_for_overlapping_but_different_spans(env):
    target = doc("c1", "en")
    neonatal = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "s1",
        [finding("x1", SEIZURE, neonatal)],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        "s2",
        [finding("y1", SEIZURE, (neonatal[0] + 2, neonatal[1]))],
    )
    result = panel(env)
    # compare() counts this as a match; the consolidation grouping does not.
    assert result["agreement"]["matching"] == 1
    assert result["all_match"] is False
    assert result["all_match_submission_id"] is None


def test_all_match_with_zero_findings_everywhere(env):
    target = doc("c1", "en")
    submit_findings(env, assign(env, target, "anno", "annotate"), "s1", [])
    submit_findings(env, assign(env, target, "anno2", "annotate"), "s2", [])
    result = panel(env)
    assert result["all_match"] is True
    assert result["all_match_submission_id"] == "s1"


def test_all_match_false_when_a_consolidation_covers_both(rounds):
    _repo, lead, _consolidation, key, _inputs = _consolidated(rounds)
    result = lead.final_panel("pkg-1", *key)
    assert result["label_rule"] == "accept"
    assert result["all_match"] is False
    assert result["all_match_submission_id"] is None


def test_all_match_in_http_answer(env):
    target = doc("c1", "en")
    submit_findings(env, assign(env, target, "anno", "annotate"), "s1", [])
    submit_findings(env, assign(env, target, "anno2", "annotate"), "s2", [])
    response = env.lead.get(f"{BASE}/document-rows/c1/en/final-panel")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["all_match"], body["all_match_submission_id"]) == (True, "s1")
