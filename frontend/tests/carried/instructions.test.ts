// @vitest-environment node
import { describe, expect, it } from "vitest";
import { carriedFromLine, dismissedLine, instructionLine, linkedMetaLine, missingReason, textSpanLine, valuesLines, whatToCheckContext } from "../../src/editor/carried/instructions";

const base = { sourceOrdinal: 2, sourceVersion: 1, currentVersion: 1, language: "de", hasEvidence: true, sameText: true };
describe("instruction lines", () => {
  it.each([
    [{ ...base, hasEvidence: false }, "needed", "carried", "No text span. Check that it still applies to this text."],
    [base, "needed", "carried", "Check the marked text and the values."],
    [{ ...base, sameText: false }, "needed", "carried", "The text changed since Round 2. Check the marked text and the values."],
    [base, "changed", "carried", "Changed after your check. Check it again."],
    [base, "needed", "placeholder:mapping_failed", "Could not be placed on this text. Mark it again, link it or dismiss it."],
    [base, "needed", "placeholder:deleted", "You deleted the carried finding. Link another finding or dismiss it."],
  ] as const)("%#", (ctx, variant, where, text) => { expect(instructionLine(ctx, variant, where)).toBe(text); });
  it("checked_and_dismissed_have_no_instruction", () => {
    expect(instructionLine(base, "checked", "carried")).toBeNull();
    expect(instructionLine(base, "dismissed", "placeholder:deleted")).toBeNull();
  });
  it("unknown_source_round_is_named_generically", () => {
    expect(instructionLine({ ...base, sourceOrdinal: null, sameText: false }, "needed", "carried")).toBe("The text changed since the earlier round. Check the marked text and the values.");
  });
});
describe("inspector lines", () => {
  it("text_span_line", () => {
    expect(textSpanLine({ ...base, hasEvidence: false })).toBe("None. This finding had no text span in Round 2 either.");
    expect(textSpanLine(base)).toBe("Same text as in Round 2 (de v1).");
    expect(textSpanLine({ ...base, sameText: false, currentVersion: 2 })).toBe("The text was corrected since Round 2 (v1 → v2). The span was moved; check that it still covers the finding.");
  });
  it("values_lines_name_defaulted_axes", () => {
    expect(valuesLines([])).toEqual(["Carried unchanged. Carrying does not confirm values."]);
    expect(valuesLines(["Temporality"])).toEqual(["Carried unchanged. Carrying does not confirm values.", "Not confirmed: Temporality."]);
  });
  it("missing_reason", () => {
    expect(missingReason("deleted", null)).toBe("You deleted the carried finding in this round.");
    expect(missingReason("mapping_failed", null)).toBe("Its text span could not be found in this text.");
    expect(missingReason("mapping_failed", "ambiguous_evidence")).toBe("Its text appears more than once in this text, so it could not be placed automatically.");
    expect(missingReason("mapping_failed", "changed_cue")).toBe("Its text was changed by the correction, so it could not be placed automatically.");
    expect(missingReason("mapping_failed", "changed_modifier_segment")).toBe(
      "The text of one of its modifiers was changed by the correction, so it could not be placed automatically.",
    );
    expect(missingReason("mapping_failed", "invalid_bounds")).toBe("Its original text span could not be read reliably, so it could not be placed automatically.");
    expect(missingReason("mapping_failed", "something_new")).toBe("Its text span could not be found in this text.");
  });
});
describe("list lines", () => {
  it("meta_and_dismissed_lines", () => {
    expect(carriedFromLine(2)).toBe("Carried from Round 2");
    expect(linkedMetaLine([{ term: "Seizure", sourceOrdinal: 2 }])).toBe("Linked to carried Seizure (Round 2)");
    expect(linkedMetaLine([{ term: "Seizure", sourceOrdinal: 2 }, { term: "Ataxia", sourceOrdinal: 2 }])).toBe("Linked to 2 carried findings");
    expect(dismissedLine("x".repeat(70))).toBe(`Dismissed: ${"x".repeat(60)}`);
    expect(dismissedLine("Not in this text")).toBe("Dismissed: Not in this text");
  });
});
describe("whatToCheckContext", () => {
  const s = (sha: string, evidence: number) => ({ annotation: { annotation_id: "a", layer_id: "l", type_id: "t", term_id: "HP:1", evidence_refs: Array.from({ length: evidence }, () => ({})) }, version: "v1", text_sha256: sha });
  it("uses_the_target_snapshot_or_falls_back_to_the_source", () => {
    const doc = { version: 2, language: "de", text_sha256: "t2" };
    const carried = { input_id: "i", source_submission_id: "s", source_snapshot: s("t1", 1), target_snapshot: s("t2", 1), mapping_status: "carried" as const, source_round_ordinal: 2, source_version: 1 };
    expect(whatToCheckContext(carried, doc)).toEqual({ sourceOrdinal: 2, sourceVersion: 1, currentVersion: 2, language: "de", hasEvidence: true, sameText: false });
    expect(whatToCheckContext({ ...carried, target_snapshot: s("t1", 0) }, doc)).toMatchObject({ hasEvidence: false, sameText: true });
    expect(whatToCheckContext({ ...carried, target_snapshot: null }, doc)).toMatchObject({ hasEvidence: true, sameText: false });
  });
});
