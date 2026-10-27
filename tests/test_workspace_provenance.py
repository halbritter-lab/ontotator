"""Real PG/API provenance projection; AUTHOR/COLLECT ONLY until root grant."""

from types import SimpleNamespace

import pytest
from auth_harness import logged_in
from sqlalchemy import delete, event, func, insert, select, update
from t1_builders import bundle, native_unit
from t1_fixtures import TEXT, annotation, create_project, run_import
from test_auth_api import _app
from test_reanchor_resolutions import from_proposals, from_scratch

from ontotator.application.workspaces import WorkspaceService
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Access
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import profile_hash
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import WorkspaceKey
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    AssignmentRow,
    ProjectMembershipRow,
    ProjectRow,
    ProposalSetRow,
    UserRow,
)


def reference_profile(db, *, reference=True):
    profile = Repository(db).get_task_profile("proj")
    original = profile.layers[0]
    profile = profile.model_copy(
        update={
            "default_layer_id": "target",
            "layers": [
                original.model_copy(
                    update={"access": "reference" if reference else "editable"}
                ),
                original.model_copy(
                    update={
                        "layer_id": "target",
                        "label": "Target",
                        "access": "editable",
                    }
                ),
            ],
        }
    )
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(
                task_profile=profile.model_dump(mode="json"),
                task_profile_sha256=profile_hash(profile),
            )
        )


@pytest.fixture
def env(tmp_path, request):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    leader = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    actor = app.state.accounts.get_by_username("leader")
    count = getattr(request, "param", 2)
    source = native_unit(
        "source",
        "en",
        TEXT,
        case_id="case",
        annotations=[annotation(f"p{i}", (6, 19)) for i in range(count)],
    )
    sibling = native_unit(
        "sibling",
        "fr",
        TEXT + " sibling",
        case_id="case",
        annotations=[annotation("sib", (6, 19), text=TEXT + " sibling")],
    )
    result = run_import(
        db,
        bundle(tmp_path, [source, sibling]),
        actor=Actor.user(actor.id, actor.username),
    )
    assert result.status == "succeeded", result.error
    reference_profile(db)
    # Proposals are offered when annotating from proposals (D1: was "assisted").
    alice = logged_in(
        app,
        "alice",
        projects={"proj": ["annotator"]},
        assignments=[("proj", "source", "annotate")],
    )
    from_proposals(db)
    user = app.state.accounts.get_by_username("alice")
    repo = ScopedRepository(
        db, Access(user.id, user.pseudonym, False, {"proj": frozenset({"annotator"})})
    )
    return SimpleNamespace(
        app=app, db=db, leader=leader, alice=alice, user=user, repo=repo, count=count
    )


def review_open(app, repo, pseudonym, document_id):
    """Open a review workspace the way a consolidation round open does (the
    API refuses a direct review open, D1); an HTTP-like result."""
    key = WorkspaceKey(
        project_key="proj",
        document_id=document_id,
        annotator_id=pseudonym,
        mode="review",
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )
    try:
        view = WorkspaceService(repo, app.state.ontology_registry).open(
            key, ReviewTargetSet.create([]), pending_proposal_set_ids=[]
        )
    except DomainError as error:
        return SimpleNamespace(status_code=403, text=error.code, json=lambda: {})
    body = {"view": view.model_dump(mode="json")}
    return SimpleNamespace(status_code=200, text="", json=lambda: body)


def opened(env, mode="proposal_check"):
    return env.alice.post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": "source", "mode": mode},
    )


def offers(view):
    return [
        (p["annotation"]["annotation_id"], p["version"], p["proposal_set_id"])
        for p in view["available_inputs"]
        if p["proposal_set_id"] is not None
    ]


def test_offered_metadata_unique_matches_public_projection_without_public_permission(
    env,
):
    response = opened(env)
    assert response.status_code == 200, response.text
    view = response.json()["view"]
    assert len(view["available_inputs"]) == env.count
    assert len(view["proposal_sets"]) == 1
    item = view["proposal_sets"][0]
    assert item["id"] == view["available_inputs"][0]["proposal_set_id"]
    assert item["document_id"] == "source" and item["origin"] == "import"
    assert item["source_document_id"] is None and item["source_version"] is None
    assert item["actors"][0]["actor_id"] == "phentrieve"
    assert (
        item["imported_by_pseudonym"]
        == env.app.state.accounts.get_by_username("leader").pseudonym
    )
    assert (
        not {
            "payload",
            "pending_items",
            "annotations",
            "manifest_sha256",
            "source_sha256",
            "imported_by",
        }
        & item.keys()
    )
    url = f"/api/v1/projects/proj/proposal-sets/{item['id']}"
    # Annotating from proposals reads the proposals of the own text (spec
    # 2026-10-23 §1), never browses versions; from scratch reads nothing.
    assert env.alice.get(url).json() == item
    assert env.leader.get(url).json() == item
    assert (
        env.alice.get(
            "/api/v1/projects/proj/documents/source/annotation-versions"
        ).json()
        == []
    )
    # Bob annotates from scratch (the text's annotation starts that way).
    from_scratch(env.db)
    scratch = logged_in(
        env.app,
        "bob",
        projects={"proj": ["annotator"]},
        assignments=[("proj", "source", "annotate")],
    )
    assert scratch.get(url).status_code == 404
    assert (
        scratch.get("/api/v1/projects/proj/documents/source/reanchor-items").status_code
        == 404
    )


@pytest.mark.parametrize("env", [1, 100], indirect=True)
def test_metadata_query_is_one_bounded_select_for_one_or_one_hundred_proposals(env):
    response = opened(env)
    assert response.status_code == 200
    view = response.json()["view"]
    statements = []

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement.lower())

    event.listen(env.db.engine, "before_cursor_execute", capture)
    try:
        result = env.repo.workspace_proposal_sets(
            WorkspaceKey.model_validate(view["key"]), offers(view)
        )
    finally:
        event.remove(env.db.engine, "before_cursor_execute", capture)
    metadata = [s for s in statements if "proposal_sets" in s]
    assert len(metadata) == 1
    assert len(result) == 1 and len(offers(view)) == env.count
    assert (
        "proposal_sets.payload" not in metadata[0]
        and "proposal_sets.pending_items" not in metadata[0]
    )


def test_blind_and_empty_offers_return_no_metadata_and_issue_no_set_query(env):
    # An annotate assignment opens only its own mode (P3): from scratch first.
    from_scratch(env.db)
    blind = opened(env, "independent")
    assert blind.status_code == 200
    assert (
        blind.json()["view"]["available_inputs"] == []
        and blind.json()["view"]["proposal_sets"] == []
    )
    key = WorkspaceKey.model_validate(blind.json()["view"]["key"])
    statements = []

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement.lower())

    event.listen(env.db.engine, "before_cursor_execute", capture)
    try:
        assert env.repo.workspace_proposal_sets(key, [("forged", "v", 1)]) == []
        from_proposals(env.db)
        assert (
            env.repo.workspace_proposal_sets(
                key.model_copy(update={"mode": "proposal_check", "scope_id": ""}), []
            )
            == []
        )
    finally:
        event.remove(env.db.engine, "before_cursor_execute", capture)
    assert not any("proposal_sets" in s for s in statements)


@pytest.mark.parametrize(
    "change",
    [
        "revoked",
        "role",
        "inactive",
        "identity",
        "mode",
        "foreign",
    ],
)
def test_exact_workspace_authority_is_fresh_even_for_empty_offers(env, change):
    response = opened(env)
    assert response.status_code == 200
    view = response.json()["view"]
    key = WorkspaceKey.model_validate(view["key"])
    with env.db.transaction() as conn:
        if change == "revoked":
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.user_id == env.user.id)
                .values(revoked_at=func.now())
            )
        elif change == "role":
            conn.execute(
                delete(ProjectMembershipRow).where(
                    ProjectMembershipRow.user_id == env.user.id
                )
            )
        elif change == "inactive":
            conn.execute(
                update(UserRow).where(UserRow.id == env.user.id).values(active=False)
            )
    if change == "identity":
        key = key.model_copy(update={"annotator_id": "somebody-else"})
    elif change == "mode":
        key = key.model_copy(update={"mode": "review"})
    elif change == "foreign":
        key = key.model_copy(update={"project_key": "foreign"})
    for provided in [offers(view), []]:
        with pytest.raises(DomainError):
            env.repo.workspace_proposal_sets(key, provided)
    if change in ("revoked", "role", "inactive"):
        assert opened(env).status_code in (401, 403, 404)


def test_sibling_text_visibility_and_forged_associations_do_not_grant_sets(env):
    response = opened(env)
    assert response.status_code == 200
    view = response.json()["view"]
    key = WorkspaceKey.model_validate(view["key"])
    sibling_text = "/api/v1/projects/proj/documents/sibling/text"
    assert env.alice.get(sibling_text).status_code == 404
    # Explicit current browsing authority preserves this test's stronger premise:
    # readable sibling text still cannot supply another workspace's proposal sets.
    with env.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=env.user.id, role="adjudicator"
            )
        )
    assert env.alice.get(sibling_text).status_code == 200
    sibling_metadata = env.app.state.repo.proposal_metadata("proj", "sibling")
    sibling_offers = [
        (aid, version, meta["proposal_set_id"])
        for (aid, version), meta in sibling_metadata.items()
    ]
    assert env.repo.workspace_proposal_sets(key, sibling_offers) == []
    assert (
        env.alice.get(
            f"/api/v1/projects/proj/proposal-sets/{sibling_offers[0][2]}"
        ).status_code
        == 404
    )
    aid, version, _set_id = offers(view)[0]
    assert (
        env.repo.workspace_proposal_sets(key, [(aid, version, sibling_offers[0][2])])
        == []
    )
    assert (
        env.alice.post(
            "/api/v1/workspaces/open",
            json={
                "project_key": "proj",
                "document_id": "sibling",
                "mode": "proposal_check",
            },
        ).status_code
        != 200
    )


def test_unoffered_pending_set_is_never_offered(env):
    # D1: the hidden-layer half belonged to "assisted" (reference layers only);
    # proposal_check offers every layer of its scope, like review.
    response = opened(env)
    assert response.status_code == 200
    view = response.json()["view"]
    key = WorkspaceKey.model_validate(view["key"])
    with env.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        conn.execute(
            insert(ProposalSetRow).values(
                project_id=pid,
                document_id="source",
                annotation_set_id="pending-only",
                bundle_id=None,
                set_kind="tool_output",
                actors=[],
                payload={"private": "raw"},
                pending_items=[{"private": "pending"}],
                origin="import",
            )
        )
    assert len(env.repo.workspace_proposal_sets(key, offers(view))) == 1


def test_review_mode_includes_offered_editable_layer_metadata(env):
    reference_profile(env.db, reference=False)
    logged_in(
        env.app,
        "reviewer",
        projects={"proj": ["adjudicator"]},
        assignments=[("proj", "source", "review")],
    )
    user = env.app.state.accounts.get_by_username("reviewer")
    repo = ScopedRepository(
        env.db,
        Access(user.id, user.pseudonym, False, {"proj": frozenset({"adjudicator"})}),
    )
    response = review_open(env.app, repo, user.pseudonym, "source")
    assert response.status_code == 200, response.text
    view = response.json()["view"]
    assert (
        len(view["available_inputs"]) == env.count and len(view["proposal_sets"]) == 1
    )


def test_actual_reanchor_source_version_and_tool_metadata_are_inlined(tmp_path):
    from test_reanchor_job import children, corrected, execute, runtime

    # Use the same actual storage fixture and durable worker helpers, never fabricated provenance.
    env = runtime.__wrapped__(tmp_path)
    corrected(env)
    result = execute(env, children(env)[0])
    assert result.status == "succeeded", result.error
    reference_profile(env.db)
    with env.db.transaction() as conn:
        target = conn.execute(
            select(ProposalSetRow.document_id).where(
                ProposalSetRow.origin == "reanchor"
            )
        ).scalar_one()
    logged_in(
        env.app,
        "reader",
        projects={"proj": ["adjudicator"]},
        assignments=[("proj", target, "review")],
    )
    user = env.app.state.accounts.get_by_username("reader")
    repo = ScopedRepository(
        env.db,
        Access(user.id, user.pseudonym, False, {"proj": frozenset({"adjudicator"})}),
    )
    response = review_open(env.app, repo, user.pseudonym, target)
    assert response.status_code == 200, response.text
    item = response.json()["view"]["proposal_sets"][0]
    assert (
        item["origin"] == "reanchor"
        and item["source_document_id"] == "case"
        and item["source_version"] == 1
    )
    assert item["actors"][0]["actor_id"] == "ontotator-reanchor"


def test_existing_foreign_project_sets_cannot_be_projected_or_publicly_read(
    env, tmp_path
):
    create_project(env.db, "foreign")
    foreign = native_unit(
        "foreign-doc",
        "en",
        TEXT,
        case_id="foreign-case",
        annotations=[annotation("foreign", (6, 19))],
    )
    foreign_directory = tmp_path / "foreign-import"
    foreign_directory.mkdir()
    result = run_import(env.db, bundle(foreign_directory, [foreign]), project="foreign")
    assert result.status == "succeeded", result.error
    foreign_refs = env.app.state.repo.proposal_metadata("foreign", "foreign-doc")
    provided = [
        (aid, version, meta["proposal_set_id"])
        for (aid, version), meta in foreign_refs.items()
    ]
    response = opened(env)
    assert response.status_code == 200, response.text
    key = WorkspaceKey.model_validate(response.json()["view"]["key"])
    assert env.repo.workspace_proposal_sets(key, provided) == []
    with pytest.raises(DomainError):
        env.repo.workspace_proposal_sets(
            key.model_copy(
                update={"project_key": "foreign", "document_id": "foreign-doc"}
            ),
            provided,
        )
    assert (
        env.alice.get(
            f"/api/v1/projects/foreign/proposal-sets/{provided[0][2]}"
        ).status_code
        == 404
    )
