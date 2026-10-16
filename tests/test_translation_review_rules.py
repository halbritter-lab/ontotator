"""Pure review-policy checks and shared vectors for later client parity."""

import json
from copy import deepcopy
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError

from ontocurator.domain.translation_review import (
    REVIEW_POLICY,
    ClinicalCategory,
    ReviewDecisionCode,
    ReviewForm,
    check_review,
    next_status,
)

CASES = json.loads(
    (
        Path(__file__).parents[1] / "contracts" / "translation-review-cases.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_cases(case):
    before = deepcopy(case)
    form = ReviewForm.model_validate(case["form"])
    saved_form = form.model_dump()
    assert (
        check_review(
            form,
            machine_text=case["machine_text"],
            proposed_text=case["proposed_text"],
        )
        == case["issues"]
    )
    assert form.model_dump() == saved_form
    assert case == before


def test_shared_vectors_cover_every_decision_and_issue():
    assert len(CASES) >= 16
    assert len({case["name"] for case in CASES}) == len(CASES)
    assert {case["form"]["decision"] for case in CASES if not case["issues"]} == {
        "accepted_unchanged",
        "accepted_corrected",
        "query",
        "rejected",
    }
    assert {issue for case in CASES for issue in case["issues"]} == {
        "TEXT_EMPTY",
        "TEXT_CHANGED",
        "CLINICAL_CHANGE_NOT_ALLOWED",
        "TEXT_UNCHANGED",
        "CLINICAL_CHANGE_REQUIRED",
        "CATEGORY_REQUIRED",
        "RATIONALE_REQUIRED",
        "CATEGORIES_WITHOUT_CHANGE",
    }


def test_texts_are_compared_canonically():
    machine = "R\u00e9sum\u00e9\nA"
    proposed = "\ufeff\ufeffRe\u0301sume\u0301\r\nA"
    assert not check_review(
        ReviewForm(decision="accepted_unchanged", clinical_change=False),
        machine_text=machine,
        proposed_text=proposed,
    )
    assert check_review(
        ReviewForm(decision="accepted_corrected", clinical_change=False),
        machine_text=machine,
        proposed_text=proposed,
    ) == ["TEXT_UNCHANGED"]


@pytest.mark.parametrize(
    ("decision", "expected"),
    [
        ("accepted_unchanged", ("accepted", None)),
        ("accepted_corrected", ("reviewed", "accepted")),
        ("query", ("reviewed", None)),
        ("rejected", ("reviewed", None)),
    ],
)
def test_next_status_follows_the_table(decision, expected):
    assert next_status(decision) == expected


def test_policy_and_choices_are_the_agreed_english_contract():
    assert REVIEW_POLICY == "ontocurator-translation-review/v1"
    assert get_args(ReviewDecisionCode) == (
        "accepted_unchanged",
        "accepted_corrected",
        "query",
        "rejected",
    )
    assert get_args(ClinicalCategory) == (
        "omission",
        "addition",
        "assertion",
        "value",
        "anatomy",
        "terminology",
        "source",
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"decision": "accept"},
        {"decision": None},
        {"categories": ["unknown"]},
        {"categories": "value"},
        {"unexpected": True},
    ],
)
def test_invalid_choices_and_extra_fields_are_model_errors(patch):
    with pytest.raises(ValidationError):
        ReviewForm.model_validate(
            {"decision": "accepted_unchanged", "clinical_change": False, **patch}
        )


def test_default_categories_are_independent_and_checking_does_not_normalize_forms():
    first = ReviewForm(decision="accepted_unchanged", clinical_change=False)
    second = ReviewForm(decision="accepted_unchanged", clinical_change=False)
    first.categories.append("value")
    assert second.categories == []
    supplied = ["value", "anatomy", "value"]
    form = ReviewForm(
        decision="accepted_corrected",
        clinical_change=True,
        categories=supplied,
        rationale="  Explained.  ",
    )
    before = form.model_dump()
    for _ in range(2):
        assert check_review(form, machine_text="A", proposed_text="B") == []
    assert form.model_dump() == before
    assert supplied == ["value", "anatomy", "value"]
