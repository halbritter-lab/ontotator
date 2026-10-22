import { describe, expect, it } from "vitest";
import { autoBanner, headerDetail, headerTitle, partialText, summaryText } from "../../src/consolidation/consolidationText";
import { allChosen, choiceSummary, choosePayload, rowsOf, takeOverChoices, takeOverWords } from "../../src/consolidation/groupModel";
import { ANA, AXIS_DEFS, decidedView, exampleView, group, LUC, member, span, TEXT, TOM } from "./fixtures";

describe("consolidation copy", () => {
  it("summarises the decisions before submitting", () => {
    const view = decidedView();
    expect(summaryText(view.groups, view.people))
      .toBe("8 decisions → 7 findings: 4 kept automatically (all matched) · 2 decided · 1 kept from Luc Martin · 1 left out · 1 note · 1 flagged");
  });

  it("counts findings added outside the groups in the summary and its total", () => {
    const view = decidedView();
    expect(summaryText(view.groups, view.people, 1))
      .toBe("8 decisions → 8 findings: 4 kept automatically (all matched) · 2 decided · 1 kept from Luc Martin · 1 left out · 1 added · 1 note · 1 flagged");
  });

  it("titles a read-only view as the consolidation of the text", () => {
    expect(headerTitle(exampleView(), true)).toBe("Consolidation of case-107 · de v2");
  });

  it("titles the view with text, people and open groups", () => {
    const view = exampleView();
    expect(headerTitle(view)).toBe("Consolidate case-107 · de v2");
    expect(headerDetail(view, 4)).toBe("Luc Martin, Tom Reis · 4 open");
    expect(autoBanner(4)).toBe("4 findings matched and were kept automatically. Check them in the text.");
  });

  it("names who marked a partial finding and who has nothing there", () => {
    expect(partialText([LUC, ANA], [TOM])).toBe("Luc Martin, Ana Weber marked this · Tom Reis has nothing here");
  });
});

describe("decision rows", () => {
  it("always offers No note, also when everyone wrote one", () => {
    const value = group("g", ["notes_differ"], [
      member("i1", LUC, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { note: "Mild." }),
      member("i2", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { note: "Severe." }),
    ]);
    const rows = rowsOf(value, [LUC, TOM], TEXT);
    const note = rows.find(row => row.id === "note")!;
    expect(note.options.map(option => option.label)).toEqual(["“Mild.” · Luc Martin", "“Severe.” · Tom Reis", "No note"]);
    expect(choosePayload(value, rows, { note: "" })).toEqual({ term_id: "HP:0001252", span_from_input_id: "i1", axes: {}, note_from_input_id: null });
    expect(choiceSummary(rows, { note: "" })).toBe("no note");
  });

  it("offers one No note option when a person wrote none", () => {
    const value = group("g", ["notes_differ"], [
      member("i1", LUC, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { note: "Mild." }),
      member("i2", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")]),
    ]);
    const note = rowsOf(value, [LUC, TOM], TEXT).find(row => row.id === "note")!;
    expect(note.options.map(option => option.label)).toEqual(["“Mild.” · Luc Martin", "No note · Tom Reis"]);
  });

  it("labels a majority value with 2 of 3", () => {
    const value = group("g", ["values_differ"], [
      member("i1", LUC, "HP:0001252", "Hypotonia", [span("muscular hypotonia")]),
      member("i2", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { axes: { assertion: "absent", experiencer: "patient", temporality: "current" } }),
      member("i3", ANA, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { axes: { assertion: "absent", experiencer: "patient", temporality: "current" } }),
    ], { majority: { assertion: "absent" } });
    const rows = rowsOf(value, [LUC, TOM, ANA], TEXT);
    expect(rows.map(row => row.options.map(option => option.label))).toEqual([["present · Luc Martin", "absent · Tom Reis, Ana Weber (2 of 3)"]]);
  });

  it("builds the choose payload from the chosen span and values", () => {
    const value = group("g", ["values_differ", "span_differs"], [
      member("i1", LUC, "HP:0001263", "Global developmental delay", [span("Delayed development")]),
      member("i2", TOM, "HP:0001263", "Global developmental delay", [span("development")], { axes: { assertion: "absent", experiencer: "patient", temporality: "current" } }),
    ]);
    const rows = rowsOf(value, [LUC, TOM], TEXT);
    expect(rows.map(row => row.id)).toEqual(["axis:assertion", "span"]);
    const choices = { "axis:assertion": "absent", span: rows[1].options[1].key };
    expect(choosePayload(value, rows, choices)).toEqual({ term_id: "HP:0001263", span_from_input_id: "i2", axes: { assertion: "absent" } });
    expect(AXIS_DEFS).toHaveLength(3);
  });
  it("asks for every field that differs across terms, not only the term", () => {
    const value = group("g", ["term_differs", "values_differ"], [
      member("i1", LUC, "HP:0001251", "Ataxia", [span("Unsteady gait")]),
      member("i2", TOM, "HP:0001288", "Gait disturbance", [span("Unsteady gait")], { axes: { assertion: "absent", experiencer: "patient", temporality: "current" } }),
    ], { differing_axes: ["assertion"] });
    const rows = rowsOf(value, [LUC, TOM], TEXT);
    expect(rows.map(row => row.id)).toEqual(["term", "axis:assertion"]);
    expect(allChosen(rows, { term: "HP:0001251" })).toBe(false);
    const choices = { term: "HP:0001251", "axis:assertion": "absent" };
    expect(allChosen(rows, choices)).toBe(true);
    expect(choosePayload(value, rows, choices)).toEqual({ term_id: "HP:0001251", span_from_input_id: "i1", axes: { assertion: "absent" } });
    expect(choiceSummary(rows, choices)).toBe("Ataxia (HP:0001251) (Luc Martin), absent (Tom Reis)");
  });

  it("takes a whole finding from one member and names what it adopts", () => {
    const value = group("g", ["term_differs", "values_differ", "notes_differ"], [
      member("i1", LUC, "HP:0001251", "Ataxia", [span("Unsteady gait")], { note: "Mild." }),
      member("i2", TOM, "HP:0001288", "Gait disturbance", [span("Unsteady gait")], { axes: { assertion: "absent", experiencer: "patient", temporality: "current" } }),
    ]);
    const rows = rowsOf(value, [LUC, TOM], TEXT);
    const choices = takeOverChoices(rows, value.members[1]);
    expect(choices).toEqual({ term: "HP:0001288", "axis:assertion": "absent", note: "" });
    expect(choosePayload(value, rows, choices)).toEqual({ term_id: "HP:0001288", span_from_input_id: "i2", axes: { assertion: "absent" }, note_from_input_id: null });
    expect(takeOverWords(value.members[1], rows, TEXT)).toBe("Gait disturbance (HP:0001288) · absent · patient · current · no note");
  });

  it("offers a term found with Other term as one more term option", () => {
    const value = group("g", ["term_differs"], [
      member("i1", LUC, "HP:0001251", "Ataxia", [span("Unsteady gait")]),
      member("i2", TOM, "HP:0001288", "Gait disturbance", [span("Unsteady gait")]),
    ]);
    const rows = rowsOf(value, [LUC, TOM], TEXT, { termId: "HP:0002066", label: "Gait ataxia" });
    expect(rows[0].options.map(option => option.label)).toEqual(["Ataxia (HP:0001251) · Luc Martin", "Gait disturbance (HP:0001288) · Tom Reis", "Gait ataxia (HP:0002066) · other term"]);
    expect(choosePayload(value, rows, { term: "HP:0002066" })).toEqual({ term_id: "HP:0002066", span_from_input_id: "i1", axes: {} });
  });
});
