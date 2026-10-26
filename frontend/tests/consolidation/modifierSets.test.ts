// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  chosenModifiers,
  crossLinks,
  modifierChoices,
  modifierKey,
  modifierText,
  NO_MODIFIERS,
  otherTextChosen,
  press,
  setText,
  setWarnings,
  toggleName,
  type MemberSet,
  type ModifierView,
} from "../../src/consolidation/modifierSets";

const TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie.";
const span = (word: string): [number, number] => {
  const start = TEXT.indexOf(word);
  return [start, start + word.length];
};
const mod = (term_id: string, term_label: string, segments: [number, number][] = [], extra: Partial<ModifierView> = {}): ModifierView => ({
  term_id, term_label, kind: "modifier", exclusive_class: null, segments, ...extra,
});
const SEVERE = mod("HP:0012828", "Severe", [span("schwere")], { exclusive_class: "severity" });
const SEVERE_NO_TEXT = mod("HP:0012828", "Severe", [], { exclusive_class: "severity" });
const SEVERE_WIDE = { ...SEVERE, segments: [[TEXT.indexOf("schwere") - 1, TEXT.indexOf("schwere") + 7]] as [number, number][] };
const MILD = mod("HP:0012825", "Mild", [], { exclusive_class: "severity" });
const RECURRENT = mod("HP:0031796", "Recurrent", [span("wiederholt")]);
const RECURRENT_NO_TEXT = mod("HP:0031796", "Recurrent");
const FREQUENT = mod("HP:0040282", "Frequent", [], { kind: "cohort" });

const ana = (...modifiers: ModifierView[]): MemberSet => ({ inputId: "in-a", personId: "a", personName: "Ana Weber", modifiers });
const ben = (...modifiers: ModifierView[]): MemberSet => ({ inputId: "in-b", personId: "b", personName: "Ben Roth", modifiers });
const cem = (...modifiers: ModifierView[]): MemberSet => ({ inputId: "in-c", personId: "c", personName: "Cem Arslan", modifiers });
const none = new Set<string>();

describe("modifierChoices and the selection rule", () => {
  it("S3: one toggle per distinct modifier, pressed once for both cells", () => {
    const choices = modifierChoices([ana(SEVERE_NO_TEXT), ben(SEVERE_NO_TEXT, RECURRENT_NO_TEXT)]);
    expect(choices.toggles.map((t) => [t.modifier.term_label, t.personIds])).toEqual([["Recurrent", ["b"]], ["Severe", ["a", "b"]]]);
    expect(choices.none).toBeNull();
    const severe = modifierKey(SEVERE_NO_TEXT);
    expect([...press(none, severe, choices)]).toEqual([severe]);
  });

  it("S4: two disjoint modifiers chosen together, in label order", () => {
    const choices = modifierChoices([ana(SEVERE), ben(RECURRENT)]);
    const selection = press(press(none, modifierKey(RECURRENT), choices), modifierKey(SEVERE), choices);
    expect(chosenModifiers(selection, choices)).toEqual([RECURRENT, SEVERE]);
    expect(setText(chosenModifiers(selection, choices)!, TEXT)).toBe("Recurrent “wiederholt”, Severe “schwere”");
  });

  it("S5: No modifiers excludes every modifier and the reverse", () => {
    const choices = modifierChoices([ana(), ben(SEVERE)]);
    expect(choices.none).toEqual({ personIds: ["a"], majority: null });
    const severe = press(none, modifierKey(SEVERE), choices);
    const noMods = press(severe, NO_MODIFIERS, choices);
    expect([...noMods]).toEqual([NO_MODIFIERS]);
    expect(chosenModifiers(noMods, choices)).toEqual([]);
    expect([...press(noMods, modifierKey(SEVERE), choices)]).toEqual([modifierKey(SEVERE)]);
  });

  it("S6: with and without text are exclusive variants", () => {
    const choices = modifierChoices([ana(SEVERE), ben(SEVERE_NO_TEXT)]);
    expect(choices.toggles).toHaveLength(2);
    expect(modifierText(SEVERE_NO_TEXT, TEXT, new Set(["HP:0012828"]))).toBe("Severe (no text)");
    expect(modifierText(SEVERE_NO_TEXT, TEXT)).toBe("Severe");
    const first = press(none, modifierKey(SEVERE), choices);
    const second = press(first, modifierKey(SEVERE_NO_TEXT), choices);
    expect([...second]).toEqual([modifierKey(SEVERE_NO_TEXT)]);
    expect([...otherTextChosen(second, choices)]).toEqual([modifierKey(SEVERE)]);
    expect([...otherTextChosen(none, choices)]).toEqual([]);
  });

  it("S7 and S20: variants that differ by segments only", () => {
    const longer: ModifierView = { ...SEVERE, segments: [[SEVERE.segments[0][0], SEVERE.segments[0][1] + 1]] };
    for (const other of [SEVERE_WIDE, longer]) {
      const choices = modifierChoices([ana(SEVERE), ben(other)]);
      expect(choices.toggles.map((t) => t.personIds).sort()).toEqual([["a"], ["b"]]);
      const selection = press(press(none, modifierKey(SEVERE), choices), modifierKey(other), choices);
      expect(chosenModifiers(selection, choices)).toEqual([other]);
    }
    expect(modifierText(longer, TEXT)).toBe("Severe “schwere ”");
  });

  it("S8: never two Severe; pressing Ben's Severe keeps Recurrent", () => {
    const choices = modifierChoices([ana(SEVERE), ben(SEVERE_WIDE, RECURRENT)]);
    let selection = press(none, modifierKey(SEVERE), choices);
    selection = press(selection, modifierKey(RECURRENT), choices);
    selection = press(selection, modifierKey(SEVERE_WIDE), choices);
    expect(chosenModifiers(selection, choices)).toEqual([RECURRENT, SEVERE_WIDE]);
    expect(modifierText(SEVERE_WIDE, TEXT)).toBe("Severe “ schwere”");
  });

  it("the quote is left out when it repeats the label", () => {
    const text = "Recurrent seizures, recurrent  fever.";
    expect(modifierText(mod("HP:0031796", "Recurrent", [[0, 9]]), text)).toBe("Recurrent");
    expect(modifierText(mod("HP:0031796", "Recurrent", [[20, 29]]), text)).toBe("Recurrent");
    expect(modifierText(mod("HP:0031796", "Recurrent", [[19, 29]]), text)).toBe("Recurrent “ recurrent”");
  });

  it("nothing pressed is no choice; pressing a pressed id releases it", () => {
    const choices = modifierChoices([ana(SEVERE), ben()]);
    expect(chosenModifiers(none, choices)).toBeNull();
    const pressed = press(none, modifierKey(SEVERE), choices);
    expect(chosenModifiers(press(pressed, modifierKey(SEVERE), choices), choices)).toBeNull();
    expect(chosenModifiers(press(press(none, NO_MODIFIERS, choices), NO_MODIFIERS, choices), choices)).toBeNull();
  });

  it("S12 and S16: Mild with Severe warns of two severities", () => {
    expect(setWarnings([MILD, SEVERE])).toEqual(["Two severities"]);
    const onset = mod("HP:0003623", "Neonatal onset", [], { exclusive_class: "onset" });
    expect(setWarnings([onset, { ...onset, term_id: "HP:0003593" }, MILD, SEVERE])).toEqual(["Two severities", "Two onsets"]);
    expect(setWarnings([SEVERE, RECURRENT])).toEqual([]);
  });

  it("S15: (2 of 3) for a modifier held by more than half of at least three members; no preselection", () => {
    const choices = modifierChoices([ana(SEVERE_NO_TEXT), ben(SEVERE_NO_TEXT), cem()]);
    expect(choices.toggles.map((t) => t.majority)).toEqual(["(2 of 3)"]);
    expect(choices.none).toEqual({ personIds: ["c"], majority: null });
    expect(Object.keys(choices)).toEqual(["toggles", "none"]);
    expect(modifierChoices([ana(SEVERE), ben(SEVERE)]).toggles[0].majority).toBeNull();
    expect(modifierChoices([ana(), ben(), cem(SEVERE)]).none?.majority).toBe("(2 of 3)");
    expect(modifierChoices([ana(SEVERE), ben(SEVERE, RECURRENT), cem(MILD)]).toggles.map((t) => [t.modifier.term_label, t.majority]))
      .toEqual([["Mild", null], ["Recurrent", null], ["Severe", "(2 of 3)"]]);
  });

  it("S17: a cohort term keeps its kind", () => {
    const choices = modifierChoices([ana(FREQUENT), ben(RECURRENT_NO_TEXT)]);
    expect(choices.toggles.find((t) => t.modifier.term_id === "HP:0040282")?.modifier.kind).toBe("cohort");
  });
});

describe("names and cross links", () => {
  it("toggleName has no middle dot", () => {
    expect(toggleName("Severe “schwere”", "Ana Weber", "(2 of 3)")).toBe("Take Severe “schwere” from Ana Weber for Modifiers (2 of 3)");
    expect(toggleName("No modifiers", "Cem Arslan", null)).toBe("Take No modifiers from Cem Arslan for Modifiers");
    expect(toggleName("Severe", "Ana Weber", "(2 of 3)")).not.toContain("·");
  });

  it("S9: names the other group a person linked the same modifier text to, both ways", () => {
    const groups = [
      { groupId: "g-seizure", members: [{ ...ana(SEVERE), termLabel: "Seizure" }, { ...ben(), termLabel: "Seizure" }] },
      { groupId: "g-hypotonia", members: [{ ...ana(), termLabel: "Hypotonia" }, { ...ben(SEVERE), termLabel: "Hypotonia" }] },
    ];
    expect(crossLinks("g-seizure", groups, TEXT)).toEqual([
      { personId: "b", personName: "Ben Roth", termLabel: "Severe", quote: "schwere", groupId: "g-hypotonia", findingLabel: "Hypotonia" },
    ]);
    expect(crossLinks("g-hypotonia", groups, TEXT)).toEqual([
      { personId: "a", personName: "Ana Weber", termLabel: "Severe", quote: "schwere", groupId: "g-seizure", findingLabel: "Seizure" },
    ]);
    const spanless = groups.map((g) => ({ ...g, members: g.members.map((m) => ({ ...m, modifiers: m.modifiers.map(() => SEVERE_NO_TEXT) })) }));
    expect(crossLinks("g-seizure", spanless, TEXT)).toEqual([]);
  });
});
