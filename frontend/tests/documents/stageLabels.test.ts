// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DocumentRowView, StageCellView } from "../../src/api/client";
import { narrowStageState, STAGE_TITLES, stageText, submittedOf, versionMarkerText, waitingOnText, type StageName } from "../../src/documents/stageLabels";
import { notInPlanRow, row, stepOf } from "./fixtures";
import { ana, cell, luc, tom } from "./tableFixtures";

const de = row({ case_id: "case-104", language: "de" });
/** "symbol word" and the detail line of a cell. */
function text(stage: StageName, value: StageCellView, target: DocumentRowView = de, sourceLanguage?: string): [string, string] {
  const result = stageText(stage, value, target, { sourceLanguage });
  return [[result.symbol, result.word].filter(Boolean).join(" "), result.detail];
}
const at = (hours: number, minutes: number) => { const date = new Date(); date.setHours(hours, minutes, 0, 0); return date.toISOString(); };

describe("Review cell", () => {
  it("source", () => expect(text("review", cell("source", "none"))).toEqual(["— source", ""]));
  it("not_planned", () => expect(text("review", cell("not_planned", "none"))).toEqual(["— not planned", ""]));
  it("undecided", () => expect(text("review", cell("undecided", "undecided"))).toEqual(["? not decided", ""]));
  it("unassigned", () => {
    expect(text("review", cell("unassigned", "todo", { version: 1, note: "machine_translation" }))).toEqual(["○ Unassigned", "v1 machine translation"]);
    expect(text("review", cell("unassigned", "todo", { version: 2 }))).toEqual(["○ Unassigned", "v2"]);
  });
  it("check_failed", () => expect(text("review", cell("check_failed", "decision", { version: 1 }))).toEqual(["⚠ Check failed", "unassigned"]));
  it("in_progress", () => {
    expect(text("review", cell("in_progress", "running", { people: [ana] }))).toEqual(["◐ In progress", "Ana Weber"]);
    // Parallel roots: versions in review of the roots.
    expect(text("review", cell("in_progress", "running", { people: [ana], assigned: 1, total: 2 }))).toEqual(["◐ 1 of 2 versions in review", "Ana Weber"]);
  });
  it("in_progress before the first save reads not started (issue 258)", () => {
    expect(text("review", cell("in_progress", "running", { people: [ana], started: 0, open_tasks: 1 }))).toEqual(["○ Assigned, not started", "Ana Weber"]);
    expect(text("review", cell("in_progress", "running", { people: [ana], started: 1, open_tasks: 1 }))).toEqual(["◐ In progress", "Ana Weber"]);
    expect(text("review", cell("in_progress", "running", { people: [ana, tom], started: 1, open_tasks: 2 }))).toEqual(["◐ 1 of 2 started", "Ana Weber, Tom Reis"]);
    expect(text("review", cell("in_progress", "running", { people: [ana, tom], assigned: 2, total: 2, started: 1, open_tasks: 2 })))
      .toEqual(["◐ 2 of 2 versions in review", "Ana Weber, Tom Reis, 1 of 2 started"]);
    expect(text("review", cell("re_review", "running", { people: [ana], note: "correction", started: 0, open_tasks: 1 })))
      .toEqual(["○ Re-review assigned, not started", "Ana Weber, correction"]);
  });
  it("re_review", () => {
    expect(text("review", cell("re_review", "running", { people: [ana], note: "new_review", reason: "Dosis prüfen" }))).toEqual(["◐ Re-review in progress", "Ana Weber, reason: “Dosis prüfen”"]);
    expect(text("review", cell("re_review", "running", { people: [ana], note: "source_changed" }))).toEqual(["◐ Re-review in progress", "Ana Weber, source changed"]);
  });
  it("paused", () => expect(text("review", cell("paused", "decision", { people: [tom], excerpt: "Satz 3 unvollständig…" }))).toEqual(["⏸ Paused", "Tom Reis: “Satz 3 unvollständig…”"]));
  it("rejected", () => expect(text("review", cell("rejected", "rejected", { people: [ana], at: at(10, 40) }))).toEqual(["✕ Rejected", "Ana Weber, 10:40"]));
  it("query", () => expect(text("review", cell("query", "decision", { people: [luc], at: at(10, 51) }))).toEqual(["? Query", "Luc Martin, 10:51"]));
  it("not_accepted", () => expect(text("review", cell("not_accepted", "decision", { note: "review_off" }))).toEqual(["⚠ Not accepted", "Review off"]));
  it("source_changed", () => expect(text("review", cell("source_changed", "decision", { from_version: 1 }), de, "en")).toEqual(["⚠ Source changed", "translation from en v1"]));
  it("accepted", () => {
    expect(text("review", cell("accepted", "done", { note: "unchanged" }))).toEqual(["✓ Accepted", "unchanged"]);
    expect(text("review", cell("accepted", "done", { note: "with_corrections", people: [ana], from_version: 1, version: 2 }))).toEqual(["✓ Accepted", "with corrections, v1 → v2, Ana Weber"]);
    expect(text("review", cell("accepted", "done", { note: "in_package" }))).toEqual(["✓ Accepted", "in package"]);
    expect(text("review", cell("accepted", "done", { note: "outside" }))).toEqual(["✓ Accepted", "outside Ontotator"]);
  });
});

describe("Annotation cell", () => {
  it("not_planned", () => {
    expect(text("annotation", cell("not_planned", "none"))).toEqual(["— not planned", ""]);
    expect(text("annotation", cell("not_planned", "none", { note: "review_only" }))).toEqual(["— not planned", "Review only"]);
  });
  it("undecided", () => expect(text("annotation", cell("undecided", "undecided"))).toEqual(["? not decided", ""]));
  it("after_review", () => {
    expect(text("annotation", cell("after_review", "waiting"))).toEqual(["○ after review", ""]);
    // A waiting task names its person (issue 213).
    expect(text("annotation", cell("after_review", "waiting", { people: [{ pseudonym: "ann-1", display_name: "Ana", is_me: false }] }))).toEqual(["○ Waiting for review", "Ana"]);
    expect(text("annotation", cell("after_review", "waiting", { note: "text_change_waiting" }))).toEqual(["○ after review", "text change waiting for review"]);
  });
  it("blocked", () => {
    expect(text("annotation", cell("blocked", "waiting", { note: "translation_rejected" }))).toEqual(["○ blocked", "translation rejected"]);
    expect(text("annotation", cell("blocked", "waiting", { note: "translation_queried" }))).toEqual(["○ blocked", "queried"]);
    expect(text("annotation", cell("blocked", "waiting", { note: "translation_not_accepted" }))).toEqual(["○ blocked", "not accepted"]);
  });
  it("unassigned", () => {
    expect(text("annotation", cell("unassigned", "todo"))).toEqual(["○ Unassigned", ""]);
    expect(text("annotation", cell("unassigned", "todo", { assigned: 0, target: 2 }))).toEqual(["○ Unassigned", ""]);
  });
  it("partly_assigned", () => expect(text("annotation", cell("partly_assigned", "todo", { people: [tom], assigned: 1, target: 2 }))).toEqual(["○ 1 annotator · max 2", "Tom Reis working"]));
  it("in_progress", () => {
    expect(text("annotation", cell("in_progress", "running", { people: [tom], submitted: 1, total: 2 }))).toEqual(["◐ 1 of 2 submitted", "waiting: Tom Reis"]);
    expect(text("annotation", cell("in_progress", "running", { people: [ana], round_ordinal: 2 }))).toEqual(["◐ In progress", "Ana Weber, Round 2"]);
    expect(text("annotation", cell("in_progress", "running", { people: [tom], note: "may_change", version: 1 }))).toEqual(["◐ In progress", "Tom Reis, v1, may change"]);
  });
  it("in_progress before the first save reads not started (issue 258)", () => {
    expect(text("annotation", cell("in_progress", "running", { people: [ana], started: 0, open_tasks: 1 }))).toEqual(["○ Assigned, not started", "Ana Weber"]);
    expect(text("annotation", cell("in_progress", "running", { people: [ana], started: 1, open_tasks: 1 }))).toEqual(["◐ In progress", "Ana Weber"]);
    expect(text("annotation", cell("in_progress", "running", { people: [ana, tom], started: 1, open_tasks: 2 }))).toEqual(["◐ 1 of 2 started", "Ana Weber, Tom Reis"]);
    expect(text("annotation", cell("in_progress", "running", { people: [tom], submitted: 1, total: 2, started: 0, open_tasks: 1 })))
      .toEqual(["◐ 1 of 2 submitted", "waiting: Tom Reis, not started"]);
    expect(text("annotation", cell("partly_assigned", "todo", { people: [tom], assigned: 1, target: 2, started: 0, open_tasks: 1 })))
      .toEqual(["○ 1 annotator · max 2", "Tom Reis assigned, not started"]);
  });
  it("paused", () => expect(text("annotation", cell("paused", "decision", { people: [tom], excerpt: "Satz 3 unvollständig…" }))).toEqual(["⏸ Paused", "Tom Reis: “Satz 3 unvollständig…”"]));
  it("consolidating", () => expect(text("annotation", cell("consolidating", "running", { people: [luc] }))).toEqual(["◐ Consolidating", "Luc Martin"]));
  it("old_text_open", () => expect(text("annotation", cell("old_text_open", "decision", { people: [tom], from_version: 1, version: 2 }))).toEqual(["⚠ In progress on old text", "Tom Reis works on v1"]));
  it("old_text_submitted", () => expect(text("annotation", cell("old_text_submitted", "decision", { people: [ana], from_version: 1, version: 2, note: "v2_not_annotated" })))
    .toEqual(["⚠ Submitted on v1", "Ana Weber, v2 not annotated"]));
  it("finishing_on_old", () => expect(text("annotation", cell("finishing_on_old", "running", { people: [tom], from_version: 1, version: 2, note: "carried_on_submit" })))
    .toEqual(["◐ Finishing on v1", "Tom Reis, carried to v2 on submit"]));
  it("submitted", () => {
    expect(text("annotation", cell("submitted", "done", { people: [ana, tom], submitted: 2, total: 2 }))).toEqual(["✓ 2 of 2 submitted", "Ana Weber, Tom Reis"]);
    expect(text("annotation", cell("submitted", "done", { people: [ana], findings: 3, version: 1 }))).toEqual(["✓ submitted", "Ana Weber, 3 findings"]);
  });
  it("never reads 2 of 1 when the limit was lowered later (issue 248); the server counts the holders (issue 283)", () => {
    expect(text("annotation", cell("in_progress", "running", { people: [tom], submitted: 2, total: 3, started: 0, open_tasks: 1 }))[0]).toBe("◐ 2 of 3 submitted");
    expect(text("annotation", cell("submitted", "done", { submitted: 2, total: 1 }))[0]).toBe("✓ 2 of 2 submitted");
    expect(submittedOf(2, 1)).toBe("2 of 2 submitted");
  });
  it("parallel versions: open tasks summed over the versions do not raise the total (issue 283)", () => {
    // Limit 2, two versions with 1 submitted and 1 open each: the server sends the total of one version.
    expect(text("annotation", cell("in_progress", "running", { people: [ana, tom], submitted: 1, total: 2, started: 0, open_tasks: 2 }))[0]).toBe("◐ 1 of 2 submitted");
  });
});

describe("narrow table states (issue 248)", () => {
  // Every state a stage cell of the table can show (cardModel's states and the stage cell labels it falls back to).
  const states: Record<string, string | null> = {
    "assigned, not started": "not started",
    "after translation review": "after review",
    "waiting for review (Ana Weber, Tom Reis)": "after review",
    "in review": null,
    "in review, 1 of 2 started": "in review",
    "1 of 2 submitted": "1/2 submitted",
    "1 of 1 submitted, not started": "1/1 submitted",
    "0 of 2 submitted, 1 of 2 started": "0/2 submitted",
    "1 annotator · max 2": "1 · max 2",
    "2 annotators · max 5": "2 · max 5",
    "2 · full": null,
    "not reviewed, optional": "not reviewed",
    "Final is on old text": "on old text",
    "In progress on old text": "on old text",
    "Submitted on v1": "v1 submitted",
    "Submitted on old text": "on old text",
    "Finishing on v2": "finishing v2",
    "ready to compare": "to compare",
    "ready to accept": null,
    "consolidating (3 of 5 groups open)": "consolidating",
    "consolidating": null,
    "can be accepted": null,
    "accepted 18 Oct": null,
    "may be outdated": null,
    "source text": null,
    "Unassigned": null,
    "not in plan": null,
    "Check failed": null,
    "Source changed": null,
    "Your choice": null,
    "waiting": null,
  };
  it.each(Object.entries(states))("%s", (state, short) => expect(narrowStageState(state)).toBe(short));
  it("a state stays only when it fits the narrow cell (15 characters); short forms have at most 13", () => {
    for (const state of Object.keys(states)) {
      const shown = narrowStageState(state) ?? state;
      expect(shown.length, state).toBeLessThanOrEqual(15);
      if (narrowStageState(state)) expect(shown.length, state).toBeLessThanOrEqual(13);
    }
  });
});

describe("Final cell", () => {
  it("none", () => expect(text("final", cell("none", "none"))).toEqual(["—", ""]));
  it("after_annotation", () => expect(text("final", cell("after_annotation", "waiting"))).toEqual(["○ after annotation", ""]));
  it("after_review", () => expect(text("final", cell("after_review", "waiting"))).toEqual(["○ after review", ""]));
  it("choose", () => {
    expect(text("final", cell("choose", "decision", { submitted: 1 }))).toEqual(["● Your choice", "1 submission"]);
  });
  it("Final choose with matching shows '2 submissions, 4 of 6 match'", () => {
    expect(text("final", cell("choose", "decision", { submitted: 2, matching: 4, compared: 6 }))).toEqual(["● Your choice", "2 submissions, 4 of 6 match"]);
  });
  it("confirm", () => expect(text("final", cell("confirm", "decision", { causes: ["SELECTED_NEWER_RESULT", "PLAN_RESTORED"] }))).toEqual(["⚠ Check changes", "newer result, returned to plan"]));
  it("old_text", () => expect(text("final", cell("old_text", "decision", { people: [ana], round_ordinal: 1, note: "round", version: 1 }))).toEqual(["⚠ Final is on old text", "Round 1, Ana Weber, v1"]));
  it("may_be_outdated", () => expect(text("final", cell("may_be_outdated", "waiting", { note: "source_changed", from_version: 1 }))).toEqual(["⚠ may be outdated", "source changed"]));
  it("final", () => {
    expect(text("final", cell("final", "done", { people: [ana], round_ordinal: 1, note: "round" }))).toEqual(["✓ Final", "Round 1, Ana Weber"]);
    expect(text("final", cell("final", "done", { people: [luc], note: "consolidation" }))).toEqual(["✓ Final", "Consolidation, Luc Martin"]);
    expect(text("final", cell("final", "done", { people: [ana], round_ordinal: 1, note: "round", version: 1 }))).toEqual(["✓ Final", "Round 1, Ana Weber, v1"]);
    expect(text("final", cell("final", "done", { people: [ana], round_ordinal: 1, note: "not_exported" }))).toEqual(["✓ Final", "not exported"]);
  });
});

describe("Waiting on", () => {
  it("You, one person by short name (identity format as title), or —", () => {
    expect(waitingOnText(row({ case_id: "c", language: "de", next_step: stepOf("assign_annotation") })).text).toBe("You");
    const one = row({ case_id: "c", language: "de", next_step: stepOf("annotation_in_progress", { owner: { kind: "person", person: ana, count: 1, people: [ana] } }) });
    expect(waitingOnText(one)).toEqual({ text: "Ana Weber", title: "Ana Weber (ann-0003)", you: false });
    expect(waitingOnText(row({ case_id: "c", language: "de", next_step: stepOf("done") })).text).toBe("—");
    expect(waitingOnText(notInPlanRow("c", "de")).text).toBe("—");
    const undecided = notInPlanRow("c", "de", { next_step: stepOf("decide_plan"), plan_row: { review: false, annotate: false, review_applicable: true, discarded: false, decided: false } });
    expect(waitingOnText(undecided).text).toBe("You");
  });
  it("Waiting on lists two names then +n and full list in title", () => {
    const people = row({ case_id: "c", language: "de", next_step: stepOf("annotation_in_progress", { owner: { kind: "people", person: null, count: 3, people: [ana, tom, luc] } }) });
    expect(waitingOnText(people)).toEqual({
      text: "Ana Weber, Tom Reis +1",
      title: "Ana Weber (ann-0003), Tom Reis (ann-0004), Luc Martin (ann-0005)",
      you: false,
      narrow: "Ana Weber +2",
    });
    const two = row({ case_id: "c", language: "de", next_step: stepOf("annotation_in_progress", { owner: { kind: "people", person: null, count: 2, people: [ana, tom] } }) });
    expect(waitingOnText(two).text).toBe("Ana Weber, Tom Reis");
    // Issue 248: below 1600 px the cell shows one name and "+n".
    expect(waitingOnText(two).narrow).toBe("Ana Weber +1");
  });
});

describe("version marker", () => {
  it("version marker v2 corrected / v2 / 2 translations", () => {
    expect(versionMarkerText(row({ case_id: "c", language: "de", version_marker: { kind: "corrected", version: 2 } }))).toBe("v2 corrected");
    expect(versionMarkerText(row({ case_id: "c", language: "de", version_marker: { kind: "version", version: 2 } }))).toBe("v2");
    expect(versionMarkerText(row({ case_id: "c", language: "de", version_marker: { kind: "parallel", version: 2 } }))).toBe("2 translations");
    expect(versionMarkerText(row({ case_id: "c", language: "de" }))).toBeNull();
  });
});

describe("unknown states (a newer server)", () => {
  it("show the tone glyph and a dash, never the state code", () => {
    const unknown = cell("brand_new_state" as StageCellView["state"], "running");
    for (const stage of ["review", "annotation", "final"] as const) expect(text(stage, unknown)).toEqual(["◐ —", ""]);
  });
});

describe("stage titles", () => {
  it("are the path names of the text card", () => {
    expect(STAGE_TITLES).toEqual({ review: "Translation", annotation: "Annotation", final: "Finalization" });
  });
});
