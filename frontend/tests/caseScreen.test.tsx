import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, initialAxisValues, type WorkspaceView } from "../src/app/CaseScreen";
import { api, ConflictError, ValidationError, type Draft } from "../src/api/client";

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
      project_key: "pkg-1",
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
        project_key: "pkg-1",
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

  describe("editor logout guard", () => {
    const setup = (pending = false, transport = false) => {
      const view = structuredClone(sampleView);
      view.layers!.push({ ...view.layers![0], layer_id: "disease", label: "Disease", access: "reference" });
      const leaveGuardRef = { current: null as ((proceed: () => void) => void) | null };
      const onLogout = vi.fn();
      let resolve!: (draft: Draft) => void;
      let reject!: (error: unknown) => void;
      const save = new Promise<Draft>((res, rej) => { resolve = res; reject = rej; });
      const command = transport
        ? vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(await save), { status: 200, headers: { "Content-Type": "application/json" } }))
        : vi.spyOn(api, "applyCommand").mockReturnValue(save);
      const rendered = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} leaveGuardRef={leaveGuardRef} />);
      if (pending) fireEvent.click(screen.getByRole("button", { name: /Mark .* as verified/i }));
      return { view, leaveGuardRef, onLogout, resolve, reject, command, rendered };
    };

    it("logout_with_pending_changes_asks_first_and_cancel_keeps_the_session", async () => {
      const state = setup(true);
      act(() => state.leaveGuardRef.current?.(state.onLogout));
      expect(await screen.findByRole("dialog", { name: "Unsaved changes" })).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(state.onLogout).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("button", { name: /Finish & Submit Case/ })).toBeDefined();
      act(() => state.leaveGuardRef.current?.(state.onLogout));
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(state.onLogout).not.toHaveBeenCalled();
    });

    it("save_and_log_out_flushes_the_draft_before_logging_out", async () => {
      const state = setup(true, true);
      act(() => state.leaveGuardRef.current?.(state.onLogout));
      fireEvent.click(await screen.findByRole("button", { name: "Save and log out" }));
      await waitFor(() => expect(state.command).toHaveBeenCalledWith("/api/v1/workspaces/ws/commands", expect.objectContaining({ method: "POST" })));
      expect(state.onLogout).not.toHaveBeenCalled();
      state.resolve({ ...state.view.draft, revision: 1, checked_layer_ids: ["phenotype"] });
      await waitFor(() => expect(state.onLogout).toHaveBeenCalledOnce());
    });

    it.each([new TypeError("Failed to fetch"), new ValidationError("Save refused"), new ConflictError()])("a_failed_flush_does_not_log_out: %s", async (error) => {
      const state = setup(true);
      act(() => state.leaveGuardRef.current?.(state.onLogout));
      fireEvent.click(await screen.findByRole("button", { name: "Save and log out" }));
      state.reject(error);
      await screen.findAllByRole("alert");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(state.onLogout).not.toHaveBeenCalled();
      if (error instanceof ValidationError) expect(screen.getByRole("alert").textContent).toBe("Save refused");
    });

    it("a_command_rejected_while_logout_waits_does_not_log_out", async () => {
      const state = setup(true);
      act(() => state.leaveGuardRef.current?.(state.onLogout));
      await screen.findByRole("dialog", { name: "Unsaved changes" });
      state.reject(new ValidationError("Save refused while waiting"));
      await screen.findByText("Save refused while waiting");
      fireEvent.click(screen.getByRole("button", { name: "Save and log out" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(state.onLogout).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toBe("Save refused while waiting");
      expect(screen.getByRole("group", { name: "Case" })).toBeDefined();
    });

    it("logout_without_changes_has_no_dialog", () => {
      const state = setup();
      act(() => state.leaveGuardRef.current?.(state.onLogout));
      expect(state.onLogout).toHaveBeenCalledOnce();
      expect(screen.queryByRole("dialog")).toBeNull();
      state.rendered.unmount();
      expect(state.leaveGuardRef.current).toBeNull();
    });
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

    await waitFor(() => expect(listed).toHaveBeenCalledWith(sampleView.key.project_key));
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

  it("escape_cancels_the_submit_dialog", async () => {
    render(<CaseScreen view={sampleView} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Submit case" })).toBeNull();
    expect(screen.getByRole("button", { name: /Finish & Submit Case/i })).toBeDefined();
  });

  it("the_case_submitted_dialog_ignores_escape", async () => {
    vi.spyOn(api, "submitWorkspace").mockResolvedValue({
      submission_id: "submission-1", created_at: "2026-10-15T10:00:00Z",
      snapshots: [], decisions: [], checked_layer_ids: [], document_checked: true,
    } as any);
    render(<CaseScreen view={sampleView} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    await screen.findByRole("dialog", { name: "Submit case" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Entire text checked for further findings" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit case" }));
    const dialog = await screen.findByRole("dialog", { name: "Case submitted" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Case submitted" })).toBe(dialog);
    fireEvent.click(screen.getByRole("button", { name: "Stay in case" }));
    expect(screen.queryByRole("dialog", { name: "Case submitted" })).toBeNull();
  });

  it("the_help_lists_review_keys_only_in_review_mode", () => {
    const rendered = render(<CaseScreen view={sampleView} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.queryByText("Next / previous review proposal")).toBeNull();
    expect(screen.queryByText("Confirm selected proposal")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    const view = structuredClone(sampleView);
    view.key.mode = "review";
    view.targets!.targets = [{ annotation_id: "proposal-1", version: "v1" }];
    rendered.rerender(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Next / previous review proposal")).toBeDefined();
    expect(screen.getByText("Confirm selected proposal")).toBeDefined();
    expect(screen.getByText("Reject selected proposal")).toBeDefined();
    expect(screen.getByText("Adopt proposal as editable copy")).toBeDefined();
    expect(screen.getByText("Mark selected proposal as uncertain")).toBeDefined();
  });

  describe("Finish & Submit while a save is pending", () => {
    // Two layers, one editable: submitting requires the editable layer to be verified.
    const twoLayerView = (): WorkspaceView => ({
      ...sampleView,
      scope: { ...sampleView.scope!, editable_layer_ids: ["phenotype"], reference_layer_ids: ["disease"] },
      layers: [
        sampleView.layers![0],
        { ...sampleView.layers![0], layer_id: "disease", label: "Disease", access: "reference" },
      ],
    });
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const finishButton = () => screen.getByRole("button", { name: /Finish & Submit Case/i });

    it("waits for the save and validates against the saved draft", async () => {
      const view = twoLayerView();
      const save = deferred<Draft>();
      const apply = vi.spyOn(api, "applyCommand").mockReturnValue(save.promise);
      render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: /Mark Phänotyp as verified/i }));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      fireEvent.click(finishButton());

      // No validation against the draft from before the save ...
      expect(screen.queryByRole("alert")).toBeNull();
      // ... and the click is not lost: the button reports that it waits for the save.
      await waitFor(() => expect(finishButton().getAttribute("aria-busy")).toBe("true"));
      expect(screen.queryByRole("dialog", { name: /Submit case/i })).toBeNull();

      save.resolve({ ...view.draft, revision: 1, checked_layer_ids: ["phenotype"] });

      expect(await screen.findByRole("dialog", { name: /Submit case/i })).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(finishButton().getAttribute("aria-busy")).not.toBe("true");
    });

    it("shows the error of a failed save and opens no submit dialog", async () => {
      const view = twoLayerView();
      view.draft = { ...view.draft, checked_layer_ids: ["phenotype"] };
      const save = deferred<Draft>();
      vi.spyOn(api, "applyCommand").mockReturnValue(save.promise);
      render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);

      // Reset the verification; the server refuses this edit.
      fireEvent.click(screen.getByRole("button", { name: /Mark Phänotyp as verified/i }));
      fireEvent.click(finishButton());
      save.reject(new ValidationError("Layer cannot be changed"));

      expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Layer cannot be changed");
      await waitFor(() => expect(finishButton().getAttribute("aria-busy")).not.toBe("true"));
      expect(screen.queryByRole("dialog", { name: /Submit case/i })).toBeNull();
    });

    it("still explains the stopped submit after a later edit clears the save error", async () => {
      const view = twoLayerView();
      view.draft = { ...view.draft, checked_layer_ids: ["phenotype"] };
      const save = deferred<Draft>();
      vi.spyOn(api, "applyCommand")
        .mockReturnValueOnce(save.promise)
        .mockResolvedValueOnce({ ...view.draft, revision: 1, checked_layer_ids: [] });
      render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: /Mark Phänotyp as verified/i }));
      fireEvent.click(finishButton());
      save.reject(new ValidationError("Layer cannot be changed"));
      await screen.findByText("Layer cannot be changed");
      await waitFor(() => expect(finishButton().getAttribute("aria-busy")).not.toBe("true"));

      // A new edit clears the error of the refused save; the stopped submit stays explained.
      fireEvent.click(screen.getByRole("button", { name: /Mark Phänotyp as verified/i }));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe("A change could not be saved; the case was not submitted."),
      );
      expect(screen.queryByRole("dialog", { name: /Submit case/i })).toBeNull();
    });

    it("reports an unreachable server during the wait and opens no submit dialog", async () => {
      const view = twoLayerView();
      const save = deferred<Draft>();
      vi.spyOn(api, "applyCommand").mockReturnValue(save.promise);
      render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: /Mark Phänotyp as verified/i }));
      fireEvent.click(finishButton());
      save.reject(new TypeError("Failed to fetch"));

      expect((await screen.findByRole("alert")).textContent).toMatch(/Pending changes could not be saved/);
      expect(screen.getByRole("status").textContent).toMatch(/Offline – changes not saved/);
      await waitFor(() => expect(finishButton().getAttribute("aria-busy")).not.toBe("true"));
      expect(screen.queryByRole("dialog", { name: /Submit case/i })).toBeNull();
    });
  });
});
