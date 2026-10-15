import { describe, expect, it } from "vitest";
import { isNegated } from "../src/editor/negation";

describe("isNegated", () => {
  it("absent_is_negated", () => {
    expect(isNegated({ axes_values: { assertion: "absent" } })).toBe(true);
    expect(isNegated({ axes_values: { assertion: "absent", temporality: "current" } })).toBe(true);
  });

  it("present_uncertain_and_missing_are_not", () => {
    expect(isNegated({ axes_values: { assertion: "present" } })).toBe(false);
    expect(isNegated({ axes_values: { assertion: "uncertain" } })).toBe(false);
    expect(isNegated({ axes_values: { assertion: null } })).toBe(false);
    expect(isNegated({ axes_values: { severity: "absent" } })).toBe(false);
    expect(isNegated({ axes_values: {} })).toBe(false);
    expect(isNegated({ axes_values: null })).toBe(false);
    expect(isNegated({})).toBe(false);
  });
});
