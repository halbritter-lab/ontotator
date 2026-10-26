import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FindingRow } from "../src/editor/FindingRow";
import { axisOptionLabel } from "../src/editor/axisLabels";

const snapshot = (refs: number) => ({
  annotation: { annotation_id: "a", document_id: "d", layer_id: "l", type_id: "t", term_id: "HP:0001250",
    axes_values: {}, evidence_refs: Array.from({ length: refs }, (_, i) => ({ evidence_id: `e${i}`, version: "v" })),
    provenance: { actor: { actor_id: "u", kind: "human" }, method: "manual" } },
  schema_version: "ontocurator-annotation/v3", evidence: [], document_id: "d", version: "v",
  text_sha256: "t", ontology_sha256: "o", layer_config_sha256: "l",
}) as any;

const row = (refs: number) => render(<ul><FindingRow snapshot={snapshot(refs)} selected={false} termLabel={() => "Seizure"}
  showLayer={false} axes={[]} defaulted={false} onActivate={vi.fn()} /></ul>).container.querySelector(".doc-meta")!.textContent;

describe("FindingRow", () => {
  it("counts mentions with a proper plural", () => {
    expect(row(1)).toContain("1 mention");
    expect(row(1)).not.toContain("mention(s)");
    expect(row(1)).not.toContain("mentions");
    expect(row(2)).toContain("2 mentions");
    expect(row(0)).toContain("Spanless");
  });
});

describe("axisOptionLabel", () => {
  it("turns a snake_case profile option into readable words", () => {
    expect(axisOptionLabel("clinically_suspected_only")).toBe("Clinically suspected only");
    expect(axisOptionLabel("mild")).toBe("Mild");
  });

  it("keeps known wording and values that are not plain identifiers", () => {
    expect(axisOptionLabel("other")).toBe("Other person");
    expect(axisOptionLabel("HP:0001250")).toBe("HP:0001250");
    expect(axisOptionLabel("Grade 2")).toBe("Grade 2");
    expect(axisOptionLabel(null)).toBe("Not specified");
  });
});

describe("FindingRow axis values", () => {
  it("axis values carry their fixed colour slot", () => {
    const { getByText } = render(<ul><FindingRow snapshot={snapshot(1)} selected={false} termLabel={() => "Seizure"}
      showLayer={false} axes={[{ id: "assertion", label: "Assertion", value: "absent" }]} defaulted={false} onActivate={vi.fn()} /></ul>);
    expect(getByText("Absent").className).toContain("axis-value--absent");
  });
});

describe("FindingRow modifier lines (E-b)", () => {
  const LABELS: Record<string, string> = { "HP:0001250": "Seizure", "HP:0012828": "Severe", "HP:0031796": "Recurrent" };
  const withModifiers = (modifiers: unknown[]) => { const s = snapshot(1); s.annotation.modifiers = modifiers; return s; };
  const renderRow = (modifiers: unknown[], extra: Record<string, unknown> = {}) => render(<ul><FindingRow snapshot={withModifiers(modifiers)} selected={false}
    termLabel={(_l, id) => LABELS[id] ?? null} showLayer={false} axes={[]} defaulted={false} onActivate={vi.fn()} {...extra} /></ul>);

  it("names the modifiers in one grey line, in label order (B3-4)", () => {
    const { container } = renderRow([{ term_id: "HP:0031796" }, { term_id: "HP:0012828", segments: [{ start: 11, end: 18 }] }]);
    expect(container.querySelector(".mod-lines")!.textContent).toBe("Modifiers: Recurrent, Severe");
  });

  it("has no modifier list without modifiers", () => {
    expect(renderRow([]).container.querySelector(".mod-lines")).toBeNull();
  });

  it("as an attach target: accessible name, the active one shows the hint, arrows move", () => {
    const onMove = vi.fn();
    const { getByRole, container } = renderRow([], { attachTarget: { term: "Severe", active: true, onMove } });
    const row = getByRole("button", { name: "Attach Severe to Seizure" });
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector(".mod-attach-here")!.textContent).toBe("Attach Severe here Enter");
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(onMove).toHaveBeenCalledWith(1);
  });
});

describe("FindingRow in convert mode (E-c)", () => {
  it("the source row reads “Becomes a modifier of the finding you choose” and is no target", () => {
    const { container } = render(<ul><FindingRow snapshot={snapshot(1)} selected termLabel={() => "Severe"} showLayer={false} axes={[]}
      defaulted={false} onActivate={vi.fn()} convertSource /></ul>);
    const li = container.querySelector("li")!;
    expect(li.textContent).toContain("Becomes a modifier of the finding you choose");
    expect(li.getAttribute("aria-label")).toBeNull();
    expect(li.className).not.toContain("mod-target");
  });
});
