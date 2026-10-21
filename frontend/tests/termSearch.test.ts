// @vitest-environment node
import { describe, expect, it } from "vitest";
import { firstUsableIndex, matchLine, NO_PREFILL_HINT, prefillHint, prefillQuery } from "../src/editor/termSearch";

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
describe("prefillHint", () => {
  it("says nothing for English and for active search languages", () => {
    expect(prefillHint("en", undefined)).toBeNull();
    expect(prefillHint("en-GB", [])).toBeNull();
    expect(prefillHint("de", ["de"])).toBeNull();
    expect(prefillHint("de-AT", ["de"])).toBeNull();
  });
  it("explains English-only search for languages that are not searched", () => {
    expect(NO_PREFILL_HINT).toBe("Names are searched in English. Type an English name or a code.");
    expect(prefillHint("de", undefined)).toBe(NO_PREFILL_HINT);
    expect(prefillHint("fr", ["de"])).toBe(NO_PREFILL_HINT);
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
