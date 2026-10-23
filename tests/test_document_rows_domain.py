"""Pure Documents row rules (no database)."""

from ontocurator.domain.document_rows import (
    AssignmentFact,
    Version,
    bar_categories,
    bar_counts,
    build_chains,
    bulk_target,
    missing_final_counts,
    open_target,
    prefix_matches,
    round_ordinals,
    submission_kind,
    translation_issue,
    version_label,
)


def v(
    doc,
    version=1,
    origin="machine_translation",
    derived=None,
    status="accepted",
    run=None,
    external="ext",
    position=1,
    decision=None,
):
    return Version(
        document_id=doc,
        case_id="c",
        language="de",
        external_id=external,
        version=version,
        origin=origin,
        derived_from=derived,
        translation=run,
        translation_status=status,
        position=position,
        latest_decision=decision,
    )


def test_chain_names_versions_and_duplicates():
    a = v("a", run={"provider": "DeepL", "model": "v3"}, external="x")
    b = v("b", run={"provider": "DeepL", "model": "v3"}, external="y", position=2)
    corr = v("a2", 2, "correction", "a", "ready_for_review", external="x")
    chains = build_chains([a, b, corr])
    assert [c.name for c in chains] == ["DeepL v3 · x", "DeepL v3 · y"]
    assert chains[0].newest.document_id == "a2"
    assert version_label(chains[0], corr, parallel=True) == "DeepL v3 · x v2"
    assert version_label(chains[0], corr, parallel=False) == "v2"
    native = build_chains([v("s", origin="native", status=None)])
    assert native[0].name == "Source"
    human = build_chains([v("h", origin="human_translation")])
    assert human[0].name == "Human translation"
    provider_only = build_chains([v("p", run={"provider": "Google"})])
    assert provider_only[0].name == "Google"


def a(status="submitted", held=False, revoked=False, task="annotate", doc="a"):
    return AssignmentFact(
        assignment_id=1,
        document_id=doc,
        task=task,
        status=status,
        held=held,
        revoked=revoked,
        pseudonym="ann-1",
        user_id=1,
        active_round_id=None,
    )


def test_missing_final_rule():
    assert not missing_final_counts(
        has_selection=True, submission_count=1, assignments=[a()]
    )
    assert not missing_final_counts(
        has_selection=False, submission_count=0, assignments=[a()]
    )
    assert missing_final_counts(has_selection=False, submission_count=1, assignments=[])
    assert missing_final_counts(
        has_selection=False,
        submission_count=1,
        assignments=[a(), a(status="open", revoked=True)],
    )
    assert not missing_final_counts(
        has_selection=False, submission_count=1, assignments=[a(held=True)]
    )
    assert not missing_final_counts(
        has_selection=False,
        submission_count=1,
        assignments=[a(), a(status="open", task="translation_review", doc="b")],
    )


def test_translation_issue_and_bulk_target():
    root = v("r", status="accepted")
    rejected = v("r2", 2, "correction", "r", "reviewed", decision="rejected")
    chain = build_chains([root, rejected])
    assert translation_issue(chain[0]) == "rejected"
    assert bulk_target(chain) == ("r", "checkbox")
    review = build_chains([root, v("r2", 2, "correction", "r", "ready_for_review")])
    assert bulk_target(review) == (None, "choose_in_versions")
    failed = build_chains([v("f", status="automatic_check_failed")])
    assert translation_issue(failed[0]) == "automatic_check_failed"
    parallel = build_chains([v("p1"), v("p2", external="z", position=2)])
    assert bulk_target(parallel) == (None, "choose_in_versions")


def test_open_target():
    chains = build_chains(
        [
            v("p1", position=1),
            v("p2", external="z", position=5),
            v("p2b", 2, "correction", "p2", "accepted", external="z", position=6),
        ]
    )
    assert open_target(chains, final_document_id=None) == ("p2b", "most_recent_root")
    assert open_target(chains, final_document_id="p1") == ("p1", "final")
    single = build_chains([v("s1"), v("s2", 2, "correction", "s1", "accepted")])
    assert open_target(single, final_document_id=None) == ("s2", "newest")


def test_round_ordinals_and_kinds():
    rounds = [("r3", "r2"), ("r1", None), ("r2", "r1"), ("x1", None)]
    assert round_ordinals(rounds) == {"r1": 1, "r2": 2, "r3": 3, "x1": 1}
    assert submission_kind("consolidation", "review") == "consolidation"
    assert submission_kind("carry_forward", "independent") == "carry_forward"
    assert submission_kind("ordinary", "independent") == "annotation"
    assert submission_kind(None, "review") == "consolidation"  # D1


def test_bar_categories_counts_and_prefix():
    one = bar_categories(
        {"OPEN_PROBLEM_REPORT", "SELECTED_NEWER_RESULT"},
        translation_failed=False,
        missing_final=False,
    )
    two = bar_categories(
        {"TASK_PAUSED_WITHOUT_REPORT"}, translation_failed=True, missing_final=True
    )
    notes = bar_categories(
        {"ROUND_REVIEW_PENDING", "SOURCE_UPDATE_UNREVIEWED", "TASK_ON_HOLD"},
        translation_failed=False,
        missing_final=False,
    )
    assert one == {"report-or-pause", "confirm-final"}
    assert notes == set()
    assert bar_counts([one, two, notes]) == {
        "total": 2,
        "report-or-pause": 2,
        "confirm-final": 1,
        "translation": 1,
        "missing-final": 1,
    }
    # Fullwidth "case-0" normalises (NFKC) to ASCII before prefix matching.
    assert prefix_matches(
        "\N{FULLWIDTH LATIN SMALL LETTER C}\N{FULLWIDTH LATIN SMALL LETTER A}se-0",
        ["case-0042"],
    )
    assert not prefix_matches("0042", ["case-0042"])
