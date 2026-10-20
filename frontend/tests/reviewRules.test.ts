// @vitest-environment node
import { describe, expect, it } from "vitest";
import cases from "../../contracts/translation-review-cases.json";
import { checkReview, textDiffers, type ReviewForm } from "../src/translation/reviewRules";
import { categoryLabels, decisionLabels, issueMessages } from "../src/translation/labels";

const unchanged: ReviewForm = { decision: "accepted_unchanged", clinical_change: false };
const clinical: ReviewForm = { decision: "query", clinical_change: true, categories: ["source"] };

describe("translation review rule parity", () => {
  it.each(cases)("matches the unchanged server vector: $name", vector => {
    const before = JSON.stringify(vector);
    expect(checkReview(vector.form as ReviewForm, vector.machine_text, vector.proposed_text)).toEqual(vector.issues);
    expect(JSON.stringify(vector)).toBe(before);
  });

  // Python str.strip's complete whitespace set, independent of JavaScript trim.
  const pythonWhitespace = [
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
    0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
    0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029,
    0x202f, 0x205f, 0x3000,
  ];
  it.each(pythonWhitespace)("treats Python whitespace U+%s as empty text and rationale", code => {
    const whitespace = String.fromCodePoint(code);
    expect(checkReview(unchanged, "", whitespace)).toEqual(["TEXT_EMPTY", "TEXT_CHANGED"]);
    expect(checkReview({ ...clinical, rationale: whitespace }, "A", "A")).toEqual(["RATIONALE_REQUIRED"]);
    expect(checkReview({ ...clinical, rationale: `${whitespace}reason${whitespace}` }, "A", "A")).toEqual([]);
  });

  it.each(["\u180e", "\u200b", "\ufeff", "\u0000"])("keeps non-Python-whitespace rationale %j significant", rationale => {
    expect(checkReview({ ...clinical, rationale }, "A", "A")).toEqual([]);
  });

  it("removes all leading BOMs but preserves BOMs after whitespace and at the end", () => {
    expect(checkReview(unchanged, "A\nCafé", "\ufeff\ufeffA\r\nCafe\u0301")).toEqual([]);
    expect(checkReview(unchanged, "", " \ufeff")).toEqual(["TEXT_CHANGED"]);
    expect(checkReview(unchanged, "A", "A\ufeff")).toEqual(["TEXT_CHANGED"]);
    expect(checkReview(unchanged, "", "\ufeff\ufeff")).toEqual(["TEXT_EMPTY"]);
  });

  it("does not trim either text for equality or normalize rationale before emptiness", () => {
    expect(checkReview(unchanged, " A", "A")).toEqual(["TEXT_CHANGED"]);
    expect(checkReview({ ...clinical, rationale: "\ufeff" }, "A", "A")).toEqual([]);
    expect(checkReview({ ...clinical, rationale: null }, "A", "A")).toEqual(["RATIONALE_REQUIRED"]);
  });

  it("accumulates ordered issues without sorting, deduplicating or filling the input", () => {
    const form = Object.freeze({
      decision: "accepted_unchanged" as const, clinical_change: true,
      categories: Object.freeze(["value", "source", "value"] as const), rationale: "\u0085\u001f",
    });
    expect(checkReview(form, "A", "")).toEqual(["TEXT_EMPTY", "TEXT_CHANGED", "CLINICAL_CHANGE_NOT_ALLOWED", "RATIONALE_REQUIRED"]);
    expect(form.categories).toEqual(["value", "source", "value"]);
    const defaults = Object.freeze({ decision: "rejected" as const, clinical_change: true });
    expect(checkReview(defaults, "A", "A")).toEqual(["CATEGORY_REQUIRED", "RATIONALE_REQUIRED"]);
    expect(defaults).toEqual({ decision: "rejected", clinical_change: true });
  });
});

describe("translation review English labels", () => {
  it("names every decision and category using the approved wording", () => {
    expect(decisionLabels).toEqual({
      accepted_unchanged: "Accepted unchanged", accepted_corrected: "Accepted with corrections",
      query: "Query", rejected: "Rejected",
    });
    expect(categoryLabels).toEqual({
      omission: "Omission", addition: "Addition", assertion: "Negation or certainty",
      value: "Number or unit", anatomy: "Anatomy or laterality", terminology: "Terminology", source: "Problem in the source",
    });
  });

  it("covers all eight issue codes and preserves the specified rationale message", () => {
    expect(Object.keys(issueMessages).sort()).toEqual([
      "TEXT_EMPTY", "TEXT_CHANGED", "CLINICAL_CHANGE_NOT_ALLOWED", "TEXT_UNCHANGED",
      "CLINICAL_CHANGE_REQUIRED", "CATEGORY_REQUIRED", "RATIONALE_REQUIRED", "CATEGORIES_WITHOUT_CHANGE",
    ].sort());
    expect(issueMessages.RATIONALE_REQUIRED).toBe("A clinical change needs a rationale.");
    for (const message of Object.values(issueMessages)) expect(message).toMatch(/\S/);
  });
});

describe("textDiffers", () => {
  it("textDiffers uses the canonical comparison", () => {
    expect(textDiffers("a\nb", "a\r\nb")).toBe(false);
    expect(textDiffers("a\u00e9", "\ufeffae\u0301")).toBe(false);
    expect(textDiffers("a", "b")).toBe(true);
  });
});
