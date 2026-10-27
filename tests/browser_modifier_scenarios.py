"""Modifier editor browser scenario (modifiers plan M1).

``POST /__test_modifiers__`` builds a fresh project ``modifiers-{uuid8}``
pinned with ``MOD_PIN`` (``hp-modifiers.json``, T1 profile ``hpo-phenotype``)
with the lead workflow's four people and one German text planned annotate,
assigned to the annotator, round 1 started. ``with_finding=1`` adds Seizure
on "Krampfanfälle" through ``create_annotation``; ``standalone=1`` writes a
standalone Severe finding on "schwere" past the editing commands (old data);
``proposal=1`` imports a tool proposal Seizure on "Krampfanfälle"; the project
default "from proposals" makes the round a proposal check (M2 M-5).
It returns the values scenarios' shape plus ``round_id`` and
``workspace_key``. Test server only, never shipped.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from browser_documents_scenarios import Scenario, identity, start_round
from browser_lead_workflow_scenarios import (
    OFF,
    ON,
    batch_assign,
    import_units,
    person,
    plan,
    result,
)
from fastapi import FastAPI, Query
from sqlalchemy import update

from ontotator.application.preferences import PreferencesUpdate
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.annotations import ActorRef, Annotation, Provenance, snapshot
from ontotator.domain.documents import (
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontotator.domain.workspace import Draft, MutationEnvelope
from ontotator.exchange.t1 import layers_for
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.store import OntologyStore
from ontotator.storage.tables import ProjectRow

CASE = "modifiers"
TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."
DEFAULTS = {"assertion": "present", "experiencer": "patient", "temporality": "current"}


def span(word: str) -> Segment:
    """``word``'s code-point offsets in ``TEXT``."""
    start = TEXT.index(word)
    return Segment(start=start, end=start + len(word))


def _command(scenario: Scenario, key: Any, payload: dict[str, Any]) -> Draft:
    from ontotator.application.editing import EditorService

    access, actor = identity(scenario, "annotator")
    scoped = ScopedRepository(scenario.db, access, actor)
    draft = scoped.open_draft(key)
    return EditorService(scoped, scenario.app.state.ontology_registry).apply(
        key,
        MutationEnvelope(
            mutation_id=f"mod-{uuid4().hex}",
            expected_revision=draft.revision,
            payload=payload,
        ),
    )


def _insert_standalone(scenario: Scenario, key: Any) -> None:
    """A Severe finding written straight into the draft, as old data would be."""
    access, actor = identity(scenario, "annotator")
    scoped = ScopedRepository(scenario.db, access, actor)
    document = scoped.get_document(key.project_key, key.document_id)
    profile = scoped.get_task_profile(key.project_key)
    assert document is not None
    evidence = snapshot_evidence(
        EvidenceMention(evidence_id="ev-standalone", segments=[span("schwere")]),
        document,
    )
    made = snapshot(
        Annotation(
            annotation_id="standalone-severe",
            document_id=document.document_id,
            layer_id="hpo",
            type_id="phenotype",
            term_id="HP:0012828",
            axes_values=dict(DEFAULTS),
            axes_defaulted=list(DEFAULTS),
            evidence_refs=[
                EvidenceRef(evidence_id="ev-standalone", version=evidence.version)
            ],
            provenance=Provenance(
                actor=ActorRef(actor_id=key.annotator_id, kind="human"),
                method="manual",
            ),
        ),
        [evidence],
        document,
        profile,
    )

    def operation(draft: Draft) -> Draft:
        draft.evidence.append(evidence)
        draft.annotations.append(made)
        return draft

    draft = scoped.open_draft(key)
    scoped.run_mutation(
        key,
        MutationEnvelope(
            mutation_id=f"standalone-{uuid4().hex}",
            expected_revision=draft.revision,
            payload={"command": "test_insert_standalone"},
        ),
        operation,
    )


def build_modifiers(
    app: FastAPI,
    *,
    with_finding: bool = False,
    standalone: bool = False,
    proposal: bool = False,
) -> dict[str, Any]:
    from modifier_fixtures import MOD_DE, MOD_PATH, MOD_PIN, MOD_SHA, modifier_profile
    from t1_builders import native_unit
    from t1_fixtures import ADMIN_ACCESS, OPERATOR, annotation

    db = app.state.repo.db
    key = f"modifiers-{uuid4().hex[:8]}"
    profile = modifier_profile()
    store = OntologyStore(db, OntologyRegistry(), db.data_dir)
    store.add(OPERATOR, MOD_DE.name, MOD_DE.read_bytes())
    store.add(OPERATOR, MOD_PATH.name, MOD_PATH.read_bytes())
    # The app's registry classifies modifier terms for the reads (D-a).
    app.state.ontology_registry.register_path(db.blobs.path(MOD_SHA))
    ScopedRepository(db, ADMIN_ACCESS, OPERATOR).create_project(
        key, "Modifiers", None, profile, {"hp": MOD_PIN}
    )
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(
                import_plan="nothing",
                annotate_accepted_translations_only=False,
                creation_defaults={"hpo": {"phenotype": DEFAULTS}},
            )
        )
    scenario = Scenario(app, key, {})
    person(scenario, "lead", ["lead"])
    person(scenario, "ana", ["annotator"], qualification="Physician")
    person(scenario, "ben", ["annotator"], qualification="Physician")
    person(scenario, "annotator", ["annotator"])

    seizure = span("Krampfanfälle")
    tool = [annotation("p-seizure", (seizure.start, seizure.end), text=TEXT)]
    unit = native_unit(
        CASE, "de", TEXT, case_id=CASE, annotations=tool if proposal else ()
    )
    layers = tuple(layers_for(profile, {"hp": MOD_PIN}))
    unit = unit.model_copy(
        update={
            "annotation_set": unit.annotation_set.model_copy(update={"layers": layers})
        }
    )
    import_units(scenario, [unit])
    plan(scenario, [CASE], {"source": {"review": OFF, "annotate": ON}})
    assignment = batch_assign(scenario, [CASE], "de", "annotate", ["annotator"])[0]
    started = start_round(scenario, assignment.id, "annotator")
    workspace_key = started.workspace_key
    # German names searched: an explicit selection, not the all-languages default.
    user = app.state.accounts.get_by_username(scenario.users["annotator"])
    app.state.preferences.update(
        user.id,
        PreferencesUpdate(
            search_languages_by_annotator={workspace_key.annotator_id: ["de"]}
        ),
    )
    if with_finding:
        seizure = span("Krampfanfälle")
        _command(
            scenario,
            workspace_key,
            {
                "command": "create_annotation",
                "annotation_id": "seizure",
                "term_id": "HP:0001250",
                "layer_id": "hpo",
                "segments": [seizure.model_dump()],
                "axes_values": dict(DEFAULTS),
                "chosen_axis_ids": [],
            },
        )
    if standalone:
        _insert_standalone(scenario, workspace_key)
    return result(
        scenario,
        [(CASE, "de")],
        assignments={CASE: assignment.id},
        texts={CASE: TEXT},
        round_id=started.round_id,
        workspace_key=workspace_key.model_dump(mode="json"),
    )


def register_modifier_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_modifiers__`` ahead of the static frontend."""

    @app.post("/__test_modifiers__")
    def modifier_scenario(
        with_finding: int = Query(0),
        standalone: int = Query(0),
        proposal: int = Query(0),
    ) -> dict[str, Any]:
        return build_modifiers(
            app,
            with_finding=bool(with_finding),
            standalone=bool(standalone),
            proposal=bool(proposal),
        )

    app.router.routes.insert(0, app.router.routes.pop())
