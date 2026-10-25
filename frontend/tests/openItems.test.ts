// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CarriedState } from "../src/editor/carried/checkState";
import { collectOpenItems, dialogItems, DIALOG_HIDDEN_KINDS, nextOpenItem, submitBlockedReason, summaryLine, type OpenItem } from "../src/editor/openItems";

const carriedState = (inputId: string, homeId: string | null): CarriedState => ({
  input: { input_id: inputId } as CarriedState["input"], index: 0, variant: "needed", unchecked: true,
  home: homeId ? "carried" : "placeholder", homeId, carriedId: homeId, missing: homeId ? null : "mapping_failed",
});
const empty = { carried: [], evidence: [], reanchor: [], unconfirmed: [], openTargets: [], defaulted: [] };

describe("collectOpenItems", () => {
  it("orders carried, evidence, re-anchor, review targets, unconfirmed values and defaulted", () => {
    const items = collectOpenItems({
      defaulted: [{ annotationId: "d", term: "Defaulted", axisId: "assertion", evidenceId: "ev-d" }],
      unconfirmed: [{ annotationId: "u", term: "Unconfirmed", axisId: "temporality", axisLabel: "Temporality" }],
      openTargets: [{ key: "t1", term: "Target" }],
      reanchor: [{ key: "r1", term: "Moved" }],
      evidence: [{ annotationId: "e", term: "Evidence", reason: "This term is obsolete.", remedy: "Change the term.", focus: '[data-repair="change-term"]' }],
      carried: [
        { state: carriedState("input-1", "c1"), term: "Seizure", instruction: "Check the text span.", evidenceId: "ev-c1" },
        { state: carriedState("input-2", null), term: "Fever", instruction: "Mark it again." },
      ],
    });
    expect(items.map(item => item.kind)).toEqual(["carried", "carried", "evidence", "reanchor", "review-target", "unconfirmed-values", "defaulted"]);
    expect(items[0]).toMatchObject({ listKey: "annotation:c1", focus: "[data-carried-primary]", evidenceId: "ev-c1", blocking: true, term: "Seizure", line: "Check the text span." });
    expect(items[1]).toMatchObject({ listKey: "input:input-2", evidenceId: undefined });
    expect(items[2]).toMatchObject({ listKey: "annotation:e", focus: '[data-repair="change-term"]', blocking: true });
    expect(items[3]).toMatchObject({ listKey: null, blocking: true });
    expect(items[4]).toMatchObject({ listKey: "target:t1", blocking: true });
    expect(items[5]).toMatchObject({ listKey: "annotation:u", axisId: "temporality", blocking: false });
    expect(items[6]).toMatchObject({ listKey: "annotation:d", axisId: "assertion", evidenceId: "ev-d", blocking: false });
  });

  it("uses the review target key for proposals and lists a finding with a warning once", () => {
    const items = collectOpenItems({
      ...empty,
      evidence: [{ annotationId: "p", term: "Proposal", reason: "r", remedy: "m", focus: '[data-repair="edit-proposal"]', targetKey: "tk" }],
      unconfirmed: [{ annotationId: "a", term: "A", axisId: "x", axisLabel: "X" }],
      defaulted: [{ annotationId: "a", term: "A", axisId: "x" }, { annotationId: "b", term: "B", axisId: "y", targetKey: "tb" }],
    });
    expect(items.map(item => [item.kind, item.listKey])).toEqual([
      ["evidence", "target:tk"], ["unconfirmed-values", "annotation:a"], ["defaulted", "target:tb"],
    ]);
    expect(new Set(items.map(item => item.key)).size).toBe(items.length);
  });
});

describe("summaryLine and submitBlockedReason", () => {
  const carried = (n: number) => collectOpenItems({
    ...empty, carried: Array.from({ length: n }, (_, i) => ({ state: carriedState(`i${i}`, `c${i}`), term: "Seizure", instruction: "" })),
  });

  it("names the open items", () => {
    expect(summaryLine(carried(1))).toBe("1 carried finding still needs a check");
    expect(summaryLine(carried(2))).toBe("2 carried findings still need a check");
    expect(summaryLine([])).toBe("");
    const mixed = collectOpenItems({ ...empty, carried: [{ state: carriedState("i", "c"), term: "S", instruction: "" }],
      defaulted: [{ annotationId: "d", term: "D", axisId: "x" }] });
    expect(summaryLine(mixed)).toBe("1 carried finding still needs a check, 1 annotation has defaulted axis values");
  });

  it("gives the first blocking kind's sentence and ignores warnings", () => {
    expect(submitBlockedReason(carried(1))).toBe("Check 1 carried finding before submitting.");
    expect(submitBlockedReason(carried(3))).toBe("Check 3 carried findings before submitting.");
    const warnings = collectOpenItems({ ...empty,
      unconfirmed: [{ annotationId: "u", term: "U", axisId: "x", axisLabel: "X" }],
      defaulted: [{ annotationId: "d", term: "D", axisId: "x" }] });
    expect(warnings.every(item => !item.blocking)).toBe(true);
    expect(submitBlockedReason(warnings)).toBeNull();
    expect(submitBlockedReason(collectOpenItems({ ...empty, openTargets: [{ key: "t", term: "T" }] }))).toBe("Decide every review proposal before submitting.");
    expect(submitBlockedReason(collectOpenItems({ ...empty, reanchor: [{ key: "r", term: "R" }] })))
      .toBe("Re-create or dismiss 1 finding after text correction before submitting.");
  });
});

describe("dialogItems and blocking values", () => {
  const mixed = () => collectOpenItems({ ...empty,
    carried: [{ state: carriedState("i", "c"), term: "S", instruction: "" }],
    unconfirmed: [{ annotationId: "u", term: "U", axisId: "x", axisLabel: "X" }],
    defaulted: [{ annotationId: "d", term: "D", axisId: "x" }] });

  it("drops defaulted and unconfirmed values from the dialog list", () => {
    expect(DIALOG_HIDDEN_KINDS).toEqual(["defaulted", "unconfirmed-values", "cohort-modifier", "exclusive-modifiers"]);
    expect(dialogItems(mixed()).map(item => item.kind)).toEqual(["carried"]);
    expect(summaryLine(dialogItems(mixed()))).toBe("1 carried finding still needs a check");
  });

  it("names blocking values after the blocking kinds", () => {
    const warnings = dialogItems(collectOpenItems({ ...empty, defaulted: [{ annotationId: "d", term: "D", axisId: "x" }] }));
    expect(submitBlockedReason(warnings, 3)).toBe("Confirm or choose 3 values before submitting.");
    expect(submitBlockedReason(warnings, 1)).toBe("Confirm or choose 1 values before submitting.");
    expect(submitBlockedReason(warnings, 0)).toBeNull();
    expect(submitBlockedReason(dialogItems(mixed()), 3)).toBe("Check 1 carried finding before submitting.");
  });
});

describe("nextOpenItem", () => {
  const items: OpenItem[] = collectOpenItems({ ...empty,
    carried: [{ state: carriedState("i1", "a"), term: "A", instruction: "" }],
    defaulted: [{ annotationId: "a", term: "A", axisId: "x" }, { annotationId: "b", term: "B", axisId: "x" }],
  });

  it("starts with the first item and moves past the current selection, wrapping", () => {
    expect(nextOpenItem([], null, null)).toBeNull();
    expect(nextOpenItem(items, null, null)?.key).toBe(items[0].key);
    expect(nextOpenItem(items, "annotation:a", null)?.key).toBe(items[2].key);
    expect(nextOpenItem(items, "annotation:a", items[0].key)?.key).toBe(items[1].key);
    expect(nextOpenItem(items, "annotation:b", items[2].key)?.key).toBe(items[0].key);
    expect(nextOpenItem(items, "annotation:other", null)?.key).toBe(items[0].key);
  });
});

describe("modifier items (R3, R10, R12)", () => {
  const items = () => collectOpenItems({ ...empty,
    unconfirmed: [{ annotationId: "u", term: "U", axisId: "x", axisLabel: "X" }],
    modifierAsFinding: [{ annotationId: "sev", term: "Severe", evidenceId: "ev-sev" }],
    modifierWarnings: [
      { annotationId: "seizure", term: "Seizure", kind: "cohort-modifier", key: "cohort:HP:0040283", labels: ["Frequent"] },
      { annotationId: "seizure", term: "Seizure", kind: "exclusive-modifiers", key: "exclusive:severity", labels: ["Mild", "Severe"], exclusiveClass: "severity" },
    ],
  });

  it("lists the blocking item before the values and the warnings after them, with their lines and focus", () => {
    const list = items();
    expect(list.map(item => item.kind)).toEqual(["modifier-as-finding", "unconfirmed-values", "cohort-modifier", "exclusive-modifiers"]);
    expect(list[0]).toMatchObject({ blocking: true, term: "Severe", line: "Severe is a modifier. Turn it into a modifier of another finding.",
      focus: "[data-turn-into-modifier]", listKey: "annotation:sev", evidenceId: "ev-sev" });
    expect(list[2]).toMatchObject({ blocking: false, term: "Seizure", line: "Frequent is a cohort term.", listKey: "annotation:seizure" });
    expect(list[3]).toMatchObject({ blocking: false, line: "Two severities: Mild, Severe." });
    expect(dialogItems(list).map(item => item.kind)).toEqual(["modifier-as-finding"]);
  });

  it("summarises per finding and names the blocking item before the values reason", () => {
    expect(summaryLine(items())).toBe("1 finding uses a modifier term, 1 finding has unconfirmed clinical values, "
      + "1 finding has a cohort term as modifier, 1 finding has two modifiers of one kind");
    expect(submitBlockedReason(items(), 2)).toBe("Turn 1 modifier used as a finding into a modifier before submitting.");
    const two = collectOpenItems({ ...empty, modifierAsFinding: [{ annotationId: "a", term: "Severe" }, { annotationId: "b", term: "Mild" }] });
    expect(submitBlockedReason(two)).toBe("Turn 2 modifiers used as findings into modifiers before submitting.");
    const onsets = collectOpenItems({ ...empty, modifierWarnings: [
      { annotationId: "a", term: "A", kind: "exclusive-modifiers", key: "exclusive:onset", labels: [], exclusiveClass: "onset" },
      { annotationId: "a", term: "A", kind: "cohort-modifier", key: "cohort:x", labels: ["Frequent"] },
      { annotationId: "a", term: "A", kind: "cohort-modifier", key: "cohort:y", labels: ["Very frequent"] }] });
    expect(onsets[0].line).toBe("Two onsets.");
    expect(summaryLine(onsets)).toBe("1 finding has a cohort term as modifier, 1 finding has two modifiers of one kind");
    expect(submitBlockedReason(onsets)).toBeNull();
  });
});
