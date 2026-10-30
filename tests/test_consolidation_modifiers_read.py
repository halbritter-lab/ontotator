"""Consolidation read with modifiers (modifiers plan M2, spec "Consolidation >
Backend", scenarios S1, S3, S9, S17, S18).

Every scenario is one case of a project pinned with ``MOD_PIN``: the people
submit snapshots written directly (S18's standalone modifier is old data the
editing commands refuse), then the lead starts a consolidation round for
``adj``. The helpers here are shared by the other modifier consolidation
tests.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from auth_harness import grant, logged_in
from modifier_fixtures import MOD_PIN, create_modifier_project, modifier_profile
from sqlalchemy import select, update
from t1_builders import bundle, native_unit
from t1_fixtures import run_import
from test_auth_api import _app
from test_consolidation_resolve_api import access_of, view
from work_plan_support import _user, assign

from ontotator.application.document_row_panel import finding_of
from ontotator.application.work_rounds import WorkRoundService
from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    Modifier,
    Provenance,
    snapshot,
)
from ontotator.domain.documents import (
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.exchange.t1 import layers_for
from ontotator.ontology.modifiers import NO_TERM_ROLES, TermRoles, classifier_of
from ontotator.storage import work_plan_store as store
from ontotator.storage.repository import _key_str
from ontotator.storage.tables import AssignmentRow, ProjectRow, UserRow

TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."
SEIZURE = "HP:0001250"
HYPOTONIA = "HP:0001252"
FOCAL = "HP:0007359"
SEVERE = "HP:0012828"
MILD = "HP:0012825"
RECURRENT = "HP:0031796"
FREQUENT = "HP:0040282"
CASES = tuple(f"c{n}" for n in range(1, 9))
PEOPLE = {"ana": "Ana Weber", "ben": "Ben Roth", "cem": "Cem Arslan"}
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}


def span(words: str, nth: int = 0) -> tuple[int, int]:
    """The ``nth`` occurrence of ``words`` in ``TEXT`` (code points)."""
    start = -1
    for _ in range(nth + 1):
        start = TEXT.index(words, start + 1)
    return start, start + len(words)


def doc(case: str) -> str:
    return f"{case}-de"


def mod_env(tmp_path: Any) -> SimpleNamespace:
    """The project ``proj`` pinned with ``MOD_PIN``; one German text per case."""
    app = _app(tmp_path)
    db = app.state.repo.db
    create_modifier_project(db, "proj", app.state.ontology_registry)
    layers = tuple(layers_for(modifier_profile(), {"hp": MOD_PIN}))
    units = []
    for case in CASES:
        unit = native_unit(doc(case), "de", TEXT, case_id=case)
        units.append(
            unit.model_copy(
                update={
                    "annotation_set": unit.annotation_set.model_copy(
                        update={"layers": layers}
                    )
                }
            )
        )
    result = run_import(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    for username, name in [*PEOPLE.items(), ("adj", "Ada Judicator")]:
        _user(app, username, name)
        assert grant(
            app, username, "proj", ["adjudicator" if username == "adj" else "annotator"]
        )
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == pid)
            .values(annotate_accepted_translations_only=False, annotations_per_text=3)
        )
        store.write_rows(
            conn,
            pid,
            {RowKey(case, "de"): PlanFlags(False, True) for case in CASES},
            actor_id=None,
        )
    return SimpleNamespace(app=app, db=db, pid=pid, lead=lead)


def modifier(term_id: str, words: str | None = None, nth: int = 0) -> Modifier:
    """``term_id`` on the ``nth`` ``words`` (no segment without words)."""
    if words is None:
        return Modifier(term_id=term_id)
    start, end = span(words, nth)
    return Modifier(term_id=term_id, segments=[Segment(start=start, end=end)])


def found(
    annotation_id: str,
    term_id: str,
    words: str | None,
    *modifiers: Modifier,
    **axes: str,
) -> dict[str, Any]:
    """A finding on ``words`` with ``modifiers``."""
    return {
        "id": annotation_id,
        "term": term_id,
        "span": span(words) if words is not None else None,
        "modifiers": list(modifiers),
        "axes": axes,
    }


def submit(
    env: Any, assignment_id: int, sid: str, findings: list[dict[str, Any]]
) -> None:
    """Record a submission with these snapshots; the assignment is submitted."""
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
                evidence_id=f"ev-{sid}-{item['id']}",
                segments=[Segment(start=item["span"][0], end=item["span"][1])],
            )
            evidence.append(EvidenceSnapshot.create(mention, document))
        annotation = Annotation(
            annotation_id=f"{sid}-{item['id']}",
            document_id=row.document_id,
            layer_id="hpo",
            type_id="phenotype",
            term_id=item["term"],
            axes_values=AXES | item["axes"],
            modifiers=item["modifiers"],
            note=item.get("note"),
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
        created_at="2026-10-25T10:00:00Z",
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


def submit_all(
    env: Any, case: str, people: dict[str, list[dict[str, Any]]]
) -> list[str]:
    """Each person's submission on the case's text, in ``people`` order."""
    sids = []
    for name, findings in people.items():
        sid = f"sub-{case}-{name}"
        submit(env, assign(env, doc(case), name, "annotate"), sid, findings)
        sids.append(sid)
    return sids


def mod_round(
    env: Any, case: str, people: dict[str, list[dict[str, Any]]]
) -> SimpleNamespace:
    """The submissions of ``people`` and a consolidation round for ``adj``."""
    sids = submit_all(env, case, people)
    review = assign(env, doc(case), "adj", "review")
    lead_access, lead_actor = access_of(env, "leader", "lead")
    created = WorkRoundService(env.db).create(
        lead_access,
        lead_actor,
        review,
        request_id=f"consolidate-{case}",
        expected_workflow_revision=0,
        kind="consolidation",
        source_submission_ids=sids,
    )
    adj = logged_in(env.app, "adj", assignments=[])
    return SimpleNamespace(env=env, round=created, adj=adj, review=review, count=0)


def group_of(ns: Any, term_id: str, nth: int = 0) -> dict[str, Any]:
    """The ``nth`` group with a member of ``term_id``."""
    return [
        g
        for g in view(ns)["groups"]
        if any(m["term_id"] == term_id for m in g["members"])
    ][nth]


# --- tests ------------------------------------------------------------------ #


def test_read_view_shows_modifiers_kinds_and_layers(tmp_path):
    env = mod_env(tmp_path)
    # S3 on Seizure (Ben adds Frequent, a cohort term); S1-like match on Hypotonia.
    ns = mod_round(
        env,
        "c1",
        {
            "ana": [
                found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere")),
                found(
                    "h", HYPOTONIA, "Muskelhypotonie", modifier(RECURRENT, "wiederholt")
                ),
            ],
            "ben": [
                found(
                    "s",
                    SEIZURE,
                    "Krampfanfälle",
                    modifier(SEVERE, "schwere"),
                    modifier(FREQUENT),
                ),
                found(
                    "h", HYPOTONIA, "Muskelhypotonie", modifier(RECURRENT, "wiederholt")
                ),
            ],
        },
    )
    read = view(ns)
    assert read["modifier_layer_ids"] == ["hpo"]
    seizure = group_of(ns, SEIZURE)
    assert seizure["kinds"] == ["modifiers_differ"] and seizure["state"] == "open"
    ben = seizure["members"][1]["modifiers"]
    start = TEXT.index("schwere")
    assert ben == [
        {
            "term_id": SEVERE,
            "term_label": "Severe",
            "kind": "modifier",
            "exclusive_class": "severity",
            "segments": [[start, start + len("schwere")]],
        },
        {
            "term_id": FREQUENT,
            "term_label": "Frequent",
            "kind": "cohort",
            "exclusive_class": None,
            "segments": [],
        },
    ]
    hypotonia = group_of(ns, HYPOTONIA)
    assert hypotonia["kinds"] == ["match"] and hypotonia["state"] == "auto"
    assert hypotonia["attached_to"] is None


def test_modifier_on_different_findings_differs_in_both_groups(tmp_path):
    """S9: A Seizure {Severe “schwere”}, Hypotonia {}; B the reverse."""
    env = mod_env(tmp_path)
    ns = mod_round(
        env,
        "c1",
        {
            "ana": [
                found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere")),
                found("h", HYPOTONIA, "Muskelhypotonie"),
            ],
            "ben": [
                found("s", SEIZURE, "Krampfanfälle"),
                found("h", HYPOTONIA, "Muskelhypotonie", modifier(SEVERE, "schwere")),
            ],
        },
    )
    assert group_of(ns, SEIZURE)["kinds"] == ["modifiers_differ"]
    assert group_of(ns, HYPOTONIA)["kinds"] == ["modifiers_differ"]


def test_standalone_modifier_reads_as_modifier_as_finding(tmp_path):
    """S18: A marks Severe on "schwere" as a finding; B Seizure {Severe}."""
    env = mod_env(tmp_path)
    ns = mod_round(
        env,
        "c1",
        {
            "ana": [found("x", SEVERE, "schwere")],
            "ben": [found("s", SEIZURE, "Krampfanfälle", modifier(SEVERE, "schwere"))],
        },
    )
    assert group_of(ns, SEVERE)["kinds"] == ["modifier_as_finding", "partial"]
    assert group_of(ns, SEIZURE)["kinds"] == ["partial"]


def test_added_findings_carry_their_modifiers(tmp_path):
    env = mod_env(tmp_path)
    ns = mod_round(
        env,
        "c1",
        {
            "ana": [found("s", SEIZURE, "Krampfanfälle")],
            "ben": [found("s", SEIZURE, "Krampfanfälle")],
        },
    )
    workspace = view(ns)["workspace_id"]
    start, end = span("Muskelhypotonie")
    for n, payload in enumerate(
        [
            {
                "command": "create_annotation",
                "annotation_id": "ann-added",
                "evidence_id": "ev-added",
                "term_id": HYPOTONIA,
                "layer_id": "hpo",
                "type_id": "phenotype",
                "segments": [{"start": start, "end": end}],
                "axes_values": {},
                "chosen_axis_ids": [],
            },
            {
                "command": "add_modifier",
                "annotation_id": "ann-added",
                "term_id": MILD,
            },
        ]
    ):
        response = ns.adj.post(
            f"/api/v1/workspaces/{workspace}/commands",
            json={
                "mutation_id": f"add-{n}",
                "expected_revision": view(ns)["draft_revision"],
                "payload": payload,
            },
        )
        assert response.status_code == 200, response.text
    (added,) = view(ns)["added"]
    assert added["modifiers"] == [
        {
            "term_id": MILD,
            "term_label": "Mild",
            "kind": "modifier",
            "exclusive_class": "severity",
            "segments": [],
        }
    ]


def test_standalone_flag_needs_a_layer_with_modifiers(tmp_path):
    """Only ``hpo-phenotype`` layers (those with a classifier) flag a
    modifier term used as a finding (pure ``finding_of``)."""
    env = mod_env(tmp_path)
    submit_all(env, "c1", {"ana": [found("x", SEVERE, "schwere")]})
    record = env.app.state.repo.get_submission("sub-c1-ana", "proj")
    assert record is not None
    item = record.snapshots[0]
    service = env.app.state.ontology_registry.for_package_layer(
        env.app.state.repo, "proj", "hpo"
    )
    roles = TermRoles({"hpo": classifier_of(service)})
    assert finding_of(item, key="k", order=0, roles=roles).standalone_modifier
    assert not finding_of(
        item, key="k", order=0, roles=NO_TERM_ROLES
    ).standalone_modifier
    assert finding_of(item, key="k", order=0).modifier_spans == ()
