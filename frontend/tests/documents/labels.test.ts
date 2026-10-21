// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decisionCategoryLabels, formatTime, issueAriaLabel, middleEllipsis, NOT_PLANNED, statusBadgeText, versionText, workText, type WorkItemLike } from "../../src/documents/labels";

describe("documents labels", () => {
  it("names rows outside the plan with one wording, Not planned", () => {
    expect(NOT_PLANNED).toBe("Not planned");
  });
  it("re_exports_shared_helpers", () => {
    expect(formatTime("2026-10-19T00:57:00", { now: new Date("2026-10-19T12:00:00") })).toBe("19 Oct, 00:57");
  });
  it("middle_ellipsis_keeps_both_ends", () => {
    expect(middleEllipsis("case-2026-10-19-0211", 12)).toBe("case-…-0211");
    expect(middleEllipsis("short", 12)).toBe("short");
  });
  it("version_text_for_single_chain_and_parallel_roots", () => {
    expect(versionText({ version: 3, origin: "correction", derivedVersion: 2, status: "ready_for_review", decision: null, chainName: "DeepL v3", parallel: false })).toBe("v3 · Correction of v2 · Ready for review");
    expect(versionText({ version: 1, origin: "machine_translation", derivedVersion: null, status: "reviewed", decision: "rejected", chainName: "DeepL v3", parallel: true })).toBe("DeepL v3 v1 · Machine translation · Rejected in review");
    expect(versionText({ version: 1, origin: "native", derivedVersion: null, status: null, decision: null, chainName: "Source", parallel: false })).toBe("v1 · Native");
  });
  it("status_badge_text", () => {
    expect(statusBadgeText("reviewed", "rejected", false)).toBe("Rejected in review");
    expect(statusBadgeText("reviewed", "query", false)).toBe("Queried");
    expect(statusBadgeText("reviewed", "accepted", false)).toBe("Reviewed");
    expect(statusBadgeText("translated", null, true)).toBe("Accepted without review");
    expect(statusBadgeText("automatic_check_failed", null, false)).toBe("Check failed");
    expect(statusBadgeText(null, null, false)).toBeNull();
  });
  it("issue_aria_label_groups_by_category", () => {
    expect(issueAriaLabel({ "report-or-pause": 1, "confirm-final": 1 }, { "Source text changed": 1 })).toBe("2 issues: problem report or paused task 1; final result to confirm 1. 1 note: source text changed");
    expect(issueAriaLabel({ "missing-final": 1 }, {})).toBe("1 issue: final result missing 1");
    expect(issueAriaLabel({}, { "Task paused": 2 })).toBe("2 notes: task paused 2");
    expect(issueAriaLabel({}, {})).toBe("No issues");
  });
  it("bar_categories_use_the_lead_workflow_copy", () => {
    expect(Object.values(decisionCategoryLabels)).toEqual(["Problem report or paused task", "Final result to confirm", "Translation rejected or queried", "Final result missing"]);
  });
  it("work_text_per_assignment_state", () => {
    const item = (over: Partial<WorkItemLike>): WorkItemLike => ({ author_label: "ann-0004", is_me: false, task: "annotate", status: "in_progress", held: false, round_ordinal: 3, version: 1, ...over });
    expect(workText([item({})])).toBe("ann-0004 annotating (Round 3)");
    expect(workText([item({ is_me: true, round_ordinal: null })])).toBe("ann-0004 (you) annotating");
    expect(workText([item({ task: "review", status: "open" })])).toBe("Annotation review open");
    expect(workText([item({ task: "translation_review", status: "open", version: 3 })])).toBe("Translation review open (v3)");
    expect(workText([item({ status: "reopened" })])).toBe("Reopened");
    expect(workText([item({ status: "submitted" }), item({ author_label: "ann-0005" })])).toBe("ann-0004 submitted; ann-0005 annotating (Round 3)");
    expect(workText([item({ status: "submitted" }), item({ status: "submitted" }), item({})])).toBe("2 of 3 submitted");
    expect(workText([])).toBe("Unassigned");
  });
});
