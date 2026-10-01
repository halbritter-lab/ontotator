import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, type WorkspaceView } from "../src/app/CaseScreen";
import { api } from "../src/api/client";

describe("CaseScreen integration", () => {
  const sampleView: WorkspaceView = {
    document: {
      document_id: "doc-test-1",
      text: "The patient showed severe hypotonia and seizure activity.",
      language: "en",
      text_sha256: "sha-test-text",
    },
    key: {
      package_id: "pkg-1",
      document_id: "doc-test-1",
      annotator_id: "user-test",
      mode: "independent",
      target_set_id: "targets-0",
    },
    draft: {
      key: {
        package_id: "pkg-1",
        document_id: "doc-test-1",
        annotator_id: "user-test",
        mode: "independent",
        target_set_id: "targets-0",
      },
      targets: {
        target_set_id: "targets-0",
        targets: [],
      },
      revision: 0,
      annotations: [],
      evidence: [],
      decisions: [],
      document_checked: false,
    },
    targets: {
      target_set_id: "targets-0",
      targets: [],
    },
    submissions: [],
    available_inputs: [],
    term_statuses: {},
    axes_definition: "editor-axes/v1",
    axes_config: [
      { id: "assertion", label: "Vorhandensein (Assertion)", options: ["present", "absent", "uncertain"], allow_empty: true },
      { id: "experiencer", label: "Betroffene Person (Experiencer)", options: ["patient", "other"], allow_empty: true },
      { id: "temporality", label: "Zeitlicher Bezug (Temporality)", options: ["current", "historical", "future"], allow_empty: true },
    ],
    axes_config_sha256: "sha-test-axes",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders document text and empty annotations list initially", () => {
    render(
      <CaseScreen
        view={sampleView}
        workspaceId="ws-test-token"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Fall: doc-test-1")).toBeDefined();
    expect(screen.getByText("Unabhängige Annotation")).toBeDefined();
    expect(screen.getByText("Keine Annotation ausgewählt")).toBeDefined();
  });

  it("creates spanless annotation without text segments", async () => {
    const updatedDraft = {
      ...sampleView.draft,
      revision: 1,
      annotations: [
        {
          annotation: {
            annotation_id: "ann-spanless-1",
            document_id: "doc-test-1",
            term_id: "HP:0001252",
            hpo_id: "HP:0001252",
            axes: {
              definition_name: "editor-axes/v1",
              values: {
                assertion: "present",
                experiencer: null,
                temporality: null,
              },
            },
            evidence_refs: [],
            provenance: {
              actor: { actor_id: "user-test", kind: "human" as const },
              method: "manual",
            },
          },
          evidence: [],
          document_id: "doc-test-1",
          text_sha256: "sha-test-text",
          ontology_sha256: "sha-ont",
          version: "v-1",
        },
      ],
    };

    const applyCommandSpy = vi
      .spyOn(api, "applyCommand")
      .mockResolvedValue(updatedDraft as any);

    render(
      <CaseScreen
        view={sampleView}
        workspaceId="ws-test-token"
        onClose={vi.fn()}
      />
    );

    // Click "+ Spanlose Annotation"
    fireEvent.click(screen.getByText("+ Spanlose Annotation"));

    // Enter ID and submit modal
    const input = screen.getByLabelText(/Ontologie-Kennung/i);
    fireEvent.change(input, { target: { value: "HP:0001252" } });
    fireEvent.click(screen.getByText("Annotation anlegen"));

    await waitFor(() => {
      expect(applyCommandSpy).toHaveBeenCalledWith(
        "ws-test-token",
        expect.objectContaining({
          expected_revision: 0,
          payload: expect.objectContaining({
            command: "create_annotation",
            term_id: "HP:0001252",
            segments: [],
          }),
        })
      );
    });

    // Check that the annotation appears in the list
    expect(screen.getByText("HP:0001252")).toBeDefined();
    expect(screen.getAllByText(/Spanlos/i).length).toBeGreaterThanOrEqual(2);
  });

  it("updates clinical axes without setting unwarranted defaults", async () => {
    const viewWithAnn = {
      ...sampleView,
      draft: {
        ...sampleView.draft,
        revision: 1,
        annotations: [
          {
            annotation: {
              annotation_id: "ann-1",
              document_id: "doc-test-1",
              term_id: "HP:0001252",
              hpo_id: "HP:0001252",
              axes: {
                definition_name: "editor-axes/v1",
                values: {
                  assertion: null,
                  experiencer: null,
                  temporality: null,
                },
              },
              evidence_refs: [],
              provenance: {
                actor: { actor_id: "user-test", kind: "human" as const },
                method: "manual",
              },
            },
            evidence: [],
            document_id: "doc-test-1",
            text_sha256: "sha-test-text",
            ontology_sha256: "sha-ont",
            version: "v-1",
          },
        ],
      },
    };

    const updatedDraft = {
      ...viewWithAnn.draft,
      revision: 2,
      annotations: [
        {
          ...viewWithAnn.draft.annotations[0],
          annotation: {
            ...viewWithAnn.draft.annotations[0].annotation,
            axes: {
              definition_name: "editor-axes/v1",
              values: {
                assertion: "absent",
                experiencer: null,
                temporality: null,
              },
            },
          },
        },
      ],
    };

    const applyCommandSpy = vi
      .spyOn(api, "applyCommand")
      .mockResolvedValue(updatedDraft as any);

    render(
      <CaseScreen
        view={viewWithAnn}
        workspaceId="ws-test-token"
        onClose={vi.fn()}
      />
    );

    // Select the annotation item
    fireEvent.click(screen.getByText("HP:0001252"));

    // Check Assertion select value is initially empty (no default!)
    const select = screen.getByLabelText(/Vorhandensein/i) as HTMLSelectElement;
    expect(select.value).toBe("");

    // Change to 'absent'
    fireEvent.change(select, { target: { value: "absent" } });

    await waitFor(() => {
      expect(applyCommandSpy).toHaveBeenCalledWith(
        "ws-test-token",
        expect.objectContaining({
          expected_revision: 1,
          payload: expect.objectContaining({
            command: "set_axes",
            annotation_id: "ann-1",
            axes: expect.objectContaining({
              values: expect.objectContaining({
                assertion: "absent",
              }),
            }),
          }),
        })
      );
    });
  });

  it("deletes annotation from current draft", async () => {
    const viewWithAnn = {
      ...sampleView,
      draft: {
        ...sampleView.draft,
        revision: 1,
        annotations: [
          {
            annotation: {
              annotation_id: "ann-to-del",
              document_id: "doc-test-1",
              term_id: "HP:0001252",
              hpo_id: "HP:0001252",
              axes: {
                definition_name: "editor-axes/v1",
                values: {},
              },
              evidence_refs: [],
              provenance: {
                actor: { actor_id: "user-test", kind: "human" as const },
                method: "manual",
              },
            },
            evidence: [],
            document_id: "doc-test-1",
            text_sha256: "sha-test-text",
            ontology_sha256: "sha-ont",
            version: "v-1",
          },
        ],
      },
    };

    const emptyDraft = {
      ...viewWithAnn.draft,
      revision: 2,
      annotations: [],
    };

    const applyCommandSpy = vi
      .spyOn(api, "applyCommand")
      .mockResolvedValue(emptyDraft as any);

    render(
      <CaseScreen
        view={viewWithAnn}
        workspaceId="ws-test-token"
        onClose={vi.fn()}
      />
    );

    // Select annotation
    fireEvent.click(screen.getByText("HP:0001252"));

    // Click delete
    fireEvent.click(screen.getByText(/Annotation löschen/i));

    await waitFor(() => {
      expect(applyCommandSpy).toHaveBeenCalledWith(
        "ws-test-token",
        expect.objectContaining({
          expected_revision: 1,
          payload: expect.objectContaining({
            command: "delete_draft_annotation",
            annotation_id: "ann-to-del",
          }),
        })
      );
    });
  });
});
