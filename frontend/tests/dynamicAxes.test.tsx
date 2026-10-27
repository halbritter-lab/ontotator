import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationPanel } from "../src/editor/AnnotationPanel";
import { SearchManager } from "../src/editor/searchState";
import type { AnnotationSnapshot, ApiClient, AxisDefinition } from "../src/api/client";

describe("Dynamic Axes and Non-HPO UI", () => {
  it("uses the same option labels in large selects and radio groups", () => {
    render(<AnnotationPanel annotation={sampleAnnotation} allEvidence={{}} workspaceKey={{ project_key: "p", document_id: "d", annotator_id: "u", mode: "independent", scope_id: "s", target_set_id: "t" }}
      searchManager={mockSearchManager} selectedEvidenceId={null} axesConfig={[{ id: "experiencer", label: "Experiencer", allow_empty: true, options: ["patient", "other", "family", "donor", "unknown"] }]}
      onSelectEvidence={vi.fn()} onUpdateTerm={vi.fn()} onUpdateAxes={vi.fn()} onAttachMention={vi.fn()} onDetachMention={vi.fn()} onDeleteAnnotation={vi.fn()} onSetIntent={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Other person" })).toHaveProperty("value", "other");
  });
  const mockSearchManager = new SearchManager({
    searchOntology: vi.fn(),
  } as unknown as ApiClient);

  const sampleAnnotation: AnnotationSnapshot = {
    schema_version: "ontotator-annotation/v3",
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
          project_key: "pkg-1",
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
    expect(screen.getByRole("heading", { level: 2, name: "MONDO:0001250" })).toBeDefined();

    // Required indicator on severity
    expect(screen.getByText(/Schweregrad/)).toBeDefined();
    expect(screen.getByText(/\(required\)/)).toBeDefined();

    // Small axes expose all choices directly; profile identifiers read as words.
    expect((screen.getByRole("radio", { name: "Severe" }) as HTMLInputElement).checked).toBe(true);

    expect((screen.getByRole("radio", { name: /Not specified|Nicht angegeben/i }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "High" }));
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
          project_key: "pkg-1",
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

    fireEvent.click(screen.getByRole("radio", { name: /Not specified|Nicht angegeben/i }));

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
          project_key: "pkg-1",
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
    expect(screen.queryByRole("heading", { name: "Values" })).toBeNull();
  });
});
