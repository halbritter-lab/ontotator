import { describe, expect, it } from "vitest";
import { adjacentCase } from "../src/app/caseOrder";

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
