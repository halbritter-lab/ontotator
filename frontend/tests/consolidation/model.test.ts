import { describe, expect, it } from "vitest";
import { fieldsToDecide, groupStatus, headerTitle, partialText, submittedText, summaryText } from "../../src/consolidation/consolidationText";
import { choicesComplete, comparisonRows, groupName, resolvePayload, resultLine, takeFinding } from "../../src/consolidation/groupModel";
import { ANA, decidedView, exampleGroups, exampleView, hypotoniaThree, LUC, span, TEXT, THREE, TOM } from "./fixtures";

describe("consolidation copy", () => {
  it("summarises groups, findings and left out before submitting", () => {
    const view = decidedView();
    expect(summaryText(view.groups)).toBe("8 groups, 7 findings, 1 left out");
    expect(summaryText(view.groups, 1)).toBe("8 groups, 8 findings, 1 left out");
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

  it("notes never block", () => {
    const rows = comparisonRows(hypotoniaThree({}, { tom: { note: "Mild." }, mia: { note: "Negated." } }), THREE, TEXT, {});
    expect(rowOf(rows, "note")).toMatchObject({ conflict: false, agreed: null });
    expect(rowOf(rows, "note").cells.map(cell => cell.display)).toEqual(["Mild.", "Negated.", ""]);
  });

  it("result line names the open choices", () => {
    const group = hypotoniaThree();
    expect(resultLine(group, THREE, {})).toMatchObject({
      saved: "Result: 1 finding, Hypotonia (HP:0001252), Assertion not chosen yet, Patient, Current",
      notTaken: "Not taken: Axial hypotonia (Ali)",
    });
    expect(resultLine(group, THREE, { assertion: "absent" }).saved).toBe("Result: 1 finding, Hypotonia (HP:0001252), Absent, Patient, Current");
  });

  it("taking a whole finding fills every row", () => {
    const group = hypotoniaThree();
    const choices = takeFinding(group, group.members[2]);
    const rows = comparisonRows(group, THREE, TEXT, choices);
    expect(rowOf(rows, "whole").cells.map(cell => cell.display)).toEqual(["Take Tom's finding", "Take Mia's finding", "Take Ali's finding"]);
    expect(rowOf(rows, "whole").cells[2].chosen).toBe(true);
    expect(rowOf(rows, "term").cells.map(cell => cell.chosen)).toEqual([false, false, true]);
    expect(resultLine(group, THREE, choices)).toMatchObject({
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
    expect(resultLine(group, THREE, choices, { termId: "HP:0002066", label: "Gait ataxia" })).toMatchObject({
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

  it("never offers keep both", () => {
    const rows = comparisonRows(hypotoniaThree(), THREE, TEXT, {});
    const words = rows.flatMap(row => [row.label, row.agreed ?? "", row.info ?? "", ...row.cells.map(cell => cell.display)]);
    expect(words.filter(word => /both/i.test(word))).toEqual([]);
  });
});
