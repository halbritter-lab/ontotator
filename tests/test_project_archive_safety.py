"""Project archives (#306): what an archive must never carry, change or leave.

Regression tests of the review of the first version: renamed pseudonyms
touch only identity fields, work by annotator ids without an account is
checked like people, archives never nest earlier archives, limits come from
the ZIP itself, integer ids inside JSON are renumbered, referenced jobs come
along, a failed import leaves no file behind, and only people who worked in
the project are named with an e-mail address.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from browser_consolidation_scenarios import FINDINGS, TEXT, _annotate
from browser_documents_scenarios import import_texts, new_project
from browser_server import TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_for
from sqlalchemy import insert, select
from t1_builders import native_unit
from t1_fixtures import OPERATOR, bundle, create_project, run_import, unit
from test_project_archive import (
    _account,
    _app,
    _consolidation_project,
    _db,
    _export,
    _rewrite,
    _set_email,
    _simple_project,
)
from test_t1_export import DOC, _own, _submit

from ontotator.auth.accounts import AccountService
from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.exchange import archive as project_archive
from ontotator.exchange.jobs import HANDLERS, store_file
from ontotator.jobs.queue import JobQueue
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    JobRow,
    ProjectRow,
    ProposalSetRow,
    StoredFileRow,
    SubmissionRow,
    UserRow,
)

FULL = {"assertion": "present", "experiencer": "patient", "temporality": "current"}


def _project_id(db: Any, key: str) -> int:
    with db.snapshot() as conn:
        return int(
            conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == key)
            ).scalar_one()
        )


def _blob_files(db: Any) -> set[str]:
    return {
        path.name
        for path in Path(db.blobs.root).rglob("*")
        if path.is_file() and len(path.name) == 64
    }


def _run_job(db: Any, kind: str, payload: dict[str, Any], **options: Any) -> Any:
    queue = JobQueue(db, HANDLERS)
    job_id = queue.enqueue(kind, payload, actor=OPERATOR, **options)
    claimed = queue.claim(job_id, "test")
    assert claimed is not None
    return queue.run(claimed, "test")


def _export_job(db: Any, key: str) -> Any:
    job = _run_job(
        db, "project_archive_export", {"project": key}, project_id=_project_id(db, key)
    )
    assert job.status == "succeeded", job.error
    return job


def _nested_zips(data: bytes) -> list[str]:
    """Names of the stored files of an archive that are ZIP files themselves."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return [
            name
            for name in archive.namelist()
            if name.startswith("blobs/") and archive.read(name)[:2] == b"PK"
        ]


# 1. --rename-pseudonyms renames identities, never free text --------------


def test_renamed_pseudonyms_leave_texts_alone(tmp_path: Path) -> None:
    """A pseudonym that is also a word of the text renames the person only."""
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = new_project(source.app, "word")
        import_texts(
            scenario, [native_unit("case-0107", "en", TEXT, case_id="case-0107")]
        )
        accounts = source.app.state.accounts
        username = f"{scenario.key}-hear"
        issued = accounts.create_user(
            Actor.cli(), username, username, pseudonym="hearing"
        )
        accounts.redeem_code(username, issued.code, TEST_PASSWORD)
        source.app.state.memberships.add(
            Actor.cli(), scenario.key, username, ["annotator"]
        )
        scenario.users["ann-0001"] = username
        document = source.app.state.repo.list_documents(scenario.key)[0].document_id
        _annotate(scenario, "ann-0001", document, FINDINGS["ann-0001"][:2])
        _account(target, "other", "other@example.org", pseudonym="hearing")
        assert "hearing" in TEXT.lower()
        data = _export(source, scenario.key, tmp_path)

        with pytest.raises(DomainError) as error:
            project_archive.import_archive(_db(target), OPERATOR, data)
        assert error.value.code == "ARCHIVE_PSEUDONYM_TAKEN"
        result = project_archive.import_archive(
            _db(target), OPERATOR, data, rename_pseudonyms=True
        )

        new = result["renamed_pseudonyms"]["hearing"]
        assert new != "hearing"
        with _db(target).snapshot() as conn:
            pid = _project_id(_db(target), result["project"])
            texts = conn.execute(
                select(DocumentRow.text, DocumentRow.text_sha256).where(
                    DocumentRow.project_id == pid
                )
            ).all()
            annotators = set(
                conn.execute(
                    select(SubmissionRow.annotator_id).where(
                        SubmissionRow.project_id == pid
                    )
                ).scalars()
            )
        assert [text for text, _ in texts] == [TEXT]
        assert all(
            sha == hashlib.sha256(text.encode()).hexdigest() for text, sha in texts
        )
        assert annotators == {new}


def test_verification_catches_a_changed_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A text the import changed fails verification even when the mapping
    back would restore it."""
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        data = _export(source, scenario.key, tmp_path)
        convert = project_archive.Mapper.convert

        def changing(self: Any, name: str, row: Any) -> dict[str, Any]:
            out = convert(self, name, row)
            if name == "documents" and isinstance(out.get("text"), str):
                if getattr(self, "_back", False):
                    out["text"] = out["text"].replace("Reduced ZZZ", "Reduced hearing")
                else:
                    out["text"] = out["text"].replace("Reduced hearing", "Reduced ZZZ")
            return out

        inverse = project_archive.Mapper.inverse

        def marked(self: Any) -> Any:
            back = inverse(self)
            back._back = True
            return back

        monkeypatch.setattr(project_archive.Mapper, "convert", changing)
        monkeypatch.setattr(project_archive.Mapper, "inverse", marked)
        with pytest.raises(DomainError) as error:
            project_archive.import_archive(_db(target), OPERATOR, data)
        assert error.value.code == "ARCHIVE_VERIFICATION_FAILED"
        with _db(target).snapshot() as conn:
            assert conn.execute(select(ProjectRow.id)).first() is None


# 2. + 6. Annotator ids without an account, jobs without a project ----------


def _t1_source(tmp_path: Path) -> Any:
    """A project whose submission is by ``ann-0001``, which has no account,
    and whose proposals came with a job that names no project (CLI import)."""
    db = database_for(tmp_path / "s" / "s.db")
    create_project(db)
    job = run_import(db, bundle(tmp_path / "in.zip", [unit(DOC)]))
    assert job.status == "succeeded", job.error
    _submit(
        db,
        "ann-0001",
        "independent",
        [_own(db, "ann-0001", "a1", (6, 19), FULL)],
        submission_id="s-1",
    )
    return db


def test_jobs_rows_refer_to_come_along(tmp_path: Path) -> None:
    db = _t1_source(tmp_path)
    with db.snapshot() as conn:
        assert (
            conn.execute(
                select(JobRow.project_id).where(JobRow.kind == "t1_import")
            ).scalar_one()
            is None
        )
        assert conn.execute(select(ProposalSetRow.job_id)).scalars().first()
    data = project_archive.build_archive(
        db, "proj", tmp_path / "a.zip"
    ).path.read_bytes()
    target = database_for(tmp_path / "t" / "t.db")

    result = project_archive.import_archive(target, OPERATOR, data)

    assert result["verification"]["ok"]
    pid = _project_id(target, result["project"])
    with target.snapshot() as conn:
        job_ids = set(conn.execute(select(ProposalSetRow.job_id)).scalars())
        kinds = conn.execute(
            select(JobRow.kind, JobRow.project_id).where(JobRow.id.in_(job_ids))
        ).all()
    assert [(kind, project) for kind, project in kinds] == [("t1_import", pid)]


def test_annotator_ids_without_an_account_are_not_given_to_people_here(
    tmp_path: Path,
) -> None:
    db = _t1_source(tmp_path)
    data = project_archive.build_archive(
        db, "proj", tmp_path / "a.zip"
    ).path.read_bytes()
    target = database_for(tmp_path / "t" / "t.db")
    AccountService(target).create_user(Actor.cli(), "bob", "Bob")
    assert AccountService(target).get_by_username("bob").pseudonym == "ann-0001"

    with pytest.raises(DomainError) as error:
        project_archive.import_archive(target, OPERATOR, data)
    assert error.value.code == "ARCHIVE_PSEUDONYM_TAKEN"
    assert "ann-0001" in str(error.value)
    result = project_archive.import_archive(
        target, OPERATOR, data, rename_pseudonyms=True
    )

    new = result["renamed_pseudonyms"]["ann-0001"]
    assert new != "ann-0001"
    with target.snapshot() as conn:
        annotators = set(conn.execute(select(SubmissionRow.annotator_id)).scalars())
        pseudonyms = set(conn.execute(select(UserRow.pseudonym)).scalars())
    assert annotators == {new}
    assert new not in pseudonyms


def test_annotator_ids_without_an_account_stay_on_their_own_server(
    tmp_path: Path,
) -> None:
    """An archive of this server and a second import of the same server's
    archive keep the ids: they name the same annotator."""
    db = _t1_source(tmp_path)
    data = project_archive.build_archive(
        db, "proj", tmp_path / "a.zip"
    ).path.read_bytes()
    copy = project_archive.import_archive(db, OPERATOR, data)
    assert copy["renamed_pseudonyms"] == {}
    target = database_for(tmp_path / "t" / "t.db")
    first = project_archive.import_archive(target, OPERATOR, data)
    second = project_archive.import_archive(target, OPERATOR, data)
    assert first["renamed_pseudonyms"] == second["renamed_pseudonyms"] == {}
    assert second["project"] == "proj-2"


# 3. Archives never nest; their files go ------------------------------------


def test_archives_do_not_carry_earlier_archives_or_erased_emails(
    tmp_path: Path,
) -> None:
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        _set_email(scenario, "ann-0001", "secret.person@example.org")
        db = _db(source)
        first = _export_job(db, scenario.key)
        first_data = db.blobs.get(first.result["sha256"])
        with zipfile.ZipFile(io.BytesIO(first_data)) as archive:
            assert b"secret.person@example.org" in archive.read("people.jsonl")
        second = _export_job(db, scenario.key)
        second_data = db.blobs.get(second.result["sha256"])
        assert _nested_zips(second_data) == []
        assert abs(len(second_data) - len(first_data)) < len(first_data) // 2

        # The import's uploaded ZIP goes once the job is done.
        from ontotator.exchange.jobs import store_file

        sha = store_file(_db(target), second_data)
        job = _run_job(
            _db(target),
            "project_archive_import",
            {"blob_sha256": sha, "filename": "a.zip"},
        )
        assert job.status == "succeeded", job.error
        assert not _db(target).blobs.path(sha).exists()
        again = _export(target, job.result["project"], tmp_path)
        assert _nested_zips(again) == []

        # Erasing an account deletes every stored archive of the server.
        accounts = source.app.state.accounts
        accounts.set_active(Actor.cli(), scenario.users["ann-0001"], False)
        accounts.anonymise(Actor.cli(), scenario.users["ann-0001"])
        for done in (first, second):
            assert not db.blobs.path(done.result["sha256"]).exists()
        with db.snapshot() as conn:
            assert (
                conn.execute(
                    select(StoredFileRow.sha256).where(
                        StoredFileRow.sha256 == first.result["sha256"]
                    )
                ).first()
                is None
            )


def test_a_failed_import_job_deletes_its_upload_too(tmp_path: Path) -> None:
    with TestClient(_app(tmp_path / "t")) as target:
        from ontotator.exchange.jobs import store_file

        sha = store_file(_db(target), b"not a zip")
        job = _run_job(
            _db(target),
            "project_archive_import",
            {"blob_sha256": sha, "filename": "a.zip"},
        )
        assert job.status == "failed"
        assert not _db(target).blobs.path(sha).exists()


def test_exported_archives_expire(tmp_path: Path) -> None:
    with TestClient(_app(tmp_path / "s")) as source:
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        db = _db(source)
        job = _export_job(db, scenario.key)
        sha = job.result["sha256"]
        project_archive.expire_archive_files(db, datetime.now(UTC))
        assert db.blobs.path(sha).exists()
        project_archive.expire_archive_files(
            db, datetime.now(UTC) + project_archive.ARCHIVE_RETENTION + timedelta(1)
        )
        assert not db.blobs.path(sha).exists()
        with db.snapshot() as conn:
            result = conn.execute(
                select(JobRow.result).where(JobRow.id == job.id)
            ).scalar_one()
        assert result["file_deleted_at"]


# 4. Limits from the ZIP itself ---------------------------------------------


def _with_blob(data: bytes, content: bytes) -> bytes:
    """The archive with one more stored file, listed with its true size."""

    def change(files: dict[str, bytes]) -> None:
        digest = hashlib.sha256(content).hexdigest()
        files[f"blobs/{digest}"] = content
        manifest = json.loads(files["manifest.json"])
        manifest["files"][f"blobs/{digest}"] = {"sha256": digest, "size": len(content)}
        files["manifest.json"] = json.dumps(manifest).encode()

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    change(files)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return out.getvalue()


def test_an_archive_that_expands_too_far_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        data = _export(source, scenario.key, tmp_path)
        bomb = _with_blob(data, b"\0" * (40 * 1024 * 1024))
        assert len(bomb) < 2 * len(data) + 1024 * 1024
        with pytest.raises(DomainError) as error:
            project_archive.import_archive(_db(target), OPERATOR, bomb)
        assert error.value.code == "ARCHIVE_TOO_LARGE"
        assert "ratio" in str(error.value)

        monkeypatch.setenv("ONTOTATOR_ARCHIVE_MAX_EXPANDED_BYTES", str(len(data)))
        with pytest.raises(DomainError) as error:
            project_archive.import_archive(_db(target), OPERATOR, data)
        assert error.value.code == "ARCHIVE_TOO_LARGE"
        with _db(target).snapshot() as conn:
            assert conn.execute(select(ProjectRow.id)).first() is None


def test_archive_entries_must_be_plain_names(tmp_path: Path) -> None:
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        data = _export(source, scenario.key, tmp_path)
        for name in ("../evil.txt", "/etc/evil", "tables/../people.jsonl"):

            def change(files: dict[str, bytes], name: str = name) -> None:
                files[name] = b"x"
                manifest = json.loads(files["manifest.json"])
                manifest["files"][name] = {
                    "sha256": hashlib.sha256(b"x").hexdigest(),
                    "size": 1,
                }
                files["manifest.json"] = json.dumps(manifest).encode()

            with pytest.raises(DomainError) as error:
                project_archive.import_archive(
                    _db(target), OPERATOR, _rewrite(data, change)
                )
            assert error.value.code == "ARCHIVE_INVALID", name


# 5. Integer ids inside JSON ------------------------------------------------


def test_ids_inside_json_point_at_the_imported_project(tmp_path: Path) -> None:
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        # The target has rows of its own first: ids differ.
        _consolidation_project(target.app)  # type: ignore[arg-type]
        built = _consolidation_project(source.app)  # type: ignore[arg-type]
        key = built["scenario"].key
        db = _db(source)
        pid = _project_id(db, key)
        with db.transaction() as conn:
            parent = conn.execute(
                select(JobRow.id).where(JobRow.project_id == pid).limit(1)
            ).scalar_one()
            conn.execute(
                insert(JobRow).values(
                    kind="reanchor",
                    status="succeeded",
                    project_id=pid,
                    payload={
                        "project": key,
                        "producer": {"kind": "import", "job_id": parent},
                    },
                    result={},
                    requested_label="test:operator",
                    finished_at=datetime.now(UTC),
                )
            )
        data = _export(source, key, tmp_path)
        result = project_archive.import_archive(
            _db(target), OPERATOR, data, rename_pseudonyms=True
        )
        assert result["verification"]["ok"]
        new_pid = _project_id(_db(target), result["project"])
        with _db(target).snapshot() as conn:
            own_assignments = set(
                conn.execute(
                    select(AssignmentRow.id).where(AssignmentRow.project_id == new_pid)
                ).scalars()
            )
            own_jobs = set(
                conn.execute(
                    select(JobRow.id).where(JobRow.project_id == new_pid)
                ).scalars()
            )
            audits = conn.execute(
                select(
                    AuditEventRow.target_type,
                    AuditEventRow.target_id,
                    AuditEventRow.details,
                ).where(
                    AuditEventRow.project_id == new_pid,
                    AuditEventRow.action != "project.import_archive",
                )
            ).all()
            producers = [
                payload["producer"]["job_id"]
                for payload in conn.execute(
                    select(JobRow.payload).where(
                        JobRow.project_id == new_pid, JobRow.kind == "reanchor"
                    )
                ).scalars()
            ]
            users = set(conn.execute(select(UserRow.id)).scalars())
        checked = 0
        for target_type, target_id, details in audits:
            if target_type == "assignment":
                assert int(target_id) in own_assignments or int(target_id) < 0
                checked += 1
            for name, allowed in (
                ("assignment_id", own_assignments),
                ("job_id", own_jobs),
            ):
                value = (details or {}).get(name)
                if isinstance(value, int):
                    assert value in allowed or value < 0, (name, value, details)
                    checked += 1
            for name in ("user_id", "actor_id"):
                value = (details or {}).get(name)
                if isinstance(value, int):
                    assert value in users
        assert checked
        assert producers and all(p in own_jobs for p in producers)


# 7. A failed import leaves no files -------------------------------------


def test_a_refused_import_leaves_no_files(tmp_path: Path) -> None:
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        data = _export(source, scenario.key, tmp_path)
        target_db = _db(target)
        # The target's first account takes the archived annotator's pseudonym.
        _account(target, "other", "other@example.org")
        before = _blob_files(target_db)
        with pytest.raises(DomainError) as error:
            project_archive.import_archive(target_db, OPERATOR, data)
        assert error.value.code == "ARCHIVE_PSEUDONYM_TAKEN"
        assert _blob_files(target_db) == before


def test_a_failed_verification_leaves_no_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        data = _export(source, scenario.key, tmp_path)
        target_db = _db(target)
        before = _blob_files(target_db)
        monkeypatch.setattr(
            project_archive,
            "verify",
            lambda *_args: {"ok": False, "mismatches": [], "files_checked": 0},
        )
        with pytest.raises(DomainError):
            project_archive.import_archive(target_db, OPERATOR, data)
        assert _blob_files(target_db) == before


# 11. E-mail addresses only of people who worked in the project -------------


def test_people_outside_the_work_are_named_without_email(tmp_path: Path) -> None:
    with TestClient(_app(tmp_path / "s")) as source:
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        _set_email(scenario, "ann-0001", "annie@example.org")
        _account(source, "auditor", "auditor@example.org")
        db = _db(source)
        auditor = source.app.state.accounts.get_by_username("auditor")
        pid = _project_id(db, scenario.key)
        with db.transaction() as conn:
            conn.execute(
                insert(AuditEventRow).values(
                    actor_user_id=auditor.id,
                    actor_label="user:auditor",
                    action="project.update",
                    target_type="project",
                    target_id=scenario.key,
                    project_id=pid,
                    details={"user_id": auditor.id},
                )
            )
        data = _export(source, scenario.key, tmp_path)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            people = {
                p["username"]: p
                for p in map(json.loads, archive.read("people.jsonl").splitlines())
            }
        assert people["auditor"]["email"] is None
        assert people[scenario.users["ann-0001"]]["email"] == "annie@example.org"


# 12. Fix round of the #325 review ------------------------------------------


def _craft(data: bytes, table_name: str, change: Any) -> bytes:
    """The archive with ``change(rows)`` applied to one table, the manifest
    made to match: a deliberate change, not damage."""

    def apply(files: dict[str, bytes]) -> None:
        name = f"tables/{table_name}.jsonl"
        rows = change([json.loads(line) for line in files[name].splitlines()])
        files[name] = project_archive.jsonl(rows)
        manifest = json.loads(files["manifest.json"])
        manifest["rows"][table_name] = len(rows)
        manifest["files"][name] = {
            "sha256": hashlib.sha256(files[name]).hexdigest(),
            "size": len(files[name]),
        }
        files["manifest.json"] = json.dumps(manifest).encode()

    return _rewrite(data, apply)


def _set_first(column: str, value: Any) -> Any:
    def change(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        assert rows
        rows[0][column] = value
        return rows

    return change


def test_references_out_of_the_archive_are_refused(tmp_path: Path) -> None:
    """A text id naming another project's row (a round, a report, ...) or a
    job result naming a stored file: the import refuses the archive."""
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        db = _db(source)
        # An export job of the project: the archive keeps it, not its file.
        _run_job(
            db,
            "edit_log_export",
            {"project": scenario.key},
            project_id=_project_id(db, scenario.key),
        )
        data = _export(source, scenario.key, tmp_path)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            jobs = [
                json.loads(line)
                for line in archive.read("tables/jobs.jsonl").splitlines()
            ]
        assert any(job["kind"] == "edit_log_export" for job in jobs)
        assert not any("sha256" in (job["result"] or {}) for job in jobs)
        foreign = "round-" + "f" * 32
        crafted = {
            "predecessor": _craft(
                data, "work_rounds", _set_first("predecessor_round_id", foreign)
            ),
            "active round": _craft(
                data, "assignments", _set_first("active_round_id", foreign)
            ),
            "job result": _craft(
                data,
                "jobs",
                lambda rows: [
                    {**row, "result": {**(row["result"] or {}), "sha256": "a" * 64}}
                    if row["kind"] == "edit_log_export"
                    else row
                    for row in rows
                ],
            ),
        }
        stored = store_file(_db(target), b"another project's file")
        crafted["stored file"] = _craft(
            data,
            "uploads",
            # Refused before any row is written: the other columns do not matter.
            lambda rows: [*rows, {"id": 999999, "files": [{"sha256": stored}]}],
        )
        for label, archive_data in crafted.items():
            with pytest.raises(DomainError) as error:
                project_archive.import_archive(_db(target), OPERATOR, archive_data)
            assert error.value.code == "ARCHIVE_INVALID", label
        with _db(target).snapshot() as conn:
            assert conn.execute(select(ProjectRow.id)).first() is None
        assert project_archive.import_archive(_db(target), OPERATOR, data)[
            "verification"
        ]["ok"]


def test_tables_beyond_their_own_limit_are_refused_before_reading(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        data = _export(source, scenario.key, tmp_path)
        monkeypatch.setattr(project_archive, "MAX_ROWS_BYTES", 1024)
        read = project_archive._copy_entry
        names: list[str] = []
        monkeypatch.setattr(
            project_archive,
            "_copy_entry",
            lambda archive, info, out: (
                names.append(info.filename) or read(archive, info, out)
            ),
        )
        with pytest.raises(DomainError) as error:
            project_archive.import_archive(_db(target), OPERATOR, data)
        assert error.value.code == "ARCHIVE_TOO_LARGE"
        assert "tables expand" in str(error.value)
        assert names == ["manifest.json"]


def test_an_import_on_the_same_server_keeps_the_export_file(tmp_path: Path) -> None:
    """The export's file is the upload: it stays for the export's 24 hours,
    and an export expiring keeps the file a queued import still needs."""
    with TestClient(_app(tmp_path / "s")) as source:
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        db = _db(source)
        export = _export_job(db, scenario.key)
        sha = export.result["sha256"]
        stored = store_file(db, db.blobs.get(sha))
        assert stored == sha
        job = _run_job(
            db, "project_archive_import", {"blob_sha256": sha, "filename": "a.zip"}
        )
        assert job.status == "succeeded", job.error
        assert db.blobs.path(sha).exists()

        queue = JobQueue(db, HANDLERS)
        queued = queue.enqueue(
            "project_archive_import",
            {"blob_sha256": sha, "filename": "a.zip"},
            actor=OPERATOR,
        )
        later = datetime.now(UTC) + project_archive.ARCHIVE_RETENTION + timedelta(1)
        project_archive.expire_archive_files(db, later)
        assert db.blobs.path(sha).exists()
        claimed = queue.claim(queued, "test")
        assert claimed is not None
        assert queue.run(claimed, "test").status == "succeeded"
        assert not db.blobs.path(sha).exists()


def test_copies_of_copies_continue_the_series(tmp_path: Path) -> None:
    """No "-2-2" or "(2) (2)": a copy of a copy takes the next free number."""
    with (
        TestClient(_app(tmp_path / "s")) as source,
        TestClient(_app(tmp_path / "t")) as target,
    ):
        scenario = _simple_project(source.app)  # type: ignore[arg-type]
        data = _export(source, scenario.key, tmp_path)
        first = project_archive.import_archive(_db(target), OPERATOR, data)
        second = project_archive.import_archive(_db(target), OPERATOR, data)
        assert second["project"] == f"{scenario.key}-2"
        copy = _export(target, second["project"], tmp_path)
        third = project_archive.import_archive(_db(target), OPERATOR, copy)
        assert third["project"] == f"{scenario.key}-3"
        assert third["name"] == f"{first['name']} (3)"
