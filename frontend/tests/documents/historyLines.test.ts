import { describe, expect, it } from "vitest";
import { historyLines } from "../../src/documents/historyLines";
import { final, item, recordedVersion, row, stageCell, stages, submission, version, work } from "./fixtures";

// Local times (no zone suffix): the history shows the browser's time like every other time in the app.
const now = new Date("2026-10-21T23:00:00");
const ana = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };
const tom = { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false };
const luc = { pseudonym: "ann-0005", display_name: "Luc Martin", is_me: false };

/** case-201 de: Ana accepted v1 unchanged, Tom submitted Round 1, Luc annotates, the lead chose the final. */
function walkthroughRow() {
  return row({
    case_id: "case-201", language: "de",
    versions: [version({ document_id: "case-201-de", origin: "machine_translation", translation_status: "accepted", latest_review_decision: "accepted_unchanged" })],
    work: [
      work({ assignment_id: 1, document_id: "case-201-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana }),
      work({ assignment_id: 2, document_id: "case-201-de", status: "submitted", author_label: "ann-0004", person: tom, round_ordinal: 1 }),
      work({ assignment_id: 3, document_id: "case-201-de", status: "in_progress", author_label: "ann-0005", person: luc, round_ordinal: 1 }),
    ],
    stages: stages({ review: stageCell("accepted", "done", { people: [ana], at: "2026-10-20T22:09:00", note: "unchanged" }) }),
    final: final({ case_id: "case-201", language: "de", document_id: "case-201-de", submission_id: "s-tom", selected_by: "lead-0002", selected_at: "2026-10-20T22:20:00" }),
  });
}
const tomSubmission = submission({ submission_id: "s-tom", document_id: "case-201-de", author_label: "ann-0004", author: tom, round_ordinal: 1, finding_count: 1, recorded_at: "2026-10-21T22:15:00" });

describe("historyLines", () => {
  it("writes one line per stage as the spec examples", () => {
    const lines = historyLines(walkthroughRow(), [tomSubmission], { me: "lead-0002", now });
    expect(lines.map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Accepted unchanged, 20 Oct, 22:09",
      "Annotation: Tom Reis (ann-0004), Round 1, 1 finding, 22:15",
      "Annotation: Luc Martin (ann-0005), Round 1, In progress",
      "Final: chosen by you, 20 Oct, 22:20",
    ]);
  });

  it("an acknowledged annotation adds its line", () => {
    const line = "Annotation assigned before the translation review was accepted (confirmed by Ana Weber (ann-0003))";
    const flagged = (status: "in_progress" | "submitted", assigned_by: typeof ana | null = ana) => row({
      case_id: "case-202", language: "de",
      versions: [version({ document_id: "case-202-de", origin: "machine_translation" })],
      work: [work({ assignment_id: 7, document_id: "case-202-de", status, author_label: "ann-0004", person: tom, assigned_by, unreviewed_translation: true })],
    });
    const open = historyLines(flagged("in_progress"), null, { now });
    expect(open.find(entry => entry.key === "unreviewed-7")).toEqual({ key: "unreviewed-7", stage: "annotation", text: line });
    const submitted = historyLines(flagged("submitted"), [submission({ submission_id: "s-7", document_id: "case-202-de", author_label: "ann-0004", author: tom, recorded_at: "2026-10-21T22:15:00" })], { now });
    expect(submitted.map(entry => entry.text)).toContain(line);
    expect(historyLines(flagged("in_progress", null), null, { now }).map(entry => entry.text))
      .toContain("Annotation assigned before the translation review was accepted (confirmed by the lead)");
  });

  it("tags every line with its stage for the row panel's Activity filter", () => {
    const lines = historyLines(walkthroughRow(), [tomSubmission], { me: "lead-0002", now });
    expect(lines.map(line => line.stage)).toEqual(["review", "annotation", "annotation", "final"]);
  });

  it("names another lead and falls back to the work items while submissions load", () => {
    const lines = historyLines(walkthroughRow(), null, { me: "lead-0009", now });
    expect(lines.map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Accepted unchanged, 20 Oct, 22:09",
      "Annotation: Tom Reis (ann-0004), Round 1, Submitted",
      "Annotation: Luc Martin (ann-0005), Round 1, In progress",
      "Final: chosen by lead-0002, 20 Oct, 22:20",
    ]);
  });

  it("words corrections, moved work, consolidations, pauses and acceptances", () => {
    const v1 = version({ document_id: "c-de", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "accepted_corrected", is_newest_in_chain: false });
    const v2 = recordedVersion({
      document_id: "c-de-v2", chain_id: "c-de", version: 2, origin: "correction", derived_from: "c-de", translation_status: "accepted",
      acceptance: { source: "lead", reason: "Checked", accepted_at: null, accepted_by: null },
    });
    const target = row({
      case_id: "c", language: "de", versions: [v1, v2],
      work: [
        work({ assignment_id: 1, document_id: "c-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana }),
        work({ assignment_id: 3, document_id: "c-de-v2", task: "review", status: "open", author_label: "ann-0003", person: ana, held: true }),
      ],
      moved_work: [work({ assignment_id: 2, document_id: "c-de", status: "in_progress", author_label: "ann-0005", person: luc, moved_to_version: 2 })],
      notes: [item({ code: "TASK_ON_HOLD", cause_id: "hold-3", author_label: "ann-0003", report_id: "rep-3" })],
    });
    const consolidation = submission({ submission_id: "s-c", document_id: "c-de-v2", version: 2, kind: "consolidation", author_label: "ann-0003", author: ana, round_ordinal: null, finding_count: 3, recorded_at: "2026-10-21T09:00:00" });
    const lines = historyLines(target, [consolidation], { now });
    expect(lines.map(line => line.text)).toEqual([
      "Review: Ana Weber (ann-0003), Accepted with corrections, v1 → v2",
      "Review: Accepted: reviewed outside Ontocurator, Checked",
      "Consolidation: Ana Weber (ann-0003), 3 findings, v2, 09:00",
      "Consolidation: Ana Weber (ann-0003), Open, Paused",
      "Annotation: Luc Martin (ann-0005), moved to v2",
      "Task paused: ann-0003",
    ]);
    expect(lines.at(-1)?.reportId).toBe("rep-3");
  });

  it("is empty for a row without work, records or final", () => {
    expect(historyLines(row({ case_id: "c", language: "de" }), [], { now })).toEqual([]);
  });

  it("says how many findings a consolidation kept automatically (all matched)", () => {
    const consolidation = (kept: number) => submission({ submission_id: `c-${kept}`, document_id: "case-201-de", author_label: "rev-0005", author: luc,
      kind: "consolidation", round_ordinal: null, finding_count: 6, recorded_at: "2026-10-21T22:30:00", kept_automatically: kept });
    const four = historyLines(walkthroughRow(), [consolidation(4)], { now }).find(line => line.key === "submission-c-4")!;
    expect(four.text).toBe("Consolidation: Luc Martin (ann-0005), 6 findings, 4 kept automatically (all matched), 22:30");
    const none = historyLines(walkthroughRow(), [consolidation(0)], { now }).find(line => line.key === "submission-c-0")!;
    expect(none.text).not.toContain("kept automatically");
  });
});
