"""``ontocurator admin``: users, codes, password hashes and the offline recovery."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import pytest
from click.testing import Result
from pg_harness import column_values, database_for, database_url_for
from sqlalchemy import select
from typer.testing import CliRunner

from ontocurator.auth.accounts import AccountService
from ontocurator.auth.passwords import hash_password, verify_password
from ontocurator.auth.sessions import SessionService
from ontocurator.cli import app
from ontocurator.storage.lease import RuntimeLease
from ontocurator.storage.tables import AuditEventRow

runner = CliRunner()
PASSWORD = "correct horse battery"
NEW_PASSWORD = "another long passphrase"
_CODE_BLOCK = re.compile(
    r"(Setup|Reset) code for '([^']+)' \(single use, valid until "
    r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\):\n  (\S+)\n"
    r"Hand it to the user out of band\. It is not shown again\.\n"
)


@pytest.fixture(autouse=True)
def _data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ONTOCURATOR_DATA_DIR", str(tmp_path / "data"))


def _admin(tmp_path: Path, *args: str, stdin: str | None = None) -> Result:
    url = database_url_for(tmp_path / "editor.db")
    return runner.invoke(app, ["admin", "--database-url", url, *args], input=stdin)


def _code(result: Result, purpose: str, username: str) -> str:
    match = _CODE_BLOCK.search(result.output)
    assert match is not None, result.output
    assert match.group(1) == purpose
    assert match.group(2) == username
    return match.group(3)


def _recovery_file(tmp_path: Path, password_hash: str) -> Path:
    path = tmp_path / "recovery.json"
    path.write_text(
        json.dumps(
            {
                "username": "admin",
                "password_hash": password_hash,
                "operator": "jdoe",
                "reason": "lost the admin password",
            }
        ),
        encoding="utf-8",
    )
    if os.name == "posix":
        path.chmod(0o600)
    return path


def test_create_prints_the_pseudonym_and_a_single_use_code(tmp_path: Path) -> None:
    result = _admin(tmp_path, "users", "create", "Alice", "--display-name", "Alice A.")

    assert result.exit_code == 0, result.output
    assert result.output.startswith("Created user 'alice' (pseudonym ann-0001).\n")
    code = _code(result, "Setup", "alice")
    accounts = AccountService(database_for(tmp_path / "editor.db"))
    user = accounts.redeem_code("alice", code, PASSWORD)
    assert user.pseudonym == "ann-0001"
    assert not user.is_system_admin
    with accounts.db.transaction() as conn:
        create = conn.execute(
            select(AuditEventRow.actor_label).where(
                AuditEventRow.action == "user.create"
            )
        ).scalar_one()
    assert create.startswith("cli:")


def test_a_taken_username_is_an_error(tmp_path: Path) -> None:
    first = _admin(tmp_path, "users", "create", "alice", "--display-name", "Alice")
    second = _admin(tmp_path, "users", "create", "alice", "--display-name", "Other")

    assert first.exit_code == 0, first.output
    assert second.exit_code == 1
    assert "Error: USERNAME_TAKEN: 'alice' is already taken." in second.output
    assert "code for" not in second.output


def test_reset_deactivate_and_admin_flag(tmp_path: Path) -> None:
    created = _admin(
        tmp_path,
        "users",
        "create",
        "bob",
        "--display-name",
        "Bob B.",
        "--email",
        "bob@example.org",
        "--pseudonym",
        "bb-7",
    )
    assert created.exit_code == 0, created.output
    assert "Created user 'bob' (pseudonym bb-7)." in created.output

    reset = _admin(tmp_path, "users", "reset-code", "bob")
    assert reset.exit_code == 0, reset.output
    code = _code(reset, "Reset", "bob")
    accounts = AccountService(database_for(tmp_path / "editor.db"))
    accounts.redeem_code("bob", code, PASSWORD)

    admin_on = _admin(tmp_path, "users", "set-admin", "bob", "--on")
    assert admin_on.exit_code == 0, admin_on.output
    assert admin_on.output == "'bob': active=yes, system admin=yes.\n"

    off = _admin(tmp_path, "users", "deactivate", "bob")
    assert off.exit_code == 0, off.output
    assert off.output == "'bob': active=no, system admin=yes.\n"
    listed = _admin(tmp_path, "users", "list")
    assert listed.exit_code == 0, listed.output
    assert listed.output == "bob\tbb-7\tBob B.\tinactive, admin\n"
    refused = _admin(tmp_path, "users", "reset-code", "bob")
    assert refused.exit_code == 1
    assert "Error: USER_INACTIVE: 'bob' is deactivated." in refused.output

    on = _admin(tmp_path, "users", "activate", "bob")
    assert on.output == "'bob': active=yes, system admin=yes.\n"
    admin_off = _admin(tmp_path, "users", "set-admin", "bob", "--off")
    assert admin_off.output == "'bob': active=yes, system admin=no.\n"
    assert _admin(tmp_path, "users", "list").output == "bob\tbb-7\tBob B.\tactive\n"

    unknown = _admin(tmp_path, "users", "deactivate", "nobody")
    assert unknown.exit_code == 1
    assert "Error: USER_NOT_FOUND: There is no user 'nobody'." in unknown.output


def test_hash_password_prints_an_argon2id_hash(tmp_path: Path) -> None:
    result = runner.invoke(app, ["admin", "hash-password"], input=f"{PASSWORD}\n")

    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert len(lines) == 1
    assert lines[0].startswith("$argon2id$v=19$")
    assert verify_password(lines[0], PASSWORD)
    assert PASSWORD not in result.output

    short = runner.invoke(app, ["admin", "hash-password"], input="short\n")
    assert short.exit_code == 1
    assert "Error: PASSWORD_RULES:" in short.output
    assert "$argon2id$" not in short.output


def test_recovery_waits_for_the_service_to_stop(tmp_path: Path) -> None:
    created = _admin(
        tmp_path,
        "users",
        "create",
        "admin",
        "--display-name",
        "Admin",
        "--system-admin",
    )
    assert created.exit_code == 0, created.output
    new_hash = hash_password(NEW_PASSWORD)
    recovery = _recovery_file(tmp_path, new_hash)
    db = database_for(tmp_path / "editor.db")
    lease = RuntimeLease(db.engine)
    lease.acquire()
    try:
        refused = _admin(tmp_path, "recover-admin", "--input", str(recovery))
    finally:
        lease.release()

    assert refused.exit_code == 1
    assert "Stop the Ontocurator service first; it is still running." in (
        refused.output
    )
    assert new_hash not in refused.output

    recovered = _admin(tmp_path, "recover-admin", "--input", str(recovery))

    assert recovered.exit_code == 0, recovered.output
    assert recovered.output == "Recovered 'admin'; all of its sessions were ended.\n"
    _token, principal = SessionService(db).login(
        "admin", NEW_PASSWORD, client_ip="127.0.0.1"
    )
    assert principal.username == "admin"
    labels = column_values(AccountService(db), "audit_events", "actor_label")
    assert "recovery:jdoe" in labels


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX file permissions")
def test_recovery_refuses_a_readable_input_file(tmp_path: Path) -> None:
    created = _admin(
        tmp_path,
        "users",
        "create",
        "admin",
        "--display-name",
        "Admin",
        "--system-admin",
    )
    assert created.exit_code == 0, created.output
    new_hash = hash_password(NEW_PASSWORD)
    recovery = _recovery_file(tmp_path, new_hash)
    recovery.chmod(0o644)

    result = _admin(tmp_path, "recover-admin", "--input", str(recovery))

    assert result.exit_code == 1
    assert "Error: RECOVERY_INPUT_NOT_PRIVATE:" in result.output
    assert new_hash not in result.output
    assert "jdoe" not in result.output
