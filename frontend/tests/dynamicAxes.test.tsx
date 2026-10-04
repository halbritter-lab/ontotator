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
    schema_version: "ontocurator-annotation/v3",
    annotation: {
      annotation_id: "ann-custom-1",
      document_id: "doc-1",
      layer_id: "disease",
      type_id: "default",
      term_id: "MONDO:0001250",
      axes_values: {
        severity: "severe",
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
    layer_config_sha256: "test-layer-sha",
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
          scope_id: "scope-default",
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

    // Small axes expose all choices directly.
    expect((screen.getByRole("radio", { name: "severe" }) as HTMLInputElement).checked).toBe(true);

    expect((screen.getByRole("radio", { name: "Nicht angegeben" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "high" }));
    expect(onUpdateAxes).toHaveBeenCalledWith({
      severity: "severe",
      confidence: "high",
    });
  });

  it("clearing an optional axis sends null", () => {
    const onUpdateAxes = vi.fn();
    const annotated = {
      ...sampleAnnotation,
      annotation: {
        ...sampleAnnotation.annotation,
        axes_values: { severity: "severe", confidence: "high" },
      },
    };

    render(
      <AnnotationPanel
        annotation={annotated}
        allEvidence={{}}
        workspaceKey={{
          package_id: "pkg-1",
          document_id: "doc-1",
          annotator_id: "user",
          mode: "independent",
          scope_id: "scope-default",
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

    fireEvent.click(screen.getByRole("radio", { name: "Nicht angegeben" }));

    expect(onUpdateAxes).toHaveBeenCalledWith({
      severity: "severe",
      confidence: null,
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
          scope_id: "scope-default",
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
