import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, initialAxisValues, type WorkspaceView } from "../src/app/CaseScreen";
import { api } from "../src/api/client";

it("never pre-fills clinical axis values (no assertion default for HPO terms)", () => {
  const axes = [
    { id: "assertion", options: ["present", "absent"] },
    { id: "experiencer", options: ["patient", "other"] },
    { id: "temporality", options: ["current", "historical"] },
  ];
  expect(initialAxisValues(axes, "HP:0001252")).toEqual({
    assertion: null, experiencer: null, temporality: null,
  });
  expect(initialAxisValues(axes, "MONDO:0000001")).toEqual({
    assertion: null, experiencer: null, temporality: null,
  });
});

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
      scope_id: "scope-default",
      target_set_id: "targets-0",
    },
    scope: {
      scope_id: "scope-default",
      mode: "independent",
      editable_layer_ids: ["phenotype"],
      reference_layer_ids: [],
    },
    layers: [
      {
        layer_id: "phenotype",
        label: "Phänotyp",
        ontology_id: "hp",
        access: "editable",
        default_visible: true,
        default_type_id: "default",
        annotation_types: [
          {
            type_id: "default",
            label: "Phänotyp",
            evidence_policy: "optional",
            axes: [
              { id: "assertion", label: "Vorhandensein (Assertion)", options: ["present", "absent", "uncertain"], allow_empty: true },
              { id: "experiencer", label: "Betroffene Person (Experiencer)", options: ["patient", "other"], allow_empty: true },
              { id: "temporality", label: "Zeitlicher Bezug (Temporality)", options: ["current", "historical", "future"], allow_empty: true },
            ],
          },
        ],
      },
    ],
    ontologies: [
      {
        ontology_id: "hp",
        release: "2024-06-25",
        label: "Human Phenotype Ontology",
        sha256: "test-hp-sha",
        format: "obo-graph-json",
      },
    ],
    checked_layer_ids: [],
    draft: {
      key: {
        package_id: "pkg-1",
        document_id: "doc-test-1",
        annotator_id: "user-test",
        mode: "independent",
        scope_id: "scope-default",
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
      checked_layer_ids: [],
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

    expect(screen.getByText(/Case: doc-test-1|Fall: doc-test-1/i)).toBeDefined();
    expect(screen.getByText(/Annotate from scratch/i)).toBeDefined();
    expect(screen.getByText(/No annotation selected|Keine Annotation ausgewählt/i)).toBeDefined();
  });

  it("switches the compact view between text, list, and details", () => {
    const rendered = render(
      <CaseScreen view={sampleView} workspaceId="ws-test-token" onClose={vi.fn()} />
    );
    const layout = rendered.container.querySelector(".app-layout")!;
    expect(layout.classList.contains("mobile-pane-text")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /List|Liste/i }));
    expect(layout.classList.contains("mobile-pane-list")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(layout.classList.contains("mobile-pane-details")).toBe(true);
  });

  it("creates spanless annotation without text segments", async () => {
    const updatedDraft = {
      ...sampleView.draft,
      revision: 1,
      annotations: [
        {
          schema_version: "ontocurator-annotation/v3" as const,
          annotation: {
            annotation_id: "ann-spanless-1",
            document_id: "doc-test-1",
            layer_id: "phenotype",
            type_id: "default",
            term_id: "HP:0001252",
            axes_values: {
              assertion: "present",
              experiencer: null,
              temporality: null,
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
          layer_config_sha256: "test-layer-sha",
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

    vi.spyOn(api, "searchOntology").mockResolvedValue({
      search_id: "search-spanless",
      candidates: [{ term_id: "HP:0001252", label: "Hypotonia", rank: 1 }],
    } as any);

    // Click "+ New Annotation" / "+ Neue Annotation"
    fireEvent.click(screen.getByText(/\+ (New Annotation|Neue Annotation)/i));

    // Shows search panel for new annotation
    expect(screen.getByText(/Select term for new annotation|Begriff für neue Annotation wählen/i)).toBeDefined();
    fireEvent.change(screen.getByLabelText(/Search ontology term|Ontologie-Term suchen/i), { target: { value: "Hypotonia" } });
    fireEvent.keyDown((await screen.findByText("Hypotonia")).closest(".candidate-card")!, { key: "Enter" });

    await waitFor(() => {
      expect(applyCommandSpy).toHaveBeenCalledWith(
        "ws-test-token",
        expect.objectContaining({
          expected_revision: 0,
          payload: expect.objectContaining({
            command: "create_annotation",
            term_id: "HP:0001252",
            segments: [],
            axes_values: {
              assertion: null,
              experiencer: null,
              temporality: null,
            },
          }),
        })
      );
    });

    // Check that the annotation appears in the list
    expect(screen.getByText("HP:0001252")).toBeDefined();
    expect(screen.getAllByText(/Spanless|Spanlos/i).length).toBeGreaterThanOrEqual(1);
  });

  it("offers the search languages of the layer's ontology and remembers the annotator's choice", async () => {
    vi.spyOn(api, "listPackageOntologies").mockResolvedValue([
      {
        ontology_id: "hp",
        release: "2024-06-25",
        sha256: "TEST-HP-SHA",
        term_count: 11,
        translations: [
          { language: "de", filenames: ["hp-de.babelon.tsv"], term_count: 4 },
          { language: "es", filenames: ["hp-es.babelon.tsv"], term_count: 3 },
        ],
      },
    ]);
    vi.spyOn(api, "getPreferences").mockResolvedValue({
      last_annotator_id: "user-test",
      mode_by_package: {},
      search_languages_by_annotator: { "user-test": ["es"], "someone-else": ["de"] },
    });
    const store = vi.spyOn(api, "updatePreferences").mockResolvedValue({} as any);
    const search = vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "s", candidates: [] } as any);

    render(<CaseScreen view={sampleView} workspaceId="ws-test-token" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/\+ (New Annotation|Neue Annotation)/i));

    // The stored selection of this annotator is back after loading.
    const button = await screen.findByRole("button", { name: "Search languages: EN, ES" });
    fireEvent.change(screen.getByLabelText(/Search ontology term/i), { target: { value: "Krampfanfall" } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search.mock.calls[0][0].languages).toEqual(["es"]);

    fireEvent.click(button);
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));

    expect(store).toHaveBeenCalledWith({ search_languages_by_annotator: { "user-test": ["de", "es"] } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search.mock.calls[1][0].languages).toEqual(["de", "es"]);
    expect(search.mock.calls[1][0].query).toBe("Krampfanfall");
  });

  it("shows no language button when the ontology has no translations", async () => {
    const listed = vi.spyOn(api, "listPackageOntologies").mockResolvedValue([
      { ontology_id: "hp", release: "2024-06-25", sha256: "test-hp-sha", term_count: 11, translations: [] },
    ]);
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "user-test", mode_by_package: {} });

    render(<CaseScreen view={sampleView} workspaceId="ws-test-token" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/\+ (New Annotation|Neue Annotation)/i));

    await waitFor(() => expect(listed).toHaveBeenCalledWith(sampleView.key.package_id));
    expect(screen.getByLabelText(/Search ontology term/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Search languages/ })).toBeNull();
  });

  it("updates clinical axes on an existing annotation", async () => {
    const viewWithAnn = {
      ...sampleView,
      draft: {
        ...sampleView.draft,
        revision: 1,
        annotations: [
          {
            schema_version: "ontocurator-annotation/v3" as const,
            annotation: {
              annotation_id: "ann-1",
              document_id: "doc-test-1",
              layer_id: "phenotype",
              type_id: "default",
              term_id: "HP:0001252",
              axes_values: {
                assertion: null,
                experiencer: null,
                temporality: null,
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
            layer_config_sha256: "test-layer-sha",
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
            axes_values: {
              assertion: "absent",
              experiencer: null,
              temporality: null,
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

    expect((screen.getAllByRole("radio", { name: /Not specified|Nicht angegeben/i })[0] as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Absent|Nicht vorhanden/i }));

    await waitFor(() => {
      expect(applyCommandSpy).toHaveBeenCalledWith(
        "ws-test-token",
        expect.objectContaining({
          expected_revision: 1,
          payload: expect.objectContaining({
            command: "set_axes",
            annotation_id: "ann-1",
            axes_values: expect.objectContaining({
              assertion: "absent",
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
            schema_version: "ontocurator-annotation/v3" as const,
            annotation: {
              annotation_id: "ann-to-del",
              document_id: "doc-test-1",
              layer_id: "phenotype",
              type_id: "default",
              term_id: "HP:0001252",
              axes_values: {},
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
            layer_config_sha256: "test-layer-sha",
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
    fireEvent.click(screen.getByText(/Delete Annotation|Annotation löschen/i));
    // Deletion requires an explicit confirmation
    fireEvent.click(screen.getByRole("button", { name: /Yes, delete/i }));

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
  it("keeps a pending span local and creates only the term chosen in a configured ontology", async () => {
    const view = structuredClone(sampleView);
    view.layers![0].ontology_id = "custom-ontology";
    const search = vi.spyOn(api, "searchOntology").mockResolvedValue({
      search_id: "search-custom", candidates: [{ term_id: "CUSTOM:42", label: "Custom finding", rank: 1 }],
    } as any);
    const mutate = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
    const rendered = render(<CaseScreen view={view} workspaceId="ws-custom" onClose={vi.fn()} />);
    const text = rendered.container.querySelector(".text-container")!;
    const node = text.querySelector(".run")!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 3);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.mouseUp(text);
    expect(screen.getByLabelText(/New Annotation|Neue Annotation/i)).toBeDefined();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Search ontology term|Ontologie-Term suchen/i), { target: { value: "Custom" } });
    fireEvent.keyDown((await screen.findByText("Custom finding")).closest(".candidate-card")!, { key: "Enter" });
    await waitFor(() => expect(mutate).toHaveBeenCalledWith("ws-custom", expect.objectContaining({
      expected_revision: 0,
      payload: expect.objectContaining({ command: "create_annotation", layer_id: "phenotype",
        type_id: "default", term_id: "CUSTOM:42", segments: [{ start: 0, end: 3 }], search_event_id: "search-custom" }),
    })));
    expect(search.mock.calls[0][0]).toEqual(expect.objectContaining({ layer_id: "phenotype" }));
    expect(search.mock.calls[0][0].annotation_id).toBe(mutate.mock.calls[0][1].payload.annotation_id);
  });

  it("does not expose imported sources in an independent view", () => {
    const view = structuredClone(sampleView);
    view.available_inputs = [{ annotation: { annotation_id: "private", layer_id: "phenotype", term_id: "SECRET:42" }, evidence: [], version: "v" }] as any;
    render(<CaseScreen view={view} workspaceId="ws-independent" onClose={vi.fn()} />);
    expect(screen.queryByText(/SECRET:42/)).toBeNull();
    expect(screen.queryByLabelText(/Reference annotations|Referenzannotationen/i)).toBeNull();
  });

  it("navigates cases using Alt+ArrowRight and Alt+ArrowLeft keyboard shortcuts", async () => {
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    const docs = [
      { document_id: "doc-1", text_length: 100, language: "de", position: 1, status: "completed" as const },
      { document_id: "doc-test-1", text_length: 100, language: "de", position: 2, status: "in_progress" as const },
      { document_id: "doc-3", text_length: 100, language: "de", position: 3, status: "not_started" as const },
    ];

    render(
      <CaseScreen
        view={sampleView}
        workspaceId="ws-test"
        onClose={vi.fn()}
        onNavigateCase={onNavigate}
        documentList={docs}
      />
    );

    // Alt + ArrowRight -> next document
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("doc-3");
    });

    // Alt + ArrowLeft -> previous document
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("doc-1");
    });
  });

});

