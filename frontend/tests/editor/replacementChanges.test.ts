// @vitest-environment node
import { describe, expect, it } from "vitest";
import { replacementChanges } from "../../src/editor/replacementChanges";

const side = (over: Partial<Parameters<typeof replacementChanges>[0]> = {}) =>
  ({ term: "Weight loss", axes: { assertion: "present" }, quotes: ["weight loss"], note: null, modifiers: "", ...over });

describe("replacementChanges (#198)", () => {
  it("is empty while the copy is unchanged", () => {
    expect(replacementChanges(side(), side())).toEqual([]);
  });
  it("names term, values, text, note and modifiers in words", () => {
    const axes = [{ id: "assertion", label: "Assertion", options: ["present", "absent"] }] as never;
    expect(replacementChanges(side(), side({ term: "Cachexia", axes: { assertion: "absent" }, quotes: ["loss"], note: "why", modifiers: "m" }), axes)).toEqual([
      "Term: Weight loss → Cachexia",
      "Assertion: Present → Absent",
      "Text: “weight loss” → “loss”",
      "Note changed",
      "Modifiers changed",
    ]);
  });
});
