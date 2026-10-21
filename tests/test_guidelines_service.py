"""Guideline service: upload, withdraw, reads, notice and lead overview (G0b)."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace

import pytest
from pg_harness import database_for
from sqlalchemy import delete, func, insert, select, update

from ontocurator.application.guidelines import GuidelineService, guideline_notice
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.storage.database import advisory_lock_id
from ontocurator.storage.guideline_tables import (
    GuidelineContentRow,
    GuidelineReadRow,
    GuidelineVersionRow,
    GuidelineWithdrawalRow,
)
from ontocurator.storage.tables import (
    AuditEventRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)

USERS = {
    # name: (display name, roles in project "p", system admin)
    "lead": ("Lena Lead", ("lead",), False),
    "alice": ("Bea Alice", ("annotator",), False),
    "bob": ("Abe Bob", ("adjudicator",), False),
    "both": ("Cid Both", ("annotator", "lead"), False),
    "admin": ("Root Admin", (), True),
    "outsider": ("Out Sider", (), False),
}


class Clock:
    def __init__(self) -> None:
        self.at = datetime(2026, 10, 21, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        self.at += timedelta(minutes=1)
        return self.at


@pytest.fixture
def world(tmp_path: Path) -> SimpleNamespace:
    db = database_for(tmp_path / "guidelines.db")
    ids: dict[str, int] = {}
    with db.transaction() as conn:
        project = conn.execute(
            insert(ProjectRow)
            .values(
                project_key="p",
                name="Project",
                manifest={},
                manifest_sha256="m",
                task_profile={},
                task_profile_sha256="t",
            )
            .returning(ProjectRow.id)
        ).scalar_one()
        for i, (name, (display, roles, admin)) in enumerate(USERS.items(), 1):
            ids[name] = conn.execute(
                insert(UserRow)
                .values(
                    username=name,
                    display_name=display,
                    pseudonym=f"ann-{i:04}",
                    is_system_admin=admin,
                )
                .returning(UserRow.id)
            ).scalar_one()
            for role in roles:
                conn.execute(
                    insert(ProjectMembershipRow).values(
                        project_id=project, user_id=ids[name], role=role
                    )
                )
    clock = Clock()
    return SimpleNamespace(
        db=db,
        project=project,
        ids=ids,
        clock=clock,
        svc=GuidelineService(db, now=clock),
    )


def access(world: SimpleNamespace, name: str) -> Access:
    _display, roles, admin = USERS[name]
    return Access(
        user_id=world.ids[name],
        pseudonym=name,
        is_system_admin=admin,
        roles={"p": frozenset(roles)},
    )


def actor(world: SimpleNamespace, name: str) -> Actor:
    return Actor.user(world.ids[name], name)


def upload(
    world: SimpleNamespace,
    text: str,
    *,
    expected: int | None,
    name: str = "lead",
    filename: str = "rules.md",
    note: str | None = None,
):
    return world.svc.upload(
        actor(world, name),
        "p",
        filename=filename,
        data=text.encode("utf-8"),
        change_note=note,
        expected_latest_version=expected,
    )


def reads(world: SimpleNamespace) -> dict[tuple[int, int], tuple]:
    with world.db.transaction() as conn:
        return {
            (row.version, row.user_id): (row.notified_at, row.opened_at)
            for row in conn.execute(select(GuidelineReadRow))
        }


def test_upload_numbers_versions_and_records_uploader_read(world) -> None:
    first = upload(world, "# One", expected=None, note="First")
    second = upload(world, "Two", expected=1, filename="rules.txt")
    assert (first.version, first.kind, first.change_note) == (1, "markdown", "First")
    assert (second.version, second.kind, second.filename) == (2, "text", "rules.txt")
    assert second.size_bytes == 3
    lead = world.ids["lead"]
    marks = reads(world)
    assert set(marks) == {(1, lead), (2, lead)}
    assert all(notified and opened for notified, opened in marks.values())


@pytest.mark.parametrize(
    "filename,data,code",
    [
        ("rules.pdf", b"text", "GUIDELINE_FILE_TYPE"),
        ("rules.md", b"x" * 262_145, "GUIDELINE_TOO_LARGE"),
        ("rules.md", b"\xff\xfe", "GUIDELINE_ENCODING"),
        ("rules.md", b"a\x00b", "GUIDELINE_ENCODING"),
        ("rules.txt", b" \n\t", "GUIDELINE_EMPTY"),
    ],
    ids=["type", "size", "utf8", "nul", "empty"],
)
def test_upload_refuses_each_invalid_file(world, filename, data, code) -> None:
    with pytest.raises(DomainError) as error:
        world.svc.upload(
            actor(world, "lead"),
            "p",
            filename=filename,
            data=data,
            change_note=None,
            expected_latest_version=None,
        )
    assert error.value.code == code
    with pytest.raises(DomainError) as error:
        upload(world, "ok", expected=None, note="two\nlines")
    assert error.value.code == "GUIDELINE_NOTE_INVALID"
    assert error.value.details == {"field": "change_note"}
    with world.db.transaction() as conn:
        assert conn.execute(select(GuidelineVersionRow)).first() is None


def test_unchanged_body_is_refused_against_the_current_version_only(world) -> None:
    upload(world, "Alpha", expected=None)
    upload(world, "Beta", expected=1)
    with pytest.raises(DomainError) as error:
        upload(world, "Beta", expected=2, filename="other.txt")
    assert error.value.code == "GUIDELINE_UNCHANGED"
    assert error.value.details == {"version": 2}
    assert upload(world, "Alpha", expected=2).version == 3


def test_expected_latest_version_conflict(world) -> None:
    upload(world, "Alpha", expected=None)
    for stale in (None, 0, 2):
        with pytest.raises(DomainError) as error:
            upload(world, "Beta", expected=stale)
        assert error.value.code == "GUIDELINE_VERSION_CONFLICT"
    with world.db.transaction() as conn:
        assert conn.execute(select(GuidelineVersionRow.version)).scalars().all() == [1]


def test_concurrent_uploads_serialize(world) -> None:
    upload(world, "Base", expected=None)
    start = Barrier(2)

    def attempt(text: str):
        start.wait()
        try:
            return upload(world, text, expected=1).version
        except DomainError as exc:
            return exc.code

    with ThreadPoolExecutor(2) as pool:
        outcomes = sorted(map(str, pool.map(attempt, ["Left", "Right"])))
    assert outcomes == ["2", "GUIDELINE_VERSION_CONFLICT"]


def _invariant_holds(world) -> None:
    with world.db.transaction() as conn:
        versions = set(conn.execute(select(GuidelineVersionRow.version)).scalars())
        contents = set(conn.execute(select(GuidelineContentRow.version)).scalars())
        withdrawn = set(conn.execute(select(GuidelineWithdrawalRow.version)).scalars())
    assert contents | withdrawn == versions
    assert not contents & withdrawn


def test_withdraw_deletes_contents_and_writes_withdrawal(world) -> None:
    upload(world, "Alpha", expected=None, note="First")
    upload(world, "Beta", expected=1)
    _invariant_holds(world)
    summary = world.svc.withdraw(
        actor(world, "lead"), "p", 1, reason="Wrong file", expected_latest_version=2
    )
    assert summary.version == 1
    assert summary.filename is None and summary.change_note is None
    assert summary.withdrawn is not None and summary.withdrawn.reason == "Wrong file"
    assert summary.withdrawn.by.pseudonym == "ann-0001"
    _invariant_holds(world)
    document = world.svc.document(access(world, "alice"), "p", 1)
    assert document.body is None and document.withdrawn is not None
    assert world.svc.document(access(world, "alice"), "p", 2).body == "Beta"


def test_withdraw_refusals(world) -> None:
    upload(world, "Alpha", expected=None)
    lead = actor(world, "lead")
    cases = [
        (dict(version=9, reason=None, expected=1), "GUIDELINE_NOT_FOUND", None),
        (
            dict(version=1, reason="a\nb", expected=1),
            "GUIDELINE_NOTE_INVALID",
            {"field": "reason"},
        ),
        (dict(version=1, reason=None, expected=0), "GUIDELINE_VERSION_CONFLICT", None),
    ]
    for case, code, details in cases:
        with pytest.raises(DomainError) as error:
            world.svc.withdraw(
                lead,
                "p",
                case["version"],
                reason=case["reason"],
                expected_latest_version=case["expected"],
            )
        assert error.value.code == code
        if details is not None:
            assert error.value.details == details
    world.svc.withdraw(lead, "p", 1, reason=None, expected_latest_version=1)
    with pytest.raises(DomainError) as error:
        world.svc.withdraw(lead, "p", 1, reason=None, expected_latest_version=1)
    assert error.value.code == "GUIDELINE_ALREADY_WITHDRAWN"
    assert error.value.details == {"version": 1}
    with pytest.raises(AccessDenied):
        world.svc.withdraw(
            actor(world, "alice"), "p", 1, reason=None, expected_latest_version=1
        )


def test_current_version_after_withdrawals(world) -> None:
    for n, text in enumerate(["A", "B", "C"]):
        upload(world, text, expected=n or None)
    lead = actor(world, "lead")
    world.svc.withdraw(lead, "p", 2, reason=None, expected_latest_version=3)
    listing = world.svc.listing(access(world, "alice"), "p")
    assert listing.current is not None and listing.current.version == 3
    world.svc.withdraw(lead, "p", 3, reason=None, expected_latest_version=3)
    listing = world.svc.listing(access(world, "alice"), "p")
    assert listing.current is None
    assert listing.latest_version == 3
    assert [item.version for item in listing.versions] == [3, 2, 1]


def test_numbering_continues_after_withdrawn_latest(world) -> None:
    for n, text in enumerate(["A", "B", "C", "D"]):
        upload(world, text, expected=n or None)
    world.svc.withdraw(
        actor(world, "lead"), "p", 4, reason=None, expected_latest_version=4
    )
    # Same text as the withdrawn v4: nothing is in force, so it is not "unchanged".
    assert upload(world, "D", expected=4).version == 5


def test_reads_upsert_keeps_first_timestamp(world) -> None:
    upload(world, "A", expected=None)
    alice = access(world, "alice")
    world.svc.record_read(alice, "p", 1, "notified")
    first = reads(world)[(1, world.ids["alice"])]
    assert first[0] is not None and first[1] is None
    world.svc.record_read(alice, "p", 1, "notified")
    world.svc.record_read(alice, "p", 1, "opened")
    world.svc.record_read(alice, "p", 1, "opened")
    notified, opened = reads(world)[(1, world.ids["alice"])]
    assert notified == first[0]
    assert opened is not None and opened > notified
    with pytest.raises(DomainError) as error:
        world.svc.record_read(alice, "p", 7, "opened")
    assert error.value.code == "GUIDELINE_NOT_FOUND"


def test_reads_ignored_for_withdrawn_versions(world) -> None:
    upload(world, "A", expected=None)
    world.svc.withdraw(
        actor(world, "lead"), "p", 1, reason=None, expected_latest_version=1
    )
    world.svc.record_read(access(world, "alice"), "p", 1, "opened")
    assert (1, world.ids["alice"]) not in reads(world)


def _notice(world, name: str):
    with world.db.transaction() as conn:
        return guideline_notice(conn, project_id=world.project, user_id=world.ids[name])


def test_notice_for_task_owner(world) -> None:
    assert _notice(world, "alice") is None
    upload(world, "v1", expected=None, note="Start")
    first = _notice(world, "alice")
    assert first is not None
    assert (first.from_version, first.to_version, first.more) == (None, 1, 0)
    world.svc.record_read(access(world, "alice"), "p", 1, "notified")
    assert _notice(world, "alice") is None
    assert _notice(world, "lead") is None  # the uploader saw their own upload
    upload(world, "v2", expected=1, note="Second")
    upload(world, "v3", expected=2, note="Third")
    world.svc.withdraw(
        actor(world, "lead"), "p", 2, reason=None, expected_latest_version=3
    )
    skipped = _notice(world, "alice")
    assert skipped is not None
    assert (skipped.from_version, skipped.to_version) == (1, 3)
    assert [(c.version, c.change_note, c.withdrawn) for c in skipped.changes] == [
        (3, "Third", False),
        (2, None, True),
    ]
    for n in range(4, 10):
        upload(world, f"v{n}", expected=n - 1)
    many = _notice(world, "alice")
    assert many is not None
    assert [c.version for c in many.changes] == [9, 8, 7, 6, 5]
    assert many.more == 3
    world.svc.record_read(access(world, "alice"), "p", 9, "opened")
    assert _notice(world, "alice") is None


def test_not_seen_lists_task_members_without_opened(world) -> None:
    upload(world, "v1", expected=None)
    world.svc.record_read(access(world, "alice"), "p", 1, "notified")
    listing = world.svc.listing(access(world, "lead"), "p")
    current = listing.current
    assert current is not None and current.not_seen is not None
    # Sorted by display name: Abe Bob, Bea Alice, Cid Both; "lead" is lead only.
    assert [(item.person.pseudonym, item.notified) for item in current.not_seen] == [
        ("ann-0003", False),
        ("ann-0002", True),
        ("ann-0004", False),
    ]
    assert current.not_seen[0].person.display_name == "Abe Bob"
    world.svc.record_read(access(world, "bob"), "p", 1, "opened")
    current = world.svc.listing(access(world, "lead"), "p").current
    assert current is not None and current.not_seen is not None
    assert [item.person.pseudonym for item in current.not_seen] == [
        "ann-0002",
        "ann-0004",
    ]
    upload(world, "v2", expected=1)
    listing = world.svc.listing(access(world, "lead"), "p")
    assert listing.versions[1].not_seen is None  # only on the current version


def test_reach_counts(world) -> None:
    upload(world, "v1", expected=None)
    world.svc.record_read(access(world, "alice"), "p", 1, "notified")
    world.svc.record_read(access(world, "bob"), "p", 1, "notified")
    world.svc.record_read(access(world, "bob"), "p", 1, "opened")
    upload(world, "v2", expected=1)
    world.svc.withdraw(
        actor(world, "lead"), "p", 1, reason=None, expected_latest_version=2
    )
    listing = world.svc.listing(access(world, "lead"), "p")
    current = listing.current
    assert current is not None and current.reach is not None
    assert current.reach.model_dump() == {"notified": 0, "opened": 0, "members": 3}
    assert listing.versions[1].reach is None  # withdrawn
    annotator = world.svc.listing(access(world, "alice"), "p")
    assert annotator.current is not None
    assert annotator.current.reach is None and annotator.current.not_seen is None
    assert annotator.current.created_by.display_name is None
    assert annotator.my_latest_seen is None


def test_reach_counts_notified_and_opened(world) -> None:
    upload(world, "v1", expected=None)
    world.svc.record_read(access(world, "alice"), "p", 1, "notified")
    world.svc.record_read(access(world, "bob"), "p", 1, "notified")
    world.svc.record_read(access(world, "bob"), "p", 1, "opened")
    world.svc.record_read(access(world, "admin"), "p", 1, "opened")
    current = world.svc.listing(access(world, "lead"), "p").current
    assert current is not None and current.reach is not None
    assert current.reach.model_dump() == {"notified": 2, "opened": 1, "members": 3}
    assert world.svc.listing(access(world, "bob"), "p").my_latest_seen == 1


def test_audit_details_have_no_filename_or_note(world) -> None:
    upload(world, "v1", expected=None, filename="secret-name.md", note="secret note")
    world.svc.withdraw(
        actor(world, "lead"), "p", 1, reason="oops", expected_latest_version=1
    )
    with world.db.transaction() as conn:
        events = conn.execute(
            select(
                AuditEventRow.action,
                AuditEventRow.target_type,
                AuditEventRow.target_id,
                AuditEventRow.details,
            ).order_by(AuditEventRow.id)
        ).all()
    upload_event, withdraw_event = [e for e in events if e[0].startswith("guideline.")]
    assert upload_event[:3] == ("guideline.upload", "guideline", "p:v1")
    assert set(upload_event[3]) == {
        "version",
        "kind",
        "size_bytes",
        "sha256",
        "previous_version",
    }
    assert "secret" not in str(upload_event[3])
    assert withdraw_event[:3] == ("guideline.withdraw", "guideline", "p:v1")
    assert withdraw_event[3] == {"version": 1, "reason": "oops", "was_current": True}


def test_system_admin_without_membership_can_upload_and_gets_no_notice(world) -> None:
    summary = upload(world, "v1", expected=None, name="admin")
    assert summary.version == 1
    assert _notice(world, "admin") is None
    assert world.svc.listing(access(world, "admin"), "p").current is not None
    with pytest.raises(DomainError) as error:
        world.svc.listing(access(world, "outsider"), "p")
    assert error.value.code == "PROJECT_NOT_FOUND"
    with pytest.raises(AccessDenied):
        upload(world, "v2", expected=1, name="alice")


@pytest.mark.parametrize(
    "filename",
    [
        "ru\x00les.md",
        "ru\nles.md",
        "ru\x7fles.md",
        "a" * 253 + ".md",
        "rules‮dm.txt",
        "ru​les.md",
    ],
    ids=["nul", "newline", "del", "too-long", "rtl-override", "zero-width"],
)
def test_upload_refuses_unsafe_filenames(world, filename) -> None:
    with pytest.raises(DomainError) as error:
        upload(world, "ok", expected=None, filename=filename)
    assert error.value.code == "GUIDELINE_FILE_TYPE"
    with world.db.transaction() as conn:
        assert conn.execute(select(GuidelineVersionRow)).first() is None


def test_upload_stores_the_base_filename(world) -> None:
    assert upload(world, "A", expected=None, filename="C:\\x\\y/rules.md").filename == (
        "rules.md"
    )
    assert upload(world, "B", expected=1, filename="a" * 252 + ".md").version == 2


def test_withdraw_checks_rights_before_the_reason(world) -> None:
    upload(world, "A", expected=None)
    with pytest.raises(AccessDenied):
        world.svc.withdraw(
            actor(world, "alice"), "p", 1, reason="a\nb", expected_latest_version=1
        )
    with pytest.raises(DomainError) as error:
        world.svc.withdraw(
            actor(world, "outsider"), "p", 1, reason="a\nb", expected_latest_version=1
        )
    assert error.value.code == "PROJECT_NOT_FOUND"


def test_record_read_waits_for_the_project_lock(world) -> None:
    upload(world, "A", expected=None)
    holding = Barrier(2)
    with ThreadPoolExecutor(1) as pool, world.db.transaction() as conn:
        conn.execute(
            select(func.pg_advisory_xact_lock(advisory_lock_id("project", "p")))
        )

        def read() -> None:
            holding.wait()
            world.svc.record_read(access(world, "alice"), "p", 1, "opened")

        pending = pool.submit(read)
        holding.wait()
        with pytest.raises(TimeoutError):
            pending.result(timeout=0.5)
        # Withdraw within the lock holder: the read then sees the withdrawal.
        conn.execute(
            delete(GuidelineContentRow).where(GuidelineContentRow.version == 1)
        )
        conn.execute(
            insert(GuidelineWithdrawalRow).values(
                project_id=world.project,
                version=1,
                withdrawn_by=world.ids["lead"],
                withdrawn_by_label="ann-0001",
                withdrawn_at=world.clock(),
            )
        )
    pending.result(timeout=10)
    assert (1, world.ids["alice"]) not in reads(world)


def test_deactivated_members_are_not_counted(world) -> None:
    upload(world, "v1", expected=None)
    with world.db.transaction() as conn:
        conn.execute(
            update(UserRow).where(UserRow.id == world.ids["bob"]).values(active=False)
        )
    current = world.svc.listing(access(world, "lead"), "p").current
    assert current is not None and current.reach is not None
    assert current.reach.members == 2
    assert current.not_seen is not None
    assert "ann-0003" not in [item.person.pseudonym for item in current.not_seen]
