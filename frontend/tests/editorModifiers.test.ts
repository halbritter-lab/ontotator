// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  attachCandidates,
  chipText,
  COHORT_TAG,
  exclusiveWarnings,
  findingDescription,
  modifierDisplayId,
  modifierMarks,
  MODIFIER_ROOTS,
  parseModifierDisplayId,
  sentenceBounds,
  sortByLabel,
  type AttachFinding,
  type TermInfo,
} from "../src/editor/modifiers";

const TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie.";
const seg = (word: string, text = TEXT) => {
  const start = Array.from(text.slice(0, text.indexOf(word))).length;
  return { start, end: start + Array.from(word).length };
};

const INFO: Record<string, TermInfo> = {
  "HP:0012828": { label: "Severe", role: "modifier", exclusiveClass: "severity" },
  "HP:0012825": { label: "Mild", role: "modifier", exclusiveClass: "severity" },
  "HP:0031796": { label: "Recurrent", role: "modifier", exclusiveClass: null },
  "HP:0003623": { label: "Neonatal onset", role: "modifier", exclusiveClass: "onset" },
  "HP:0003593": { label: "infantile onset", role: "modifier", exclusiveClass: "onset" },
  "HP:0040282": { label: "Frequent", role: "cohort", exclusiveClass: null },
};
const info = (termId: string) => INFO[termId];
const slice = (text: string, [start, end]: [number, number]) => Array.from(text).slice(start, end).join("");

describe("sentenceBounds", () => {
  const text = "First one. Second one here! Third? Last";
  it("finds the sentence around an offset in the middle", () => {
    expect(slice(text, sentenceBounds(text, text.indexOf("one here")))).toBe(" Second one here!");
  });
  it("covers the first and the last sentence", () => {
    expect(slice(text, sentenceBounds(text, 0))).toBe("First one.");
    expect(slice(text, sentenceBounds(text, text.length))).toBe(" Last");
    expect(slice(text, sentenceBounds(text, text.indexOf("Third")))).toBe(" Third?");
  });
  it("ends a sentence at ! and ?", () => {
    expect(sentenceBounds(text, text.indexOf("here"))[1]).toBe(text.indexOf("!") + 1);
    expect(sentenceBounds(text, text.indexOf("Third"))[1]).toBe(text.indexOf("?") + 1);
  });
  it("limitation: an abbreviation like 'Dr. med.' is a boundary when whitespace follows", () => {
    const abbrev = "Laut Dr. med. Weber schwere Anfälle.";
    expect(slice(abbrev, sentenceBounds(abbrev, abbrev.indexOf("schwere")))).toBe(" Weber schwere Anfälle.");
    const noSpace = "Wert 3.5 mg schwere Anfälle.";
    expect(slice(noSpace, sentenceBounds(noSpace, noSpace.indexOf("schwere")))).toBe(noSpace);
  });
  it("breaks at line breaks", () => {
    const lines = "Befund\nschwere Anfälle\r\nweiter";
    expect(slice(lines, sentenceBounds(lines, lines.indexOf("Anfälle")))).toBe("schwere Anfälle");
  });
  it("counts code points, so an emoji before the offset does not shift the bounds", () => {
    const emoji = "Gut \u{1f600}. Dann schwere Anfälle.";
    const offset = Array.from(emoji).indexOf("D");
    expect(sentenceBounds(emoji, offset)).toEqual([6, Array.from(emoji).length]);
  });
});

describe("attachCandidates", () => {
  const finding = (annotationId: string, term: string, words: string[], text = TEXT): AttachFinding => ({
    annotationId, term, termId: `HP:${annotationId}`, segments: words.map((w) => seg(w, text)), quote: words.join(" "),
  });
  it("keeps only findings in the mark's sentence, nearest first", () => {
    const text = "Muskelhypotonie seit Jahren. Seit 2 Wochen schwere Krampfanfälle und eine Ataxie.";
    const result = attachCandidates(text, seg("schwere", text), [
      finding("hyp", "Hypotonia", ["Muskelhypotonie"], text),
      finding("atx", "Ataxia", ["Ataxie"], text),
      finding("sz", "Seizure", ["Krampfanfälle"], text),
    ]);
    expect(result.map((c) => [c.annotationId, c.distance, c.after])).toEqual([["sz", 1, true], ["atx", 24, true]]);
  });
  it("on a tie prefers the finding after the mark", () => {
    const result = attachCandidates(TEXT, seg("schwere"), [
      finding("rec", "Wiederholung", ["wiederholt"]),
      finding("sz", "Seizure", ["Krampfanfälle"]),
    ]);
    expect(result.map((c) => c.annotationId)).toEqual(["sz", "rec"]);
    expect(result.map((c) => c.distance)).toEqual([1, 1]);
  });
  it("gives an overlapping segment distance 0", () => {
    const [candidate] = attachCandidates(TEXT, seg("schwere"), [finding("sz", "Seizure", ["schwere Krampfanfälle"])]);
    expect(candidate.distance).toBe(0);
  });
  it("leaves spanless findings out", () => {
    expect(attachCandidates(TEXT, seg("schwere"), [{ ...finding("sz", "Seizure", []), segments: [] }])).toEqual([]);
  });
});

describe("labels", () => {
  it("chipText", () => {
    expect(chipText("Severe", "schwere", "modifier")).toBe("Severe · “schwere”");
    expect(chipText("Recurrent", null, "modifier")).toBe("Recurrent");
    expect(chipText("Frequent", "oft", "cohort")).toBe(`Frequent · “oft” · ${COHORT_TAG}`);
    expect(COHORT_TAG).toBe("Cohort term");
  });
  it("exclusiveWarnings", () => {
    expect(exclusiveWarnings([{ term_id: "HP:0012828" }, { term_id: "HP:0012825" }], info)).toEqual(["Two severities"]);
    expect(exclusiveWarnings(["HP:0003623", "HP:0012828", "HP:0003593", "HP:0012825"].map((term_id) => ({ term_id })), info))
      .toEqual(["Two severities", "Two onsets"]);
    expect(exclusiveWarnings([{ term_id: "HP:0012828" }, { term_id: "HP:0031796" }, { term_id: "HP:unknown" }], info)).toEqual([]);
  });
  it("sortByLabel orders case-insensitively by label", () => {
    const sorted = sortByLabel(["HP:0012828", "HP:0003593", "HP:0031796", "HP:0012825"].map((term_id) => ({ term_id })), info);
    expect(sorted.map((m) => info(m.term_id).label)).toEqual(["infantile onset", "Mild", "Recurrent", "Severe"]);
  });
  it("modifier display ids round-trip, also with ':' in the term id", () => {
    const id = modifierDisplayId("ann-1", "HP:0012828");
    expect(id).toBe("mod:ann-1:HP:0012828");
    expect(parseModifierDisplayId(id)).toEqual({ annotationId: "ann-1", termId: "HP:0012828" });
    expect(parseModifierDisplayId("ev-1")).toBeNull();
    expect(parseModifierDisplayId("mod:ann-1")).toBeNull();
    expect(MODIFIER_ROOTS).toEqual(["HP:0012823", "HP:0040279"]);
  });
});

describe("modifierMarks and findingDescription", () => {
  const seizure = {
    annotationId: "ann-1", term: "Seizure", termId: "HP:0001250", colorIndex: 4,
    modifiers: [{ term_id: "HP:0012828", segments: [seg("schwere")] }, { term_id: "HP:0031796" }],
  };
  it("marks modifier segments in the finding's slot; spanless modifiers have no mark", () => {
    expect(modifierMarks([seizure], TEXT, info)).toEqual([{
      evidence_id: "mod:ann-1:HP:0012828", segments: [seg("schwere")], kind: "modifier", colorIndex: 4,
      label: "Severe, modifier of Seizure",
    }]);
  });
  it("describes a finding with its modifiers", () => {
    const withRecurrentText = { ...seizure.modifiers[1], segments: [] };
    expect(findingDescription("Seizure", [seizure.modifiers[1], seizure.modifiers[0]], TEXT, info))
      .toBe("Seizure, modifiers: Recurrent, Severe (“schwere”)");
    expect(findingDescription("Seizure", [withRecurrentText], TEXT, info)).toBe("Seizure, modifiers: Recurrent");
    expect(findingDescription("Seizure", [], TEXT, info)).toBeNull();
  });
});
