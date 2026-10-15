"""The real browser-user HTTP fixture honors assignment provisioning opt-out."""

from types import SimpleNamespace

import auth_harness
import pytest
from browser_server import TEST_PASSWORD, register_test_user_route
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ontocurator.authz.policy import ROLES


class FixtureAccounts:
    def __init__(self):
        self.users = {}
        self.created = []
        self.redeemed = []
        self.resets = []

    def get_by_username(self, username):
        return self.users.get(username)

    def create_user(self, actor, username, display_name, *, pseudonym):
        self.created.append((username, display_name, pseudonym))
        user = SimpleNamespace(id=17, username=username, pseudonym=pseudonym)
        self.users[username] = user
        return SimpleNamespace(user=user, code="setup-code")

    def redeem_code(self, username, code, password):
        self.redeemed.append((username, code, password))

    def issue_reset_code(self, actor, username):
        self.resets.append(username)
        return SimpleNamespace(user=self.users[username], code="reset-code")


@pytest.fixture
def browser_user_route(monkeypatch):
    app = FastAPI()
    accounts = FixtureAccounts()
    app.state.accounts = accounts
    grants = []
    provisions = []

    def grant_roles(user_id, username, project_key):
        grants.append((user_id, username, project_key))

    def provision(target_app, username, project_key, roles):
        assert target_app is app
        provisions.append((username, project_key, roles))

    monkeypatch.setattr(auth_harness, "provision_assignments", provision)

    # The fixture route must also remain reachable ahead of the static app.
    @app.post("/{path:path}")
    def static_fallback(path: str):
        return {"fallback": path}

    register_test_user_route(app, grant_roles)
    return TestClient(app), accounts, grants, provisions


@pytest.mark.parametrize("assign", [None, "all", "none"])
def test_assignment_flag_controls_only_provisioning(browser_user_route, assign):
    client, accounts, grants, provisions = browser_user_route
    params = {
        "username": "alice",
        "pseudonym": "ann-alice",
        "display_name": "Alice",
        "projects": "project-a,,project-b",
    }
    if assign is not None:
        params["assign"] = assign
    response = client.post("/__test_user__", params=params)
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "alice", "pseudonym": "ann-alice"}
    assert accounts.created == [("alice", "Alice", "ann-alice")]
    assert accounts.redeemed == [("alice", "setup-code", TEST_PASSWORD)]
    assert accounts.resets == []
    assert grants == [(17, "alice", "project-a"), (17, "alice", "project-b")]
    assert provisions == (
        []
        if assign == "none"
        else [("alice", "project-a", ROLES), ("alice", "project-b", ROLES)]
    )


@pytest.mark.parametrize("assign", ["invalid", "", "ALL"])
def test_invalid_assignment_flag_refuses_before_any_fixture_change(
    browser_user_route, assign
):
    client, accounts, grants, provisions = browser_user_route
    response = client.post(
        "/__test_user__",
        params={
            "username": "alice",
            "pseudonym": "ann-alice",
            "projects": "project-a",
            "assign": assign,
        },
    )
    assert response.status_code == 422, response.text
    assert accounts.created == []
    assert accounts.users == {}
    assert accounts.redeemed == []
    assert accounts.resets == []
    assert grants == []
    assert provisions == []


@pytest.mark.parametrize("assign", ["all", "none"])
def test_setup_reset_and_existing_user_behavior_is_preserved(
    browser_user_route, assign
):
    client, accounts, grants, provisions = browser_user_route
    params = {
        "username": "alice",
        "pseudonym": "ann-alice",
        "projects": "project-a",
        "assign": assign,
    }
    fresh = client.post("/__test_user__", params={**params, "setup": "true"})
    assert fresh.status_code == 200, fresh.text
    assert fresh.json() == {"code": "setup-code"}
    assert accounts.created == [("alice", "ann-alice", "ann-alice")]
    assert accounts.redeemed == []
    assert accounts.resets == []
    existing = client.post("/__test_user__", params=params)
    assert existing.status_code == 200, existing.text
    assert existing.json() == {"username": "alice", "pseudonym": "ann-alice"}
    reset = client.post("/__test_user__", params={**params, "setup": "true"})
    assert reset.status_code == 200, reset.text
    assert reset.json() == {"code": "reset-code"}
    assert len(accounts.created) == 1
    assert accounts.redeemed == []
    assert accounts.resets == ["alice"]
    assert grants == [(17, "alice", "project-a")] * 3
    assert provisions == (
        [] if assign == "none" else [("alice", "project-a", ROLES)] * 3
    )
