import { describe, expect, it } from "vitest";
import { checkExplanation, checkLabel, failedChecksTitle, unknownCheckExplanation, formatReviewDate, languageName, translationStatusLabel } from "../src/translation/labels";

describe("translation review labels", () => {
  it("names known check codes and turns unknown codes into words", () => {
    expect(checkLabel("units_added")).toBe("Units added in translation");
    expect(checkLabel("numbers_changed")).toBe("Numbers changed in translation");
    expect(checkLabel("negation-flip_detected")).toBe("Negation flip detected");
    expect(checkLabel("")).toBe("Unnamed check");
    expect(checkLabel(undefined)).toBe("Unnamed check");
    expect(checkLabel("toString")).toBe("ToString");
  });
  it("explains known check codes and falls back for unknown ones", () => {
    expect(checkExplanation("units_added")).toContain("unit of measurement");
    expect(checkExplanation("numbers_changed")).toContain("numbers in the translation that differ");
    expect(checkExplanation("glossary_miss")).toBe(unknownCheckExplanation);
    expect(checkExplanation("toString")).toBe(unknownCheckExplanation);
  });
  it("counts failed checks in words", () => {
    expect(failedChecksTitle(1)).toBe("1 automatic check failed");
    expect(failedChecksTitle(3)).toBe("3 automatic checks failed");
  });
  it("describes translation statuses without raw values", () => {
    expect(translationStatusLabel("reviewed")).toBe("Reviewed");
    expect(translationStatusLabel("accepted")).toBe("Accepted");
    expect(translationStatusLabel("ready_for_review")).toBe("Ready for review");
    expect(translationStatusLabel("needs_another_look")).toBe("Needs another look");
  });
  it("names languages in English and keeps unknown codes", () => {
    expect(languageName("de")).toBe("German");
    expect(languageName("en")).toBe("English");
    expect(languageName("not a code")).toBe("not a code");
  });
  it("formats review dates in English without seconds", () => {
    expect(formatReviewDate("2026-10-16T12:00:30Z")).toMatch(/^\d{1,2} October 2026 at \d{2}:\d{2}$/);
    expect(formatReviewDate("not a date")).toBe("not a date");
  });
});
