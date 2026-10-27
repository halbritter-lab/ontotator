// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FinalSelectionSummary } from "../../src/api/client";
import { finalResultLabel } from "../../src/problems/LeadStatePanel";
import { conflictReasonText, historyItems, intentState, leadOutcome, leadSummary, reportStateBadge, reportStateFact, reportTitle, taskLabel, taskRef, toolbarEntry, yourTaskFact } from "../../src/problems/labels";
import { event, hold, report } from "./fixtures";

const T = "2026-10-18T10:05:00Z";

describe("problem report labels", () => {
  it("title_is_first_line_cut_at_a_word_boundary", () => {
    expect(reportTitle("Short\nsecond")).toBe("Short");
    expect(reportTitle("word ".repeat(30).trim())).toBe(`${"word ".repeat(16).trim()}…`);
    expect(reportTitle("a".repeat(100))).toBe(`${"a".repeat(80)}…`); // no boundary: hard cut
  });
  it("state_vocabulary", () => {
    expect(reportStateBadge(report()).text).toBe("Open");
    expect(reportStateBadge(report({ state: "resolved" }))).toEqual({ text: "Closed", tone: "success" });
    expect(reportStateBadge(report({ state: "withdrawn" }))).toEqual({ text: "Withdrawn", tone: "neutral" });
  });
  it("state_fact_names_actor_and_time", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(reportStateFact(report(), now)).toBe("Open");
    const closed = reportStateFact(report({ state: "resolved", state_changed_by_label: "ann-0002", state_changed_at: "2026-10-19T01:31:00Z" }), now);
    expect(closed).toMatch(/^Closed by ann-0002, 19 Oct, \d\d:31$/);
    expect(reportStateFact(report({ state: "withdrawn", state_changed_by_label: "ann-0004", state_changed_at: "2026-10-19T01:31:00Z" }), now)).toMatch(/^Withdrawn by you, /);
    expect(reportStateFact(report({ state: "resolved", viewer_is_lead: true, viewer_label: "lead-0002", state_changed_by_label: "lead-0002", state_changed_at: null }), now)).toBe("Closed by lead-0002 (you)");
  });
  it("task_label", () => {
    expect(taskLabel(hold())).toBe("Task 4, ann-0004, accepted-translation de");
    expect(taskRef(hold())).toBe("Task 4 (ann-0004)");
  });
  it("your_task_fact_for_each_release_path", () => {
    expect(yourTaskFact(report()).text).toBe("Paused since");
    expect(yourTaskFact(report({ holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004", released_at: "2026-10-19T01:13:00Z" })] })).text).toBe("Resumed by you");
    expect(yourTaskFact(report({ holds: [hold({ active: false, release_action: "resume", released_by_label: "lead-0002", released_at: "2026-10-19T01:13:00Z" })] })).text).toBe("Resumed by lead-0002");
    expect(yourTaskFact(report({ events: [event({ event_id: "e9", action: "restart", round_ordinal: 3 })], holds: [hold({ active: false, release_action: "restart", release_event_id: "e9", released_by_label: "lead-0002", released_at: "2026-10-19T02:00:00Z" })] })).text).toBe("Restarted with an empty Round 3");
    expect(yourTaskFact(report({ holds: [hold({ active: false }), hold({ hold_id: "h2", created_by_label: "lead-0002", created_at: "2026-10-19T03:00:00Z" })] })).text).toBe("Paused again by lead-0002");
    expect(yourTaskFact(report({ holds: [hold({ active: false })] })).text).toBe("Released (no record of who released it)");
    expect(yourTaskFact(report({ holds: [hold({ active: false, release_action: "withdraw", released_at: "2026-10-19T01:20:00Z" })] }))).toEqual({ kind: "withdrawn", text: "Resumed when you withdrew the report", at: "2026-10-19T01:20:00Z" });
    expect(yourTaskFact(report()).at).toBe("2026-10-19T01:12:00Z");
  });
  it("history_creation_first_and_view_dependent_sentences", () => {
    const lead = report({ viewer_is_lead: true, viewer_label: "lead-0002", events: [event(), event({ event_id: "e2", action: "extend_hold", actor_label: "lead-0002", own_task: false, reason: "Wait", affected: [{ assignment_id: 7, owner_label: "ann-0005", case_id: "c", language: "de", task: "annotate" }] })] });
    expect(historyItems(lead).map(i => i.sentence)).toEqual([
      "ann-0004 reported the problem. Task 4 paused.",
      "ann-0004 resumed Task 4 (ann-0004).",
      "lead-0002 (you) paused Task 7 (ann-0005). Reason shown to their owners:",
    ]);
    const mine = report({ events: [event(), event({ event_id: "e3", action: "resolve", actor_label: "lead-0002", own_task: false, reason: "Fixed" })] });
    const items = historyItems(mine);
    expect(items.map(i => i.sentence)).toEqual(["You reported the problem. Your task paused.", "You resumed your task.", "lead-0002 closed the report."]);
    expect(items[2]).toMatchObject({ quoteLabel: "Outcome", quote: "Fixed" });
    expect(historyItems(report({ events: [event({ action: "withdraw" })] })).at(-1)?.sentence).toBe("You withdrew the report. Your task resumed.");
    expect(historyItems(report({ events: [event({ action: "mystery", actor_label: "lead-0002" })] })).at(-1)?.sentence).toBe('lead-0002 recorded "mystery".');
    const restarted = report({ round_ordinal: 1, current_round_ordinal: 3, events: [event({ action: "restart", actor_label: "lead-0002", own_task: true, round_ordinal: 3, abandoned_round_ordinal: 2 })] });
    expect(historyItems(restarted).at(-1)?.sentence).toBe("lead-0002 restarted your task with an empty Round 3. Round 2 is kept. Report closed.");
  });
  it("history_lead_sentences_for_release_restart_withdraw_and_reopen", () => {
    const other = { assignment_id: 7, owner_label: "ann-0005", case_id: "c", language: "de", task: "annotate" as const };
    const lead = (events: Parameters<typeof event>[0][]) => historyItems(report({ viewer_is_lead: true, viewer_label: "lead-0003", events: events.map(e => event(e)) })).at(-1)?.sentence;
    expect(lead([{ actor_label: "lead-0002", own_task: false, affected: [other] }])).toBe("lead-0002 released the pause on Task 7 (ann-0005).");
    expect(lead([{ action: "extend_hold", actor_label: "lead-0002", own_task: false, affected: [other, { ...other, assignment_id: 9, owner_label: "ann-0006" }] }]))
      .toBe("lead-0002 paused Task 7 (ann-0005) and Task 9 (ann-0006). Reason shown to their owners:");
    expect(lead([{ action: "restart", actor_label: "lead-0002", round_ordinal: 3, abandoned_round_ordinal: 2 }]))
      .toBe("lead-0002 agreed an empty restart of Task 4. Round 2 abandoned and kept; Round 3 started empty. Report closed.");
    expect(lead([{ action: "restart", actor_label: "lead-0002", round_ordinal: 3 }]))
      .toBe("lead-0002 agreed an empty restart of Task 4. The previous round abandoned and kept; Round 3 started empty. Report closed.");
    expect(lead([{ action: "withdraw", affected: [{ ...other, assignment_id: 4, owner_label: "ann-0004" }] }])).toBe("ann-0004 withdrew the report. Task 4 resumed.");
    expect(lead([{ action: "reopen", actor_label: "lead-0002" }])).toBe("lead-0002 reopened the report.");
    const reporter = historyItems(report({ events: [event({ action: "restart", actor_label: "lead-0002", round_ordinal: 3, abandoned_translation_draft: { text: "Draft", form: { a: 1 } } })] })).at(-1);
    expect(reporter).toMatchObject({ sentence: "lead-0002 restarted your task with an empty Round 3. The previous round is kept. Report closed.", draft: { text: "Draft", form: { a: 1 } } });
    expect(historyItems(report({ events: [event({ action: "extend_hold", actor_label: "lead-0002", own_task: true })] })).at(-1)?.sentence).toBe("lead-0002 paused your task again.");
    expect(historyItems(report({ events: [event({ actor_label: "lead-0002", own_task: true })] })).at(-1)?.sentence).toBe("lead-0002 released the pause on your task.");
    expect(historyItems(report({ events: [event({ action: "extend_hold", actor_label: "lead-0002", own_task: false })] }))).toHaveLength(1);
  });
  it("toolbar_entry_states", () => {
    expect(toolbarEntry([], false)).toEqual({ badge: null, paused: false, accessibleSuffix: "for this task" });
    expect(toolbarEntry([report({ holds: [hold({ active: false })] })], false)).toEqual({ badge: "1 open", paused: false, accessibleSuffix: "1 open report" });
    expect(toolbarEntry([report()], true)).toEqual({ badge: "Paused, 1 open", paused: true, accessibleSuffix: "Task paused, 1 open report" });
    expect(toolbarEntry(null, true).accessibleSuffix).toBe("Task paused");
  });
  it("intent_availability", () => {
    const open = intentState(report({ viewer_is_lead: true }));
    expect(open.close.label).toBe("Close report (pauses stay)");
    expect(open.close.consequence).toBe("Records your outcome for ann-0004. Task 4 stays paused until you release it.");
    expect(open.reopen.unavailable).toBe("The report is open.");
    const closed = intentState(report({ viewer_is_lead: true, state: "resolved", holds: [hold({ active: false })] }));
    expect(closed.close.label).toBe("Close report");
    expect(closed.release.unavailable).toBe("No task is paused by this report.");
    expect(closed.pause.unavailable).toBe("The report is closed.");
    expect(closed.reopen).toEqual({ label: "Reopen report…", consequence: "Makes the report open again. Nothing is paused again.", unavailable: null });
    expect(intentState(report({ state: "withdrawn" })).restart.unavailable).toBe("The report is withdrawn.");
    const blocked = intentState(report({ viewer_is_lead: true, holds: [hold({ other_active_holds: [{ report_id: "r2" }] })] }));
    expect(blocked.restart.unavailable).toBe("Task 4 is also paused by another report. Release that pause first.");
  });
  it("summary_and_outcomes", () => {
    expect(leadSummary(report({ state: "resolved" }))).toBe("1 task is paused by this report. The report is closed; release the pause when work can continue.");
    expect(leadSummary(report({ holds: [hold({ active: false })] }))).toBe("Nothing is paused by this report. The report is open until you close it.");
    expect(leadSummary(report())).toBe("1 task paused by this report. The report is open.");
    expect(leadSummary(report({ state: "withdrawn", holds: [hold({ active: false })] }))).toBe("The reporter withdrew this report. Nothing is paused by it.");
    expect(leadSummary(report({ state: "resolved", holds: [hold({ active: false })] }))).toBe("Nothing left to decide.");
    const before = report({ viewer_is_lead: true });
    const after = report({ viewer_is_lead: true, state: "resolved" });
    expect(leadOutcome("close", before, after)).toBe("Report closed. Task 4 is still paused by this report; release it when work can continue.");
    expect(leadOutcome("close", before, report({ state: "resolved", holds: [hold({ active: false })] }))).toBe("Report closed. No task is paused by it any more. The final result did not change.");
    expect(leadOutcome("reopen", after, before)).toBe("Report reopened. No task was paused again.");
    const released = report({ viewer_is_lead: true, holds: [hold({ active: false, release_action: "resume" })] });
    expect(leadOutcome("release", before, released, [4])).toBe("Released the pause on Task 4 (ann-0004). The report is still open.");
    const stillHeld = report({ viewer_is_lead: true, holds: [hold({ active: false, release_action: "resume", other_active_holds: [{ report_id: "r2" }] })] });
    expect(leadOutcome("release", before, stillHeld)).toBe("Released the pause on Task 4 (ann-0004). The report is still open. Task 4 is still paused by another report.");
    const restarted = report({ viewer_is_lead: true, state: "resolved", events: [event({ action: "restart", actor_label: "lead-0002", round_ordinal: 3, abandoned_round_ordinal: 2 })] });
    expect(leadOutcome("restart", before, restarted)).toBe("Task 4 restarted with an empty Round 3. Round 2 is kept in the history. Report closed. The final result did not change.");
    const paused = report({ viewer_is_lead: true, holds: [hold(), hold({ hold_id: "h7", assignment_id: 7, owner_label: "ann-0005" })] });
    expect(leadOutcome("pause", before, paused)).toBe("Paused Task 7 (ann-0005). Their owners see your reason. The report is still open.");
  });
  it("conflict_reasons", () => {
    expect(conflictReasonText({ reason: "REPORT_LEAD_ACTED" })).toMatch(/project lead/);
    expect(conflictReasonText({ reason: "OTHER" })).toBeNull();
    expect(conflictReasonText(null)).toBeNull();
  });
});

it("names the final result's author with display name and pseudonym for leads", () => {
  const base = { case_id: "accepted-translation", language: "de", document_id: "d", submission_id: "s", revision: 1, selected_at: T, updated_at: T,
    selected_by: "lead-0002", kind: "annotation" as const, round_ordinal: 2, author_label: "ann-0004", is_mine: false, recorded_at: null };
  expect(finalResultLabel({ ...base, author: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } } as FinalSelectionSummary)).toBe("Round 2, Ana Weber (ann-0004)");
  expect(finalResultLabel(base as FinalSelectionSummary)).toBe("Round 2, ann-0004");
});
