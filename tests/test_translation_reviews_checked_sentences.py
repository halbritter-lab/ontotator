"""Checked-sentence marks of a translation review (issue 256): a reviewer's aid only."""

import json

import pytest
from auth_harness import logged_in
from sqlalchemy import select
from test_review_export import exported_env as exported_env
from test_review_export import queued, run
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save

from ontotator.application.translation_reviews import (
    CHECKED_SENTENCES_KEY,
    CheckedSentences,
)
from ontotator.domain.errors import DomainError
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    TranslationReviewDraftRow,
)

MARKS = {
    "source": [{"index": 0, "hash": "0a1b2c3d"}, {"index": 2, "hash": "deadbeef"}],
    "translation": [{"index": 1, "hash": "12345678"}],
}


def _draft_row(env):
    with env.db.transaction() as conn:
        return (
            conn.execute(
                select(TranslationReviewDraftRow).where(
                    TranslationReviewDraftRow.assignment_id == env.ids["alice"]
                )
            )
            .mappings()
            .one()
        )


def _status(env):
    with env.db.transaction() as conn:
        return conn.execute(
            select(AssignmentRow.status, AssignmentRow.updated_at).where(
                AssignmentRow.id == env.ids["alice"]
            )
        ).one()


def _mark(env, marks=MARKS):
    return env.service.save_checked_sentences(
        env.accesses["alice"],
        env.ids["alice"],
        CheckedSentences.model_validate(marks),
    )


def test_marks_round_trip_without_starting_the_task(review_env):
    env = review_env
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert opened.checked_sentences == CheckedSentences()
    before, row_before = _status(env), _draft_row(env)
    assert before.status == "open"
    _mark(env)
    # Marking alone never starts the task, bumps the draft revision or its time.
    assert _status(env) == before
    row = _draft_row(env)
    assert row["revision"] == row_before["revision"] == 0
    assert row["updated_at"] == row_before["updated_at"]
    reopened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert reopened.checked_sentences.model_dump() == MARKS
    # The review form the client sees never carries the marks.
    assert CHECKED_SENTENCES_KEY not in reopened.draft.form
    assert reopened.draft.revision == 0


def test_draft_saves_keep_the_marks_and_marks_keep_the_draft(review_env):
    env = review_env
    env.service.open(env.accesses["alice"], env.ids["alice"])
    _mark(env)
    revision = save(env, "accepted_corrected", "Geändert")
    reopened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert reopened.checked_sentences.model_dump() == MARKS
    assert reopened.draft.text == "Geändert" and reopened.draft.revision == revision
    assert reopened.draft.form["decision"] == "accepted_corrected"
    # A client that echoes a marks key in the form cannot overwrite the stored marks.
    env.service.save_draft(
        env.accesses["alice"],
        env.ids["alice"],
        expected_revision=revision,
        text="Geändert",
        form={**reopened.draft.form, CHECKED_SENTENCES_KEY: {"source": []}},
    )
    assert (
        env.service.open(
            env.accesses["alice"], env.ids["alice"]
        ).checked_sentences.model_dump()
        == MARKS
    )
    _mark(env, {"source": [], "translation": [{"index": 0, "hash": "aaaaaaaa"}]})
    after = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert after.draft.form["decision"] == "accepted_corrected"
    assert after.draft.revision == revision + 1
    assert after.checked_sentences.translation[0].hash == "aaaaaaaa"


def test_stored_index_and_hash_let_the_client_detect_stale_marks(review_env):
    env = review_env
    env.service.open(env.accesses["alice"], env.ids["alice"])
    _mark(env)
    # A later edit of the text keeps the marks as stored; the client compares the
    # stored hash with the hash of the sentence now at that index.
    save(env, "accepted_corrected", "Ganz anders")
    stored = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert [(m.index, m.hash) for m in stored.checked_sentences.translation] == [
        (1, "12345678")
    ]


def test_http_contract_validates_and_keeps_status(review_env):
    env = review_env
    client = logged_in(env.app, "alice", assignments=[])
    url = f"/api/v1/translation-reviews/{env.ids['alice']}"
    assert client.get(url).json()["checked_sentences"] == {
        "source": [],
        "translation": [],
    }
    response = client.put(url + "/checked-sentences", json=MARKS)
    assert response.status_code == 200, response.text
    assert response.json() == MARKS
    assert client.get(url).json()["checked_sentences"] == MARKS
    assert _status(env).status == "open"
    for bad in (
        {"source": [{"index": 0, "hash": "XYZ"}]},
        {"source": [{"index": -1, "hash": "0a1b2c3d"}]},
        {"source": [{"index": "1", "hash": "0a1b2c3d"}]},
        {"other": []},
    ):
        assert client.put(url + "/checked-sentences", json=bad).status_code == 422
    # Another reviewer cannot read or write these marks.
    bob = logged_in(env.app, "bob", assignments=[])
    assert bob.put(url + "/checked-sentences", json=MARKS).status_code == 404


def test_marks_never_reach_the_review_result_exports_or_audit(exported_env):
    env = exported_env
    env.service.open(env.accesses["alice"], env.ids["alice"])
    _mark(env)
    revision = save(env, rationale="Checked.")
    _mark(env)
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    dumped = record.model_dump_json()
    assert CHECKED_SENTENCES_KEY not in dumped and "deadbeef" not in dumped
    # The submitted, read-only review shows no marks.
    reopened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert reopened.checked_sentences == CheckedSentences()
    assert CHECKED_SENTENCES_KEY not in reopened.draft.form
    records = env.lead.get(
        "/api/v1/projects/proj/documents/target/translation-reviews"
    ).json()
    assert records and "deadbeef" not in json.dumps(records)
    result = run(env, queued(env))
    blob = env.db.blobs.get(result.result["sha256"]).decode()
    assert "deadbeef" not in blob and CHECKED_SENTENCES_KEY not in blob
    with env.db.transaction() as conn:
        details = conn.execute(select(AuditEventRow.details)).scalars().all()
    assert "deadbeef" not in json.dumps(details, default=str)
    # Marking a submitted review is refused.
    with pytest.raises(DomainError) as refused:
        _mark(env)
    assert refused.value.code == "ASSIGNMENT_SUBMITTED"


def test_two_tabs_keep_each_others_marks(review_env):
    """Issue 284: each tab sends the marks it started from; only its change applies."""
    env = review_env
    client = logged_in(env.app, "alice", assignments=[])
    url = f"/api/v1/translation-reviews/{env.ids['alice']}"
    opened = client.get(url).json()["checked_sentences"]
    one = {"index": 0, "hash": "0a1b2c3d"}
    two = {"index": 1, "hash": "12345678"}
    # Tab A marks sentence 0; tab B, opened before, marks sentence 1.
    tab_a = {"source": [], "translation": [one], "base": opened}
    assert client.put(url + "/checked-sentences", json=tab_a).json() == {
        "source": [],
        "translation": [one],
    }
    tab_b = {"source": [], "translation": [two], "base": opened}
    both = {"source": [], "translation": [one, two]}
    assert client.put(url + "/checked-sentences", json=tab_b).json() == both
    # Tab A, which still shows only its own mark, unmarks it: tab B's mark stays.
    tab_a = {"source": [], "translation": [], "base": {"translation": [one]}}
    assert client.put(url + "/checked-sentences", json=tab_a).json() == {
        "source": [],
        "translation": [two],
    }
    # Tab B, which took over both marks from its answer, unmarks its sentence.
    tab_b = {"source": [], "translation": [one], "base": both}
    assert client.put(url + "/checked-sentences", json=tab_b).json() == {
        "source": [],
        "translation": [],
    }
    assert client.get(url).json()["checked_sentences"]["translation"] == []
    # The base is never stored with the marks.
    assert "base" not in _draft_row(env)["form"][CHECKED_SENTENCES_KEY]


def test_without_a_base_the_marks_replace_the_stored_ones(review_env):
    env = review_env
    env.service.open(env.accesses["alice"], env.ids["alice"])
    _mark(env)
    only = {"source": [], "translation": [{"index": 3, "hash": "aaaaaaaa"}]}
    assert _mark(env, only).model_dump() == only
    merged = env.service.save_checked_sentences(
        env.accesses["alice"],
        env.ids["alice"],
        CheckedSentences.model_validate(MARKS),
        base=CheckedSentences(),
    )
    # Everything from the empty base is new: added to the stored mark.
    assert merged.model_dump() == {
        "source": MARKS["source"],
        "translation": [{"index": 1, "hash": "12345678"}, only["translation"][0]],
    }
