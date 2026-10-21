// @vitest-environment node
import { describe, expect, it } from "vitest";
import { carriedChosenAxisIds, carriedListOrder, checkStateBadge, deriveCarriedStates, nextUncheckedKey, progressText, rowKeyOf, type CarriedInputLike } from "../../src/editor/carried/checkState";

const snap = (id: string, version = "v1", evidence = 0) => ({ annotation: { annotation_id: id, layer_id: "hpo", type_id: "phenotype", term_id: "HP:1", evidence_refs: Array.from({ length: evidence }, (_, i) => ({ evidence_id: `e${i}`, version: "1" })), axes_values: {}, axes_defaulted: [] }, version, evidence: [], text_sha256: "t1" }) as any;
const input = (id: string, target: any) => ({ input_id: id, source_submission_id: "s1", source_snapshot: snap("orig"), target_snapshot: target, mapping_status: target ? "carried" : "needs_review" }) as any;

describe("deriveCarriedStates", () => {
  it("needed_without_resolution", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [], [snap("input-i1")]);
    expect(s).toMatchObject({ variant: "needed", unchecked: true, home: "carried", homeId: "input-i1", missing: null });
  });
  it("checked_when_the_named_version_is_current", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [{ input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "input-i1", version: "v1" } }], [snap("input-i1")]);
    expect(s.variant).toBe("checked"); expect(s.unchecked).toBe(false);
  });
  it("changed_after_check_when_the_version_differs", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [{ input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "input-i1", version: "v1" } }], [snap("input-i1", "v2")]);
    expect(s.variant).toBe("changed"); expect(s.unchecked).toBe(true);
  });
  it("removed_when_the_linked_finding_is_gone_and_placeholder_when_carried_is_gone_too", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [{ input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "input-i1", version: "v1" } }], []);
    expect(s).toMatchObject({ variant: "removed", home: "placeholder", homeId: null, missing: "deleted" });
  });
  it("derives the state of an input from a frozen draft (no source submission)", () => {
    const drafted: CarriedInputLike = { ...input("i1", snap("input-i1")), source_submission_id: null };
    const [s] = deriveCarriedStates([drafted], [], [snap("input-i1")]);
    expect(s).toMatchObject({ variant: "needed", unchecked: true, home: "carried", homeId: "input-i1" });
  });
  it("dismissed", () => {
    const [s] = deriveCarriedStates([input("i1", null)], [{ input_id: "i1", outcome: "dismissed", reason: "No" }], []);
    expect(s).toMatchObject({ variant: "dismissed", unchecked: false, home: "placeholder", missing: "mapping_failed" });
  });
  it("linked_finding_is_the_home_and_two_inputs_can_share_it", () => {
    const states = deriveCarriedStates([input("i1", null), input("i2", null)], [
      { input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "own", version: "v1" } },
      { input_id: "i2", outcome: "completed", annotation_ref: { annotation_id: "own", version: "v1" } }], [snap("own")]);
    expect(states.map(s => [s.home, s.homeId, s.variant])).toEqual([["linked", "own", "checked"], ["linked", "own", "checked"]]);
  });
  it("legacy_draft_with_carried_present_but_another_finding_linked_shows_on_the_linked_row", () => {
    const [s] = deriveCarriedStates([input("i1", snap("input-i1"))], [{ input_id: "i1", outcome: "completed", annotation_ref: { annotation_id: "own", version: "v1" } }], [snap("input-i1"), snap("own")]);
    expect(s).toMatchObject({ home: "linked", homeId: "own", carriedId: "input-i1", variant: "checked" });
  });
});

describe("progress and navigation", () => {
  it("progress_text_variants", () => {
    const mk = (variant: string) => ({ variant, unchecked: ["needed", "changed", "removed"].includes(variant) }) as any;
    expect(progressText([mk("needed")])).toBe("0 of 1 checked");
    expect(progressText([mk("checked"), mk("checked"), mk("dismissed"), mk("needed"), mk("changed")])).toBe("2 of 5 checked, 1 dismissed");
    expect(progressText([mk("checked"), mk("dismissed")])).toBe("All carried findings checked");
  });
  it("next_unchecked_wraps_and_goes_backwards", () => {
    const order = ["input:a", "annotation:x", "annotation:y", "annotation:z"];
    const open = new Set(["input:a", "annotation:y"]);
    expect(nextUncheckedKey(order, open, "annotation:y", 1)).toBe("input:a");
    expect(nextUncheckedKey(order, open, "annotation:x", 1)).toBe("annotation:y");
    expect(nextUncheckedKey(order, open, null, 1)).toBe("input:a");
    expect(nextUncheckedKey(order, open, "input:a", -1)).toBe("annotation:y");
    expect(nextUncheckedKey(order, new Set(), null, 1)).toBeNull();
  });
  it("row_key_of_home_or_placeholder", () => {
    expect(rowKeyOf({ homeId: "x", input: { input_id: "i" } } as any)).toBe("annotation:x");
    expect(rowKeyOf({ homeId: null, input: { input_id: "i" } } as any)).toBe("input:i");
  });
});

describe("check state badge", () => {
  it("badge_text_tone_and_extra_line_per_variant", () => {
    expect(checkStateBadge("needed")).toEqual({ tone: "warning", label: "Check needed", line: null });
    expect(checkStateBadge("changed")).toEqual({ tone: "warning", label: "Check needed", line: "Changed after your check" });
    expect(checkStateBadge("removed")).toEqual({ tone: "warning", label: "Check needed", line: "The linked finding was deleted" });
    expect(checkStateBadge("checked")).toEqual({ tone: "success", label: "Checked", line: null });
    expect(checkStateBadge("dismissed")).toEqual({ tone: "neutral", label: "Dismissed", line: null });
  });
});

describe("carriedListOrder", () => {
  it("puts carried findings and placeholders first in input order, then the other findings", () => {
    const states = deriveCarriedStates([input("i1", snap("input-i1")), input("i2", null), input("i3", snap("input-i3"))], [], [snap("ann-1"), snap("input-i3"), snap("input-i1")]);
    expect(carriedListOrder(states, ["ann-1", "input-i3", "input-i1"])).toEqual(["annotation:input-i1", "input:i2", "annotation:input-i3", "annotation:ann-1"]);
  });
  it("keeps the draft order without carried inputs", () => {
    expect(carriedListOrder([], ["b", "a"])).toEqual(["annotation:b", "annotation:a"]);
  });
});

describe("carriedChosenAxisIds", () => {
  it("keeps the original's chosen, non-empty axes of the target type", () => {
    const source = { ...snap("orig").annotation, axes_values: { assertion: "present", temporality: "current", onset: "", gone: "x" }, axes_defaulted: ["temporality"] };
    expect(carriedChosenAxisIds(source, ["assertion", "temporality", "onset"])).toEqual(["assertion"]);
  });
  it("chooses nothing when every value was defaulted", () => {
    const source = { ...snap("orig").annotation, axes_values: { assertion: "present" }, axes_defaulted: ["assertion"] };
    expect(carriedChosenAxisIds(source, ["assertion"])).toEqual([]);
  });
});
