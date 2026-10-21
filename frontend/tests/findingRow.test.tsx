import { render } from "@testing-library/react";
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
