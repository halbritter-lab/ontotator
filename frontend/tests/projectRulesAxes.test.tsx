import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationPanel, type AnnotationPanelProps } from "../src/editor/AnnotationPanel";
import { SearchManager } from "../src/editor/searchState";

const props = (value: string, options = ["present", "absent"]): AnnotationPanelProps => ({
  annotation: {
    annotation: { annotation_id: "a", document_id: "d", layer_id: "l", type_id: "t", term_id: "TERM:1",
      axes_values: { presence: value }, axes_defaulted: ["presence"], evidence_refs: [],
      provenance: { actor: { actor_id: "tool", kind: "tool" }, method: "import" } },
    schema_version: "ontotator-annotation/v3", evidence: [], document_id: "d", version: "v",
    text_sha256: "t", ontology_sha256: "o", layer_config_sha256: "l",
  },
  allEvidence: {}, workspaceKey: { project_key: "p", document_id: "d", annotator_id: "a", mode: "independent", scope_id: "s", target_set_id: "t" },
  searchManager: new SearchManager({ searchOntology: vi.fn() } as any), selectedEvidenceId: null,
  axesConfig: [{ id: "presence", label: "Presence", options, allow_empty: true }],
  onSelectEvidence: vi.fn(), onUpdateTerm: vi.fn(), onUpdateAxes: vi.fn(), onAttachMention: vi.fn(),
  onDetachMention: vi.fn(), onDeleteAnnotation: vi.fn(), onSetIntent: vi.fn(),
});

describe("project rule axis controls", () => {
  it("offers an explicit same-value confirmation for a retained default", () => {
    const onConfirmDefaults = vi.fn();
    render(<AnnotationPanel {...props("present")} onConfirmDefaults={onConfirmDefaults} />);
    expect(screen.getByText(/Click a highlighted default/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Confirm defaults (1)" }));
    expect(onConfirmDefaults).toHaveBeenCalledWith(["presence"], { presence: "present" });
  });

  it.each([["yes"], ["a", "b", "c", "d", "e"]])("keeps a hidden current value visible with options %j", (...options) => {
    render(<AnnotationPanel {...props("unknown", options)} />);
    expect(screen.getByText("unknown (current unavailable value)")).toBeDefined();
    const current = screen.queryByRole("radio", { name: "unknown (current unavailable value)" }) as HTMLInputElement | null;
    if (current) {
      expect(current.checked).toBe(true);
      expect(current.disabled).toBe(true);
    } else {
      expect((screen.getByRole("combobox", { name: "Presence" }) as HTMLSelectElement).value).toBe("unknown");
    }
  });
});
