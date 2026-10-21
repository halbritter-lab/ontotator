import { describe, expect, it } from "vitest";
import { submissionGuidelineLabel } from "../src/guidelines/submissionLabel";

describe("submissionGuidelineLabel", () => {
  it("names the version when it is the current one or none is in force", () => {
    expect(submissionGuidelineLabel(2, false, 2)).toBe("Guidelines v2");
    expect(submissionGuidelineLabel(2, false, null)).toBe("Guidelines v2");
  });
  it("adds the current version when the result was made under an older one", () => {
    expect(submissionGuidelineLabel(2, false, 3)).toBe("Guidelines v2 (current: v3)");
  });
  it("marks a withdrawn version, also when a newer one is in force", () => {
    expect(submissionGuidelineLabel(2, true, 3)).toBe("Guidelines v2 (withdrawn)");
    expect(submissionGuidelineLabel(2, true, null)).toBe("Guidelines v2 (withdrawn)");
  });
  it("says not recorded without a stamp", () => {
    expect(submissionGuidelineLabel(null, false, 3)).toBe("Guidelines: not recorded");
    expect(submissionGuidelineLabel(undefined, false, null)).toBe("Guidelines: not recorded");
  });
});
