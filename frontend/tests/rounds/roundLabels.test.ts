// @vitest-environment node
import { describe, expect, it } from "vitest";
import { carryUnavailableReason, carriedCell, roundBadge, roundIdentity, roundStartingPoint, roundStateLabel, sourceOptionLabel, submissionCell, type RoundFacts } from "../../src/editor/rounds/roundLabels";

const now = new Date("2026-10-19T12:00:00");
const r = (o: Partial<any>): RoundFacts => ({ round_id: "r", kind: "ordinary", state: "editable", round_ordinal: 1, document_language: "de", document_version: 1, input_count: 0, submission_count: 0, predecessor_round_id: null, ...o });
describe("round labels", () => {
  it("identity_lines", () => {
    expect(roundIdentity(r({}), { now })).toBe("Round 1 · started empty · de v1");
    expect(roundIdentity(r({ kind: "carry_forward", round_ordinal: 3, source_round_ordinal: 2, source_submission_recorded_at: "2026-10-19T00:57:00" }), { now })).toBe("Round 3 · continued from Round 2 submission (19 Oct, 00:57) · de v1");
    expect(roundIdentity(r({ kind: "clean_restart", round_ordinal: 4 }), { now })).toBe("Round 4 · restarted empty after agreement with the lead");
    expect(roundIdentity(r({ kind: "consolidation", round_ordinal: 2, input_submission_ids: ["a", "b"] }), { now })).toBe("Round 2 · consolidation of 2 submissions");
  });
  it("text_change_and_handover_rounds", () => {
    expect(roundIdentity(r({ kind: "text_change", document_version: 2 }), { now })).toBe("Round 1 · carried after text change · de v2");
    expect(roundIdentity(r({ kind: "handover", document_version: 2 }), { now })).toBe("Round 1 · handed over from another annotator · de v2");
    expect(roundStartingPoint(r({ kind: "text_change" }))).toBe("carried after text change");
    expect(roundStartingPoint(r({ kind: "handover" }))).toBe("handed over");
    expect(roundBadge(r({ kind: "handover", round_ordinal: 2 }))).toBeUndefined();
  });
  it("state_labels_name_the_replacing_round", () => {
    const rounds = [r({ round_id: "a", state: "superseded" }), r({ round_id: "b", round_ordinal: 2, predecessor_round_id: "a", state: "abandoned" }), r({ round_id: "c", round_ordinal: 3, predecessor_round_id: "b" })];
    expect(roundStateLabel(rounds[0], rounds)).toBe("Replaced by Round 2");
    expect(roundStateLabel(rounds[1], rounds)).toBe("Discarded by restart");
    expect(roundStateLabel(rounds[2], rounds)).toBe("Open");
    expect(roundStateLabel(r({ state: "submitted" }), rounds)).toBe("Submitted");
  });
  it("submission_and_carried_cells", () => {
    expect(submissionCell(0, null, { now })).toBe("Not submitted yet");
    expect(submissionCell(1, "2026-10-19T00:16:00", { now })).toBe("Submitted 19 Oct, 00:16");
    expect(submissionCell(2, "2026-10-19T00:57:00", { now })).toBe("2 submissions, latest 19 Oct, 00:57");
    expect(carriedCell(0)).toBe("None"); expect(carriedCell(1)).toBe("1 finding"); expect(carriedCell(3)).toBe("3 findings");
  });
  it("carry_unavailable_reasons", () => {
    expect(carryUnavailableReason({ held: true, openRoundOrdinal: 3, sourceCount: 1 })).toBe("The task is paused. Resume it before starting another round.");
    expect(carryUnavailableReason({ held: false, openRoundOrdinal: 3, sourceCount: 1 })).toBe("You can continue from a submission once Round 3 is submitted. Round 3 is still open.");
    expect(carryUnavailableReason({ held: false, openRoundOrdinal: null, sourceCount: 0 })).toBe("There is no submitted work of yours on this text yet.");
    expect(carryUnavailableReason({ held: false, openRoundOrdinal: null, sourceCount: 2 })).toBeNull();
  });
  it("source_option_label", () => {
    expect(sourceOptionLabel({ round_ordinal: 2, recorded_at: "2026-10-19T00:57:00", language: "de", version: 1, finding_count: 1 }, { now })).toBe("Round 2 submission · 19 Oct, 00:57 · de v1 · 1 finding");
    expect(sourceOptionLabel({ round_ordinal: 2, recorded_at: null, language: "de", version: 1, finding_count: 2 }, { now })).toBe("Round 2 submission · de v1 · 2 findings");
  });
});
