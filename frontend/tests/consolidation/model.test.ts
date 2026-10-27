import { describe, expect, it } from "vitest";
import { duplicatesText, fieldsToDecide, finalizationState, groupStatus, headerTitle, partialText, readOnlyText, submittedText, summaryText } from "../../src/consolidation/consolidationText";
import type { ConsolidationGroupView } from "../../src/api/client";
import { attachCandidates, choicesComplete, choose, comparisonRows, duplicateTerms, groupName, resolvePayload, resultLine, sameTermGroups, standaloneText, takeFinding, type Choices } from "../../src/consolidation/groupModel";
import { NO_MODIFIERS } from "../../src/consolidation/modifierSets";
import { textOrder } from "../../src/consolidation/GroupList";
import { ANA, BEN, CEM, decidedView, exampleGroups, exampleView, group, hypotoniaThree, LUC, member, mild, MOD_PEOPLE, MOD_TEXT, modSpan, recurrent, seizure, severe, span, TEXT, THREE, TOM } from "./fixtures";

describe("consolidation copy", () => {
  it("summarises groups, findings and not in result before submitting (M-7f)", () => {
    const view = decidedView();
    expect(summaryText(view.groups)).toBe("8 groups, 7 findings, 1 not in result");
    expect(summaryText(view.groups, 1)).toBe("8 groups, 8 findings, 1 not in result");
  });

  it("titles the view without separators", () => {
    expect(headerTitle(exampleView())).toBe("Consolidate case-107 de v2");
    expect(headerTitle(exampleView(), true)).toBe("Consolidation of case-107 de v2");
  });

  it("names who marked a partial finding and who has nothing there", () => {
    expect(partialText([LUC, ANA], [TOM])).toBe("Luc Martin, Ana Weber marked this. Tom Reis has nothing here.");
  });

  it("states a group as fields to decide, agreed or decided", () => {
    expect(fieldsToDecide(1)).toBe("1 field to decide");
    expect(groupStatus({ state: "open" }, 0)).toBe("to decide");
    expect(groupStatus({ state: "open" }, 2)).toBe("2 fields to decide");
    expect(groupStatus({ state: "auto" }, 0)).toBe("agreed");
    expect(groupStatus({ state: "choose" }, 2)).toBe("decided");
  });

  it("says who accepts the result after submitting", () => {
    expect(submittedText(true)).toBe("Consolidation submitted. Accept the result in Documents.");
    expect(submittedText(false)).toBe("Consolidation submitted. The lead then accepts the result.");
  });

  it("words the read-only banner by state: accepted, submitted for the lead or the consolidator, else the reason", () => {
    const submitted = { read_only_reason: "submitted" as const, accepted_at: null, consolidator: "Carla Consolidator (ann-0006)" };
    expect(readOnlyText(submitted, true)).toBe("Submitted by Carla Consolidator. Read-only; accept it in Documents.");
    expect(readOnlyText({ ...submitted, consolidator: null }, true)).toBe("Submitted by the consolidator. Read-only; accept it in Documents.");
    expect(readOnlyText(submitted, false)).toBe("Submitted. Waiting for the lead.");
    expect(readOnlyText({ ...submitted, accepted_at: "2026-10-27T10:00:00" }, false)).toBe("Accepted by the lead on 27 Oct. Read-only.");
    expect(readOnlyText({ read_only_reason: "not_assigned", accepted_at: null, consolidator: null }, false)).toBe("This consolidation is no longer assigned to you. It is read-only.");
  });

  it("names terms kept twice before submitting, nothing otherwise (R-3)", () => {
    expect(duplicatesText([])).toBeNull();
    expect(duplicatesText(["Fatigue"])).toBe("More than one finding with the same term: Fatigue.");
  });

  it("derives the Finalization step from round and final state, not the open groups (X-8)", () => {
    expect(finalizationState(2, 5, false)).toEqual({ state: "consolidating, 2 of 5 groups open", tone: "now" });
    expect(finalizationState(0, 5, true)).toEqual({ state: "submitted, waiting for the lead", tone: "later" });
    expect(finalizationState(0, 5, true, null, true)).toEqual({ state: "ready to accept", tone: "now" });
    expect(finalizationState(0, 5, true, "2026-10-27T10:00:00", true)).toEqual({ state: "accepted 27 Oct", tone: "done" });
  });
});

const rowOf = (rows: ReturnType<typeof comparisonRows>, id: string) => rows.find(row => row.id === id)!;

describe("comparison model", () => {
  it("comparison rows mark term and assertion as conflicts and the rest as agreed", () => {
    const rows = comparisonRows(hypotoniaThree(), THREE, TEXT, {});
    expect(rows.map(row => row.id)).toEqual(["term", "assertion", "experiencer", "temporality", "text", "whole"]);
    expect(rowOf(rows, "term").conflict).toBe(true);
    expect(rowOf(rows, "assertion").conflict).toBe(true);
    expect(rowOf(rows, "experiencer")).toMatchObject({ conflict: false, agreed: "Patient (all agree)", label: "Experiencer" });
    expect(rowOf(rows, "temporality").agreed).toBe("Current (all agree)");
    expect(rowOf(rows, "term").cells.map(cell => cell.display)).toEqual(["Hypotonia", "Hypotonia", "Axial hypotonia"]);
  });

  it("text is information unless spans conflict", () => {
    const text = rowOf(comparisonRows(hypotoniaThree(), THREE, TEXT, {}), "text");
    expect(text).toMatchObject({ conflict: false, agreed: null, info: "(overlapping, comes with the chosen finding)" });
    const conflicting = rowOf(comparisonRows(hypotoniaThree({ span_conflict: true }, { ali: { spans: [span("hypotonia")] } }), THREE, TEXT, {}), "text");
    expect(conflicting.conflict).toBe(true);
    expect(conflicting.cells).toHaveLength(3);
  });

  it("a one-person group reads the text without the overlap suffix, spanless too (R-9)", () => {
    const spanless = group("g-fatigue", ["partial"], [member("in-f", BEN, "HP:0012378", "Fatigue", [], { note: "Says tired." })]);
    expect(rowOf(comparisonRows(spanless, [BEN], TEXT, {}), "text")).toMatchObject({ info: null, agreed: "No text span" });
    const single = group("g-hypo1", ["partial"], [member("in-h", BEN, "HP:0001252", "Hypotonia", [span("hypotonia")])]);
    expect(rowOf(comparisonRows(single, [BEN], TEXT, {}), "text")).toMatchObject({ info: null, agreed: "“hypotonia”" });
  });

  it("notes never block", () => {
    const rows = comparisonRows(hypotoniaThree({}, { tom: { note: "Mild." }, mia: { note: "Negated." } }), THREE, TEXT, {});
    expect(rowOf(rows, "note")).toMatchObject({ conflict: false, agreed: null });
    expect(rowOf(rows, "note").cells.map(cell => cell.display)).toEqual(["Mild.", "Negated.", ""]);
  });

  it("result line names the open choices", () => {
    const group = hypotoniaThree();
    expect(resultLine(group, THREE, TEXT, {})).toMatchObject({
      saved: "Result: 1 finding, Hypotonia (HP:0001252), Assertion not chosen yet, Patient, Current",
      notTaken: "Not taken: Axial hypotonia (Ali)",
    });
    expect(resultLine(group, THREE, TEXT, { assertion: "absent" }).saved).toBe("Result: 1 finding, Hypotonia (HP:0001252), Absent, Patient, Current");
  });

  it("taking a whole finding fills every row", () => {
    const group = hypotoniaThree();
    const choices = takeFinding(group, group.members[2]);
    const rows = comparisonRows(group, THREE, TEXT, choices);
    expect(rowOf(rows, "whole").cells.map(cell => cell.display)).toEqual(["Take Tom's finding", "Take Mia's finding", "Take Ali's finding"]);
    expect(rowOf(rows, "whole").cells[2].chosen).toBe(true);
    expect(rowOf(rows, "term").cells.map(cell => cell.chosen)).toEqual([false, false, true]);
    expect(resultLine(group, THREE, TEXT, choices)).toMatchObject({
      finding: "Axial hypotonia (HP:0008936), Present, Patient, Current",
      saved: "Result: 1 finding, Axial hypotonia (HP:0008936), Present, Patient, Current",
      notTaken: "Not taken: Hypotonia (Tom, Mia)",
    });
  });

  it("payload is keep when everyone agrees and choose otherwise", () => {
    const agreed = exampleGroups().find(value => value.group_id === "g-seiz")!;
    expect(resolvePayload(agreed, {})).toEqual({ action: "keep" });
    const group = hypotoniaThree();
    expect(resolvePayload(group, { term: "HP:0001252", assertion: "absent" })).toEqual({
      action: "choose", choice: { term_id: "HP:0001252", axes: { assertion: "absent" }, span_from_input_id: "in-tom" },
    });
    expect(resolvePayload(group, takeFinding(group, group.members[2])).choice?.span_from_input_id).toBe("in-ali");
    expect(choicesComplete(comparisonRows(group, THREE, TEXT, { term: "HP:0001252" }), { term: "HP:0001252" })).toBe(false);
    expect(choicesComplete(comparisonRows(group, THREE, TEXT, {}), { term: "HP:0008936", assertion: "present" })).toBe(true);
  });

  it("an other term replaces the members' terms in the result and the payload", () => {
    const group = hypotoniaThree();
    const choices = { term: "HP:0002066", assertion: "present" };
    expect(resultLine(group, THREE, TEXT, choices, { termId: "HP:0002066", label: "Gait ataxia" })).toMatchObject({
      saved: "Result: 1 finding, Gait ataxia (HP:0002066), Present, Patient, Current",
      notTaken: "Not taken: Hypotonia (Tom, Mia), Axial hypotonia (Ali)",
    });
    expect(resolvePayload(group, choices).choice).toEqual({ term_id: "HP:0002066", span_from_input_id: "in-tom", axes: { assertion: "present" } });
  });

  it("an axis a person left empty is sent as null", () => {
    const group = hypotoniaThree({ differing_axes: ["assertion", "temporality"] }, { ali: { axes: { assertion: "present", experiencer: "patient" } } });
    const choices = takeFinding(group, group.members[2]);
    expect(rowOf(comparisonRows(group, THREE, TEXT, choices), "temporality").cells[2].display).toBe("Not specified");
    expect(resolvePayload(group, choices).choice?.axes).toEqual({ assertion: "present", temporality: null });
  });

  it("taking a finding in a group without conflicts chooses that person's finding", () => {
    const agreed = exampleGroups().find(value => value.group_id === "g-dd")!;
    expect(resolvePayload(agreed, takeFinding(agreed, agreed.members[1]))).toEqual({
      action: "choose", choice: { term_id: "HP:0001263", span_from_input_id: "in-dt", axes: {} },
    });
  });

  it("the text row is keyed by person: identical spans with different notes are separate choices", () => {
    const group = hypotoniaThree({ span_conflict: true }, { tom: { note: "Mild." }, mia: { note: "Negated." }, ali: { spans: [span("hypotonia")] } });
    const rows = comparisonRows(group, THREE, TEXT, { text: "in-mia" });
    expect(rowOf(rows, "text").cells.map(cell => cell.chosen)).toEqual([false, true, false]);
    expect(resolvePayload(group, { term: "HP:0001252", assertion: "absent", text: "in-mia" }).choice?.span_from_input_id).toBe("in-mia");
  });

  it("names the group by its text excerpt", () => {
    expect(groupName(hypotoniaThree(), TEXT)).toBe("muscular hypotonia");
  });

  it("names a spanless group by its term, marked as without a text span (R-3)", () => {
    const spanless = group("g-f", ["partial"], [member("in-f", BEN, "HP:0012378", "Fatigue", [])]);
    expect(groupName(spanless, TEXT)).toBe("Fatigue (no text span)");
  });

  it("finds other decided groups keeping the same term and lists duplicate terms (R-3)", () => {
    const kept = (id: string, extra = {}) => group(id, ["partial"], [member(`in-${id}`, BEN, "HP:0012378", "Fatigue", [])], { state: "keep",
      result: { term_id: "HP:0012378", term_label: "Fatigue", layer_id: "phenotype", axes: {}, modifiers: [] }, ...extra });
    const first = kept("a"), second = kept("b"), left = kept("c", { state: "leave_out" });
    const open = group("o", ["partial"], [member("in-o", BEN, "HP:0012378", "Fatigue", [span("hypotonia")])]);
    expect(sameTermGroups(open, [first, left, open], "HP:0012378")).toEqual([first]);
    expect(sameTermGroups(open, [first], "HP:0001252")).toEqual([]);
    expect(duplicateTerms([first, left, open])).toEqual([]);
    expect(duplicateTerms([first, second, left])).toEqual(["Fatigue"]);
  });

  it("never offers keep both", () => {
    const rows = comparisonRows(hypotoniaThree(), THREE, TEXT, {});
    const words = rows.flatMap(row => [row.label, row.agreed ?? "", row.info ?? "", ...row.cells.map(cell => cell.display)]);
    expect(words.filter(word => /both/i.test(word))).toEqual([]);
  });
});

describe("modifiers row", () => {
  const P = MOD_PEOPLE;
  const mods = (value: ConsolidationGroupView, choices: Choices = {}) => rowOf(comparisonRows(value, P, MOD_TEXT, choices), "modifiers");
  type Row = ReturnType<typeof mods>;
  const labels = (row: Row) => row.cells.map(cell => cell.toggles!.map(toggle => toggle.label));
  const idOf = (row: Row, label: string, cell = 0) => row.cells[cell].toggles!.find(toggle => toggle.label === label)!.id;
  const pressed = (row: Row) => row.cells.map(cell => cell.toggles!.map(toggle => toggle.pressed));
  const s4 = () => seizure("g-s4", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [recurrent("wiederholt")]]]);
  const s15 = () => seizure("g-s15", ["modifiers_differ"], [[ANA, [severe()]], [BEN, [severe()]], [CEM, []]]);

  it("comes after Text and before Note, only when a member has modifiers", () => {
    const value = seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [], { note: "Unsure." }]]);
    expect(comparisonRows(value, P, MOD_TEXT, {}).map(row => row.id)).toEqual(["term", "assertion", "experiencer", "temporality", "text", "modifiers", "note"]);
    expect(mods(value)).toMatchObject({ kind: "modifiers", label: "Modifiers", conflict: true, agreed: null });
    expect(comparisonRows(seizure("g", ["values_differ"], [[ANA, []], [BEN, []]]), P, MOD_TEXT, {}).some(row => row.id === "modifiers")).toBe(false);
  });

  it("lists each member's modifiers as toggles, or No modifiers (S5, S6)", () => {
    expect(labels(mods(seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [severe()]]])))).toEqual([["Severe “schwere”"], ["Severe (no text)"]]);
    expect(labels(mods(seizure("g", ["modifiers_differ"], [[ANA, []], [BEN, [severe("schwere"), recurrent()]]])))).toEqual([["No modifiers"], ["Recurrent", "Severe “schwere”"]]);
  });

  it("conflicts whenever modifiers_differ, segment-only differences too (DN-4: S6, S7, S20)", () => {
    expect(mods(seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [severe("schwere ")]]])).conflict).toBe(true);
    expect(mods(seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [severe("schwere Krampfanfälle")]]])).conflict).toBe(true);
  });

  it("agreed modifiers are one grey line (S1)", () => {
    const row = mods(seizure("g", ["match"], [[ANA, [severe("schwere"), recurrent("wiederholt")]], [BEN, [severe("schwere"), recurrent("wiederholt")]]]));
    expect(row).toMatchObject({ conflict: false, agreed: "Recurrent “wiederholt”, Severe “schwere” (all agree)" });
  });

  it("labels majorities (2 of 3) and preselects nothing (S15)", () => {
    const row = mods(s15());
    expect(row.cells.map(cell => cell.toggles!.map(toggle => toggle.majority))).toEqual([["(2 of 3)"], ["(2 of 3)"], [null]]);
    expect(pressed(row)).toEqual([[false], [false], [false]]);
    expect(row.cells[0].toggles![0].name).toBe("Take Severe from Ana Weber for Modifiers (2 of 3)");
    expect(row.cells[2].toggles![0].name).toBe("Take No modifiers from Cem Arslan for Modifiers");
  });

  it("one check presses the identical modifier in every cell; No modifiers excludes modifiers (S15, S5)", () => {
    const value = s15();
    const choices = choose(value, {}, "modifiers", idOf(mods(value), "Severe"));
    expect(pressed(mods(value, choices))).toEqual([[true], [true], [false]]);
    const none = choose(value, choices, "modifiers", NO_MODIFIERS);
    expect(pressed(mods(value, none))).toEqual([[false], [false], [true]]);
    expect(pressed(mods(value, choose(value, none, "modifiers", NO_MODIFIERS)))).toEqual([[false], [false], [false]]);
  });

  it("variants of one term are exclusive and read other text chosen (S6, S8)", () => {
    const value = seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [severe("schwere "), recurrent()]]]);
    const ana = choose(value, {}, "modifiers", idOf(mods(value), "Severe “schwere”"));
    const both = choose(value, ana, "modifiers", idOf(mods(value), "Recurrent", 1));
    expect(mods(value, both).cells[1].toggles!.map(toggle => [toggle.label, toggle.pressed, toggle.otherText]))
      .toEqual([["Recurrent", true, false], ["Severe “schwere ”", false, true]]);
    const ben = choose(value, both, "modifiers", idOf(mods(value), "Severe “schwere ”", 1));
    expect(mods(value, ben).cells[0].toggles![0]).toMatchObject({ pressed: false, otherText: true });
    expect(resultLine(value, P, MOD_TEXT, ben).finding).toBe("Seizure (HP:0001250), Present, Patient, Current, modifiers: Recurrent, Severe “schwere ”");
  });

  it("one check completes the row; a modifiers-only group has one field and no Whole finding row (S4)", () => {
    const value = s4();
    const rows = comparisonRows(value, P, MOD_TEXT, {});
    expect(rows.filter(row => row.conflict).map(row => row.id)).toEqual(["modifiers"]);
    expect(fieldsToDecide(rows.filter(row => row.conflict).length)).toBe("1 field to decide");
    expect(rows.some(row => row.kind === "whole")).toBe(false);
    expect(choicesComplete(rows, {})).toBe(false);
    const choices = choose(value, {}, "modifiers", idOf(mods(value), "Severe “schwere”"));
    expect(choicesComplete(comparisonRows(value, P, MOD_TEXT, choices), choices)).toBe(true);
  });

  it("warns about two severities among the chosen modifiers (S12, S16)", () => {
    const value = seizure("g", ["modifiers_differ"], [[ANA, [severe()]], [BEN, [severe(), recurrent()]], [CEM, [mild()]]]);
    let choices = choose(value, {}, "modifiers", idOf(mods(value), "Severe"));
    expect(mods(value, choices).warnings).toEqual([]);
    choices = choose(value, choices, "modifiers", idOf(mods(value), "Mild", 2));
    expect(mods(value, choices).warnings).toEqual(["Two severities"]);
  });

  it("result line names the modifiers (DN-5)", () => {
    const value = s4();
    expect(resultLine(value, P, MOD_TEXT, {}).saved).toBe("Result: 1 finding, Seizure (HP:0001250), Present, Patient, Current, modifiers not chosen yet");
    let choices = choose(value, {}, "modifiers", idOf(mods(value), "Severe “schwere”"));
    choices = choose(value, choices, "modifiers", idOf(mods(value), "Recurrent “wiederholt”", 1));
    expect(resultLine(value, P, MOD_TEXT, choices).finding).toBe("Seizure (HP:0001250), Present, Patient, Current, modifiers: Recurrent “wiederholt”, Severe “schwere”");
    const none = seizure("g", ["modifiers_differ"], [[ANA, []], [BEN, [severe("schwere")]]]);
    expect(resultLine(none, P, MOD_TEXT, choose(none, {}, "modifiers", NO_MODIFIERS)).finding).toBe("Seizure (HP:0001250), Present, Patient, Current, no modifiers");
  });

  it("choose sends the pressed modifiers with their segments (S4)", () => {
    const value = s4();
    let choices = choose(value, {}, "modifiers", idOf(mods(value), "Recurrent “wiederholt”", 1));
    choices = choose(value, choices, "modifiers", idOf(mods(value), "Severe “schwere”"));
    const [rs, re] = modSpan("wiederholt"), [ss, se] = modSpan("schwere");
    expect(resolvePayload(value, choices)).toEqual({ action: "choose", choice: { term_id: "HP:0001250", span_from_input_id: "g-s4-0", axes: {},
      modifiers: [{ term_id: "HP:0031796", segments: [{ start: rs, end: re }] }, { term_id: "HP:0012828", segments: [{ start: ss, end: se }] }] } });
    expect(resolvePayload(value, choose(value, {}, "modifiers", NO_MODIFIERS)).choice?.modifiers).toEqual([]);
  });

  it("a no-conflict keep stays keep; other choices send the base member's modifiers", () => {
    expect(resolvePayload(seizure("g", ["match"], [[ANA, [severe("schwere")]], [BEN, [severe("schwere")]]]), {})).toEqual({ action: "keep" });
    const values = seizure("g", ["values_differ"], [[ANA, [severe()]], [BEN, [severe()], { axes: { assertion: "absent", experiencer: "patient", temporality: "current" } }]],
      { differing_axes: ["assertion"] });
    expect(resolvePayload(values, { assertion: "absent" }).choice?.modifiers).toEqual([{ term_id: "HP:0012828", segments: [] }]);
  });

  it("Whole finding stays with other conflicts and takes values and modifiers (S10)", () => {
    const value = seizure("g", ["values_differ", "span_differs", "modifiers_differ"], [[ANA, [severe("schwere")]],
      [BEN, [], { spans: [modSpan("schwere Krampfanfälle")], axes: { assertion: "uncertain", experiencer: "patient", temporality: "current" } }]],
    { differing_axes: ["assertion"], span_conflict: true });
    const rows = comparisonRows(value, P, MOD_TEXT, {});
    expect(rows.filter(row => row.conflict).map(row => row.id)).toEqual(["assertion", "text", "modifiers"]);
    expect(rowOf(rows, "whole").cells.map(cell => cell.display)).toEqual(["Take Ana's finding", "Take Ben's finding"]);
    const ana = takeFinding(value, value.members[0]);
    expect(pressed(mods(value, ana))).toEqual([[true], [false]]);
    expect(resolvePayload(value, ana).choice).toMatchObject({ span_from_input_id: "g-0", axes: { assertion: "present" },
      modifiers: [{ term_id: "HP:0012828", segments: [{ start: modSpan("schwere")[0], end: modSpan("schwere")[1] }] }] });
    expect(resolvePayload(value, takeFinding(value, value.members[1])).choice?.modifiers).toEqual([]);
  });

  it("term differs: the Modifiers row compares all members, decided on its own (S11)", () => {
    const value = group("g", ["term_differs", "modifiers_differ"], [
      member("a", ANA, "HP:0001250", "Seizure", [modSpan("Krampfanfälle")], { modifiers: [severe("schwere")] }),
      member("b", BEN, "HP:0007359", "Focal-onset seizure", [modSpan("Krampfanfälle")], { modifiers: [recurrent()] }),
    ]);
    expect(labels(mods(value))).toEqual([["Severe “schwere”"], ["Recurrent"]]);
    let choices = choose(value, {}, "term", "HP:0007359");
    choices = choose(value, choices, "modifiers", idOf(mods(value), "Severe “schwere”"));
    expect(resolvePayload(value, choices).choice).toMatchObject({ term_id: "HP:0007359", span_from_input_id: "b", modifiers: [{ term_id: "HP:0012828" }] });
  });

  it("never shows a separator, keep both or a Text of row", () => {
    const rows = comparisonRows(s15(), P, MOD_TEXT, {});
    const words = rows.flatMap(row => [row.label, row.agreed ?? "", ...row.cells.flatMap(cell => [cell.display, ...(cell.toggles ?? []).map(toggle => toggle.name)])]);
    expect(words.join(" ")).not.toMatch(/·|both|Text of/);
  });
});

describe("standalone modifier (S18)", () => {
  const standalone = () => group("g-sev", ["partial", "modifier_as_finding"], [member("sev-a", ANA, "HP:0012828", "Severe", [modSpan("schwere")])]);
  const resolved = (groupId: string, words: string, state: ConsolidationGroupView["state"] = "keep") =>
    group(groupId, ["partial"], [member(`${groupId}-b`, BEN, "HP:0001250", "Seizure", [modSpan(words)])], { state, annotation_ids: [`cons-${groupId}`] });

  it("offers the resolved findings of the sentence, nearest first", () => {
    const groups = [standalone(), resolved("g-hypo", "Muskelhypotonie"), resolved("g-seiz", "Krampfanfälle"), resolved("g-open", "wiederholt", "open"),
      resolved("g-fever", "Fieber")];
    expect(attachCandidates(groups[0], groups, MOD_TEXT)).toEqual([
      { groupId: "g-seiz", annotationId: "cons-g-seiz", label: "Seizure (HP:0001250), “Krampfanfälle”" },
      { groupId: "g-hypo", annotationId: "cons-g-hypo", label: "Seizure (HP:0001250), “Muskelhypotonie”" },
    ]);
    expect(standaloneText(groups[0], MOD_TEXT)).toBe("Severe “schwere”");
  });

  it("offers only the cons- result of the standalone modifier's layer", () => {
    const adopted = { ...resolved("g-seiz", "Krampfanfälle"), annotation_ids: ["a-adopted", "cons-g-seiz"] };
    const other = group("g-hypo", ["partial"], [member("g-hypo-b", BEN, "HP:0001250", "Seizure", [modSpan("Muskelhypotonie")], { layer_id: "other" })],
      { state: "keep", annotation_ids: ["cons-g-hypo"] });
    const groups = [standalone(), adopted, other];
    expect(attachCandidates(groups[0], groups, MOD_TEXT).map(c => [c.groupId, c.annotationId])).toEqual([["g-seiz", "cons-g-seiz"]]);
  });

  it("finds the sentence like the editor: no split inside 2.5 or Z.n., none across a line break", () => {
    const at = (text: string, words: string): [number, number] => {
      const start = Array.from(text.slice(0, text.indexOf(words))).length;
      return [start, start + Array.from(words).length];
    };
    const ids = (text: string, words: Record<string, string>, mark: string) => {
      const groups = [group("g-sev", ["partial", "modifier_as_finding"], [member("sev-a", ANA, "HP:0012828", "Severe", [at(text, mark)])]),
        ...Object.entries(words).map(([id, value]) => group(id, ["partial"], [member(`${id}-b`, BEN, "HP:0001250", "Seizure", [at(text, value)])],
          { state: "keep", annotation_ids: [`cons-${id}`] }))];
      return attachCandidates(groups[0], groups, text).map(c => c.groupId);
    };
    expect(ids("Seit 2.5 Jahren schwere Anfälle.", { "g-a": "Seit" }, "schwere")).toEqual(["g-a"]);
    // Only a "." before whitespace ends a sentence (spec), so "Z.n. " still does.
    expect(ids("Anfälle (Z.n./V.a.) schwere Hypotonie.", { "g-a": "Anfälle" }, "schwere")).toEqual(["g-a"]);
    expect(ids("- Anfälle\n- schwere Hypotonie", { "g-a": "Anfälle", "g-b": "Hypotonie" }, "schwere")).toEqual(["g-b"]);
  });

  it("sorts a standalone modifier after the last other finding of its sentence", () => {
    const groups = [resolved("g-fever", "Fieber", "open"), resolved("g-hypo", "Muskelhypotonie", "open"), standalone(),
      resolved("g-seiz", "Krampfanfälle", "open"), resolved("g-rep", "wiederholt", "open")];
    expect(textOrder(groups, MOD_TEXT).map(value => value.group_id)).toEqual(["g-rep", "g-seiz", "g-hypo", "g-sev", "g-fever"]);
    // Alone in its sentence, it keeps its text position.
    expect(textOrder([groups[0], standalone()], MOD_TEXT).map(value => value.group_id)).toEqual(["g-sev", "g-fever"]);
  });

  it("an attached group reads attached", () => {
    expect(groupStatus({ state: "leave_out", attached_to: "cons-1" }, 0)).toBe("attached");
  });
});
