"""Pure work-plan rules (spec "Work plan"); no database."""

from ontocurator.domain.work_plans import (
    LanguageChange,
    LanguageVersion,
    OpenReport,
    OpenTask,
    PlanFlags,
    RowKey,
    consequences,
    import_defaults,
    merge,
    mixed_counts,
    preset_changes,
    validate,
)

ON_ON, OFF_ON = PlanFlags(True, True), PlanFlags(False, True)
ON_OFF, OFF_OFF = PlanFlags(True, False), PlanFlags(False, False)


def lv(case, lang, *, source=False, accepted=False, marked=False, blocked=False):
    return LanguageVersion(case, lang, source, accepted, marked, review_blocked=blocked)


def test_nothing_planned_puts_every_row_out_of_plan():
    rows = [lv("c1", "en", source=True), lv("c1", "de")]
    assert set(import_defaults("nothing", rows).values()) == {OFF_OFF}


def test_review_and_annotate_all_translations_default():
    rows = [
        lv("c1", "en", source=True),
        lv("c1", "de"),
        lv("c1", "fr", accepted=True, marked=True),
        lv("c2", "en", source=True),
    ]
    got = import_defaults("review_and_annotate_translations", rows)
    assert got[RowKey("c1", "en")] == OFF_OFF  # source with translations
    assert got[RowKey("c1", "de")] == ON_ON
    assert got[RowKey("c1", "fr")] == OFF_ON  # marked as reviewed in the package
    assert got[RowKey("c2", "en")] == OFF_ON  # source without translation


def test_validate_refuses_source_review_and_unaccepted_annotation_with_rule_on():
    en, de = RowKey("c1", "en"), RowKey("c1", "de")
    rows = {en: lv("c1", "en", source=True), de: lv("c1", "de")}
    bad = validate({en: ON_ON, de: OFF_ON}, rows, rule_on=True)
    assert [(i.key.language, i.reason) for i in bad] == [
        ("en", "source_review"),
        ("de", "annotate_not_accepted"),
    ]
    assert validate({de: OFF_ON}, rows, rule_on=False) == []
    assert validate({de: ON_ON}, rows, rule_on=True) == []
    assert validate({de: OFF_ON}, rows, rule_on=True, accepting=frozenset({de})) == []


def test_validate_refuses_external_acceptance_of_rejected_queried_or_in_review():
    de = RowKey("c1", "de")
    rows = {de: lv("c1", "de", blocked=True)}
    bad = validate({de: OFF_ON}, rows, rule_on=True, accepting=frozenset({de}))
    assert [i.reason for i in bad] == ["not_acceptable"]


def test_merge_is_tri_state_and_source_key_targets_each_case_source():
    keys = [("c1", "en"), ("c1", "de"), ("c2", "en"), ("c2", "fr")]
    rows = {RowKey(c, lang): lv(c, lang, source=(lang == "en")) for c, lang in keys}
    current = {RowKey("c1", "de"): ON_OFF, RowKey("c2", "fr"): OFF_OFF}
    got = merge(
        current,
        rows,
        ["c1", "c2"],
        {"de": LanguageChange(annotate="on"), "source": LanguageChange(annotate="off")},
    )
    assert got[RowKey("c1", "de")] == ON_ON  # review kept, annotate set
    assert RowKey("c2", "de") not in got  # no de row in c2: never created
    assert got[RowKey("c1", "en")] == OFF_OFF
    assert got[RowKey("c2", "en")] == OFF_OFF
    assert RowKey("c2", "fr") not in got  # language not in the change set


def test_presets_expand_over_translation_rows():
    rows = [lv("c1", "en", source=True), lv("c1", "de"), lv("c1", "fr")]
    assert preset_changes("review_and_annotate_translations", rows) == {
        "de": LanguageChange("on", "on"),
        "fr": LanguageChange("on", "on"),
    }
    assert preset_changes("annotate_only", rows) == {
        "de": LanguageChange("keep", "on"),
        "fr": LanguageChange("keep", "on"),
    }


def test_consequences_cover_the_editing_table():
    key = RowKey("c1", "fr")
    tasks = [
        OpenTask(1, "c1", "fr", "translation_review", 7),
        OpenTask(2, "c1", "fr", "annotate", 8),
        OpenTask(3, "c1", "fr", "review", 9),
    ]
    review_off = consequences({key: ON_ON}, {key: OFF_ON}, tasks, frozenset())
    assert [t.assignment_id for t in review_off.withdrawn] == [1]
    annotate_off = consequences({key: ON_ON}, {key: ON_OFF}, tasks, frozenset({key}))
    assert [t.assignment_id for t in annotate_off.withdrawn] == [2, 3]
    assert annotate_off.finals_leaving == (key,)
    restored = consequences({key: ON_OFF}, {key: ON_ON}, [], frozenset({key}))
    assert restored.restored == (key,) and restored.any
    assert not consequences({key: OFF_OFF}, {key: ON_ON}, [], frozenset()).any


def test_consequences_list_open_reports_of_rows_turned_off():
    key = RowKey("c1", "fr")
    report = OpenReport("r1", "c1", "fr", 2, True)
    got = consequences({key: ON_ON}, {key: ON_OFF}, [], frozenset(), [report])
    assert got.open_reports == (report,) and got.any
    assert (
        consequences(
            {key: OFF_ON}, {key: ON_ON}, [], frozenset(), [report]
        ).open_reports
        == ()
    )


def test_mixed_counts():
    cur = {RowKey("a", "de"): ON_ON, RowKey("b", "de"): OFF_OFF}
    assert mixed_counts(cur, cur.keys()) == {
        "review_on": 1,
        "review_off": 1,
        "annotate_on": 1,
        "annotate_off": 1,
    }
