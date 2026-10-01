import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationPanel } from "../src/editor/AnnotationPanel";
import { SearchManager } from "../src/editor/searchState";
import type { AnnotationSnapshot, ApiClient, AxisDefinition } from "../src/api/client";

describe("Dynamic Axes and Non-HPO UI", () => {
  const mockSearchManager = new SearchManager({
    searchOntology: vi.fn(),
  } as unknown as ApiClient);

  const sampleAnnotation: AnnotationSnapshot = {
    annotation: {
      annotation_id: "ann-custom-1",
      document_id: "doc-1",
      term_id: "MONDO:0001250",
      hpo_id: "MONDO:0001250",
      axes: {
        definition_name: "rare-disease/v1",
        values: {
          severity: "severe",
        },
      },
      evidence_refs: [],
      provenance: {
        actor: { actor_id: "annotator-1", kind: "human" },
        method: "manual",
      },
    },
    evidence: [],
    document_id: "doc-1",
    text_sha256: "text-sha",
    ontology_sha256: "ont-sha",
    version: "v-1",
  };

  const customAxesConfig: AxisDefinition[] = [
    {
      id: "severity",
      label: "Schweregrad",
      options: ["mild", "moderate", "severe"],
      allow_empty: false,
    },
    {
      id: "confidence",
      label: "Sicherheit",
      options: ["high", "medium", "low"],
      allow_empty: true,
    },
  ];

  it("renders non-HPO term in header and displays dynamic axes with required indicators", () => {
    const onUpdateAxes = vi.fn();

    render(
      <AnnotationPanel
        annotation={sampleAnnotation}
        allEvidence={{}}
        workspaceKey={{
          package_id: "pkg-1",
          document_id: "doc-1",
          annotator_id: "user",
          mode: "independent",
          target_set_id: "targets",
        }}
        searchManager={mockSearchManager}
        selectedEvidenceId={null}
        axesConfig={customAxesConfig}
        axesDefinition="rare-disease/v1"
        onSelectEvidence={vi.fn()}
        onUpdateTerm={vi.fn()}
        onUpdateAxes={onUpdateAxes}
        onAttachMention={vi.fn()}
        onDetachMention={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onSetIntent={vi.fn()}
      />
    );

    // Non-HPO CURIE displayed in header
    expect(screen.getByText("MONDO:0001250")).toBeDefined();
    expect(screen.getByText("Ontologie-Term")).toBeDefined();

    // Required indicator on severity
    expect(screen.getByText(/Schweregrad/)).toBeDefined();
    expect(screen.getByText(/\* \(Pflichtfeld\)/)).toBeDefined();

    // Select current value matches 'severe'
    const severitySelect = screen.getByLabelText(/Schweregrad/) as HTMLSelectElement;
    expect(severitySelect.value).toBe("severe");

    // Change confidence axis value
    const confidenceSelect = screen.getByLabelText(/Sicherheit/) as HTMLSelectElement;
    expect(confidenceSelect.value).toBe("");

    fireEvent.change(confidenceSelect, { target: { value: "high" } });
    expect(onUpdateAxes).toHaveBeenCalledWith({
      definition_name: "rare-disease/v1",
      values: {
        severity: "severe",
        confidence: "high",
      },
    });
  });

  it("clearing an axis value to empty string sends null", () => {
    const onUpdateAxes = vi.fn();

    render(
      <AnnotationPanel
        annotation={sampleAnnotation}
        allEvidence={{}}
        workspaceKey={{
          package_id: "pkg-1",
          document_id: "doc-1",
          annotator_id: "user",
          mode: "independent",
          target_set_id: "targets",
        }}
        searchManager={mockSearchManager}
        selectedEvidenceId={null}
        axesConfig={customAxesConfig}
        axesDefinition="rare-disease/v1"
        onSelectEvidence={vi.fn()}
        onUpdateTerm={vi.fn()}
        onUpdateAxes={onUpdateAxes}
        onAttachMention={vi.fn()}
        onDetachMention={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onSetIntent={vi.fn()}
      />
    );

    const severitySelect = screen.getByLabelText(/Schweregrad/) as HTMLSelectElement;
    fireEvent.change(severitySelect, { target: { value: "" } });

    expect(onUpdateAxes).toHaveBeenCalledWith({
      definition_name: "rare-disease/v1",
      values: {
        severity: null,
      },
    });
  });

  it("hides the axes section completely when axesConfig is empty array", () => {
    const { container } = render(
      <AnnotationPanel
        annotation={sampleAnnotation}
        allEvidence={{}}
        workspaceKey={{
          package_id: "pkg-1",
          document_id: "doc-1",
          annotator_id: "user",
          mode: "independent",
          target_set_id: "targets",
        }}
        searchManager={mockSearchManager}
        selectedEvidenceId={null}
        axesConfig={[]}
        axesDefinition="empty-profile/v1"
        onSelectEvidence={vi.fn()}
        onUpdateTerm={vi.fn()}
        onUpdateAxes={vi.fn()}
        onAttachMention={vi.fn()}
        onDetachMention={vi.fn()}
        onDeleteAnnotation={vi.fn()}
        onSetIntent={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="axes-section"]')).toBeNull();
    expect(screen.queryByText("Kontext-Achsen")).toBeNull();
  });
});
