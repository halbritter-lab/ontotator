import { describe, expect, it } from "vitest";
import { allKeep, describePlanChange, languageName, savedSummary } from "../../src/documents/planSummary";

const languages = [
  { key: "source", source_languages: ["en"], cases_in_selection: 20 },
  { key: "de", source_languages: [], cases_in_selection: 20 },
  { key: "fr", source_languages: [], cases_in_selection: 18 },
];

describe("planSummary", () => {
  it("describes review then annotate with the rule on", () => {
    expect(describePlanChange({ choices: { de: { review: "on", annotate: "on" } }, languages, toAssign: { translation_review: 20, annotate: 20 }, ruleOn: true }))
      .toBe("de in 20 cases → review, then annotate after the review is accepted. Nothing else changes. 20 translation reviews and 20 annotations become \"to assign\".");
  });

  it("describes parallel work with the rule off", () => {
    expect(describePlanChange({ choices: { de: { review: "on", annotate: "on" } }, languages, toAssign: {}, ruleOn: false }))
      .toBe("de in 20 cases → review and annotate in parallel. Nothing else changes.");
  });

  it("returns Nothing to change yet. while every cell is keep", () => {
    expect(describePlanChange({ choices: { de: { review: "keep", annotate: "keep" } }, languages, toAssign: {}, ruleOn: true })).toBe("Nothing to change yet.");
    expect(allKeep({})).toBe(true);
    expect(allKeep({ fr: { annotate: "off" } })).toBe(false);
  });

  it("describes single flags, the source and turning off, with singular counts", () => {
    expect(describePlanChange({ choices: { source: { annotate: "on" }, fr: { review: "off", annotate: "off" } }, languages, toAssign: { annotate: 1 }, ruleOn: true }))
      .toBe("Source (en) in 20 cases → annotate. fr in 18 cases → not in plan. Nothing else changes. 1 annotation becomes \"to assign\".");
    expect(describePlanChange({ choices: { de: { review: "on" }, fr: { annotate: "off" } }, languages: languages.slice(1), toAssign: {}, ruleOn: true }))
      .toBe("de in 20 cases → review. fr in 18 cases → annotate off.");
  });

  it("names languages and summarises a save for the toast", () => {
    expect(languageName({ key: "source", source_languages: ["en", "fr"] })).toBe("Source (en, fr)");
    expect(languageName({ key: "de", source_languages: [] })).toBe("de");
    expect(savedSummary(20, { de: { review: "on", annotate: "on" }, fr: { review: "keep" } })).toBe("Plan saved for 20 cases · de: review + annotate");
    expect(savedSummary(1, { fr: { review: "off", annotate: "on" }, source: { annotate: "off" } })).toBe("Plan saved for 1 case · source: annotate off · fr: annotate, review off");
  });
});
