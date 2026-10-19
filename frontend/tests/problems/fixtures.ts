import type { ProblemReportView, ReportEventView, ReportHoldView } from "../../src/api/client";

export const T0 = "2026-10-19T01:12:00Z";

export function hold(over: Partial<ReportHoldView> = {}): ReportHoldView {
  return { hold_id: "h1", assignment_id: 4, owner_label: "ann-0004", case_id: "accepted-translation", language: "de", task: "annotate",
    created_at: T0, created_by_label: "ann-0004", active: true, released_at: null, released_by_label: null, release_action: null,
    release_event_id: null, other_active_holds: [], ...over };
}

export function event(over: Partial<ReportEventView> = {}): ReportEventView {
  return { event_id: "e1", action: "resume", actor_label: "ann-0004", created_at: "2026-10-19T01:13:00Z", reason: "upsi", round_id: null,
    round_ordinal: null, abandoned_round_id: null, abandoned_round_ordinal: null, abandoned_translation_draft: null, affected: [], own_task: true, ...over };
}

export function report(over: Partial<ProblemReportView> = {}): ProblemReportView {
  return { report_id: "r1", project_key: "p", assignment_id: 4, document_id: "accepted-translation/de", reporter_id: 9, round_id: "round-2",
    submission_id: null, reason: "Text is cut off after the second paragraph\nMore detail", state: "open", revision: 1, resolution: null,
    held_assignment_ids: [4], events: [], new_round: null, created_at: T0, reporter_label: "ann-0004", case_id: "accepted-translation",
    language: "de", task: "annotate", round_ordinal: 2, current_round_id: "round-2", current_round_ordinal: 2, submission: null, state_changed_at: null, state_changed_by_label: null,
    withdrawable: true, viewer_label: "ann-0004", viewer_is_lead: false, holds: [hold()], ...over } as ProblemReportView;
}
