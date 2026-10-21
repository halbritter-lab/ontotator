import { describe, expect, it } from "vitest";
import { autoBanner, headerDetail, headerTitle, partialText, summaryText } from "../../src/consolidation/consolidationText";
import { choosePayload, rowsOf } from "../../src/consolidation/groupModel";
import { ANA, AXIS_DEFS, decidedView, exampleView, group, LUC, member, span, TEXT, TOM } from "./fixtures";

describe("consolidation copy", () => {
  it("summarises the decisions before submitting", () => {
    const view = decidedView();
    expect(summaryText(view.groups, view.people))
      .toBe("8 decisions → 7 findings: 4 kept automatically (all matched) · 2 decided · 1 kept from Luc Martin · 1 left out · 1 note · 1 flagged");
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
});
