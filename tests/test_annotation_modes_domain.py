"""The annotation mode of a text (spec 2026-10-23 §1 Q3, plan "Pure rule")."""

import pytest

from ontotator.domain.annotation_modes import TextMode, text_mode, workspace_mode


def mode(**kw):
    base = dict(
        project_mode="proposals", plan_override=None, proposal_count=17, work_modes=()
    )
    return text_mode(**(base | kw))


def test_project_setting_applies_to_texts_with_proposals():
    assert mode() == TextMode("proposals", "project", False)
    assert mode(project_mode="scratch") == TextMode("scratch", "project", False)


def test_texts_without_proposals_are_always_from_scratch():
    assert mode(proposal_count=0) == TextMode("scratch", "no_proposals", False)
    assert mode(proposal_count=0, plan_override="proposals") == TextMode(
        "scratch", "no_proposals", False
    )


def test_plan_override_wins_over_project_setting():
    assert mode(plan_override="scratch") == TextMode("scratch", "plan", False)
    assert mode(project_mode="scratch", plan_override="proposals") == TextMode(
        "proposals", "plan", False
    )


def test_oldest_work_locks_the_mode():
    locked = mode(
        project_mode="scratch",
        plan_override="scratch",
        work_modes=("proposals", "scratch"),
    )
    assert locked == TextMode("proposals", "locked", True)


def test_lock_holds_without_proposals():
    assert mode(proposal_count=0, work_modes=("proposals",)) == TextMode(
        "proposals", "locked", True
    )


@pytest.mark.parametrize(
    ("task", "annotation_mode", "expected"),
    [
        ("annotate", "proposals", "proposal_check"),
        ("annotate", "scratch", "independent"),
        ("review", None, "review"),
    ],
)
def test_workspace_mode_of_an_assignment(task, annotation_mode, expected):
    assert workspace_mode(task, annotation_mode) == expected


def test_annotate_without_a_mode_is_an_error():
    with pytest.raises(ValueError):
        workspace_mode("annotate", None)


def test_translation_review_has_no_workspace_mode():
    with pytest.raises(ValueError):
        workspace_mode("translation_review", None)
