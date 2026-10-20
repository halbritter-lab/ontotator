// @vitest-environment node
import { describe, expect, it } from "vitest";
import { adjacentCase, sharedIdPrefix } from "../src/app/caseOrder";

describe("sharedIdPrefix", () => {
  it("cuts the shared prefix back to a separator", () => {
    expect(sharedIdPrefix(["e3c:v2.0.0:en:EN100075:native", "e3c:v2.0.0:es:ES100050:native"])).toBe("e3c:v2.0.0:");
  });

  it("ignores short shared prefixes and single IDs", () => {
    expect(sharedIdPrefix(["doc-alpha", "doc-beta"])).toBe("");
    expect(sharedIdPrefix(["e3c:v2.0.0:en:EN100075:native"])).toBe("");
  });

  it("never hides an entire ID", () => {
    expect(sharedIdPrefix(["case:2026:", "case:2026:de"])).toBe("");
    expect(sharedIdPrefix(["e3c:v2.0.0:en:EN100075:native", "e3c:v2.0.0:en:EN100075:native:review-tllm-de"]))
      .toBe("e3c:v2.0.0:en:EN100075:");
  });
});

describe("adjacentCase", () => {
  const doc = (document_id: string, has_review_inputs?: boolean | null) =>
    ({ document_id, language: "en", text_length: 1, position: 1, status: "not_started" as const, has_review_inputs });

  it("treats documents without the review flag as openable", () => {
    expect(adjacentCase([doc("a"), doc("b")], "a", 1)?.document_id).toBe("b");
  });

  it("returns null for an unknown current case", () => {
    expect(adjacentCase([doc("a"), doc("b")], "x", 1)).toBeNull();
  });
});
