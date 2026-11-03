"""Project archives: export one project, import it into a fresh server (#306).

The source is a real server with the test ontology; the target another
server on its own database and data directory. Every round trip is checked
by the import itself (each table read back, mapped to the archive's ids and
compared with the manifest) and by reading the imported project through the
application.
"""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Iterator
from pathlib import Path
from time import monotonic, sleep
from typing import Any

import pytest
from browser_consolidation_scenarios import FINDINGS, TEXT, _annotate, start_as_lead
from browser_documents_scenarios import (
    Scenario,
    accept_translation,
    add_user,
    identity,
    import_texts,
    new_project,
)
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import func, insert, select
from t1_builders import native_unit, translation_unit
from t1_fixtures import HP_PATH, OPERATOR
from typer.testing import CliRunner

from ontotator.api.app import create_app
from ontotator.application.guidelines import GuidelineService
from ontotator.auth.audit import Actor
from ontotator.config import AppConfig
from ontotator.domain.errors import DomainError
from ontotator.exchange import archive as project_archive
from ontotator.exchange.archive_tables import ARCHIVED
from ontotator.exchange.jobs import store_file
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.store import OntologyStore
from ontotator.storage.tables import (
    AuditEventRow,
    DocumentRow,
    ImportedPersonRow,
    JobRow,
    ProjectMembershipRow,
    ProjectRow,
    SubmissionRow,
    TranslationReviewRow,
    UserRow,
)
from ontotator.storage.workflow_tables import WorkRoundRow

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "examples" / "demo-project"
CASE = "case-0107"
GERMAN = "Der Patient hatte letzte Woche zwei Anfälle. Keine muskuläre Hypotonie."


def _app(folder: Path) -> FastAPI:
    folder.mkdir(parents=True, exist_ok=True)
    return create_app(
        AppConfig(
            workspace_dir=folder,
            database_url=database_url_for(folder / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )


@pytest.fixture
def servers(tmp_path: Path) -> Iterator[tuple[TestClient, TestClient]]:
    with (
        TestClient(_app(tmp_path / "source")) as source,
        TestClient(_app(tmp_path / "target")) as target,
    ):
        yield source, target


def _db(client: TestClient) -> Any:
    return client.app.state.repo.db  # type: ignore[attr-defined]


def _export(client: TestClient, key: str, tmp: Path, **options: Any) -> bytes:
    built = project_archive.build_archive(
        _db(client), key, tmp / f"{key}.zip", **options
    )
    return built.path.read_bytes()


def _counts(db: Any, key: str) -> dict[str, int]:
    """Rows per archived table of one project, without the import's own
    audit entries (``project.import_archive``, roles given to linked accounts)."""
    with db.snapshot() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == key)
        ).scalar_one()
        counts = {
            entry.name: len(project_archive._rows(conn, entry, pid))
            for entry in ARCHIVED
        }
        counts["audit_events"] = conn.execute(
            select(func.count())
            .select_from(AuditEventRow)
            .where(
                AuditEventRow.project_id == pid,
                AuditEventRow.action != "project.import_archive",
                ~AuditEventRow.actor_label.startswith("test:"),
            )
        ).scalar_one()
        return counts


def _set_email(scenario: Scenario, name: str, email: str) -> None:
    scenario.app.state.accounts.update_profile(
        Actor.cli(), scenario.users[name], email=email
    )


def _pseudonym(scenario: Scenario, name: str) -> str:
    return str(
        scenario.app.state.accounts.get_by_username(scenario.users[name]).pseudonym
    )


def _login(client: TestClient, username: str) -> dict[str, str]:
    origin = str(client.base_url).rstrip("/")
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": TEST_PASSWORD},
        headers={"Origin": origin},
    )
    assert response.status_code == 200, response.text
    return {"Origin": origin, "X-CSRF-Token": response.json()["csrf_token"]}


def _account(
    client: TestClient, username: str, email: str, pseudonym: str | None = None
) -> None:
    accounts = client.app.state.accounts  # type: ignore[attr-defined]
    issued = accounts.create_user(
        Actor.cli(), username, username, email=email, pseudonym=pseudonym
    )
    accounts.redeem_code(username, issued.code, TEST_PASSWORD)


def _consolidation_project(app: FastAPI) -> dict[str, Any]:
    """A text with a reviewed translation, two submissions and a started
    consolidation round."""
    scenario = new_project(app, "arch")
    source = native_unit(CASE, "en", TEXT, case_id=CASE)
    german = translation_unit(CASE, "de", GERMAN, source=source)
    documents = import_texts(scenario, [source, german])
    english, translated = documents[(CASE, "en", 1)], documents[(CASE, "de", 1)]
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "reviewer", ["annotator"], qualification="Physician")
    for name in FINDINGS:
        add_user(scenario, name, ["annotator"])
    accept_translation(scenario, translated, "reviewer")
    sources = [_annotate(scenario, name, english, FINDINGS[name]) for name in FINDINGS]
    round_view = start_as_lead(scenario, english, sources)
    return {
        "scenario": scenario,
        "document_id": english,
        "translation_id": translated,
        "submissions": sources,
        "round_id": round_view.round_id,
    }


def test_consolidation_and_translation_review_round_trip(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, target = servers
    built = _consolidation_project(source.app)  # type: ignore[arg-type]
    scenario: Scenario = built["scenario"]
    _set_email(scenario, "lead", "lead@example.org")
    lead_pseudonym = _pseudonym(scenario, "lead")
    # The lead exists on the target with the same e-mail and pseudonym.
    _account(target, "lead", "lead@example.org", pseudonym=lead_pseudonym)
    data = _export(source, scenario.key, tmp_path)

    result = project_archive.import_archive(_db(target), OPERATOR, data)

    assert result["project"] == scenario.key and not result["renamed"]
    assert result["verification"]["ok"], result["verification"]
    assert _counts(_db(target), scenario.key) == _counts(_db(source), scenario.key)
    assert {"pseudonym": lead_pseudonym, "username": "lead", "by": "email"} in result[
        "people"
    ]["mapped"]
    # The unmatched people keep their pseudonyms, without a login.
    created = {item["pseudonym"] for item in result["people"]["pseudonym_only"]}
    assert created == {_pseudonym(scenario, n) for n in ["reviewer", *FINDINGS]}
    # The consolidation reads the same on the target, for the mapped lead.
    headers = _login(target, "lead")
    round_url = f"/api/v1/rounds/{built['round_id']}/consolidation"
    before = source.get(round_url, headers=_login(source, scenario.users["lead"]))
    after = target.get(round_url, headers=headers)
    assert before.status_code == after.status_code == 200, after.text
    names = {scenario.users["lead"]: "lead"}
    assert _groups(after.json(), {}) == _groups(before.json(), names)
    # Immutable records keep their content and times.
    with _db(source).snapshot() as conn:
        original = _submissions(conn, scenario.key)
    with _db(target).snapshot() as conn:
        copied = _submissions(conn, scenario.key)
    assert copied == original
    # The translation review stays, with its reviewer snapshot and status.
    with _db(source).snapshot() as conn:
        reviewed = _reviews(conn, scenario.key)
    with _db(target).snapshot() as conn:
        assert _reviews(conn, scenario.key) == reviewed
    assert [r[0] for r in reviewed] == ["accepted_unchanged"]
    with _db(target).snapshot() as conn:
        audit = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "project.import_archive"
            )
        ).scalar_one()
    assert audit["archive_sha256"] == result["archive_sha256"]

    # The same archive again: a copy with a new key, new round and report
    # ids, the same people, and a consolidation that still opens.
    again = project_archive.import_archive(_db(target), OPERATOR, data)
    assert again["project"] == f"{scenario.key}-2" and again["new_ids"] > 0
    assert again["verification"]["ok"] and again["people"]["pseudonym_only"] == []
    with _db(target).snapshot() as conn:
        copied_round = conn.execute(
            select(WorkRoundRow.round_id)
            .join(ProjectRow, ProjectRow.id == WorkRoundRow.project_id)
            .where(
                ProjectRow.project_key == again["project"],
                WorkRoundRow.kind == "consolidation",
            )
        ).scalar_one()
    assert copied_round != built["round_id"]
    copy = target.get(f"/api/v1/rounds/{copied_round}/consolidation", headers=headers)
    assert copy.status_code == 200, copy.text
    assert len(copy.json()["groups"]) == len(after.json()["groups"])


def _reviews(conn: Any, key: str) -> list[tuple[Any, ...]]:
    return sorted(
        conn.execute(
            select(
                TranslationReviewRow.decision,
                TranslationReviewRow.reviewer_pseudonym,
                TranslationReviewRow.proposed_text_sha256,
                TranslationReviewRow.created_at,
                DocumentRow.translation_status,
            )
            .join(ProjectRow, ProjectRow.id == TranslationReviewRow.project_id)
            .join(
                DocumentRow,
                (DocumentRow.project_id == TranslationReviewRow.project_id)
                & (DocumentRow.document_id == TranslationReviewRow.document_id),
            )
            .where(ProjectRow.project_key == key)
        ).tuples()
    )


def _access(client: TestClient, username: str) -> Any:
    from types import SimpleNamespace

    from ontotator.authz.memberships import MembershipService

    user = client.app.state.accounts.get_by_username(username)  # type: ignore[attr-defined]
    principal = SimpleNamespace(
        user_id=user.id, pseudonym=user.pseudonym, is_system_admin=False
    )
    return MembershipService(_db(client)).access_for(principal)


def _groups(view: dict[str, Any], names: dict[str, str]) -> Any:
    """The view without its workspace id and the people's names (the
    pseudonym-only people are shown as anonymised here)."""
    text = json.dumps(
        {k: v for k, v in view.items() if k not in {"workspace_id", "people"}},
        sort_keys=True,
    )
    for name, shown in names.items():
        text = text.replace(name, shown)
    return json.loads(text)


def _submissions(conn: Any, key: str) -> list[tuple[Any, ...]]:
    return sorted(
        conn.execute(
            select(
                SubmissionRow.submission_id,
                SubmissionRow.payload,
                SubmissionRow.created_at,
                SubmissionRow.recorded_at,
                SubmissionRow.annotator_id,
            )
            .join(ProjectRow, ProjectRow.id == SubmissionRow.project_id)
            .where(ProjectRow.project_key == key)
        ).tuples()
    )


def _demo_project(app: FastAPI) -> Scenario:
    """The demo project's plain texts, guidelines and people, with work."""
    from work_plan_support import plan_all

    scenario = new_project(app, "demo")
    texts = io.BytesIO()
    with zipfile.ZipFile(texts, "w") as archive:
        for path in sorted((DEMO / "texts").glob("*.txt")):
            archive.write(path, path.name)
    folder = Path(app.state.repo.db.data_dir) / "staged"
    folder.mkdir(parents=True, exist_ok=True)
    staged = folder / "texts.zip"
    staged.write_bytes(texts.getvalue())
    _import_plain_texts(app, scenario.key, staged)
    plan_all(scenario.db, scenario.key)
    for name, roles in [
        ("ana.weber", ["lead"]),
        ("mia.kuehn", ["annotator"]),
        ("luc.martin", ["annotator"]),
        ("sam.okafor", ["annotator"]),
        ("noor.haddad", ["adjudicator"]),
    ]:
        add_user(scenario, name, roles)
        _set_email(scenario, name, f"{name}@example.org")
    _access, lead = identity(scenario, "ana.weber")
    GuidelineService(scenario.db).upload(
        lead,
        scenario.key,
        filename="guidelines.md",
        data=(DEMO / "guidelines.md").read_bytes(),
        change_note="First version for the demo project.",
        expected_latest_version=None,
    )
    document = next(
        row
        for row in app.state.repo.list_variants(scenario.key)
        if row.external_id == "NEURO-2026-001"
    )
    text = app.state.repo.list_documents(scenario.key)
    body = next(d.text for d in text if d.document_id == document.document_id)
    findings = [("HP:0001250", "seizures", {})]
    for name in ("luc.martin", "sam.okafor"):
        _annotate(scenario, name, document.document_id, findings, body)
    return scenario


def _import_plain_texts(app: FastAPI, key: str, path: Path) -> None:
    db = app.state.repo.db
    digest = store_file(db, path.read_bytes())
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == key)
        ).scalar_one()
    job_id = app.state.jobs.enqueue(
        "t1_import",
        {
            "project": key,
            "blob_sha256": digest,
            "filename": path.name,
            "kind": "text",
            "language": "en",
        },
        project_id=pid,
        actor=Actor.cli(),
    )
    deadline = monotonic() + 30
    while (job := app.state.jobs.get(job_id)).status in {"queued", "running"}:
        assert monotonic() < deadline
        sleep(0.05)
    assert job.status == "succeeded", job.error


def test_demo_project_round_trip_maps_people_by_email(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, target = servers
    scenario = _demo_project(source.app)  # type: ignore[arg-type]
    pseudonyms = {name: _pseudonym(scenario, name) for name in scenario.users}
    # Ana (no work under her pseudonym) and Luc (same pseudonym) map by e-mail;
    # Sam's account here has another pseudonym; Mia and Noor have none.
    _account(target, "ana", "Ana.Weber@example.org", pseudonym="ana-here")
    _account(
        target, "luc", "luc.martin@example.org", pseudonym=pseudonyms["luc.martin"]
    )
    _account(target, "sam", "sam.okafor@example.org", pseudonym="sam-here")
    data = _export(source, scenario.key, tmp_path)

    result = project_archive.import_archive(_db(target), OPERATOR, data)

    assert result["verification"]["ok"], result["verification"]
    expected = _counts(_db(source), scenario.key)
    # Sam's account got the role of the person it is linked to.
    linked_roles = {"project_memberships": expected["project_memberships"] + 1}
    assert _counts(_db(target), scenario.key) == expected | linked_roles
    mapped = {item["username"] for item in result["people"]["mapped"]}
    assert mapped == {"ana", "luc"}
    only = {
        item["archived_pseudonym"]: item for item in result["people"]["pseudonym_only"]
    }
    assert only[pseudonyms["sam.okafor"]]["linked_to"] == "sam"
    assert {pseudonyms["mia.kuehn"], pseudonyms["noor.haddad"]} <= set(only)
    with _db(target).snapshot() as conn:
        roles = _roles(conn, scenario.key)
        people = conn.execute(
            select(
                UserRow.pseudonym, UserRow.active, UserRow.anonymised_at, UserRow.email
            ).join(ImportedPersonRow, ImportedPersonRow.user_id == UserRow.id)
        ).all()
    # Roles are kept for the mapped accounts; Sam's account got the linked
    # person's role; the pseudonym-only people have no login and no e-mail.
    assert roles["ana"] == {"lead"} and roles["luc"] == {"annotator"}
    assert roles["sam"] == {"annotator"}
    assert all(not p.active and p.anonymised_at and p.email is None for p in people)
    assert pseudonyms["sam.okafor"] in {p.pseudonym for p in people}
    # The guidelines and the texts arrived.
    lead = _access(target, "ana")
    listing = GuidelineService(_db(target)).listing(lead, scenario.key)
    assert [v.version for v in listing.versions] == [1]
    document = GuidelineService(_db(target)).document(lead, scenario.key, 1)
    assert document.body == (DEMO / "guidelines.md").read_text("utf-8")
    assert len(target.app.state.repo.list_documents(scenario.key)) == 4  # type: ignore[attr-defined]

    # A pseudonym-only person is linked to a real account later.
    _account(target, "noor", "noor@elsewhere.example")
    linked = project_archive.link_person(
        _db(target), OPERATOR, pseudonyms["noor.haddad"], "noor"
    )
    assert linked["roles"] == {scenario.key: ["adjudicator"]}
    with pytest.raises(DomainError) as error:
        project_archive.link_person(
            _db(target), OPERATOR, pseudonyms["noor.haddad"], "noor"
        )
    assert error.value.code == "PERSON_ALREADY_LINKED"

    # A second import of the same archive gets a new key and name and maps
    # everyone to the people the first import created or matched.
    again = project_archive.import_archive(_db(target), OPERATOR, data)
    assert again["renamed"] and again["project"] == f"{scenario.key}-2"
    assert again["name"].endswith("(2)")
    assert again["verification"]["ok"]
    assert again["people"]["pseudonym_only"] == []
    with _db(target).snapshot() as conn:
        assert _roles(conn, again["project"])["noor"] == {"adjudicator"}
    # Sam and Noor: the linked accounts get the roles in the copy too.
    linked_roles = {"project_memberships": expected["project_memberships"] + 2}
    assert _counts(_db(target), again["project"]) == expected | linked_roles


def _roles(conn: Any, key: str) -> dict[str, set[str]]:
    roles: dict[str, set[str]] = {}
    for username, role in conn.execute(
        select(UserRow.username, ProjectMembershipRow.role)
        .join(ProjectMembershipRow, ProjectMembershipRow.user_id == UserRow.id)
        .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
        .where(ProjectRow.project_key == key)
    ):
        roles.setdefault(username, set()).add(role)
    return roles


def _simple_project(app: FastAPI) -> Scenario:
    scenario = new_project(app, "small")
    import_texts(scenario, [native_unit(CASE, "en", TEXT, case_id=CASE)])
    add_user(scenario, "ann-0001", ["annotator"])
    document = app.state.repo.list_documents(scenario.key)[0].document_id
    _annotate(scenario, "ann-0001", document, FINDINGS["ann-0001"][:2])
    return scenario


def _rewrite(data: bytes, change: Any) -> bytes:
    """The archive with ``change(files)`` applied to its files."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    change(files)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return out.getvalue()


def _manifest(files: dict[str, bytes]) -> dict[str, Any]:
    value: dict[str, Any] = json.loads(files["manifest.json"])
    return value


def _tamper_row(files: dict[str, bytes]) -> None:
    name = "tables/documents.jsonl"
    files[name] = files[name].replace(b"seizures", b"seizurez", 1)


def _tamper_manifest_too(files: dict[str, bytes]) -> None:
    """A changed row with a matching digest still fails the row count."""
    manifest = _manifest(files)
    name = "tables/submissions.jsonl"
    files[name] = b""
    manifest["files"][name]["sha256"] = project_archive._sha(b"")
    manifest["files"][name]["size"] = 0
    files["manifest.json"] = json.dumps(manifest).encode()


def _extra_file(files: dict[str, bytes]) -> None:
    files["blobs/" + "0" * 64] = b"extra"


def _drop_file(files: dict[str, bytes]) -> None:
    del files["people.jsonl"]


@pytest.mark.parametrize(
    "change",
    [_tamper_row, _tamper_manifest_too, _extra_file, _drop_file],
)
def test_a_tampered_archive_is_refused_and_imports_nothing(
    servers: tuple[TestClient, TestClient], tmp_path: Path, change: Any
) -> None:
    source, target = servers
    scenario = _simple_project(source.app)  # type: ignore[arg-type]
    data = _rewrite(_export(source, scenario.key, tmp_path), change)
    with pytest.raises(DomainError) as error:
        project_archive.import_archive(_db(target), OPERATOR, data)
    assert error.value.code == "ARCHIVE_TAMPERED"
    with _db(target).snapshot() as conn:
        assert conn.execute(select(func.count()).select_from(ProjectRow)).scalar() == 0


def _newer_revision(files: dict[str, bytes]) -> None:
    manifest = _manifest(files)
    manifest["alembic_revision"] = "9999"
    files["manifest.json"] = json.dumps(manifest).encode()


def _newer_format(files: dict[str, bytes]) -> None:
    manifest = _manifest(files)
    manifest["schema_version"] = project_archive.SCHEMA_VERSION + 1
    files["manifest.json"] = json.dumps(manifest).encode()


@pytest.mark.parametrize(
    ("change", "code"),
    [
        (_newer_revision, "ARCHIVE_SCHEMA_NEWER"),
        (_newer_format, "ARCHIVE_FORMAT_UNSUPPORTED"),
        (lambda files: files.clear(), "ARCHIVE_INVALID"),
    ],
)
def test_newer_schemas_and_other_files_are_refused(
    servers: tuple[TestClient, TestClient], tmp_path: Path, change: Any, code: str
) -> None:
    source, target = servers
    scenario = _simple_project(source.app)  # type: ignore[arg-type]
    data = _rewrite(_export(source, scenario.key, tmp_path), change)
    with pytest.raises(DomainError) as error:
        project_archive.import_archive(_db(target), OPERATOR, data)
    assert error.value.code == code


def test_an_older_revision_is_accepted(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, target = servers
    scenario = _simple_project(source.app)  # type: ignore[arg-type]

    def older(files: dict[str, bytes]) -> None:
        manifest = _manifest(files)
        manifest["alembic_revision"] = "0030"
        files["manifest.json"] = json.dumps(manifest).encode()

    data = _rewrite(_export(source, scenario.key, tmp_path), older)
    result = project_archive.import_archive(_db(target), OPERATOR, data)
    assert result["verification"]["ok"]


def test_without_ontology_files_the_target_needs_them(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, target = servers
    scenario = _simple_project(source.app)  # type: ignore[arg-type]
    data = _export(source, scenario.key, tmp_path, include_ontology_files=False)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["ontology_files_included"] is False
    assert manifest["ontology_files"] == 1
    with pytest.raises(DomainError) as error:
        project_archive.import_archive(_db(target), OPERATOR, data)
    assert error.value.code == "ARCHIVE_ONTOLOGY_MISSING"

    OntologyStore(_db(target), OntologyRegistry(), _db(target).data_dir).add(
        OPERATOR, HP_PATH.name, HP_PATH.read_bytes()
    )
    assert project_archive.import_archive(_db(target), OPERATOR, data)["verification"][
        "ok"
    ]


def test_manifest_names_format_versions_digests_and_counts(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, _target = servers
    scenario = _simple_project(source.app)  # type: ignore[arg-type]
    data = _export(source, scenario.key, tmp_path)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        names = set(archive.namelist())
    assert manifest["format"] == "ontotator-project-archive"
    assert manifest["schema_version"] == 1
    assert manifest["ontotator_version"]
    assert manifest["alembic_revision"]
    assert manifest["created_at"]
    assert set(manifest["rows"]) == {entry.name for entry in ARCHIVED}
    assert names == {"manifest.json", *manifest["files"]}
    assert manifest["rows"]["submissions"] == 1
    assert {n for n in names if n.startswith("blobs/")}
    assert all(len(v["sha256"]) == 64 for v in manifest["files"].values())


def test_a_practice_project_or_a_missing_one_is_not_archived(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, _target = servers
    with _db(source).transaction() as conn:
        conn.execute(
            insert(ProjectRow).values(
                project_key="practice-x",
                name="Practice project",
                manifest={},
                manifest_sha256="m",
                task_profile={},
                task_profile_sha256="t",
                practice=True,
            )
        )
    for key, code in [
        ("practice-x", "ARCHIVE_PRACTICE_PROJECT"),
        ("missing", "PROJECT_NOT_FOUND"),
    ]:
        with pytest.raises(DomainError) as error:
            project_archive.build_archive(_db(source), key, tmp_path / f"{key}.zip")
        assert error.value.code == code


def test_cli_exports_imports_and_links(
    servers: tuple[TestClient, TestClient], tmp_path: Path, monkeypatch: Any
) -> None:
    from ontotator.cli import app as cli

    source, target = servers
    scenario = _simple_project(source.app)  # type: ignore[arg-type]
    runner = CliRunner()
    out = tmp_path / "archive.zip"
    monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(_db(source).data_dir))
    exported = runner.invoke(
        cli,
        [
            "admin",
            "--database-url",
            _url(source),
            "projects",
            "export-archive",
            scenario.key,
            str(out),
        ],
    )
    assert exported.exit_code == 0, exported.output
    assert "Wrote" in exported.output
    monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(_db(target).data_dir))
    imported = runner.invoke(
        cli,
        [
            "admin",
            "--database-url",
            _url(target),
            "projects",
            "import-archive",
            str(out),
        ],
    )
    assert imported.exit_code == 0, imported.output
    assert f"Imported project '{scenario.key}'" in imported.output
    assert "verified: yes" in imported.output
    pseudonym = _pseudonym(scenario, "ann-0001")
    assert f"pseudonym-only\t{pseudonym}" in imported.output
    _account(target, "annie", "annie@example.org")
    linked = runner.invoke(
        cli,
        [
            "admin",
            "--database-url",
            _url(target),
            "users",
            "link-person",
            pseudonym,
            "annie",
        ],
    )
    assert linked.exit_code == 0, linked.output
    assert f"{scenario.key}: annotator" in linked.output
    with _db(target).snapshot() as conn:
        jobs = conn.execute(
            select(JobRow.kind, JobRow.status, JobRow.project_id).where(
                JobRow.kind == "project_archive_import"
            )
        ).all()
    assert [(j.kind, j.status) for j in jobs] == [
        ("project_archive_import", "succeeded")
    ]
    assert jobs[0].project_id is not None


def _url(client: TestClient) -> str:
    return str(_db(client).url.render_as_string(hide_password=False))


def _wait(client: TestClient, job_id: int) -> dict[str, Any]:
    deadline = monotonic() + 60
    while True:
        response = client.get(f"/api/v1/admin/project-archives/jobs/{job_id}")
        assert response.status_code == 200, response.text
        job: dict[str, Any] = response.json()
        if job["status"] in {"succeeded", "failed"}:
            return job
        assert monotonic() < deadline, job
        sleep(0.05)


def test_admin_api_exports_downloads_and_imports(
    servers: tuple[TestClient, TestClient],
) -> None:
    from auth_harness import logged_in

    source, target = servers
    scenario = _simple_project(source.app)  # type: ignore[arg-type]
    admin = logged_in(source.app, "root", system_admin=True, assignments=[])  # type: ignore[arg-type]
    lead = logged_in(
        source.app,  # type: ignore[arg-type]
        "leader",
        projects={scenario.key: ["lead"]},
        assignments=[],
    )
    body = {"project_key": scenario.key, "include_ontology_files": True}
    assert (
        lead.post("/api/v1/admin/project-archives/export", json=body).status_code == 403
    )
    queued = admin.post("/api/v1/admin/project-archives/export", json=body)
    assert queued.status_code == 200, queued.text
    job_id = queued.json()["job_id"]
    job = _wait(admin, job_id)
    assert job["status"] == "succeeded", job
    assert job["result"]["project"] == scenario.key
    # A lead of the project sees neither the job nor the file.
    assert lead.get(f"/api/v1/jobs/{job_id}").status_code == 404
    assert lead.get(f"/api/v1/admin/project-archives/jobs/{job_id}").status_code == 403
    download = admin.get(f"/api/v1/admin/project-archives/jobs/{job_id}/download")
    assert download.status_code == 200, download.text
    assert project_archive._sha(download.content) == job["result"]["sha256"]

    # The target's first account has the same pseudonym as the annotator.
    target_admin = logged_in(target.app, "root", system_admin=True, assignments=[])  # type: ignore[arg-type]
    taken = _pseudonym(scenario, "ann-0001")
    assert target.app.state.accounts.get_by_username("root").pseudonym == taken  # type: ignore[attr-defined]
    imported = target_admin.post(
        "/api/v1/admin/project-archives/import",
        files={"file": ("archive.zip", download.content, "application/zip")},
    )
    job = _wait(target_admin, imported.json()["job_id"])
    assert job["status"] == "failed" and "ARCHIVE_PSEUDONYM_TAKEN" in job["error"]
    assert job["result"] is None
    imported = target_admin.post(
        "/api/v1/admin/project-archives/import",
        files={"file": ("archive.zip", download.content, "application/zip")},
        data={"rename_pseudonyms": "true"},
    )
    assert imported.status_code == 200, imported.text
    job = _wait(target_admin, imported.json()["job_id"])
    assert job["status"] == "succeeded", job
    renamed = job["result"]["renamed_pseudonyms"]
    assert set(renamed) == {taken} and renamed[taken] != taken
    with _db(target).snapshot() as conn:
        annotators = {row.annotator_id for row in _submission_rows(conn, scenario.key)}
    assert annotators == {renamed[taken]}
    assert job["result"]["project"] == scenario.key
    assert job["result"]["verification"]["ok"]
    listed = target_admin.get("/api/v1/projects")
    assert scenario.key in {p["project_key"] for p in listed.json()}

    tampered = _rewrite(download.content, _tamper_row)
    failed = target_admin.post(
        "/api/v1/admin/project-archives/import",
        files={"file": ("archive.zip", tampered, "application/zip")},
    )
    job = _wait(target_admin, failed.json()["job_id"])
    assert job["status"] == "failed" and "ARCHIVE_TAMPERED" in job["error"]


def _submission_rows(conn: Any, key: str) -> list[Any]:
    return list(
        conn.execute(
            select(SubmissionRow.annotator_id, SubmissionRow.local_key)
            .join(ProjectRow, ProjectRow.id == SubmissionRow.project_id)
            .where(ProjectRow.project_key == key)
        )
    )


def test_renamed_pseudonyms_map_email_accounts_and_keep_work_usable(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    """With new pseudonyms, the e-mail account takes the work over: it opens
    its submitted round under its own pseudonym."""
    source, target = servers
    scenario = _simple_project(source.app)  # type: ignore[arg-type]
    _set_email(scenario, "ann-0001", "annie@example.org")
    archived = _pseudonym(scenario, "ann-0001")
    _account(target, "annie", "annie@example.org", pseudonym="annie-here")
    data = _export(source, scenario.key, tmp_path)

    result = project_archive.import_archive(
        _db(target), OPERATOR, data, rename_pseudonyms=True
    )

    assert result["verification"]["ok"]
    assert result["renamed_pseudonyms"] == {archived: "annie-here"}
    assert result["people"]["mapped"][0]["username"] == "annie"
    with _db(target).snapshot() as conn:
        rows = _submission_rows(conn, scenario.key)
        roles = _roles(conn, scenario.key)
    assert {row.annotator_id for row in rows} == {"annie-here"}
    assert all(
        ":annie-here:" in row.local_key or "|annie-here|" in row.local_key
        for row in rows
    )
    assert roles["annie"] == {"annotator"}
    headers = _login(target, "annie")
    tasks = target.get("/api/v1/me/tasks", headers=headers)
    assert tasks.status_code == 200, tasks.text
    assert scenario.key in tasks.text
