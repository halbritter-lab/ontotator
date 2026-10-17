import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    allow_spanless_findings: true, enforce_spanless_rules: false,
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

  const withEditableFinding = (view: WorkspaceView) => {
    view.draft.annotations = [{ schema_version: "ontocurator-annotation/v3", version: "pending-v1",
      document_id: view.document.document_id, text_sha256: "text", ontology_sha256: "ontology", layer_config_sha256: "layer",
      annotation: { annotation_id: "pending-finding", document_id: view.document.document_id, layer_id: "phenotype",
        type_id: "default", term_id: "HP:0001252", axes_values: {}, evidence_refs: [],
        provenance: { actor: { actor_id: "user-test", kind: "human" }, method: "manual", source_refs: [] } }, evidence: [] }];
    return view;
  };
  const selectEditableFinding = () => fireEvent.click(document.querySelector('[data-list-key="annotation:pending-finding"]')!);
  const editFinding = () => fireEvent.click(screen.getByRole("radio", { name: "Present" }));

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("editor logout guard", () => {
    const setup = (pending = false, transport = false) => {
      const view = withEditableFinding(structuredClone(sampleView));
      view.layers!.push({ ...view.layers![0], layer_id: "disease", label: "Disease", access: "reference" });
      const leaveGuardRef = { current: null as ((proceed: () => void) => void) | null };
      const onLogout = vi.fn();
      let resolve!: (draft: Draft) => void;
      let reject!: (error: unknown) => void;
      const save = new Promise<Draft>((res, rej) => { resolve = res; reject = rej; });
      const command = transport
        ? vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith("/commands") ? await save : []), { status: 200, headers: { "Content-Type": "application/json" } }))
        : vi.spyOn(api, "applyCommand").mockReturnValue(save);
      const rendered = render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} leaveGuardRef={leaveGuardRef} />);
      selectEditableFinding();
      if (pending) editFinding();
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

  it("requires a spanless reason only when the workspace enforces the new rules", async () => {
    const view = { ...sampleView, enforce_spanless_rules: true, allow_spanless_findings: true };
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
    vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "s", candidates: [{ term_id: "HP:0001252", label: "Hypotonia", rank: 1 }] } as any);
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    fireEvent.change(screen.getByLabelText(/Search ontology term/), { target: { value: "Hypotonia" } });
    const candidate = (await screen.findByText("Hypotonia")).closest(".candidate-card")!;
    fireEvent.keyDown(candidate, { key: "Enter" });
    expect(apply).not.toHaveBeenCalled();
    const reason = screen.getByLabelText(/Reason for no text span/);
    fireEvent.change(reason, { target: { value: "  Summary outside this excerpt  " } });
    fireEvent.keyDown(candidate, { key: "Enter" });
    await waitFor(() => expect(apply).toHaveBeenCalledWith("ws", expect.objectContaining({ payload: expect.objectContaining({ command: "create_annotation", note: "Summary outside this excerpt" }) })));
  });

  it("explains prohibited spanless creation without overriding profile evidence requirements", () => {
    const view = structuredClone(sampleView);
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: false });
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add finding without a text span" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This project requires a text span for findings.")).toBeDefined();
  });

  it("keeps an unsaved annotation note across selection and saves it through the mutation queue", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    selectEditableFinding();
    fireEvent.change(screen.getByLabelText("Annotation note"), { target: { value: "Clinical explanation" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    selectEditableFinding();
    expect((screen.getByLabelText("Annotation note") as HTMLTextAreaElement).value).toBe("Clinical explanation");
    fireEvent.blur(screen.getByLabelText("Annotation note"));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("ws", expect.objectContaining({ payload: { command: "set_annotation_note", annotation_id: "pending-finding", note: "Clinical explanation" } })));
  });

  it("a delayed failed note save stays with its annotation after the target changes", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const second = structuredClone(view.draft.annotations![0]); second.annotation.annotation_id = "second-finding";
    view.draft.annotations!.push(second);
    let rejectSave!: (error: unknown) => void;
    const apply = vi.spyOn(api, "applyCommand").mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));
    render(<CaseScreen view={view} workspaceId="ws-note" onClose={vi.fn()} />);
    selectEditableFinding();
    fireEvent.change(screen.getByLabelText("Annotation note"), { target: { value: "First unsaved explanation" } });
    fireEvent.blur(screen.getByLabelText("Annotation note"));
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    fireEvent.click(document.querySelector('[data-list-key="annotation:second-finding"]')!);
    fireEvent.change(screen.getByLabelText("Annotation note"), { target: { value: "Second local explanation" } });
    await act(async () => { rejectSave(new ValidationError("Delayed note refusal")); });
    expect((screen.getByLabelText("Annotation note") as HTMLTextAreaElement).value).toBe("Second local explanation");
    selectEditableFinding();
    expect((screen.getByLabelText("Annotation note") as HTMLTextAreaElement).value).toBe("First unsaved explanation");
    expect(apply).toHaveBeenCalledWith("ws-note", expect.objectContaining({ payload: expect.objectContaining({ annotation_id: "pending-finding", note: "First unsaved explanation" }) }));
  });

  it("retains failed note autosaves and guards empty spanless reasons on submit and logout", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true });
    Object.assign(view.draft.annotations![0].annotation, { note: "Stored reason" });
    const apply = vi.spyOn(api, "applyCommand").mockRejectedValue(new ValidationError("Note save refused"));
    const leaveGuardRef = { current: null as ((proceed: () => void) => void) | null };
    const logout = vi.fn();
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} leaveGuardRef={leaveGuardRef} />);
    selectEditableFinding();
    const field = screen.getByLabelText(/Reason for no text span/);
    fireEvent.change(field, { target: { value: "New reason" } });
    fireEvent.blur(field);
    await screen.findByText("Note save refused");
    expect((field as HTMLTextAreaElement).value).toBe("New reason");
    fireEvent.change(field, { target: { value: "  " } }); fireEvent.blur(field);
    expect(apply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/ }));
    await screen.findByText("A reason is required for findings without a text span.");
    expect(screen.queryByRole("dialog", { name: "Submit case" })).toBeNull();
    act(() => leaveGuardRef.current?.(logout));
    await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(logout).not.toHaveBeenCalled();
  });

  it("keeps profile-required evidence mandatory even when the project permits spanless findings", () => {
    const view = structuredClone(sampleView);
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true });
    view.layers![0].annotation_types[0].evidence_policy = "required_on_complete";
    render(<CaseScreen view={view} workspaceId="ws" onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add finding without a text span" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This annotation type requires a text span.")).toBeDefined();
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
    fireEvent.click(screen.getByText(/Add finding without a text span/i));

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
    fireEvent.click(screen.getByText(/Add finding without a text span/i));

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
    fireEvent.click(screen.getByText(/Add finding without a text span/i));

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

  it("labels existing own history by displayed ordinal and opens the exact submission details", () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const first = view.draft.annotations![0]; const second = structuredClone(first);
    second.annotation.annotation_id = "second-history-finding"; second.annotation.term_id = "HP:0001250";
    view.draft.annotations = [];
    const base = { format_version: "ontocurator-submission/v2", origin_key: view.key,
      targets: view.targets!, draft_revision: 1, snapshots: [first], decisions: [], document_checked: true,
      created_at: new Date(2026, 9, 17, 9, 5).toISOString() };
    view.submissions = [{ ...base, submission_id: "sub-exact-first" },
      { ...base, submission_id: "sub-exact-second", snapshots: [second] }];
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Submission 1 · 17 Oct 2026, 09:05" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /sub-exact-second/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submission 2 · 17 Oct 2026, 09:05" }));
    const dialog = screen.getByRole("dialog", { name: "Historical submission" });
    expect(within(dialog).getByRole("heading", { name: "Submission 2 · 17 Oct 2026, 09:05" })).toBeDefined();
    fireEvent.click(within(dialog).getByText("Technical details"));
    expect(within(dialog).getByText("sub-exact-second")).toBeDefined();
    expect(within(dialog).queryByText("sub-exact-first")).toBeNull();
    expect(within(dialog).getByText("HP:0001250")).toBeDefined();
    expect(within(dialog).queryByText("HP:0001252")).toBeNull();
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
    expect(screen.getByText("Mark selected proposal as unresolved (note required)")).toBeDefined();
  });

  it("counts hidden defaulted annotations and jumps to their axes without confirming them", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    view.layers!.push({ ...view.layers![0], layer_id: "disease", label: "Disease", access: "reference" });
    const annotation = view.draft.annotations![0].annotation;
    annotation.axes_values = { assertion: "present", experiencer: "patient", temporality: "current" };
    annotation.axes_defaulted = ["assertion", "experiencer", "temporality"];
    const apply = vi.spyOn(api, "applyCommand").mockImplementation(async () => {
      const next = structuredClone(view.draft); next.revision = 1;
      next.annotations![0].annotation.axes_defaulted = ["experiencer", "temporality"];
      return next;
    });
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Visibility for Phänotyp/i }));
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    expect(await screen.findByText("1 annotations have defaulted axis values.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Review defaulted annotations" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("axes-section")));
    expect((screen.getByRole("checkbox", { name: /Visibility for Phänotyp/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Defaulted axes")).toBeDefined();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirm Vorhandensein.* value/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("ws-test", expect.objectContaining({ payload: expect.objectContaining({ chosen_axis_ids: ["assertion"] }) })));
  });

  it("outcome keys set decisions repeatedly and zero resets while inputs, IME and dialogs suppress them", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const proposal = view.draft.annotations![0];
    view.draft.annotations = []; view.available_inputs = [proposal];
    view.key.mode = "review"; view.draft.key.mode = "review";
    view.targets!.targets = [{ annotation_id: proposal.annotation.annotation_id, version: proposal.version }];
    view.draft.targets = view.targets!;
    let saved = structuredClone(view.draft);
    const record = vi.spyOn(api, "recordDecision").mockImplementation(async (_id, envelope) => {
      const payload = envelope.payload as any;
      saved = { ...saved, revision: saved.revision + 1, decisions: payload.outcome === null ? [] : [{
        decision_id: "decision", target: payload.target, outcome: payload.outcome, note: payload.note, reviewer_id: "user-test",
      }] };
      return saved;
    });
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    fireEvent.change(screen.getByRole("textbox", { name: /Reviewer note/ }), { target: { value: "Review required" } });
    for (const [key, outcome] of [["1", "confirmed"], ["2", "rejected"], ["4", "uncertain"]]) {
      for (let repeat = 0; repeat < 2; repeat++) {
        fireEvent.keyDown(window, { key });
        await waitFor(() => expect(record).toHaveBeenLastCalledWith("ws-test", expect.objectContaining({ payload: expect.objectContaining({ outcome }) })));
      }
    }
    const note = screen.getByRole("textbox", { name: /Reviewer note/i });
    fireEvent.change(note, { target: { value: "Keep this draft" } });
    const calls = record.mock.calls.length;
    fireEvent.keyDown(note, { key: "1" }); fireEvent.keyDown(window, { key: "2", isComposing: true });
    expect(record).toHaveBeenCalledTimes(calls);
    fireEvent.keyDown(window, { key: "0" });
    await waitFor(() => expect(record).toHaveBeenLastCalledWith("ws-test", expect.objectContaining({ payload: expect.objectContaining({ outcome: null }) })));
    expect((note as HTMLTextAreaElement).value).toBe("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    await screen.findByRole("dialog", { name: /Submit case/i });
    const beforeModal = record.mock.calls.length;
    fireEvent.keyDown(window, { key: "1" });
    expect(record).toHaveBeenCalledTimes(beforeModal);
  });

  it("key four requires a note before changing the reviewer decision", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const proposal = view.draft.annotations![0]; view.draft.annotations = [];
    view.available_inputs = [proposal]; view.key.mode = "review"; view.draft.key.mode = "review";
    view.targets!.targets = [{ annotation_id: proposal.annotation.annotation_id, version: proposal.version }];
    view.draft.targets = view.targets!;
    const record = vi.spyOn(api, "recordDecision").mockResolvedValue(view.draft);
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    fireEvent.keyDown(window, { key: "4" });
    const note = screen.getByRole("textbox", { name: "Reviewer note" });
    expect(record).not.toHaveBeenCalled(); expect(document.activeElement).toBe(note);
    expect(note.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(note, { target: { value: "Needs specialist input" } });
    fireEvent.keyDown(window, { key: "4" });
    await waitFor(() => expect(record).toHaveBeenCalledWith("ws-test", expect.objectContaining({
      payload: expect.objectContaining({ outcome: "uncertain", note: "Needs specialist input" }),
    })));
  });

  it("keeps the editable reviewer note when the server refuses a decision save", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const proposal = view.draft.annotations![0]; view.draft.annotations = [];
    view.available_inputs = [proposal]; view.key.mode = "review"; view.draft.key.mode = "review";
    view.targets!.targets = [{ annotation_id: proposal.annotation.annotation_id, version: proposal.version }];
    view.draft.targets = view.targets!;
    vi.spyOn(api, "recordDecision").mockRejectedValue(new ValidationError("Reviewer note could not be saved"));
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    const note = screen.getByRole("textbox", { name: "Reviewer note" });
    fireEvent.change(note, { target: { value: "  Keep this attempted note  " } });
    fireEvent.click(screen.getByRole("button", { name: /Unresolved/ }));
    expect(await screen.findByText("Reviewer note could not be saved")).toBeDefined();
    expect((note as HTMLInputElement).value).toBe("  Keep this attempted note  ");
  });

  it("keeps an untouched legacy missing-note decision clean and permits logout while blocking a new submission", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const proposal = view.draft.annotations![0]; view.draft.annotations = [];
    view.available_inputs = [proposal]; view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: proposal.annotation.annotation_id, version: proposal.version };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    view.draft.decisions = [{ decision_id: "legacy", target, outcome: "uncertain", reviewer_id: "r" }];
    const logout = vi.fn();
    const leaveGuardRef = { current: null as ((proceed: () => void) => void) | null };
    const routeLeaveRef = { current: null as (() => Promise<boolean>) | null };
    const submit = vi.spyOn(api, "submitWorkspace");
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} leaveGuardRef={leaveGuardRef} routeLeaveRef={routeLeaveRef} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    expect(screen.getByText(/^Saved$/)).toBeDefined();
    const unloading = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloading); expect(unloading.defaultPrevented).toBe(false);
    act(() => leaveGuardRef.current?.(logout));
    expect(logout).toHaveBeenCalledOnce();
    await act(async () => { expect(await routeLeaveRef.current!()).toBe(true); });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/ }));
    expect((await screen.findAllByText(/unresolved proposals require a reviewer note before submitting/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog", { name: /Submit case/ })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Reviewer note" }));
  });

  it("blocks submit for a blank local unresolved note after selecting another target", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const first = view.draft.annotations![0]; const second = structuredClone(first);
    second.annotation.annotation_id = "second-proposal"; second.version = "second-v";
    view.draft.annotations = []; view.available_inputs = [first, second];
    view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: first.annotation.annotation_id, version: first.version };
    const other = { annotation_id: second.annotation.annotation_id, version: second.version };
    view.targets!.targets = [target, other]; view.draft.targets = view.targets!;
    view.draft.decisions = [{ decision_id: "first", target, outcome: "uncertain", note: "Stored reason", reviewer_id: "r" },
      { decision_id: "second", target: other, outcome: "confirmed", reviewer_id: "r" }];
    const record = vi.spyOn(api, "recordDecision").mockImplementation(async (_id, envelope) => {
      const next = structuredClone(view.draft); next.revision++;
      next.decisions![0].note = envelope.payload.note as string;
      return next;
    });
    const submit = vi.spyOn(api, "submitWorkspace");
    const logout = vi.fn();
    const leaveGuardRef = { current: null as ((proceed: () => void) => void) | null };
    const routeLeaveRef = { current: null as (() => Promise<boolean>) | null };
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} leaveGuardRef={leaveGuardRef} routeLeaveRef={routeLeaveRef} />);
    const targets = document.querySelectorAll('[data-list-key^="target:"]');
    fireEvent.click(targets[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer note" }), { target: { value: "  " } });
    fireEvent.click(targets[1]);
    expect(screen.getByText("Reviewer note required – changes not saved")).toBeDefined();
    act(() => leaveGuardRef.current?.(logout));
    expect(logout).not.toHaveBeenCalled();
    let departure!: Promise<boolean>;
    act(() => { departure = routeLeaveRef.current!(); });
    await screen.findByRole("dialog", { name: "Changes not saved" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => { expect(await departure).toBe(false); });
    const unloading = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloading); expect(unloading.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Submit case/ })).toBeNull());
    expect((await screen.findAllByText(/unresolved proposals require a reviewer note before submitting/)).length).toBeGreaterThan(0);
    const note = screen.getByRole("textbox", { name: "Reviewer note" });
    expect((note as HTMLInputElement).value).toBe("  "); expect(document.activeElement).toBe(note);
    expect(record).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    fireEvent.change(note, { target: { value: "Corrected reviewer note" } }); fireEvent.blur(note);
    await waitFor(() => expect(record).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/ }));
    expect(await screen.findByRole("dialog", { name: /Submit case/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer note" }), { target: { value: "" } });
    act(() => { departure = routeLeaveRef.current!(); });
    await screen.findByRole("dialog", { name: "Changes not saved" });
    fireEvent.click(screen.getByRole("button", { name: "Discard edits and leave" }));
    await act(async () => { expect(await departure).toBe(true); });
    expect((screen.getByRole("textbox", { name: "Reviewer note" }) as HTMLInputElement).value).toBe("Corrected reviewer note");
    expect(record).toHaveBeenCalledOnce();

  });

  it("key three resumes the exact saved replacement without adopting another copy", () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const replacement = view.draft.annotations![0];
    const proposal = structuredClone(replacement);
    proposal.annotation.annotation_id = "source-proposal"; proposal.version = "source-version";
    replacement.annotation.provenance.source_refs = ["source-proposal:source-version"];
    view.available_inputs = [proposal]; view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: "source-proposal", version: "source-version" };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    view.draft.decisions = [{ decision_id: "d", reviewer_id: "reviewer", outcome: "changed", target,
      replacement: { annotation_id: replacement.annotation.annotation_id, version: replacement.version } }];
    const apply = vi.spyOn(api, "applyCommand"); const decide = vi.spyOn(api, "recordDecision");
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!); fireEvent.keyDown(window, { key: "3" });
    expect(screen.getByTestId("axes-section")).toBeDefined();
    expect(document.querySelector('[data-list-key="annotation:pending-finding"]')?.classList.contains("selected")).toBe(true);
    expect(apply).not.toHaveBeenCalled(); expect(decide).not.toHaveBeenCalled();
  });

  it.each([true, false])("note autosave synchronizes the exact replacement version (existing decision: %s)", async (existingDecision) => {
    const view = withEditableFinding(structuredClone(sampleView));
    const replacement = view.draft.annotations![0];
    const proposal = structuredClone(replacement);
    proposal.annotation.annotation_id = "source-proposal"; proposal.version = "source-version";
    replacement.annotation.provenance.source_refs = ["source-proposal:source-version"];
    view.available_inputs = [proposal]; view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: "source-proposal", version: "source-version" };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    view.draft.decisions = existingDecision ? [{ decision_id: "d", reviewer_id: "reviewer", outcome: "changed", target,
      replacement: { annotation_id: replacement.annotation.annotation_id, version: replacement.version } }] : [];
    const saved = structuredClone(view.draft); saved.revision = 1; saved.annotations![0].version = "note-version";
    saved.annotations![0].annotation.note = "Specific clinical reason";
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue(saved);
    const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({ ...saved, revision: 2 });
    render(<CaseScreen view={view} workspaceId="ws-note" onClose={vi.fn()} />);
    selectEditableFinding();
    fireEvent.change(screen.getByLabelText("Annotation note"), { target: { value: "Specific clinical reason" } });
    fireEvent.blur(screen.getByLabelText("Annotation note"));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("ws-note", expect.objectContaining({ expected_revision: 1,
      payload: expect.objectContaining({ outcome: "changed", target, replacement: { annotation_id: "pending-finding", version: "note-version" } }) })));
    expect(apply).toHaveBeenCalledOnce();
  });

  it("collects a reason before adopting a spanless proposal into an enforced draft", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true });
    const proposal = view.draft.annotations![0]; view.draft.annotations = []; view.available_inputs = [proposal];
    view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: proposal.annotation.annotation_id, version: proposal.version };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    const apply = vi.spyOn(api, "applyCommand").mockRejectedValue(new ValidationError("Copy save refused"));
    render(<CaseScreen view={view} workspaceId="ws-reason" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reason for no text span" });
    expect(apply).not.toHaveBeenCalled();
    expect((within(dialog).getByRole("button", { name: "Create editable copy" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason for no text span/), { target: { value: "History supports the finding" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create editable copy" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("ws-reason", expect.objectContaining({ payload: expect.objectContaining({ command: "create_annotation", note: "History supports the finding", source_annotation_id: "pending-finding" }) })));
    await screen.findByText("Adopting the proposal failed: Copy save refused");
    fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/ }));
    const retry = await screen.findByRole("dialog", { name: "Reason for no text span" });
    expect((within(retry).getByLabelText(/Reason for no text span/) as HTMLTextAreaElement).value).toBe("History supports the finding");
    fireEvent.click(within(retry).getByRole("button", { name: "Cancel" }));
    expect(apply).toHaveBeenCalledOnce();
  });

  it("reset preserves note text when an earlier blurred note save finishes afterward", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const proposal = view.draft.annotations![0];
    view.draft.annotations = []; view.available_inputs = [proposal];
    view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: proposal.annotation.annotation_id, version: proposal.version };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    view.draft.decisions = [{ decision_id: "d", reviewer_id: "reviewer", outcome: "uncertain", target }];
    let resolveNote!: (draft: Draft) => void;
    const pendingNote = new Promise<Draft>(resolve => { resolveNote = resolve; });
    const record = vi.spyOn(api, "recordDecision").mockReturnValueOnce(pendingNote)
      .mockResolvedValueOnce({ ...view.draft, revision: 2, decisions: [] });
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    const note = screen.getByRole("textbox", { name: /Reviewer note/ });
    fireEvent.change(note, { target: { value: "Keep this draft" } }); fireEvent.blur(note);
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: "0" });
    resolveNote({ ...view.draft, revision: 1, decisions: [{ ...view.draft.decisions[0], note: "Keep this draft" }] });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector('.decision-tag--open')).not.toBeNull());
    expect((note as HTMLTextAreaElement).value).toBe("Keep this draft");
  });

  it("submits multiple layers through one fresh document confirmation", async () => {
    const view = structuredClone(sampleView);
    view.layers!.push({ ...view.layers![0], layer_id: "hidden", label: "Hidden", default_visible: false });
    view.scope!.editable_layer_ids.push("hidden");
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit case/i });
    expect(dialog.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Entire text checked for further findings" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/i }));
    await screen.findByRole("dialog", { name: /Submit case/i });
    expect((screen.getByRole("checkbox", { name: "Entire text checked for further findings" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/Verified layers:/)).toBeNull();
  });

  describe("Finish & Submit while a save is pending", () => {
    // Pending clinical edits must finish before opening the completion dialog.
    const twoLayerView = (): WorkspaceView => withEditableFinding({
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

      selectEditableFinding();
      editFinding();
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
      selectEditableFinding();
      editFinding();
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

      selectEditableFinding();
      editFinding();
      fireEvent.click(finishButton());
      save.reject(new ValidationError("Layer cannot be changed"));
      await screen.findByText("Layer cannot be changed");
      await waitFor(() => expect(finishButton().getAttribute("aria-busy")).not.toBe("true"));

      // A new clinical edit clears the save error; the stopped submit stays explained.
      fireEvent.click(screen.getByRole("radio", { name: "Absent" }));
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

      selectEditableFinding();
      editFinding();
      fireEvent.click(finishButton());
      save.reject(new TypeError("Failed to fetch"));

      expect((await screen.findByRole("alert")).textContent).toMatch(/Pending changes could not be saved/);
      expect(screen.getByRole("status").textContent).toMatch(/Offline – changes not saved/);
      await waitFor(() => expect(finishButton().getAttribute("aria-busy")).not.toBe("true"));
      expect(screen.queryByRole("dialog", { name: /Submit case/i })).toBeNull();
    });
  });
});
