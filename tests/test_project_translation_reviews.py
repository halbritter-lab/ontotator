"""GET /projects/{key}/translation-reviews: every review of a project (#352)."""

from test_case_api import BASE, TARGET
from test_translation_review_task import assigned
from test_translation_review_task import case_env as case_env
from work_plan_support import review_task

URL = f"{BASE}/translation-reviews"


def test_project_reviews_follow_the_per_text_rules(case_env):
    env = case_env
    assert env.lead.get(URL).json() == []
    row = assigned(env)
    env.alice.patch("/api/v1/me/profile", json={"qualification": "Clinical reviewer"})
    review = f"/api/v1/translation-reviews/{row['id']}"
    text = env.alice.get(review).json()["text"]
    env.alice.put(
        review + "/draft",
        json={
            "expected_revision": 0,
            "text": text,
            "form": {"decision": "accepted_unchanged", "clinical_change": False},
        },
    )
    submitted = env.alice.post(review + "/submit", json={"expected_revision": 1})
    assert submitted.status_code == 200, submitted.text
    record = submitted.json()

    listed = env.lead.get(URL)
    assert listed.status_code == 200, listed.text
    assert listed.json() == [record]
    assert [r["document_id"] for r in listed.json()] == [TARGET]
    # The reviewer sees their own review; someone else's only with the right
    # to see every text.
    assert [r["id"] for r in env.alice.get(URL).json()] == [record["id"]]
    review_task(env.db, "proj", TARGET, "reviewer")
    assert env.reviewer.get(URL).json() == []
    assert env.admin.get(URL).status_code == 200
    assert env.lead.get(f"{BASE}x/translation-reviews").status_code == 404
