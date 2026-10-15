"""``ontocurator admin``: users, codes, password hashes and the offline recovery."""

from __future__ import annotations

import codecs
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
    # Another active admin, so bob may lose the role (last-admin rule).
    root = _admin(
        tmp_path, "users", "create", "root", "--display-name", "R", "--system-admin"
    )
    assert root.exit_code == 0, root.output
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
    assert listed.output == (
        "bob\tbb-7\tBob B.\tinactive, admin\nroot\tann-0001\tR\tactive, admin\n"
    )
    refused = _admin(tmp_path, "users", "reset-code", "bob")
    assert refused.exit_code == 1
    assert "Error: USER_INACTIVE: 'bob' is deactivated." in refused.output

    on = _admin(tmp_path, "users", "activate", "bob")
    assert on.output == "'bob': active=yes, system admin=yes.\n"
    admin_off = _admin(tmp_path, "users", "set-admin", "bob", "--off")
    assert admin_off.output == "'bob': active=yes, system admin=no.\n"
    assert _admin(tmp_path, "users", "list").output == (
        "bob\tbb-7\tBob B.\tactive\nroot\tann-0001\tR\tactive, admin\n"
    )

    unknown = _admin(tmp_path, "users", "deactivate", "nobody")
    assert unknown.exit_code == 1
    assert "Error: USER_NOT_FOUND: There is no user 'nobody'." in unknown.output


def test_the_last_active_admin_is_kept(tmp_path: Path) -> None:
    created = _admin(
        tmp_path, "users", "create", "root", "--display-name", "R", "--system-admin"
    )
    assert created.exit_code == 0, created.output

    for args in (("deactivate", "root"), ("set-admin", "root", "--off")):
        refused = _admin(tmp_path, "users", *args)
        assert refused.exit_code == 1
        assert (
            "Error: LAST_SYSTEM_ADMIN: 'root' is the last active system admin."
            in refused.output
        )
    listed = _admin(tmp_path, "users", "list")
    assert listed.output == "root\tann-0001\tR\tactive, admin\n"


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
    db.close()


def _fields(password_hash: str, **changes: object) -> dict[str, object]:
    fields: dict[str, object] = {
        "username": "admin",
        "password_hash": password_hash,
        "operator": "jdoe",
        "reason": "lost the admin password",
    }
    fields.update(changes)
    return {key: value for key, value in fields.items() if value is not None}


_INPUTS = {
    "not-json": (lambda h: b"{" + h.encode(), "RECOVERY_INPUT_INVALID"),
    "not-utf8": (lambda h: bytes([0xFF, 0xFE]) + h.encode(), "RECOVERY_INPUT_INVALID"),
    "a-list": (lambda h: json.dumps([h]).encode(), "RECOVERY_INPUT_INVALID"),
    "missing-reason": (
        lambda h: json.dumps(_fields(h, reason=None)).encode(),
        "RECOVERY_INPUT_INVALID",
    ),
    "extra-field": (
        lambda h: json.dumps(_fields(h, password=NEW_PASSWORD)).encode(),
        "RECOVERY_INPUT_INVALID",
    ),
    "not-text": (
        lambda h: json.dumps(_fields(h, operator=7)).encode(),
        "RECOVERY_INPUT_INVALID",
    ),
    "too-large": (
        lambda h: json.dumps(_fields(h, reason="x" * 8192)).encode(),
        "RECOVERY_INPUT_TOO_LARGE",
    ),
    "not-an-admin": (
        lambda h: json.dumps(_fields(h, username="alice")).encode(),
        "NOT_AN_ACTIVE_ADMIN",
    ),
    "weak-hash": (
        lambda h: json.dumps(_fields(h.replace("m=19456", "m=1024"))).encode(),
        "PASSWORD_RULES",
    ),
    "with-bom": (lambda h: codecs.BOM_UTF8 + json.dumps(_fields(h)).encode(), None),
}


@pytest.mark.parametrize("case", list(_INPUTS))
def test_recovery_input_is_checked_without_showing_it(
    tmp_path: Path, case: str
) -> None:
    for args in (
        ("admin", "--display-name", "Admin", "--system-admin"),
        ("alice", "--display-name", "Alice"),
    ):
        assert _admin(tmp_path, "users", "create", *args).exit_code == 0
    new_hash = hash_password(NEW_PASSWORD)
    content, code = _INPUTS[case]
    recovery = _recovery_file(tmp_path, new_hash)
    recovery.write_bytes(content(new_hash))

    result = _admin(tmp_path, "recover-admin", "--input", str(recovery))

    if code is None:
        assert result.exit_code == 0, result.output
        assert result.output.startswith("Recovered 'admin';")
        return
    assert result.exit_code == 1
    assert f"Error: {code}:" in result.output
    assert "$argon2id$" not in result.output
    assert "jdoe" not in result.output
    assert NEW_PASSWORD not in result.output


def test_an_unreachable_database_is_a_short_error(tmp_path: Path) -> None:
    url = "postgresql://ontocurator_app:pw-not-shown@127.0.0.1:1/ontocurator"
    result = runner.invoke(app, ["admin", "--database-url", url, "users", "list"])

    assert result.exit_code == 1
    assert "Error: DATABASE_UNAVAILABLE:" in result.output
    assert "pw-not-shown" not in result.output
    assert "Traceback" not in result.output


def test_a_database_error_shows_no_parameters(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy.exc import ProgrammingError

    def failing(*_args: object, **_kwargs: object) -> None:
        raise ProgrammingError(
            "UPDATE x SET h = %(h)s", {"h": "$argon2id$secret"}, ValueError("boom")
        )

    monkeypatch.setattr(AccountService, "list_users", failing)

    result = _admin(tmp_path, "users", "list")

    assert result.exit_code == 1
    assert "Error: DATABASE_ERROR: ValueError: boom" in result.output
    assert "secret" not in result.output


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


def test_members_can_be_added_listed_and_removed(tmp_path: Path) -> None:
    from layered_fixtures import make_layered_package

    from ontocurator.storage.repository import Repository

    Repository(database_for(tmp_path / "editor.db")).import_package(
        make_layered_package("single")
    )
    created = _admin(tmp_path, "users", "create", "alice", "--display-name", "A")
    assert created.exit_code == 0, created.output

    added = _admin(
        tmp_path,
        "projects",
        "add-member",
        "pkg-scenario-a",
        "alice",
        "--role",
        "annotator",
        "--role",
        "lead",
    )
    assert added.exit_code == 0, added.output
    assert added.output == "'alice' in 'pkg-scenario-a': annotator, lead.\n"
    listed = _admin(tmp_path, "projects", "list")
    assert listed.output == "pkg-scenario-a\tpkg-scenario-a\t2 documents\t1 member\n"
    members = _admin(tmp_path, "projects", "members", "pkg-scenario-a")
    assert members.output == "alice\tann-0001\tannotator, lead\n"

    removed = _admin(
        tmp_path,
        "projects",
        "remove-member",
        "pkg-scenario-a",
        "alice",
        "--role",
        "lead",
    )
    assert removed.output == "'alice' in 'pkg-scenario-a': annotator.\n"
    gone = _admin(tmp_path, "projects", "remove-member", "pkg-scenario-a", "alice")
    assert gone.output == "'alice' in 'pkg-scenario-a': no role.\n"
    assert _admin(tmp_path, "projects", "members", "pkg-scenario-a").output == ""

    invalid = _admin(
        tmp_path, "projects", "add-member", "pkg-scenario-a", "alice", "--role", "boss"
    )
    assert invalid.exit_code == 1
    assert "Error: ROLE_INVALID:" in invalid.output
    unknown = _admin(
        tmp_path, "projects", "add-member", "nope", "alice", "--role", "lead"
    )
    assert unknown.exit_code == 1
    assert "Error: PROJECT_NOT_FOUND: There is no project 'nope'." in unknown.output

    accounts = AccountService(database_for(tmp_path / "editor.db"))
    with accounts.db.transaction() as conn:
        rows = conn.execute(
            select(AuditEventRow.action, AuditEventRow.actor_label).where(
                AuditEventRow.action.like("project.%")
            )
        ).all()
    assert [r.action for r in rows] == [
        "project.member_add",
        "project.member_remove",
        "project.member_remove",
    ]
    assert all(r.actor_label.startswith("cli:") for r in rows)


def test_ontologies_add_and_list(tmp_path: Path) -> None:
    import hashlib

    fixtures = Path(__file__).parent / "fixtures"
    hp, de = fixtures / "hp.json", fixtures / "hp-de.babelon.tsv"
    hp_sha = hashlib.sha256(hp.read_bytes()).hexdigest()
    de_sha = hashlib.sha256(de.read_bytes()).hexdigest()

    added = _admin(tmp_path, "ontologies", "add", str(hp), str(de))

    assert added.exit_code == 0, added.output
    lines = [f"{hp_sha}  hp  2026-06-23  ontology", f"{de_sha}  hp  -  translation"]
    assert added.output.splitlines() == lines
    assert (tmp_path / "data" / "blobs" / hp_sha[:2] / hp_sha).is_file()

    again = _admin(tmp_path, "ontologies", "add", str(hp))
    assert again.output.splitlines() == lines[:1]

    listed = _admin(tmp_path, "ontologies", "list")
    assert listed.exit_code == 0, listed.output
    assert listed.output.splitlines() == lines

    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    refused = _admin(tmp_path, "ontologies", "add", str(broken))
    assert refused.exit_code == 1
    assert "INVALID_ONTOLOGY" in refused.output


def test_cli_imports_plain_text(tmp_path: Path) -> None:
    from t1_fixtures import create_project

    from ontocurator.storage.repository import Repository

    db = database_for(tmp_path / "editor.db")
    create_project(db)
    path = tmp_path / "plain.txt"
    path.write_bytes(b"Plain text.\r\n")
    result = _admin(tmp_path, "import", "proj", str(path), "--language", "de")
    assert result.exit_code == 0, result.output
    assert "documents_added: 1" in result.output
    doc = Repository(db).get_document("proj", "plain")
    assert doc is not None and doc.language == "de" and doc.text == "Plain text.\n"
