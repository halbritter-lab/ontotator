// @vitest-environment node
import { describe, expect, it } from "vitest";
import { allKeep, changedChoices, languageName, planReport, savedSummary } from "../../src/documents/planSummary";

describe("planSummary", () => {
  it("treats keep as no change and keeps a chosen annotation mode", () => {
    expect(allKeep({})).toBe(true);
    expect(allKeep({ de: { review: "keep", annotate: "keep", annotation_mode: "keep" } })).toBe(true);
    expect(allKeep({ fr: { annotate: "off" } })).toBe(false);
    expect(allKeep({ fr: { annotation_mode: "scratch" } })).toBe(false);
    expect(changedChoices({ de: { review: "keep", annotate: "on", annotation_mode: "proposals" }, fr: { annotate: "keep" } }))
      .toEqual({ de: { annotate: "on", annotation_mode: "proposals" } });
  });

  it("reports changed, locked and no-proposal texts and omits parts with 0", () => {
    expect(planReport("18 texts changed", 2, 1)).toBe("18 texts changed; 2 kept their mode because the annotation has started; 1 have no tool proposals.");
    expect(planReport("20 texts", 0, 3)).toBe("20 texts; 3 have no tool proposals.");
    expect(planReport("1 text changed", 0, 0)).toBe("1 text changed.");
  });

  it("names languages and summarises a quick action for the toast", () => {
    expect(languageName({ key: "source", source_languages: ["en", "fr"] })).toBe("Source (en, fr)");
    expect(languageName({ key: "de", source_languages: [] })).toBe("de");
    expect(savedSummary(20, { de: { review: "on", annotate: "on" }, fr: { review: "keep" } })).toBe("Plan saved for 20 cases, de: translation review and annotation");
    expect(savedSummary(1, { fr: { review: "off", annotate: "on" }, source: { annotate: "off" } })).toBe("Plan saved for 1 case, source: annotate off, fr: annotate, translation review off");
  });
});
