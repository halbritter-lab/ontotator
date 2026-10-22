import { describe, expect, it } from "vitest";
import { autoBanner, headerDetail, headerTitle, partialText, summaryText } from "../../src/consolidation/consolidationText";
import { allChosen, choiceSummary, choosePayload, KEEP_BOTH, resolvePayload, rowsOf, takeOverChoices, takeOverWords } from "../../src/consolidation/groupModel";
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
  it("never asks about notes: the note comes with the kept finding", () => {
    const value = group("g", ["notes_differ"], [
      member("i1", LUC, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { note: "Mild." }),
      member("i2", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { note: "Severe." }),
    ]);
    const rows = rowsOf(value, [LUC, TOM], TEXT);
    expect(rows).toEqual([]);
    expect(choosePayload(value, rows, {})).toEqual({ term_id: "HP:0001252", span_from_input_id: "i1", axes: {} });
  });

  it("asks about the text only when the spans conflict", () => {
    const members = [
      member("i1", LUC, "HP:0001263", "Global developmental delay", [span("Delayed development")]),
      member("i2", TOM, "HP:0001263", "Global developmental delay", [span("development")]),
    ];
    expect(rowsOf(group("g", ["span_differs"], members), [LUC, TOM], TEXT)).toEqual([]);
    const conflict = rowsOf(group("g", ["span_differs"], members, { span_conflict: true }), [LUC, TOM], TEXT);
    expect(conflict.map(row => row.id)).toEqual(["span"]);
    expect(conflict[0].options.map(option => option.label)).toEqual(["“Delayed development” · Luc Martin", "“development” · Tom Reis"]);
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
    ], { span_conflict: true });
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
    expect(choices).toEqual({ __from: "i2", term: "HP:0001288", "axis:assertion": "absent" });
    expect(choosePayload(value, rows, choices)).toEqual({ term_id: "HP:0001288", span_from_input_id: "i2", axes: { assertion: "absent" } });
    expect(takeOverWords(value.members[1], rows, TEXT)).toBe("Gait disturbance (HP:0001288) · absent · patient · current");
    expect(takeOverWords(value.members[0], rows, TEXT)).toBe("Ataxia (HP:0001251) · present · patient · current · note “Mild.”");
  });

  it("takes span and note from the member taken with Take … finding, also within one term", () => {
    const absent = { assertion: "absent", experiencer: "patient", temporality: "current" };
    const value = group("g", ["term_differs", "values_differ", "span_differs"], [
      member("i1", LUC, "HP:0001251", "Ataxia", [span("Unsteady gait")]),
      member("i2", TOM, "HP:0001251", "Ataxia", [span("Unsteady")], { axes: absent }),
      member("i3", ANA, "HP:0001288", "Gait disturbance", [span("gait")]),
    ]);
    const rows = rowsOf(value, [LUC, TOM, ANA], TEXT);
    const choices = takeOverChoices(rows, value.members[1]);
    expect(choosePayload(value, rows, choices)).toEqual({ term_id: "HP:0001251", span_from_input_id: "i2", axes: { assertion: "absent" } });
    // Choosing the other term by hand: the span comes with that term's first member.
    expect(choosePayload(value, rows, { ...choices, term: "HP:0001288" }).span_from_input_id).toBe("i3");
  });

  it("asks the values within one term when both terms are kept (three people)", () => {
    const absent = { assertion: "absent", experiencer: "patient", temporality: "current" };
    const value = group("g", ["term_differs", "values_differ"], [
      member("i1", LUC, "HP:0001251", "Ataxia", [span("Unsteady gait")]),
      member("i2", TOM, "HP:0001251", "Ataxia", [span("Unsteady gait")], { axes: absent }),
      member("i3", ANA, "HP:0001288", "Gait disturbance", [span("Unsteady gait")]),
    ], { differing_axes: ["assertion"], term_parts: { "HP:0001251": { differing_axes: ["assertion"], span_conflict: false } } });
    const rows = rowsOf(value, [LUC, TOM, ANA], TEXT);
    expect(rows[0].options.map(option => option.key)).toEqual(["HP:0001251", "HP:0001288", KEEP_BOTH]);
    const both = rowsOf(value, [LUC, TOM, ANA], TEXT, null, true);
    expect(both.map(row => [row.id, row.label])).toEqual([["term", "Term"], ["both:HP:0001251:axis:assertion", "Ataxia · Assertion"]]);
    expect(allChosen(both, { term: KEEP_BOTH })).toBe(false);
    const choices = { term: KEEP_BOTH, "both:HP:0001251:axis:assertion": "absent" };
    expect(allChosen(both, choices)).toBe(true);
    expect(resolvePayload(value, both, choices)).toEqual({ action: "keep_both",
      term_choices: [{ term_id: "HP:0001251", span_from_input_id: "i1", axes: { assertion: "absent" } }] });
    expect(choiceSummary(both, choices)).toBe("kept both, absent (Tom Reis)");
    // Without differences inside a term "Keep both" needs nothing more.
    const plain = { ...value, term_parts: {} };
    expect(resolvePayload(plain, rowsOf(plain, [LUC, TOM, ANA], TEXT, null, true), { term: KEEP_BOTH })).toEqual({ action: "keep_both" });
  });

  it("offers a term found with Other term as one more term option", () => {
    const value = group("g", ["term_differs"], [
      member("i1", LUC, "HP:0001251", "Ataxia", [span("Unsteady gait")]),
      member("i2", TOM, "HP:0001288", "Gait disturbance", [span("Unsteady gait")]),
    ]);
    const rows = rowsOf(value, [LUC, TOM], TEXT, { termId: "HP:0002066", label: "Gait ataxia" });
    expect(rows[0].options.map(option => option.label)).toEqual(["Ataxia (HP:0001251) · Luc Martin", "Gait disturbance (HP:0001288) · Tom Reis", "Gait ataxia (HP:0002066) · other term", "Keep both"]);
    expect(choosePayload(value, rows, { term: "HP:0002066" })).toEqual({ term_id: "HP:0002066", span_from_input_id: "i1", axes: {} });
  });
});
