// @vitest-environment node
import { describe, expect, it } from "vitest";
import { annotationTaskName, isReviewLike, modeBadge } from "../src/editor/modes";

describe("editor modes", () => {
  it("treats consolidation and annotation from proposals as review-like", () => {
    expect(isReviewLike("independent")).toBe(false);
    expect(isReviewLike("review")).toBe(true);
    expect(isReviewLike("proposal_check")).toBe(true);
  });

  it("names the editor badges in D2 words", () => {
    expect(modeBadge("review").label).toBe("Consolidate");
    expect(modeBadge("proposal_check").label).toBe("Annotate from proposals");
    expect(modeBadge("independent").label).toBe("Annotate from scratch");
  });

  it("names the annotation task with its mode", () => {
    expect(annotationTaskName("proposals")).toBe("Annotation, from proposals");
    expect(annotationTaskName("scratch")).toBe("Annotation, from scratch");
    expect(annotationTaskName(null)).toBe("Annotation");
  });
});
