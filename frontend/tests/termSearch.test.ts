import { describe, expect, it } from "vitest";
import { canPrefill, firstUsableIndex, matchLine, prefillQuery } from "../src/editor/termSearch";

describe("prefillQuery", () => {
  it("joins segments with a space and collapses whitespace", () => {
    const text = "Der Patient hat\n  Krampfanfälle und Fieber.";
    expect(prefillQuery(text, [{ start: 0, end: 3 }, { start: 18, end: 31 }])).toBe("Der Krampfanfälle");
  });
  it("cuts at 80 codepoints on a word boundary", () => {
    const text = `${"wort ".repeat(30)}`;
    const value = prefillQuery(text, [{ start: 0, end: text.length }]);
    expect(Array.from(value).length).toBeLessThanOrEqual(80);
    expect(value.endsWith("wort")).toBe(true);
  });
  it("counts codepoints, not UTF-16 units", () => {
    expect(prefillQuery("😀 seizure", [{ start: 2, end: 9 }])).toBe("seizure");
  });
});
describe("canPrefill", () => {
  it("prefills English and active search languages only", () => {
    expect(canPrefill("en", undefined)).toBe(true);
    expect(canPrefill("en-GB", [])).toBe(true);
    expect(canPrefill("de", ["de"])).toBe(true);
    expect(canPrefill("de", undefined)).toBe(false);
    expect(canPrefill("fr", ["de"])).toBe(false);
  });
});
describe("matchLine (spec B.6)", () => {
  const hit = (match_kind: string, matched_term = "Absence seizure", match_language: string | null = null) =>
    ({ label: "Seizure", matched_term, match_kind, match_language });
  it.each([
    ["label", null],
    ["hasExactSynonym", "Matched synonym “Absence seizure”"],
    ["prefix:hasExactSynonym", "Matched the start of “Absence seizure”"],
    ["ngram", "Similar wording “Absence seizure”"],
    ["id", "Matched the code"],
    ["child", "Matched “Absence seizure”"],
  ])("%s", (kind, expected) => { expect(matchLine(hit(kind))).toBe(expected); });
  it("names the language for translated matches", () => {
    expect(matchLine(hit("ngram:de", "Krampfanfall", "de"))).toBe("Matched German name “Krampfanfall”");
    expect(matchLine(hit("translation", "Krampfanfall", "de"))).toBe("Matched German name “Krampfanfall”");
  });
  it("returns null when the match equals the label", () => { expect(matchLine(hit("hasExactSynonym", "Seizure"))).toBeNull(); });
});
it("firstUsableIndex skips obsolete hits", () => {
  expect(firstUsableIndex([{ obsolete: true }, { obsolete: false }] as never, true)).toBe(1);
  expect(firstUsableIndex([{ obsolete: false }] as never, false)).toBe(-1);
});
