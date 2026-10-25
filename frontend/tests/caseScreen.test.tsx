import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, initialAxisValues, type WorkspaceView } from "../src/app/CaseScreen";
import { api, ApiError, AuthError, ConflictError, ValidationError, type Draft } from "../src/api/client";

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
    require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: true, enforce_spanless_rules: false,
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
  /** The hit row of a term in the search list (the detail area may repeat its label). */
  const candidateCard = async (label: string) =>
    (await screen.findAllByText(label)).map(element => element.closest<HTMLElement>(".candidate-card")).find(Boolean)!;
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
      expect(screen.getByRole("button", { name: /Finish & Submit/ })).toBeDefined();
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

  describe("annotation note transport recovery", () => {
    const failures = [new TypeError("Failed to fetch"), new AuthError("Session ended", {}, "NOT_AUTHENTICATED", 401)];
    const setup = (failure: Error) => {
      const view = withEditableFinding(structuredClone(sampleView));
      const routeLeaveRef = { current: null as (() => Promise<boolean>) | null };
      const leaveGuardRef = { current: null as ((proceed: () => void) => void) | null };
      const logout = vi.fn();
      const apply = vi.spyOn(api, "applyCommand").mockRejectedValueOnce(failure).mockImplementation(async (_workspace, envelope) => {
        const result = structuredClone(view.draft); result.revision = envelope.expected_revision + 1;
        result.annotations![0].annotation.note = envelope.payload.note as string;
        result.annotations![0].version = `note-${result.revision}`; return result;
      });
      render(<CaseScreen view={view} workspaceId="ws-note-transport" onClose={vi.fn()} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} />);
      selectEditableFinding();
      fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Retained transport note" } });
      fireEvent.blur(screen.getByLabelText("Note"));
      return { routeLeaveRef, leaveGuardRef, logout, apply };
    };

    it.each(failures)("navigation can cancel and then discard a retained note after %s", async failure => {
      const state = setup(failure); await screen.findByRole("button", { name: "Retry" });
      let departure!: Promise<boolean>;
      act(() => { departure = state.routeLeaveRef.current!(); });
      await screen.findByRole("dialog", { name: "Changes not saved" });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await act(async () => { expect(await departure).toBe(false); });
      expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Retained transport note");
      act(() => { departure = state.routeLeaveRef.current!(); });
      fireEvent.click(await screen.findByRole("button", { name: "Discard edits and leave" }));
      await act(async () => { expect(await departure).toBe(true); });
      const unloading = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unloading);
      expect(unloading.defaultPrevented).toBe(false);
      expect(state.apply).toHaveBeenCalledOnce();
    });

    it.each(failures)("logout releases a failed note flush and retry saves the latest text after %s", async failure => {
      const state = setup(failure); await screen.findByRole("button", { name: "Retry" });
      fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Latest local explanation" } });
      act(() => state.leaveGuardRef.current?.(state.logout));
      fireEvent.click(await screen.findByRole("button", { name: "Save and log out" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull());
      expect(state.logout).not.toHaveBeenCalled();
      expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Latest local explanation");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await screen.findByText(/^Saved$/);
      expect(state.apply).toHaveBeenLastCalledWith("ws-note-transport", expect.objectContaining({ payload: expect.objectContaining({ note: "Latest local explanation" }) }));
      act(() => state.leaveGuardRef.current?.(state.logout));
      expect(state.logout).toHaveBeenCalledOnce();
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

    expect(screen.getByRole("heading", { level: 1, name: "doc-test-1" })).toBeDefined();
    expect(screen.getByText("Annotate from scratch")).toBeDefined();
    expect(screen.getByText("No finding selected")).toBeDefined();
  });

  it("switches the compact view between text, list, and details", () => {
    const rendered = render(
      <CaseScreen view={sampleView} workspaceId="ws-test-token" onClose={vi.fn()} />
    );
    const layout = rendered.container.querySelector(".app-layout")!;
    expect(layout.classList.contains("mobile-pane-text")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Findings/ }));
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
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "Hypotonia" } });
    const candidate = await candidateCard("Hypotonia");
    fireEvent.click(candidate);
    expect(apply).not.toHaveBeenCalled();
    const reason = screen.getByLabelText(/Reason for no text span/);
    expect(screen.getByRole("button", { name: "Add annotation" })).toHaveProperty("disabled", true);
    fireEvent.change(reason, { target: { value: "  Summary outside this excerpt  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("ws", expect.objectContaining({ payload: expect.objectContaining({ command: "create_annotation", note: "Summary outside this excerpt" }) })));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("creates configured values as unconfirmed presets rather than deliberate clinical choices", async () => {
    const view = structuredClone(sampleView); view.require_spanless_note = false;
    view.creation_defaults = { phenotype: { default: { assertion: "absent", experiencer: "other" } } };
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
    vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "presets", candidates: [{ term_id: "HP:0001252", label: "Hypotonia", rank: 1 }] } as any);
    render(<CaseScreen view={view} workspaceId="presets" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "Hypotonia" } });
    fireEvent.click(await candidateCard("Hypotonia"));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("presets", expect.objectContaining({ payload: expect.objectContaining({
      axes_values: { assertion: "absent", experiencer: "other", temporality: null }, chosen_axis_ids: [],
    }) })));
  });

  describe("submit with unconfirmed values", () => {
    const shown = { assertion: "present", experiencer: "patient", temporality: "current" };
    const unconfirmedView = (defaulted: string[] = ["experiencer"]) => {
      const view = withEditableFinding(structuredClone(sampleView)); view.require_spanless_note = false;
      view.annotation_policy_revision = 7;
      view.draft.annotations![0].annotation.axes_values = { ...shown };
      view.draft.annotations![0].annotation.axes_defaulted = defaulted;
      return view;
    };
    const acknowledgementOf = (view: WorkspaceView, digest = "exact-server-digest") =>
      ({ draft_revision: view.draft.revision, policy_revision: 7, warning_digest: digest });
    const axisWarning = (view: WorkspaceView, axes: string[], acknowledgement = acknowledgementOf(view)) =>
      new ApiError(422, "Review defaults", "AXIS_CONFIRMATION_WARNING", { acknowledgement,
        warnings: axes.map(axis => ({ annotation_id: "pending-finding", rule: "axis_not_chosen", detail: { axis } })) });
    const submissionOf = (view: WorkspaceView) => ({ format_version: "ontocurator-submission/v2", submission_id: "warning-submitted", origin_key: view.key,
      targets: view.targets!, draft_revision: view.draft.revision, snapshots: view.draft.annotations!, decisions: [], document_checked: true,
      created_at: "2026-10-18T12:00:00Z" });
    const openSubmit = async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
      return screen.findByRole("dialog", { name: "Submit case" });
    };
    const submitTicked = (dialog: HTMLElement, n: number) => {
      fireEvent.click(within(dialog).getByRole("checkbox", { name: `Submit with ${n} unconfirmed values` }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit case" }));
    };
    const statusOf = (dialog: HTMLElement) => dialog.querySelector("[data-submit-status]")!.textContent;

    it("auto-resends once when the warning lists exactly the ticked values", async () => {
      const view = unconfirmedView();
      const submit = vi.spyOn(api, "submitWorkspace").mockRejectedValueOnce(axisWarning(view, ["experiencer"]))
        .mockResolvedValue(submissionOf(view) as any);
      const update = vi.spyOn(api, "applyCommand");
      render(<CaseScreen view={view} workspaceId="resend" onClose={vi.fn()} />);
      const dialog = await openSubmit();
      expect(within(dialog).getByRole("heading", { name: "Unconfirmed values (1 finding)" })).toBeDefined();
      submitTicked(dialog, 1);
      await screen.findByRole("dialog", { name: "Case submitted" });
      expect(submit).toHaveBeenCalledTimes(2);
      const [firstBody, secondBody] = submit.mock.calls.map(call => call[1] as any);
      expect(firstBody.payload.warning_acknowledgement).toBeUndefined();
      expect(secondBody.payload.warning_acknowledgement).toEqual(acknowledgementOf(view));
      expect(firstBody.mutation_id).not.toBe(secondBody.mutation_id);
      expect(update).not.toHaveBeenCalled();
      expect(view.draft.annotations![0].annotation.axes_defaulted).toEqual(["experiencer"]);
    });

    it("does not resend when the warning set differs", async () => {
      const view = unconfirmedView();
      const submit = vi.spyOn(api, "submitWorkspace").mockRejectedValue(axisWarning(view, ["experiencer", "temporality"]));
      render(<CaseScreen view={view} workspaceId="differs" onClose={vi.fn()} />);
      const dialog = await openSubmit();
      submitTicked(dialog, 1);
      await waitFor(() => expect(statusOf(dialog)).toBe("The unconfirmed values changed. Check the list again."));
      expect(submit).toHaveBeenCalledTimes(1);
      const box = within(dialog).getByRole("checkbox", { name: "Submit with 2 unconfirmed values" }) as HTMLInputElement;
      expect(box.checked).toBe(false);
      expect(within(dialog).getByText("Betroffene Person (Experiencer): Patient, Zeitlicher Bezug (Temporality): Current")).toBeDefined();
    });

    it("sends no acknowledgement when no rows remain", async () => {
      const view = unconfirmedView([]);
      const submit = vi.spyOn(api, "submitWorkspace").mockResolvedValue(submissionOf(view) as any);
      render(<CaseScreen view={view} workspaceId="no-rows" onClose={vi.fn()} />);
      const dialog = await openSubmit();
      expect(within(dialog).queryByRole("checkbox", { name: /unconfirmed values/ })).toBeNull();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit case" }));
      await screen.findByRole("dialog", { name: "Case submitted" });
      expect(submit).toHaveBeenCalledTimes(1);
      expect((submit.mock.calls[0][1] as any).payload.warning_acknowledgement).toBeUndefined();
    });

    it("row Confirm sends one set_axes with the row's defaulted axes", async () => {
      const view = unconfirmedView(["assertion", "experiencer"]);
      const confirmed = structuredClone(view.draft); confirmed.revision += 1;
      confirmed.annotations![0].annotation.axes_defaulted = [];
      const apply = vi.spyOn(api, "applyCommand").mockResolvedValue(confirmed);
      render(<CaseScreen view={view} workspaceId="row-confirm" onClose={vi.fn()} />);
      const dialog = await openSubmit();
      fireEvent.click(within(dialog).getByRole("button", { name: /^Confirm values of / }));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      expect((apply.mock.calls[0][1] as any).payload).toEqual(expect.objectContaining({ command: "set_axes",
        annotation_id: "pending-finding", axes_values: shown, chosen_axis_ids: ["assertion", "experiencer"] }));
      await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("All values are confirmed."));
      expect(dialog.querySelector("[data-unconfirmed-values]")).toBeNull();
      expect(document.activeElement).toBe(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
    });

    it("a second warning after the resend clears the checkbox without a third request", async () => {
      const view = unconfirmedView();
      const renewed = { ...acknowledgementOf(view), policy_revision: 8, warning_digest: "renewed-server-digest" };
      const submit = vi.spyOn(api, "submitWorkspace").mockRejectedValueOnce(axisWarning(view, ["experiencer"]))
        .mockRejectedValueOnce(new ApiError(422, "Policy changed", "AXIS_CONFIRMATION_WARNING", { acknowledgement: renewed, warnings: [] }))
        .mockResolvedValue(submissionOf(view) as any);
      const update = vi.spyOn(api, "applyCommand");
      render(<CaseScreen view={view} workspaceId="warning" onClose={vi.fn()} />);
      const dialog = await openSubmit();
      submitTicked(dialog, 1);
      const box = within(dialog).getByRole("checkbox", { name: "Submit with 1 unconfirmed values" }) as HTMLInputElement;
      await waitFor(() => expect(statusOf(dialog)).toBe("The unconfirmed values changed. Check the list again."));
      expect(box.checked).toBe(false);
      expect(submit).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("dialog", { name: "Case submitted" })).toBeNull();
      fireEvent.click(box);
      expect(statusOf(dialog)).toBe("");
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit case" }));
      await screen.findByRole("dialog", { name: "Case submitted" });
      expect(submit).toHaveBeenCalledTimes(3);
      expect(submit).toHaveBeenLastCalledWith("warning", expect.objectContaining({ payload: expect.objectContaining({ warning_acknowledgement: renewed }) }));
      expect(update).not.toHaveBeenCalled();
      expect(view.draft.annotations![0].annotation.axes_defaulted).toEqual(["experiencer"]);
    });

    it("allows leaving after cancelling a submission warning without treating it as a rejected edit", async () => {
      const view = withEditableFinding(structuredClone(sampleView)); view.require_spanless_note = false;
      vi.spyOn(api, "submitWorkspace").mockRejectedValue(new ApiError(422, "Review defaults", "AXIS_CONFIRMATION_WARNING", { acknowledgement: { draft_revision: view.draft.revision, policy_revision: 1, warning_digest: "warning" }, warnings: [] }));
      const routeLeaveRef = { current: null as (() => Promise<boolean>) | null };
      render(<CaseScreen view={view} workspaceId="cancel-warning" onClose={vi.fn()} routeLeaveRef={routeLeaveRef} />);
      const dialog = await openSubmit();
      submitTicked(dialog, 3);
      await waitFor(() => expect(statusOf(dialog)).toBe("The unconfirmed values changed. Check the list again."));
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await act(async () => { expect(await routeLeaveRef.current!()).toBe(true); });
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("creates a finding without a reason when the enforced workspace makes it optional", async () => {
    const view = { ...sampleView, enforce_spanless_rules: true, allow_spanless_findings: true, require_spanless_note: false };
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
    vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "optional-search", candidates: [{ term_id: "HP:0001252", label: "Hypotonia", rank: 1 }] } as any);
    render(<CaseScreen view={view} workspaceId="ws-optional" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    expect((screen.getByLabelText(/Reason for no text span/) as HTMLTextAreaElement).required).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "Hypotonia" } });
    fireEvent.click(await candidateCard("Hypotonia"));
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(apply.mock.calls[0][1].payload).toMatchObject({ command: "create_annotation", segments: [], term_id: "HP:0001252" });
    expect(apply.mock.calls[0][1].payload).not.toHaveProperty("note");
  });

  it("autosaves a cleared optional reason before navigation without a discard guard", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true, require_spanless_note: false });
    view.draft.annotations![0].annotation.note = "Previous optional reason";
    const saved = structuredClone(view.draft); saved.revision = 1; delete saved.annotations![0].annotation.note;
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue(saved);
    const routeLeaveRef = { current: null as (() => Promise<boolean>) | null };
    render(<CaseScreen view={view} workspaceId="ws-optional-clear" onClose={vi.fn()} routeLeaveRef={routeLeaveRef} />);
    selectEditableFinding();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "  " } });
    await act(async () => { expect(await routeLeaveRef.current!()).toBe(true); });
    expect(apply).toHaveBeenCalledWith("ws-optional-clear", expect.objectContaining({ payload: { command: "set_annotation_note", annotation_id: "pending-finding", note: null } }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("permits removing the last mention without an optional reason", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true, require_spanless_note: false });
    view.draft.annotations![0].annotation.evidence_refs = [{ evidence_id: "mention", version: "mention-version" }];
    view.draft.evidence = [{ version: "mention-version", mention: { evidence_id: "mention", segments: [{ start: 0, end: 3 }] } }] as any;
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
    render(<CaseScreen view={view} workspaceId="ws-optional-detach" onClose={vi.fn()} />);
    selectEditableFinding();
    const remove = screen.getByRole("button", { name: "Remove" });
    expect((remove as HTMLButtonElement).disabled).toBe(false); fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("ws-optional-detach", expect.objectContaining({ payload: expect.objectContaining({ command: "detach_mention" }) })));
  });

  it.each(["optional", "required_on_complete"] as const)("opens a note-less historical editable copy when reasons are optional (%s)", async evidencePolicy => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true, require_spanless_note: false });
    const proposal = view.draft.annotations![0]; view.draft.annotations = []; view.available_inputs = [proposal];
    view.layers![0].annotation_types[0].evidence_policy = evidencePolicy;
    view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: proposal.annotation.annotation_id, version: proposal.version };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    const apply = vi.spyOn(api, "applyCommand").mockImplementation(async (_workspace, envelope) => {
      const copy = structuredClone(proposal); copy.annotation.annotation_id = envelope.payload.annotation_id as string;
      copy.annotation.provenance.source_refs = [`${target.annotation_id}:${target.version}`];
      return { ...view.draft, revision: 1, annotations: [copy] };
    });
    const decide = vi.spyOn(api, "recordDecision");
    render(<CaseScreen view={view} workspaceId="ws-optional-copy" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(apply.mock.calls[0][1].payload).not.toHaveProperty("note");
    expect(screen.queryByRole("dialog", { name: "Reason for no text span" })).toBeNull();
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).required).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it("keeps an unresolved reviewer note mandatory when clinical reasons are optional", () => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true, require_spanless_note: false });
    const proposal = view.draft.annotations![0]; view.draft.annotations = []; view.available_inputs = [proposal];
    view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: proposal.annotation.annotation_id, version: proposal.version };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    const decide = vi.spyOn(api, "recordDecision");
    render(<CaseScreen view={view} workspaceId="ws-optional-review" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    fireEvent.click(screen.getByRole("button", { name: /Unresolved/ }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Reviewer note" }));
    expect(screen.getByRole("textbox", { name: "Reviewer note" }).getAttribute("aria-invalid")).toBe("true");
    expect(decide).not.toHaveBeenCalled();
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
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Clinical explanation" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    selectEditableFinding();
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Clinical explanation");
    fireEvent.blur(screen.getByLabelText("Note"));
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
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "First unsaved explanation" } });
    fireEvent.blur(screen.getByLabelText("Note"));
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    fireEvent.click(document.querySelector('[data-list-key="annotation:second-finding"]')!);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Second local explanation" } });
    await act(async () => { rejectSave(new ValidationError("Delayed note refusal")); });
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Second local explanation");
    selectEditableFinding();
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("First unsaved explanation");
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
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
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
    expect(screen.getByRole("heading", { name: "New finding without a text span" })).toBeDefined();
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "Hypotonia" } });
    fireEvent.click(await candidateCard("Hypotonia"));

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
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "Krampfanfall" } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search.mock.calls[0][0].languages).toEqual(["es"]);

    fireEvent.click(button);
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));

    expect(store).not.toHaveBeenCalled();
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
    expect(screen.getByRole("combobox", { name: "Search term" })).toBeDefined();
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
    fireEvent.click(screen.getByText("Delete finding"));
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
    expect(screen.getByRole("region", { name: "New finding" })).toBeDefined();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "Custom" } });
    fireEvent.click(await candidateCard("Custom finding"));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith("ws-custom", expect.objectContaining({
      expected_revision: 0,
      payload: expect.objectContaining({ command: "create_annotation", layer_id: "phenotype",
        type_id: "default", term_id: "CUSTOM:42", segments: [{ start: 0, end: 3 }], search_event_id: "search-custom" }),
    })));
    expect(search.mock.calls[0][0]).toEqual(expect.objectContaining({ layer_id: "phenotype" }));
    expect(search.mock.calls[0][0].annotation_id).toBe(mutate.mock.calls[0][1].payload.annotation_id);
  });

  describe("term search after marking text", () => {
    const markThe = (container: HTMLElement) => {
      const text = container.querySelector(".text-container")!;
      const node = text.querySelector(".run")!.firstChild!;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 3);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      fireEvent.mouseUp(text);
      return text as HTMLElement;
    };
    const hits = { search_id: "search-the", candidates: [
      { term_id: "HP:0000001", label: "Gone", obsolete: true, matched_term: "Gone", match_kind: "label", rank: 1, display_pos: 1 },
      { term_id: "HP:0001252", label: "Hypotonia", obsolete: false, matched_term: "Hypotonia", match_kind: "label", rank: 2, display_pos: 2 },
    ] };

    it("marking text focuses the prefilled, selected term search and searches at once", () => {
      const search = vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
      const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-prefill" onClose={vi.fn()} />);
      markThe(rendered.container);
      expect(screen.getByRole("heading", { name: "New finding" })).toBeDefined();
      expect(rendered.container.querySelector(".pending-quote")!.textContent).toBe("“The”");
      const input = screen.getByRole("combobox", { name: "Search term" }) as HTMLInputElement;
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("The");
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(3);
      expect(search).toHaveBeenCalledTimes(1);
      expect(search.mock.calls[0][0]).toEqual(expect.objectContaining({ query: "The" }));
      expect(screen.queryByText("The annotation will be saved upon selecting a term.")).toBeNull();
    });

    it("Enter adds the active hit and creates the finding with the search event", async () => {
      vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
      const view = structuredClone(sampleView);
      const mutate = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
      const rendered = render(<CaseScreen view={view} workspaceId="ws-enter" onClose={vi.fn()} />);
      markThe(rendered.container);
      const input = screen.getByRole("combobox", { name: "Search term" });
      await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id));
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(mutate).toHaveBeenCalledWith("ws-enter", expect.objectContaining({
        payload: expect.objectContaining({ command: "create_annotation", term_id: "HP:0001252",
          segments: [{ start: 0, end: 3 }], search_event_id: "search-the" }),
      })));
    });

    it("prefills a German document without German search names and says names are searched in English", async () => {
      const search = vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
      const view = structuredClone(sampleView); view.document.language = "de";
      const rendered = render(<CaseScreen view={view} workspaceId="ws-de" onClose={vi.fn()} />);
      markThe(rendered.container);
      const input = screen.getByRole("combobox", { name: "Search term" }) as HTMLInputElement;
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("The");
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(3);
      expect(search).toHaveBeenCalledTimes(1);
      expect(search.mock.calls[0][0]).toEqual(expect.objectContaining({ query: "The" }));
      expect(screen.getByText("Names are searched in English. Type an English name or a code.")).toBeDefined();
      await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
      expect(screen.getByText("Names are searched in English. Type an English name or a code.")).toBeDefined();
    });

    it("prefills a German document at once and searches German too once its search languages arrive", async () => {
      let resolveOntologies!: (value: any) => void;
      let resolvePreferences!: (value: any) => void;
      vi.spyOn(api, "listPackageOntologies").mockReturnValue(new Promise(resolve => { resolveOntologies = resolve; }) as any);
      vi.spyOn(api, "getPreferences").mockReturnValue(new Promise(resolve => { resolvePreferences = resolve; }) as any);
      const search = vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
      const view = structuredClone(sampleView); view.document.language = "de";
      const rendered = render(<CaseScreen view={view} workspaceId="ws-de-late" onClose={vi.fn()} />);
      markThe(rendered.container);
      const input = screen.getByRole("combobox", { name: "Search term" }) as HTMLInputElement;
      expect(input.value).toBe("The");
      expect(search).toHaveBeenCalledTimes(1);
      expect(search.mock.calls[0][0]).toEqual(expect.objectContaining({ query: "The" }));
      expect(screen.getByText("Names are searched in English. Type an English name or a code.")).toBeDefined();
      await act(async () => {
        resolveOntologies([{ ontology_id: "hp", release: "2024-06-25", sha256: "TEST-HP-SHA", term_count: 11,
          translations: [{ language: "de", filenames: ["hp-de.babelon.tsv"], term_count: 4 }] }]);
        resolvePreferences({ last_annotator_id: "user-test", mode_by_package: {}, search_languages_by_annotator: { "user-test": ["de"] } });
      });
      // The German names arrive: the same query is asked again with German.
      await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
      expect(input.value).toBe("The");
      expect(document.activeElement).toBe(input);
      expect(search.mock.calls[1][0]).toEqual(expect.objectContaining({ query: "The", languages: ["de"] }));
      expect(screen.queryByText("Names are searched in English. Type an English name or a code.")).toBeNull();
    });

    it("Esc in the term search cancels the new finding and focuses the text at the selection end", () => {
      vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
      const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-esc" onClose={vi.fn()} />);
      const text = markThe(rendered.container);
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Search term" }), { key: "Escape" });
      expect(screen.queryByRole("region", { name: "New finding" })).toBeNull();
      expect(document.activeElement).toBe(text);
      const selection = window.getSelection()!;
      expect(selection.isCollapsed).toBe(true);
      expect(text.contains(selection.anchorNode)).toBe(true);
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(selection.anchorNode!, selection.anchorOffset);
      expect(range.toString()).toBe("The");
    });

    it("focusing the search does not scroll the text pane", () => {
      vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
      const focus = vi.spyOn(HTMLElement.prototype, "focus");
      const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-scroll" onClose={vi.fn()} />);
      const container = rendered.container.querySelector<HTMLElement>(".text-container")!;
      container.scrollTop = 40;
      markThe(rendered.container);
      const input = screen.getByRole("combobox", { name: "Search term" });
      const inputFocus = focus.mock.calls.filter((_, index) => focus.mock.contexts[index] === input);
      expect(inputFocus.length).toBeGreaterThan(0);
      for (const call of inputFocus) expect(call[0]).toEqual({ preventScroll: true });
      expect(container.scrollTop).toBe(40);
      focus.mockRestore();
    });

    describe("pending mark (F1)", () => {
      const handlesOf = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".resize-handle"));
      const endHandle = () => screen.getByRole("separator", { name: "End of marked text" });
      const status = (container: HTMLElement) => container.querySelector("[data-carried-announcer]")!.textContent;
      const arrow = (key: "ArrowLeft" | "ArrowRight") => fireEvent.keyDown(document.activeElement!, { key });

      it("the pending mark is resizable", () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = withEditableFinding(structuredClone(sampleView));
        const rendered = render(<CaseScreen view={view} workspaceId="ws-f1-handles" onClose={vi.fn()} />);
        markThe(rendered.container);
        const handles = handlesOf(rendered.container);
        expect(handles.map(h => h.getAttribute("aria-label"))).toEqual(["Start of marked text", "End of marked text"]);
        expect(screen.getByRole("separator", { name: "Start of marked text" }).dataset.offset).toBe("0");
        expect(endHandle().dataset.offset).toBe("3");
      });

      it("moving a pending edge updates the mark locally without a mutation", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const mutate = vi.spyOn(api, "applyCommand");
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-move" onClose={vi.fn()} />);
        markThe(rendered.container);
        endHandle().focus();
        arrow("ArrowRight");
        // Reported after the vendor's keyboard pause.
        await waitFor(() => expect(rendered.container.querySelector(".pending-quote")!.textContent).toBe("“The p”"));
        expect(status(rendered.container)).toBe("Marked text: “The p”");
        expect(screen.getByRole("region", { name: "New finding" })).toBeDefined();
        expect(mutate).not.toHaveBeenCalled();
      });

      it("the search follows the adjusted span until typed", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-prefill" onClose={vi.fn()} />);
        markThe(rendered.container);
        const input = screen.getByRole("combobox", { name: "Search term" }) as HTMLInputElement;
        endHandle().focus();
        arrow("ArrowRight");
        await waitFor(() => expect(input.value).toBe("The p"));
        fireEvent.change(input, { target: { value: "tone" } });
        endHandle().focus();
        arrow("ArrowRight");
        await waitFor(() => expect(rendered.container.querySelector(".pending-quote")!.textContent).toBe("“The pa”"));
        expect(input.value).toBe("tone");
      });

      it("choosing a term during a keyboard pause saves the adjusted segments", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = structuredClone(sampleView);
        const mutate = vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1 });
        const rendered = render(<CaseScreen view={view} workspaceId="ws-f1-flush" onClose={vi.fn()} />);
        markThe(rendered.container);
        const hypotonia = await candidateCard("Hypotonia");
        endHandle().focus();
        arrow("ArrowRight");
        fireEvent.click(hypotonia);
        await waitFor(() => expect(mutate).toHaveBeenCalledWith("ws-f1-flush", expect.objectContaining({
          payload: expect.objectContaining({ command: "create_annotation", term_id: "HP:0001252", segments: [{ start: 0, end: 5 }] }),
        })));
        expect(mutate).toHaveBeenCalledTimes(1);
      });

      it("Esc in the text pane discards the marked text", () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-esc-text" onClose={vi.fn()} />);
        const text = markThe(rendered.container);
        text.focus();
        fireEvent.keyDown(text, { key: "Escape" });
        expect(screen.queryByRole("region", { name: "New finding" })).toBeNull();
        expect(status(rendered.container)).toBe("Marked text discarded.");
        expect(document.activeElement).toBe(text);
        const selection = window.getSelection()!;
        const range = document.createRange(); range.setStart(text, 0); range.setEnd(selection.anchorNode!, selection.anchorOffset);
        expect(range.toString()).toBe("The");
        expect(handlesOf(rendered.container)).toEqual([]);
      });

      it("Esc on an inspector button discards", () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-esc-button" onClose={vi.fn()} />);
        markThe(rendered.container);
        const region = screen.getByRole("region", { name: "New finding" });
        const button = within(region).getByRole("button", { name: "Discard" });
        button.focus();
        fireEvent.keyDown(button, { key: "Escape" });
        expect(screen.queryByRole("region", { name: "New finding" })).toBeNull();
      });

      it("Esc on a select in the inspector discards; a text field keeps its Escape", () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-esc-select" onClose={vi.fn()} />);
        markThe(rendered.container);
        const inspector = rendered.container.querySelector(".inspector-pane")!;
        const field = document.createElement("input");
        field.type = "text";
        const select = document.createElement("select");
        select.append(new Option("en"), new Option("de"));
        inspector.append(field, select);
        field.focus();
        fireEvent.keyDown(field, { key: "Escape" });
        expect(screen.getByRole("region", { name: "New finding" })).toBeDefined();
        select.focus();
        fireEvent.keyDown(select, { key: "Escape" });
        expect(screen.queryByRole("region", { name: "New finding" })).toBeNull();
        field.remove(); select.remove();
      });

      it("Esc inside a dialog or drawer does not discard", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-esc-dialog" onClose={vi.fn()} />);
        const text = markThe(rendered.container);
        text.focus();
        fireEvent.keyDown(text, { key: "?" });
        const help = await screen.findByRole("dialog");
        fireEvent.keyDown(within(help).getAllByRole("button")[0], { key: "Escape" });
        expect(screen.getByRole("region", { name: "New finding" })).toBeDefined();
        // A drawer inside the screen owns its Escape too.
        const drawer = document.createElement("aside");
        drawer.className = "ui-drawer";
        const inside = document.createElement("button");
        drawer.append(inside);
        rendered.container.querySelector(".inspector-pane")!.append(drawer);
        fireEvent.keyDown(inside, { key: "Escape" });
        expect(screen.getByRole("region", { name: "New finding" })).toBeDefined();
        drawer.remove();
      });

      it("the inspector heading row has Discard and the adjust hint; no bottom Cancel for a marked span", () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-inspector" onClose={vi.fn()} />);
        markThe(rendered.container);
        const region = screen.getByRole("region", { name: "New finding" });
        const row = region.querySelector(".term-heading-row")!;
        expect(within(row as HTMLElement).getByRole("heading", { name: "New finding" })).toBeDefined();
        const discard = within(row as HTMLElement).getByRole("button", { name: "Discard" });
        expect(discard.getAttribute("aria-keyshortcuts")).toBe("Escape");
        expect(discard.querySelector("[aria-hidden='true'] kbd")!.textContent).toBe("Esc");
        expect(within(region).getByText("Adjust the marked text with its edge handles, or mark new text to replace it.")).toBeDefined();
        expect(within(region).queryByRole("button", { name: "Cancel" })).toBeNull();
        fireEvent.click(discard);
        expect(screen.queryByRole("region", { name: "New finding" })).toBeNull();
        expect(status(rendered.container)).toBe("Marked text discarded.");
      });

      it("spanless findings keep Cancel and get no handles", () => {
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-spanless" onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
        const region = screen.getByRole("region", { name: "New finding" });
        expect(within(region).getByRole("button", { name: "Cancel" })).toBeDefined();
        expect(within(region).queryByRole("button", { name: "Discard" })).toBeNull();
        expect(within(region).queryByText("Adjust the marked text with its edge handles, or mark new text to replace it.")).toBeNull();
        expect(handlesOf(rendered.container)).toEqual([]);
        expect(screen.queryByRole("group", { name: "Marked text" })).toBeNull();
      });

      it("at 700 px the New finding bar offers Discard", () => {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({
          matches: query === "(max-width: 700px)", media: query, onchange: null,
          addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
        })) as unknown as typeof window.matchMedia;
        try {
          vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
          const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-narrow" onClose={vi.fn()} />);
          const text = markThe(rendered.container);
          const bar = rendered.container.querySelector<HTMLElement>(".pending-bar")!;
          expect(within(bar).queryByRole("button", { name: "Cancel" })).toBeNull();
          expect(screen.queryByRole("group", { name: "Marked text" })).toBeNull();
          fireEvent.click(within(bar).getByRole("button", { name: "Discard" }));
          expect(rendered.container.querySelector(".pending-bar")).toBeNull();
          expect(status(rendered.container)).toBe("Marked text discarded.");
          expect(document.activeElement).toBe(text);
        } finally { window.matchMedia = original; }
      });

      it("above 700 px the Marked text bar is shown and Discard discards", () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const rendered = render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-bar" onClose={vi.fn()} />);
        markThe(rendered.container);
        expect(rendered.container.querySelector(".pending-bar")).toBeNull();
        const bar = screen.getByRole("group", { name: "Marked text" });
        expect(bar.textContent).toContain("Drag the edges to adjust");
        fireEvent.click(within(bar).getByRole("button", { name: "Discard" }));
        expect(screen.queryByRole("group", { name: "Marked text" })).toBeNull();
        expect(screen.queryByRole("region", { name: "New finding" })).toBeNull();
      });

      it("? help lists Esc as Discard the marked text / clear selection / cancel adding a mention or segment", async () => {
        render(<CaseScreen view={structuredClone(sampleView)} workspaceId="ws-f1-help" onClose={vi.fn()} />);
        fireEvent.keyDown(window, { key: "?" });
        const help = await screen.findByRole("dialog");
        expect(within(help).getByText("Discard the marked text / clear selection / cancel adding a mention or segment")).toBeDefined();
        expect(within(help).getByText("Move the focused mention edge (Tab to an edge handle of the selected annotation or the marked text)")).toBeDefined();
      });
    });

    describe("values loop", () => {
      const allDefaults = { assertion: "present", experiencer: "patient", temporality: "current" };
      const loopView = (defaults: Record<string, string> = allDefaults, requiredAssertion = false) => {
        const view = structuredClone(sampleView);
        view.creation_defaults = { phenotype: { default: defaults } };
        if (requiredAssertion) view.layers![0].annotation_types[0].axes![0].allow_empty = false;
        return view;
      };
      /** A server that keeps the created finding and its values. */
      const loopServer = (view: WorkspaceView) => {
        let current = structuredClone(view.draft);
        return vi.spyOn(api, "applyCommand").mockImplementation(async (_workspace: string, body: any) => {
          const p = body.payload;
          current = structuredClone(current); current.revision += 1;
          if (p.command === "create_annotation") {
            const evidence = { mention: { evidence_id: p.evidence_id, segments: p.segments }, version: "ev-1" };
            current.evidence = [...(current.evidence ?? []), evidence] as any;
            current.annotations = [...(current.annotations ?? []), { schema_version: "ontocurator-annotation/v3", version: "v1",
              document_id: view.document.document_id, text_sha256: "t", ontology_sha256: "o", layer_config_sha256: "l",
              annotation: { annotation_id: p.annotation_id, document_id: view.document.document_id, layer_id: p.layer_id,
                type_id: p.type_id, term_id: p.term_id, axes_values: p.axes_values,
                axes_defaulted: Object.keys(p.axes_values).filter(id => p.axes_values[id] != null && !p.chosen_axis_ids.includes(id)),
                evidence_refs: [{ evidence_id: p.evidence_id, version: "ev-1" }],
                provenance: { actor: { actor_id: "user-test", kind: "human" }, method: "manual", source_refs: [] } },
              evidence: [evidence] }] as any;
          }
          // Like Annotation.with_axes plus _set_axes in the backend: a changed value and a chosen id
          // both leave axes_defaulted; an unchanged, unchosen default stays.
          if (p.command === "set_axes") {
            current.annotations = current.annotations!.map(snapshot => snapshot.annotation.annotation_id !== p.annotation_id ? snapshot
              : { ...snapshot, annotation: { ...snapshot.annotation, axes_values: p.axes_values,
                axes_defaulted: (snapshot.annotation.axes_defaulted ?? []).filter(id => !p.chosen_axis_ids.includes(id)
                  && p.axes_values[id] === snapshot.annotation.axes_values?.[id]) } });
          }
          return structuredClone(current);
        });
      };
      const addHypotonia = async (container: HTMLElement) => {
        const text = markThe(container);
        const input = screen.getByRole("combobox", { name: "Search term" });
        await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id));
        fireEvent.keyDown(input, { key: "Enter" });
        return text;
      };
      const announcer = () => document.querySelector("[data-carried-announcer]")!.textContent;
      const setAxesCalls = (apply: ReturnType<typeof loopServer>) => apply.mock.calls.filter(call => (call[1] as any).payload.command === "set_axes");

      it("after adding a term focuses Confirm defaults and announces the defaults", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = loopView();
        loopServer(view);
        const rendered = render(<CaseScreen view={view} workspaceId="ws-loop" onClose={vi.fn()} />);
        await addHypotonia(rendered.container);
        await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-confirm-defaults")).toBe(true));
        expect(document.activeElement!.textContent).toContain("Confirm defaults (3)");
        expect(announcer()).toBe("Hypotonia added. Values from defaults: Present, Patient, Current. Confirm defaults or change a value.");
      });

      it("after adding a term focuses the first required empty value instead", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = loopView({ experiencer: "patient", temporality: "current" }, true);
        loopServer(view);
        const rendered = render(<CaseScreen view={view} workspaceId="ws-required" onClose={vi.fn()} />);
        await addHypotonia(rendered.container);
        await waitFor(() => expect((document.activeElement as HTMLElement).closest('[data-axis-field="assertion"]')).not.toBeNull());
        expect((document.activeElement as HTMLInputElement).type).toBe("radio");
        expect(announcer()).toBe("Hypotonia added. Values from defaults: Patient, Current. Confirm defaults or change a value.");
      });

      it("D confirms all defaults in one set_axes and returns focus to the text after the mark", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = loopView();
        const apply = loopServer(view);
        const focus = vi.spyOn(HTMLElement.prototype, "focus");
        const rendered = render(<CaseScreen view={view} workspaceId="ws-d" onClose={vi.fn()} />);
        const text = await addHypotonia(rendered.container);
        text.scrollTop = 25;
        await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-confirm-defaults")).toBe(true));
        fireEvent.keyDown(document.body, { key: "d" });
        await waitFor(() => expect(document.activeElement).toBe(rendered.container.querySelector(".text-container")));
        const calls = setAxesCalls(apply);
        expect(calls).toHaveLength(1);
        expect((calls[0][1] as any).payload).toEqual(expect.objectContaining({ command: "set_axes",
          axes_values: allDefaults, chosen_axis_ids: ["assertion", "experiencer", "temporality"] }));
        expect(announcer()).toBe("Confirmed: Vorhandensein (Assertion) Present, Betroffene Person (Experiencer) Patient, Zeitlicher Bezug (Temporality) Current.");
        const selection = window.getSelection()!;
        expect(selection.isCollapsed).toBe(true);
        const range = document.createRange(); range.setStart(text, 0); range.setEnd(selection.anchorNode!, selection.anchorOffset);
        expect(range.toString()).toBe("The");
        expect(text.scrollTop).toBe(25);
        for (const [index, call] of focus.mock.calls.entries()) {
          if (focus.mock.contexts[index] === text || (focus.mock.contexts[index] as HTMLElement).hasAttribute?.("data-confirm-defaults")) {
            expect(call[0]).toEqual({ preventScroll: true });
          }
        }
        focus.mockRestore();
        await waitFor(() => expect(screen.queryByRole("button", { name: /Confirm defaults/ })).toBeNull());
      });

      it("V focuses the first defaulted value and arrow changes are sent once", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = loopView({ experiencer: "patient", temporality: "current" });
        const apply = loopServer(view);
        const rendered = render(<CaseScreen view={view} workspaceId="ws-v" onClose={vi.fn()} />);
        const text = await addHypotonia(rendered.container);
        await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-confirm-defaults")).toBe(true));
        text.focus();
        vi.useFakeTimers();
        try {
          fireEvent.keyDown(text, { key: "v" });
          const patient = document.activeElement as HTMLInputElement;
          expect(patient.closest('[data-axis-field="experiencer"]')).not.toBeNull();
          expect(patient.checked).toBe(true);
          fireEvent.keyDown(patient, { key: "ArrowRight" });
          fireEvent.click(screen.getByRole("radio", { name: "Other person" }));
          fireEvent.keyDown(screen.getByRole("radio", { name: "Other person" }), { key: "ArrowLeft" });
          fireEvent.click(screen.getByRole("radio", { name: /^Patient/ }));
          fireEvent.keyDown(screen.getByRole("radio", { name: /^Patient/ }), { key: "ArrowRight" });
          fireEvent.click(screen.getByRole("radio", { name: "Other person" }));
          expect(setAxesCalls(apply)).toHaveLength(0);
          await act(async () => { vi.advanceTimersByTime(300); });
        } finally { vi.useRealTimers(); }
        await waitFor(() => expect(setAxesCalls(apply)).toHaveLength(1));
        expect((setAxesCalls(apply)[0][1] as any).payload).toEqual(expect.objectContaining({
          axes_values: { assertion: null, experiencer: "other", temporality: "current" }, chosen_axis_ids: ["experiencer"] }));
      });

      it("/ focuses the term search of a new finding and opens Change term for an own finding", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = loopView();
        loopServer(view);
        const rendered = render(<CaseScreen view={view} workspaceId="ws-slash" onClose={vi.fn()} />);
        const text = markThe(rendered.container);
        text.focus();
        fireEvent.keyDown(text, { key: "/" });
        expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search term" }));
        await addHypotonia(rendered.container);
        await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-confirm-defaults")).toBe(true));
        expect(screen.queryByRole("combobox", { name: "Search term" })).toBeNull();
        fireEvent.keyDown(document.activeElement!, { key: "/" });
        expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search term" }));
        expect(screen.getByRole("button", { name: "Close search" })).toBeDefined();
        // With the search already open, "/" focuses it again.
        (document.activeElement as HTMLElement).blur();
        fireEvent.keyDown(document.body, { key: "/" });
        expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search term" }));
      });

      it("never fires / V D in text fields, with Shift for D and V, or in read-only and proposal views", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = loopView();
        const apply = loopServer(view);
        const rendered = render(<CaseScreen view={view} workspaceId="ws-guard" onClose={vi.fn()} />);
        await addHypotonia(rendered.container);
        await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-confirm-defaults")).toBe(true));
        const note = screen.getByLabelText("Note");
        note.focus();
        for (const key of ["d", "v", "/"]) fireEvent.keyDown(note, { key });
        expect(document.activeElement).toBe(note);
        fireEvent.keyDown(document.body, { key: "D", shiftKey: true });
        fireEvent.keyDown(document.body, { key: "V", shiftKey: true });
        expect(document.activeElement).toBe(note);
        rendered.rerender(<CaseScreen view={view} workspaceId="ws-guard" onClose={vi.fn()} readOnly />);
        fireEvent.keyDown(document.body, { key: "d" });
        fireEvent.keyDown(document.body, { key: "v" });
        fireEvent.keyDown(document.body, { key: "/" });
        await act(async () => { await Promise.resolve(); });
        expect(setAxesCalls(apply)).toHaveLength(0);
        expect(screen.queryByRole("combobox", { name: "Search term" })).toBeNull();
      });

      it("never fires D for a selected proposal in review mode", async () => {
        const { view, proposal } = proposalView();
        proposal.annotation.axes_values = { assertion: "present" }; proposal.annotation.axes_defaulted = ["assertion"];
        const apply = vi.spyOn(api, "applyCommand");
        render(<CaseScreen view={view} workspaceId="ws-proposal" onClose={vi.fn()} />);
        fireEvent.keyDown(window, { key: "j" });
        fireEvent.keyDown(document.body, { key: "d" });
        fireEvent.keyDown(document.body, { key: "v" });
        await act(async () => { await Promise.resolve(); });
        expect(apply).not.toHaveBeenCalled();
      });

      it("lists /, V and D under Finding in ? help", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = loopView();
        loopServer(view);
        const rendered = render(<CaseScreen view={view} workspaceId="ws-help" onClose={vi.fn()} />);
        await addHypotonia(rendered.container);
        await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-confirm-defaults")).toBe(true));
        fireEvent.keyDown(document.body, { key: "?" });
        const help = await screen.findByRole("dialog");
        expect(within(help).getByText("Finding")).toBeDefined();
        expect(within(help).getByText("Focus the term search")).toBeDefined();
        expect(within(help).getByText("Focus the values")).toBeDefined();
        expect(within(help).getByText("Confirm all default values")).toBeDefined();
      });

      it("renames the findings badge to Defaults to confirm", async () => {
        vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
        const view = loopView();
        loopServer(view);
        const rendered = render(<CaseScreen view={view} workspaceId="ws-badge" onClose={vi.fn()} />);
        await addHypotonia(rendered.container);
        expect(await screen.findByText("Defaults to confirm")).toBeDefined();
        expect(screen.queryByText("Defaulted axes")).toBeNull();
      });

      it("at 700 px shows the New finding bar instead of switching panes and opens the focused search on Choose term", async () => {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({
          matches: query === "(max-width: 700px)", media: query, onchange: null,
          addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
        })) as unknown as typeof window.matchMedia;
        try {
          vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
          const view = loopView();
          loopServer(view);
          const rendered = render(<CaseScreen view={view} workspaceId="ws-narrow" onClose={vi.fn()} />);
          const text = markThe(rendered.container);
          const layout = () => rendered.container.querySelector(".app-layout")!;
          expect(layout().classList.contains("mobile-pane-text")).toBe(true);
          const bar = rendered.container.querySelector<HTMLElement>(".pending-bar")!;
          expect(bar.textContent).toContain("New finding “The”Choose term");
          expect(within(bar).getByRole("button", { name: "Discard" })).toBeDefined();
          expect(document.activeElement).not.toBe(screen.getByRole("combobox", { name: "Search term" }));
          fireEvent.click(within(bar).getByRole("button", { name: "Choose term" }));
          expect(layout().classList.contains("mobile-pane-details")).toBe(true);
          const input = screen.getByRole("combobox", { name: "Search term" });
          await waitFor(() => expect(document.activeElement).toBe(input));
          await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id));
          fireEvent.keyDown(input, { key: "Enter" });
          await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-confirm-defaults")).toBe(true));
          fireEvent.keyDown(document.body, { key: "d" });
          const back = await screen.findByRole("button", { name: "Back to text" });
          await waitFor(() => expect(document.activeElement).toBe(back));
          fireEvent.click(back);
          expect(layout().classList.contains("mobile-pane-text")).toBe(true);
          await waitFor(() => expect(document.activeElement).toBe(text));
          expect(screen.queryByRole("button", { name: "Back to text" })).toBeNull();
        } finally { window.matchMedia = original; }
      });

      it("at 700 px with nothing to confirm focuses Back to text after adding a term", async () => {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({
          matches: query === "(max-width: 700px)", media: query, onchange: null,
          addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
        })) as unknown as typeof window.matchMedia;
        try {
          vi.spyOn(api, "searchOntology").mockResolvedValue(hits as any);
          const view = loopView({});
          loopServer(view);
          const rendered = render(<CaseScreen view={view} workspaceId="ws-narrow-empty" onClose={vi.fn()} />);
          markThe(rendered.container);
          fireEvent.click(within(rendered.container.querySelector<HTMLElement>(".pending-bar")!).getByRole("button", { name: "Choose term" }));
          const input = screen.getByRole("combobox", { name: "Search term" });
          await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id));
          fireEvent.keyDown(input, { key: "Enter" });
          await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to text" })));
        } finally { window.matchMedia = original; }
      });

      /** Two saved findings with unconfirmed defaults, selectable from the findings list. */
      const twoFindings = () => {
        const view = withEditableFinding(loopView());
        const a = view.draft.annotations![0];
        a.annotation.annotation_id = "finding-a";
        a.annotation.axes_values = { ...allDefaults }; a.annotation.axes_defaulted = ["assertion", "experiencer", "temporality"];
        const b = structuredClone(a); b.annotation.annotation_id = "finding-b";
        view.draft.annotations = [a, b];
        return view;
      };
      const selectFinding = (id: string) => fireEvent.click(document.querySelector(`[data-list-key="annotation:${id}"]`)!);
      const arrowTo = (from: RegExp, to: string) => {
        fireEvent.keyDown(screen.getByRole("radio", { name: from }), { key: "ArrowRight" });
        fireEvent.click(screen.getByRole("radio", { name: to }));
      };

      it("sends a pending arrow change to its own finding when another finding is selected within 300 ms", async () => {
        const view = twoFindings();
        const apply = loopServer(view);
        render(<CaseScreen view={view} workspaceId="ws-switch" onClose={vi.fn()} />);
        selectFinding("finding-a");
        vi.useFakeTimers();
        try {
          arrowTo(/^Present/, "Absent");
          act(() => { vi.advanceTimersByTime(100); });
          selectFinding("finding-b");
          await act(async () => { vi.advanceTimersByTime(400); });
        } finally { vi.useRealTimers(); }
        await waitFor(() => expect(setAxesCalls(apply)).toHaveLength(1));
        expect((setAxesCalls(apply)[0][1] as any).payload).toEqual(expect.objectContaining({
          annotation_id: "finding-a", axes_values: { ...allDefaults, assertion: "absent" }, chosen_axis_ids: ["assertion"] }));
      });

      it("V, an arrow change and D within 300 ms send the change first and then confirm the remaining defaults", async () => {
        const view = twoFindings();
        const apply = loopServer(view);
        render(<CaseScreen view={view} workspaceId="ws-vd" onClose={vi.fn()} />);
        selectFinding("finding-a");
        vi.useFakeTimers();
        try {
          fireEvent.keyDown(document.body, { key: "v" });
          const present = document.activeElement as HTMLInputElement;
          expect(present.closest('[data-axis-field="assertion"]')).not.toBeNull();
          fireEvent.keyDown(present, { key: "ArrowRight" });
          fireEvent.click(screen.getByRole("radio", { name: "Absent" }));
          fireEvent.keyDown(document.body, { key: "d" });
          await act(async () => { vi.advanceTimersByTime(400); });
        } finally { vi.useRealTimers(); }
        await waitFor(() => expect(setAxesCalls(apply)).toHaveLength(2));
        const [first, second] = setAxesCalls(apply).map(call => (call[1] as any).payload);
        const shown = { ...allDefaults, assertion: "absent" };
        expect(first).toEqual(expect.objectContaining({ axes_values: shown, chosen_axis_ids: ["assertion"] }));
        expect(second).toEqual(expect.objectContaining({ axes_values: shown, chosen_axis_ids: ["experiencer", "temporality"] }));
      });

      it("a failed confirmation shows the inline error and keeps the focus on Confirm defaults", async () => {
        const view = twoFindings();
        vi.spyOn(api, "applyCommand").mockRejectedValue(new ValidationError("Save refused"));
        render(<CaseScreen view={view} workspaceId="ws-confirm-fail" onClose={vi.fn()} />);
        selectFinding("finding-a");
        const button = screen.getByRole("button", { name: "Confirm defaults (3)" });
        button.focus();
        fireEvent.click(button);
        const section = document.querySelector<HTMLElement>("[data-values-section]")!;
        await waitFor(() => expect(within(section).getByRole("alert").textContent).toContain("The values could not be confirmed. Try again."));
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm defaults (3)" }));
        expect(document.querySelector("[data-carried-announcer]")?.textContent ?? "").not.toContain("Confirmed:");
      });

      it("clicking the highlighted default sends one set_axes for that axis and keeps focus", async () => {
        const view = twoFindings();
        view.draft.annotations![0].annotation.axes_defaulted = ["assertion", "experiencer"];
        const apply = loopServer(view);
        render(<CaseScreen view={view} workspaceId="ws-click-default" onClose={vi.fn()} />);
        selectFinding("finding-a");
        const present = screen.getByRole("radio", { name: "Present (default)" });
        present.focus();
        fireEvent.click(present);
        await waitFor(() => expect(setAxesCalls(apply)).toHaveLength(1));
        expect((setAxesCalls(apply)[0][1] as any).payload).toEqual(expect.objectContaining({
          command: "set_axes", annotation_id: "finding-a", axes_values: allDefaults, chosen_axis_ids: ["assertion"] }));
        await waitFor(() => expect(announcer()).toBe("Confirmed: Vorhandensein (Assertion) Present."));
        expect(document.activeElement).toBe(present);
        await waitFor(() => expect(screen.getByRole("button", { name: "Confirm defaults (1)" })).toBeDefined());
        expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Present" }));
      });

      it("queues a pending arrow change before the logout guard looks at the queue", async () => {
        const view = twoFindings();
        let release!: () => void;
        const hold = new Promise<void>(resolve => { release = resolve; });
        const server = loopServer(view);
        const inner = server.getMockImplementation()!;
        server.mockImplementation(async (...args) => { await hold; return inner(...args); });
        const leaveGuardRef = { current: null as ((proceed: () => void) => void) | null };
        render(<CaseScreen view={view} workspaceId="ws-guard-flush" onClose={vi.fn()} leaveGuardRef={leaveGuardRef} />);
        selectFinding("finding-a");
        arrowTo(/^Present/, "Absent");
        const proceed = vi.fn();
        act(() => { leaveGuardRef.current!(proceed); });
        expect(proceed).not.toHaveBeenCalled();
        expect(await screen.findByRole("dialog", { name: "Unsaved changes" })).toBeDefined();
        await act(async () => { release(); await hold; });
        await waitFor(() => expect(setAxesCalls(server)).toHaveLength(1));
      });

      it("queues a pending arrow change before leaving the case", async () => {
        const view = twoFindings();
        const apply = loopServer(view);
        const routeLeaveRef = { current: null as (() => Promise<boolean>) | null };
        render(<CaseScreen view={view} workspaceId="ws-leave-flush" onClose={vi.fn()} routeLeaveRef={routeLeaveRef} />);
        selectFinding("finding-a");
        arrowTo(/^Present/, "Absent");
        let left!: Promise<boolean>;
        act(() => { left = routeLeaveRef.current!(); });
        expect(await left).toBe(true);
        expect(setAxesCalls(apply)).toHaveLength(1);
      });
    });
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
    first.annotation.note = "First historical note\n<em>literal</em>";
    second.annotation.note = "Second historical note";
    second.annotation.annotation_id = "second-history-finding"; second.annotation.term_id = "HP:0001250";
    const current = structuredClone(first); current.annotation.note = "Current draft note";
    view.draft.annotations = [current];
    const base = { format_version: "ontocurator-submission/v2", origin_key: view.key,
      targets: view.targets!, draft_revision: 1, snapshots: [first], decisions: [], document_checked: true,
      created_at: new Date(2026, 9, 17, 9, 5).toISOString() };
    view.submissions = [{ ...base, submission_id: "sub-exact-first" },
      { ...base, submission_id: "sub-exact-second", snapshots: [second] }];
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Submission 1, 17 Oct 2026, 09:05" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /sub-exact-second/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submission 1, 17 Oct 2026, 09:05" }));
    const firstDialog = screen.getByRole("dialog", { name: "Historical submission" });
    expect(within(firstDialog).getByText(/First historical note/).textContent).toBe("First historical note\n<em>literal</em>");
    expect(firstDialog.querySelector("em")).toBeNull();
    expect(within(firstDialog).queryByText("Current draft note")).toBeNull();
    fireEvent.click(within(firstDialog.querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Submission 2, 17 Oct 2026, 09:05" }));
    const dialog = screen.getByRole("dialog", { name: "Historical submission" });
    expect(within(dialog).getByText("Second historical note")).toBeDefined();
    expect(within(dialog).getByRole("heading", { name: "Submission 2, 17 Oct 2026, 09:05" })).toBeDefined();
    fireEvent.click(within(dialog).getByText("Technical details"));
    expect(within(dialog).getByText("sub-exact-second")).toBeDefined();
    expect(within(dialog).queryByText("sub-exact-first")).toBeNull();
    expect(within(dialog).getByText("HP:0001250")).toBeDefined();
    expect(within(dialog).queryByText("HP:0001252")).toBeNull();
  });

  it("makes the absence of previous submissions explicit", () => {
    render(<CaseScreen view={sampleView} workspaceId="history-empty" onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Submission history" })).toBeDefined();
    expect(screen.getByText("No previous submissions yet.")).toBeDefined();
  });

  it("adds the exact successful submission to history immediately and keeps it read-only", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    view.draft.annotations![0].annotation.note = "Exact submitted clinical note";
    const submission = { format_version: "ontocurator-submission/v2", origin_key: view.key, targets: view.targets!,
      draft_revision: 1, snapshots: structuredClone(view.draft.annotations!), decisions: [], document_checked: true,
      created_at: new Date(2026, 9, 18, 9, 5).toISOString(), submission_id: "fresh-exact-submission" };
    vi.spyOn(api, "submitWorkspace").mockResolvedValue(submission);
    render(<CaseScreen view={view} workspaceId="history-after-submit" onClose={vi.fn()} />);
    expect(screen.getByText("No previous submissions yet.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    const confirm = await screen.findByRole("dialog", { name: "Submit case" });
    fireEvent.click(within(confirm).getByRole("checkbox", { name: "Submit with 3 unconfirmed values" }));
    fireEvent.click(within(confirm).getByRole("checkbox", { name: /Entire text checked/ }));
    fireEvent.click(within(confirm).getByRole("button", { name: "Submit case" }));
    const receipt = await screen.findByRole("dialog", { name: "Case submitted" });
    fireEvent.click(within(receipt).getByRole("button", { name: "Stay in case" }));
    expect(screen.queryByText("No previous submissions yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submission 1, 18 Oct 2026, 09:05" }));
    const history = screen.getByRole("dialog", { name: "Historical submission" });
    expect(within(history).getByText("Exact submitted clinical note")).toBeDefined();
    expect(within(history).getByText("fresh-exact-submission")).toBeDefined();
    expect(within(history).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(history.querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: /Finish & Submit/ })).toHaveProperty("disabled", true);
  });

  it("labels every profile axis and opens a finding with the keyboard", () => {
    const view = withEditableFinding(structuredClone(sampleView));
    view.draft.annotations![0].annotation.axes_values = { assertion: null, experiencer: "other", temporality: "historical" };
    const mounted = render(<CaseScreen view={view} workspaceId="axis-summary" onClose={vi.fn()} />);
    const row = mounted.container.querySelector('[data-list-key^="annotation:"]')!;
    expect(row.textContent).toContain("Vorhandensein (Assertion): Not specified");
    expect(row.textContent).toContain("Betroffene Person (Experiencer): Other person");
    expect(row.textContent).toContain("Zeitlicher Bezug (Temporality): Historical");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Note" })).toBeDefined();
  });

  it.each([
    [false, true, "This project requires a text span for findings.", "optional"],
    [true, true, "A reason is required for this finding without a text span.", "optional"],
    [true, false, "This annotation type requires a text span.", "required_on_complete"],
  ] as const)("checks current rules on a legacy draft at submission (%s, %s)", async (allow, requireNote, reason, evidencePolicy) => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: false, allow_spanless_findings: allow, require_spanless_note: requireNote });
    view.draft.annotations![0].annotation.evidence_refs = [];
    view.layers![0].annotation_types![0].evidence_policy = evidencePolicy;
    delete view.draft.annotations![0].annotation.note;
    const submit = vi.spyOn(api, "submitWorkspace");
    render(<CaseScreen view={view} workspaceId="legacy-rules" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
    expect(within(dialog).getByRole("button", { name: "Submit case" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(dialog).getByText(new RegExp(reason.replace(".", "\\.")))).toBeDefined();
    fireEvent.click(within(dialog).getAllByRole("button", { name: /^Go to / })[0]);
    expect(screen.queryByRole("dialog", { name: "Submit case" })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    await waitFor(() => expect(allow && requireNote && evidencePolicy === "optional"
      ? screen.getByLabelText("Note") : screen.getByRole("button", { name: "Add mention" })).toBe(document.activeElement));
  });

  it("does not request a reason when a text span is required", () => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: false, require_spanless_note: true });
    render(<CaseScreen view={view} workspaceId="prohibited" onClose={vi.fn()} />);
    selectEditableFinding();
    expect(screen.queryByLabelText(/Reason for no text span/)).toBeNull();
    expect(screen.getByLabelText("Note")).toHaveProperty("required", false);
  });

  it.each([false, true])("explains current submission rules without restricting legacy edits (%s)", allow => {
    const view = structuredClone(sampleView);
    Object.assign(view, { enforce_spanless_rules: false, allow_spanless_findings: allow, require_spanless_note: true });
    render(<CaseScreen view={view} workspaceId="legacy-guidance" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
    expect(screen.queryByText("Optional context for this finding.")).toBeNull();
    expect(screen.getAllByText(allow ? /Before submission, add a reason/ : /Before submission, add a text span or remove/).length).toBeGreaterThan(0);
  });

  const proposalView = () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const proposal = view.draft.annotations![0];
    view.draft.annotations = []; view.available_inputs = [proposal];
    view.key.mode = "review"; view.draft.key.mode = "review";
    view.targets!.targets = [{ annotation_id: proposal.annotation.annotation_id, version: proposal.version }];
    view.draft.targets = view.targets!;
    view.draft.decisions = [{ decision_id: "confirmed", target: view.targets!.targets[0], outcome: "confirmed", reviewer_id: "user-test" }];
    return { view, proposal };
  };

  it("focuses Edit & Replace for a proposal missing its annotation reason", async () => {
    const { view } = proposalView();
    render(<CaseScreen view={view} workspaceId="proposal-reason" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    expect(within(dialog).getByText(/The reviewer note does not supply the annotation reason/)).toBeDefined();
    expect(within(dialog).getByText(/A reason is required/)).toBeDefined();
    fireEvent.click(within(dialog).getAllByRole("button", { name: /^Go to / })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit & Replace/ })).toBe(document.activeElement));
  });

  it.each(["unknown", "obsolete"] as const)("names and focuses an invalid unresolved proposal (%s)", status => {
    const { view, proposal } = proposalView();
    view.require_spanless_note = false;
    view.draft.decisions![0].outcome = "uncertain";
    view.draft.decisions![0].note = "Needs review";
    view.term_statuses = { [`phenotype:${proposal.annotation.term_id}`]: status };
    render(<CaseScreen view={view} workspaceId="invalid-proposal" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    return screen.findByRole("dialog", { name: "Submit case" }).then(async dialog => {
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
      expect(within(dialog).getByRole("button", { name: "Submit case" }).getAttribute("aria-disabled")).toBe("true");
      expect(within(dialog).getByText(/Reject this proposal or use Edit & Replace/)).toBeDefined();
      expect(within(dialog).getByText(new RegExp(`term is ${status}`))).toBeDefined();
      fireEvent.click(within(dialog).getAllByRole("button", { name: /^Go to / })[0]);
      await waitFor(() => expect(screen.getByRole("button", { name: /Edit & Replace/ })).toBe(document.activeElement));
    });
  });

  it("shows one actionable stale-policy rejection and reloads current rules", async () => {
    const view = withEditableFinding(structuredClone(sampleView)); view.require_spanless_note = false;
    const reload = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(api, "submitWorkspace").mockRejectedValue(new ValidationError("Rules changed", "PROJECT_RULE_VIOLATION", { violations: [] }));
    render(<CaseScreen view={view} workspaceId="stale-policy" onClose={vi.fn()} onReload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Submit with 3 unconfirmed values" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit case" }));
    await screen.findByText(/Reload the case to load the current rules/);
    expect(screen.getAllByText(/Submission failed:/)).toHaveLength(1);
    expect(screen.queryByText(/highlighted values/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload current rules" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("identifies defaulted proposal axes and explains how to confirm them", async () => {
    const { view, proposal } = proposalView(); view.require_spanless_note = false;
    proposal.annotation.axes_values = { assertion: "present" }; proposal.annotation.axes_defaulted = ["assertion"];
    render(<CaseScreen view={view} workspaceId="proposal-defaults" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    fireEvent.click(within(dialog).getAllByRole("button", { name: /^Go to / })[0]);
    await waitFor(() => expect(document.activeElement).toHaveProperty("className", "detail-section review-actions__proposal"));
    expect(within(document.activeElement as HTMLElement).getByText("Defaulted")).toBeDefined();
    expect(screen.getByText(/This proposal is immutable/)).toBeDefined();
  });

  it("permits a legacy spanless result without a note under the current optional mode", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: false, allow_spanless_findings: true, require_spanless_note: false });
    view.draft.annotations![0].annotation.evidence_refs = [];
    delete view.draft.annotations![0].annotation.note;
    render(<CaseScreen view={view} workspaceId="legacy-optional" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
    expect(within(dialog).getByRole("button", { name: "Submit case" })).toHaveProperty("disabled", false);
  });

  it("escape_cancels_the_submit_dialog", async () => {
    render(<CaseScreen view={sampleView} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/i }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Submit case" })).toBeNull();
    expect(screen.getByRole("button", { name: /Finish & Submit/i })).toBeDefined();
  });

  it("the_case_submitted_dialog_ignores_escape", async () => {
    vi.spyOn(api, "submitWorkspace").mockResolvedValue({
      submission_id: "submission-1", created_at: "2026-10-15T10:00:00Z",
      snapshots: [], decisions: [], checked_layer_ids: [], document_checked: true,
    } as any);
    render(<CaseScreen view={sampleView} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/i }));
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
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/i }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    expect(within(dialog).getByRole("heading", { name: "Unconfirmed values (1 finding)" })).toBeDefined();
    fireEvent.click(within(dialog.querySelector<HTMLElement>("[data-unconfirmed-row]")!).getByRole("button", { name: /^Go to / }));
    await waitFor(() => expect((document.activeElement as HTMLElement).closest('[data-axis-field="assertion"]')).not.toBeNull());
    expect((screen.getByRole("checkbox", { name: /Visibility for Phänotyp/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Defaults to confirm")).toBeDefined();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm defaults (3)" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("ws-test", expect.objectContaining({ payload: expect.objectContaining({
      command: "set_axes", chosen_axis_ids: ["assertion", "experiencer", "temporality"] }) })));
    expect(apply).toHaveBeenCalledTimes(1);
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
        if (key === "4") fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
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
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/i }));
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
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(record).toHaveBeenCalledWith("ws-test", expect.objectContaining({
      payload: expect.objectContaining({ outcome: "uncertain", note: "Needs specialist input" }),
    })));
  });

  it("keeps a newly opened unresolved intent when an older decision request finishes", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const proposal = view.draft.annotations![0]; view.draft.annotations = [];
    view.available_inputs = [proposal]; view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: proposal.annotation.annotation_id, version: proposal.version };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    let finish!: (draft: Draft) => void;
    const record = vi.spyOn(api, "recordDecision").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<CaseScreen view={view} workspaceId="late-decision" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: "4" });
    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer note" }), { target: { value: "New unresolved intent" } });
    await act(async () => { finish({ ...view.draft, revision: 1, decisions: [{ decision_id: "old", target, outcome: "confirmed", reviewer_id: "r" }] }); });
    expect(screen.getByRole("button", { name: "Save decision" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("textbox", { name: "Reviewer note" })).toHaveProperty("value", "New unresolved intent");
  });

  it("keeps the editable reviewer note when the server refuses a decision save", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    const proposal = view.draft.annotations![0]; view.draft.annotations = [];
    view.available_inputs = [proposal]; view.key.mode = "review"; view.draft.key.mode = "review";
    view.targets!.targets = [{ annotation_id: proposal.annotation.annotation_id, version: proposal.version }];
    view.draft.targets = view.targets!;
    const saved = structuredClone(view.draft);
    saved.decisions = [{ decision_id: "saved", target: view.targets!.targets[0], outcome: "uncertain", note: "Keep this attempted note", reviewer_id: "r" }];
    const record = vi.spyOn(api, "recordDecision").mockRejectedValueOnce(new ValidationError("Reviewer note could not be saved")).mockResolvedValue(saved);
    render(<CaseScreen view={view} workspaceId="ws-test" onClose={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-list-key^="target:"]')!);
    const note = screen.getByRole("textbox", { name: "Reviewer note" });
    fireEvent.change(note, { target: { value: "  Keep this attempted note  " } });
    fireEvent.click(screen.getByRole("button", { name: /Unresolved/ }));
    expect(screen.queryByText("Reviewer note could not be saved")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
    expect(await screen.findByText("Reviewer note could not be saved")).toBeDefined();
    expect((note as HTMLInputElement).value).toBe("  Keep this attempted note  ");
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save decision" })).toBeNull());
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
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Submit case/ })).toBeNull());
    expect((await screen.findAllByText(/unresolved proposals require a reviewer note before submitting/)).length).toBeGreaterThan(0);
    const note = screen.getByRole("textbox", { name: "Reviewer note" });
    expect((note as HTMLInputElement).value).toBe("  "); expect(document.activeElement).toBe(note);
    expect(record).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    fireEvent.change(note, { target: { value: "Corrected reviewer note" } }); fireEvent.blur(note);
    await waitFor(() => expect(record).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
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
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Specific clinical reason" } });
    fireEvent.blur(screen.getByLabelText("Note"));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("ws-note", expect.objectContaining({ expected_revision: 1,
      payload: expect.objectContaining({ outcome: "changed", target, replacement: { annotation_id: "pending-finding", version: "note-version" } }) })));
    expect(apply).toHaveBeenCalledOnce();
  });

  it.each(["optional", "required_on_complete"] as const)("collects a reason before adopting a spanless proposal (%s)", async (evidencePolicy) => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true });
    const proposal = view.draft.annotations![0]; view.draft.annotations = []; view.available_inputs = [proposal];
    view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: proposal.annotation.annotation_id, version: proposal.version };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    view.layers![0].annotation_types[0].evidence_policy = evidencePolicy;
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

  it("editing a reason on a required-evidence copy waits for a mention before approving the replacement", async () => {
    const view = withEditableFinding(structuredClone(sampleView));
    Object.assign(view, { enforce_spanless_rules: true, allow_spanless_findings: true });
    view.layers![0].annotation_types[0].evidence_policy = "required_on_complete";
    const copy = view.draft.annotations![0]; copy.annotation.note = "Initial reason";
    const source = structuredClone(copy); source.annotation.annotation_id = "source-proposal"; source.version = "source-version";
    copy.annotation.provenance.source_refs = ["source-proposal:source-version"];
    view.available_inputs = [source]; view.key.mode = "review"; view.draft.key.mode = "review";
    const target = { annotation_id: "source-proposal", version: "source-version" };
    view.targets!.targets = [target]; view.draft.targets = view.targets!;
    const noted = structuredClone(view.draft); noted.revision = 1; noted.annotations![0].version = "noted-copy";
    noted.annotations![0].annotation.note = "Revised reason before supporting text";
    const supported = structuredClone(noted); supported.revision = 2; supported.annotations![0].version = "supported-copy";
    supported.annotations![0].annotation.evidence_refs = [{ evidence_id: "support", version: "support-v" }];
    supported.evidence = [{ version: "support-v", mention: { evidence_id: "support", segments: [{ start: 0, end: 3 }] } }] as any;
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValueOnce(noted).mockResolvedValueOnce(supported);
    const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({ ...supported, revision: 3 });
    const routeLeaveRef = { current: null as (() => Promise<boolean>) | null };
    render(<CaseScreen view={view} workspaceId="ws-required-copy" onClose={vi.fn()} routeLeaveRef={routeLeaveRef} />);
    selectEditableFinding();
    fireEvent.change(screen.getByLabelText(/Reason for no text span/), { target: { value: "Revised reason before supporting text" } });
    fireEvent.blur(screen.getByLabelText(/Reason for no text span/));
    await screen.findByText(/^Saved$/); expect(decide).not.toHaveBeenCalled(); expect(apply).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Add mention" }));
    const text = document.querySelector(".text-container")!;
    const node = text.querySelector(".run")!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 3);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); fireEvent.mouseUp(text);
    await waitFor(() => expect(decide).toHaveBeenCalledWith("ws-required-copy", expect.objectContaining({ payload: expect.objectContaining({ target, outcome: "changed", replacement: { annotation_id: "pending-finding", version: "supported-copy" } }) })));
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Revised reason before supporting text");
    await act(async () => { expect(await routeLeaveRef.current!()).toBe(true); });
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
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/i }));
    const dialog = await screen.findByRole("dialog", { name: /Submit case/i });
    expect(dialog.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Entire text checked for further findings" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/i }));
    await screen.findByRole("dialog", { name: /Submit case/i });
    expect((screen.getByRole("checkbox", { name: "Entire text checked for further findings" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/Verified layers:/)).toBeNull();
  });

  describe("Finish & Submit while a save is pending", () => {
    // Pending clinical edits must finish before opening the completion dialog.
    const twoLayerView = (): WorkspaceView => withEditableFinding({
      ...sampleView, require_spanless_note: false,
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
    const finishButton = () => screen.getByRole("button", { name: /Finish & Submit/i });

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

  describe("editor polish", () => {
    const task = { assignment_id: 17, workflow_revision: 0, held: false, project_key: "pkg-1", project_name: "Project", document_id: "doc-test-1",
      external_id: "accepted-translation", language: "de", source_language: "en", target_language: "de", task: "annotate" as const,
      status: "in_progress" as const, updated_at: "2026-10-16T12:00:00Z" };
    const assignmentNavigation = { tasks: [task], current: task, onNavigate: vi.fn() };
    const withMention = (view: WorkspaceView) => {
      const evidence = { mention: { evidence_id: "ev-h", segments: [{ start: 26, end: 35 }] }, version: "ev-1" };
      view.draft.evidence = [evidence] as any;
      view.draft.annotations = [{ schema_version: "ontocurator-annotation/v3", version: "v1",
        document_id: view.document.document_id, text_sha256: "text", ontology_sha256: "ontology", layer_config_sha256: "layer",
        annotation: { annotation_id: "ann-h", document_id: view.document.document_id, layer_id: "phenotype",
          type_id: "default", term_id: "HP:0001252", axes_values: {}, evidence_refs: [{ evidence_id: "ev-h", version: "ev-1" }],
          provenance: { actor: { actor_id: "user-test", kind: "human" }, method: "manual", source_refs: [] } }, evidence: [evidence] }] as any;
      return view;
    };
    const selectMention = () => fireEvent.click(document.querySelector('[data-list-key="annotation:ann-h"]')!);

    it("shows the empty inspector without the typo", () => {
      const rendered = render(<CaseScreen view={sampleView} workspaceId="ws" onClose={vi.fn()} />);
      expect(screen.getByRole("heading", { name: "No finding selected" })).toBeDefined();
      expect(screen.getByText("Select a finding in the list or in the text, or mark text to add one.")).toBeDefined();
      expect(document.body.textContent).not.toMatch(/text,or/);
      rendered.unmount();
      render(<CaseScreen view={sampleView} workspaceId="ws" onClose={vi.fn()} readOnly />);
      expect(screen.getByText("Select a finding in the list or in the text to see its details.")).toBeDefined();
    });

    it("has no My tasks button on assignment routes and keeps Dashboard on the legacy path", () => {
      const rendered = render(<CaseScreen view={sampleView} workspaceId="ws" onClose={vi.fn()} assignmentNavigation={assignmentNavigation} />);
      const toolbar = screen.getByRole("group", { name: "Case" });
      expect(within(toolbar).queryByRole("button", { name: /My tasks/ })).toBeNull();
      expect(within(toolbar).queryByRole("button", { name: /Dashboard/ })).toBeNull();
      rendered.unmount();
      render(<CaseScreen view={sampleView} workspaceId="ws" onClose={vi.fn()} />);
      expect(screen.getByRole("button", { name: "← Dashboard" })).toBeDefined();
    });

    it("renders the document name as h1 and the plain case navigation", () => {
      const rendered = render(<CaseScreen view={sampleView} workspaceId="ws" onClose={vi.fn()} assignmentNavigation={assignmentNavigation} />);
      const title = screen.getByRole("heading", { level: 1 });
      expect(title.textContent).toBe("accepted-translation");
      expect(title.classList.contains("case-title")).toBe(true);
      expect(screen.getByText("Case 1 of 1")).toBeDefined();
      rendered.unmount();
      render(<CaseScreen view={sampleView} workspaceId="ws" onClose={vi.fn()} />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("doc-test-1");
      expect(screen.queryByText(/Case: doc-test-1/)).toBeNull();
    });

    it("names modes and identity without jargon", () => {
      render(<CaseScreen view={sampleView} workspaceId="ws" onClose={vi.fn()} annotatorName="Alice" />);
      const badge = screen.getByText("Annotate from scratch");
      expect(badge.getAttribute("title")).toBe("You see neither the tool's proposals nor other people's work.");
      expect(screen.getByTestId("annotator-identity").textContent).toBe("as Alice (user-test)");
      expect(document.body.textContent).not.toMatch(/Annotating as|Independent annotation/);
    });

    it("hides the selection intent and explains segment and mention adding", async () => {
      vi.spyOn(api, "resolveTermLabels").mockResolvedValue([{ layer_id: "phenotype", term_id: "HP:0001252", label: "Hypotonia" }] as any);
      render(<CaseScreen view={withMention(structuredClone(sampleView))} workspaceId="ws" onClose={vi.fn()} />);
      expect(screen.queryByText(/Selection intent/)).toBeNull();
      selectMention();
      await screen.findByRole("heading", { level: 2, name: /Hypotonia/ });
      expect(screen.queryByText(/Selection intent/)).toBeNull();
      expect(screen.queryByText(/Mark the text/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Add segment" }));
      expect(screen.getByText("Adding a segment to mention 1 of Hypotonia. Mark the text. Esc cancels.")).toBeDefined();
      fireEvent.keyDown(document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByText(/Adding a segment/)).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "Add mention" }));
      expect(screen.getByText("Adding a mention to Hypotonia. Mark the text. Esc cancels.")).toBeDefined();
      expect(screen.queryByText(/Adding a segment/)).toBeNull();
    });

    it("uses Add mention, Add segment, Delete finding and Note", () => {
      render(<CaseScreen view={withMention(structuredClone(sampleView))} workspaceId="ws" onClose={vi.fn()} />);
      selectMention();
      expect(screen.getByRole("button", { name: "Add mention" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Add segment" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Delete finding" })).toBeDefined();
      expect(screen.getByLabelText("Note")).toBeDefined();
      expect(document.body.textContent).not.toMatch(/\+ Add Mention|\+ Segment|Delete Annotation/);
    });
  });
});

describe("CaseScreen: finding modifiers (attach mode, Modifiers section, marks)", () => {
  const TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie.";
  const pos = (word: string) => { const start = TEXT.indexOf(word); return { start, end: start + word.length }; };
  const LABELS: Record<string, [string, "finding" | "modifier" | "cohort", ("severity" | "onset" | null)?]> = {
    "HP:0001250": ["Seizure", "finding"], "HP:0001252": ["Hypotonia", "finding"],
    "HP:0012828": ["Severe", "modifier", "severity"], "HP:0031796": ["Recurrent", "modifier"],
    "HP:0012825": ["Mild", "modifier", "severity"], "HP:0040283": ["Frequent", "cohort"],
  };
  const AXES = [{ id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: true }];
  type Mod = { term_id: string; segments?: { start: number; end: number }[] };
  type Finding = [id: string, term: string, word: string | null, modifiers?: Mod[]];
  const findingSnap = ([id, term, word, modifiers = []]: Finding) => ({
    schema_version: "ontocurator-annotation/v3", version: `${id}-v1`, document_id: "doc-mod", text_sha256: "t", ontology_sha256: "o", layer_config_sha256: "l",
    annotation: { annotation_id: id, document_id: "doc-mod", layer_id: "phenotype", type_id: "default", term_id: term, axes_values: { assertion: "present" },
      axes_defaulted: [], evidence_refs: word ? [{ evidence_id: `ev-${id}`, version: "ev-1" }] : [], modifiers,
      provenance: { actor: { actor_id: "ann", kind: "human" }, method: "manual", source_refs: [] } },
    evidence: [],
  });
  const modView = (findings: Finding[]): WorkspaceView => {
    const key = { project_key: "pkg-1", document_id: "doc-mod", annotator_id: "ann", mode: "independent", scope_id: "scope-default", target_set_id: "targets-0" };
    return {
      require_chosen_axes: false, annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: false, enforce_spanless_rules: true,
      document: { document_id: "doc-mod", text: TEXT, language: "de", text_sha256: "t" }, key,
      scope: { scope_id: "scope-default", mode: "independent", editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
      layers: [{ layer_id: "phenotype", label: "Phenotype", ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "default",
        annotation_types: [{ type_id: "default", label: "Phenotype", evidence_policy: "optional", axes: AXES }] }],
      ontologies: [{ ontology_id: "hp", release: "1", label: "HPO", sha256: "s", format: "obo-graph-json" }],
      checked_layer_ids: [], modifier_layer_ids: ["phenotype"],
      draft: { key, targets: { target_set_id: "targets-0", targets: [] }, revision: 1,
        annotations: findings.map(findingSnap),
        evidence: findings.filter(([, , word]) => word).map(([id, , word]) => ({ version: "ev-1", mention: { evidence_id: `ev-${id}`, segments: [pos(word!)] } })),
        decisions: [], checked_layer_ids: [] },
      targets: { target_set_id: "targets-0", targets: [] }, submissions: [], available_inputs: [], term_statuses: {},
      axes_definition: "editor-axes/v1", axes_config: AXES, axes_config_sha256: "x",
    } as unknown as WorkspaceView;
  };
  const severeHits = { search_id: "s-sev", candidates: [
    { term_id: "HP:0012828", label: "Severe", rank: 1, display_pos: 1, match_kind: "label", matched_term: "schwer", role: "modifier" }] };
  /** applyCommand that applies the modifier commands to the draft it last returned. */
  const commandSpy = (view: WorkspaceView) => {
    let current = structuredClone(view.draft);
    return vi.spyOn(api, "applyCommand").mockImplementation(async (_ws, envelope) => {
      const payload = envelope.payload as Record<string, any>;
      current = structuredClone(current); current.revision += 1;
      const ann = current.annotations!.find(a => a.annotation.annotation_id === payload.annotation_id)?.annotation as any;
      if (ann) {
        const rest = (ann.modifiers ?? []).filter((m: Mod) => m.term_id !== payload.term_id);
        const old = (ann.modifiers ?? []).find((m: Mod) => m.term_id === payload.term_id);
        if (payload.command === "add_modifier") ann.modifiers = [...rest, { term_id: payload.term_id, segments: payload.segments ?? old?.segments ?? [] }];
        if (payload.command === "set_modifier_segments") ann.modifiers = [...rest, { term_id: payload.term_id, segments: payload.segments }];
        if (payload.command === "remove_modifier") ann.modifiers = rest;
      }
      return current;
    });
  };
  const setup = async (view: WorkspaceView, hits: unknown = severeHits, waitForList = true) => {
    vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_p, terms) => terms.map(t => ({ ...t, label: LABELS[t.term_id]?.[0] ?? t.term_id,
      role: LABELS[t.term_id]?.[1] ?? "finding", exclusive_class: LABELS[t.term_id]?.[2] ?? null })) as never);
    vi.spyOn(api, "searchOntology").mockResolvedValue(hits as never);
    const apply = commandSpy(view);
    const rendered = render(<CaseScreen view={view} workspaceId="ws-mod" onClose={vi.fn()} />);
    if (waitForList && view.draft.annotations?.length) await screen.findAllByText(LABELS[view.draft.annotations[0].annotation.term_id][0]);
    return { ...rendered, apply };
  };
  const mark = (container: HTMLElement, word: string) => {
    const text = container.querySelector(".text-container")!;
    const run = [...text.querySelectorAll(".run")].find(r => r.textContent!.includes(word))!;
    const node = run.firstChild!, start = node.textContent!.indexOf(word);
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + word.length);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.mouseUp(text);
    window.getSelection()!.removeAllRanges();
  };
  const chooseSevere = async (container: HTMLElement) => {
    mark(container, "schwere");
    const input = screen.getByRole("combobox", { name: "Search term" });
    await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
  };
  const startAttach = async (container: HTMLElement) => {
    await chooseSevere(container);
    await screen.findByRole("region", { name: "Attach Severe" });
  };
  const runsOf = (container: HTMLElement, id: string) => [...container.querySelectorAll<HTMLElement>(".text-container .run")]
    .filter(run => (run.dataset.mentions ?? "").split(" ").includes(id));
  const payloads = (apply: { mock: { calls: unknown[][] } }) => apply.mock.calls.map(call => (call[1] as { payload: Record<string, unknown> }).payload);
  const announcer = (container: HTMLElement) => container.querySelector("[data-carried-announcer]")!.textContent;
  const SEIZURE_HYPO: Finding[] = [["seizure", "HP:0001250", "Krampfanfälle"], ["hypo", "HP:0001252", "Muskelhypotonie"]];
  const SEVERE_ON_SEIZURE: Finding[] = [["seizure", "HP:0001250", "Krampfanfälle", [{ term_id: "HP:0012828", segments: [pos("schwere")] }]]];

  it("a modifier hit for a new mark starts the attach mode; Enter on the focused row attaches", async () => {
    const { container, apply } = await setup(modView(SEIZURE_HYPO));
    await startAttach(container);
    expect(payloads(apply)).toEqual([]);
    const banner = container.querySelector<HTMLElement>(".attach-mention-banner")!;
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toContain("Attach Severe: click its finding in the list or in the text (↑ ↓ Enter in the list). Esc cancels.");
    expect(within(banner).getByRole("button", { name: "Cancel (Esc)" })).toBeDefined();
    expect(container.querySelector(".pending-mark-bar")).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Search term" })).toBeNull();
    const row = screen.getByRole("button", { name: "Attach Severe to Seizure" });
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row.textContent).toContain("Attach Severe here");
    await waitFor(() => expect(runsOf(container, "ev-seizure")[0].classList.contains("run--framed")).toBe(true));
    expect(runsOf(container, "ev-hypo")[0].classList.contains("run--framed")).toBe(false);
    expect(runsOf(container, "ev-seizure")[0].title).toBe("Attach Severe to Seizure");
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(payloads(apply)).toEqual([{ command: "add_modifier", annotation_id: "seizure", term_id: "HP:0012828", segments: [pos("schwere")] }]));
    await waitFor(() => expect(document.activeElement?.closest('[data-modifier-chip="HP:0012828"]')).not.toBeNull());
    expect(container.querySelector(".attach-mention-banner")).toBeNull();
    expect(screen.getByRole("list", { name: "Modifiers of Seizure" }).textContent).toContain("Severe · “schwere”");
    expect(announcer(container)).toBe("Attached Severe to Seizure. Next: mark more text, or add another modifier with “+ Add modifier…”.");
    expect(container.querySelector('[data-list-key="annotation:seizure"] .mod-lines')!.textContent).toContain("Severe HP:0012828 “schwere”");
    const modRun = runsOf(container, "mod:seizure:HP:0012828")[0];
    expect(modRun.classList.contains("run--modifier")).toBe(true);
    expect(modRun.title).toBe("Severe, modifier of Seizure");
    expect(runsOf(container, "ev-seizure")[0].title).toBe("Seizure, modifiers: Severe (“schwere”)");
  });

  it("↓ moves to the next target row and Enter attaches there", async () => {
    const { container, apply } = await setup(modView(SEIZURE_HYPO));
    await startAttach(container);
    const seizure = screen.getByRole("button", { name: "Attach Severe to Seizure" });
    await waitFor(() => expect(document.activeElement).toBe(seizure));
    fireEvent.keyDown(seizure, { key: "ArrowDown" });
    const hypo = screen.getByRole("button", { name: "Attach Severe to Hypotonia" });
    await waitFor(() => expect(document.activeElement).toBe(hypo));
    fireEvent.keyDown(hypo, { key: "Enter" });
    await waitFor(() => expect(payloads(apply)[0]).toEqual(expect.objectContaining({ command: "add_modifier", annotation_id: "hypo" })));
  });

  it("a click on another finding's mark attaches to it", async () => {
    const { container, apply } = await setup(modView(SEIZURE_HYPO));
    await startAttach(container);
    fireEvent.click(runsOf(container, "ev-hypo")[0]);
    await waitFor(() => expect(payloads(apply)[0]).toEqual(expect.objectContaining({ annotation_id: "hypo", segments: [pos("schwere")] })));
  });

  it("“Attach to Seizure” in the inspector attaches to the nearest", async () => {
    const { container, apply } = await setup(modView(SEIZURE_HYPO));
    await startAttach(container);
    fireEvent.click(screen.getByRole("button", { name: "Attach to Seizure" }));
    await waitFor(() => expect(payloads(apply)[0]).toEqual(expect.objectContaining({ annotation_id: "seizure" })));
  });

  it("a target with Severe on another span is only focused; Replace text span sends set_modifier_segments", async () => {
    const { container, apply } = await setup(modView([["seizure", "HP:0001250", "Krampfanfälle", [{ term_id: "HP:0012828", segments: [pos("wiederholt")] }]], ["hypo", "HP:0001252", "Muskelhypotonie"]]));
    await startAttach(container);
    fireEvent.click(screen.getByRole("button", { name: "Attach Severe to Seizure" }));
    expect(await screen.findByText("Seizure already has Severe (“wiederholt”). Attaching replaces its text span.")).toBeDefined();
    expect(payloads(apply)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Replace text span" }));
    await waitFor(() => expect(payloads(apply)).toEqual([{ command: "set_modifier_segments", annotation_id: "seizure", term_id: "HP:0012828", segments: [pos("schwere")] }]));
  });

  it("a spanless Severe on the target is linked through add_modifier", async () => {
    const { container, apply } = await setup(modView([["seizure", "HP:0001250", "Krampfanfälle", [{ term_id: "HP:0012828" }]]]));
    await startAttach(container);
    fireEvent.click(screen.getByRole("button", { name: "Link “schwere” to Severe" }));
    await waitFor(() => expect(payloads(apply)).toEqual([{ command: "add_modifier", annotation_id: "seizure", term_id: "HP:0012828", segments: [pos("schwere")] }]));
    await waitFor(() => expect(announcer(container)).toBe("Linked “schwere” to Severe of Seizure."));
  });

  it("the pending mark stays resizable; an adjusted mark is attached", async () => {
    const { container, apply } = await setup(modView(SEIZURE_HYPO));
    await startAttach(container);
    const handles = container.querySelectorAll<HTMLElement>(".text-container .resize-handle");
    expect(handles.length).toBe(2);
    // A keyboard move of the end handle, still waiting for its pause when attaching.
    handles[1].focus();
    fireEvent.keyDown(handles[1], { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Attach to Seizure" }));
    await waitFor(() => expect(payloads(apply)).toHaveLength(1));
    // The edge skips the space: "schwere K".
    expect(payloads(apply)[0].segments).toEqual([{ start: pos("schwere").start, end: pos("schwere").end + 2 }]);
  });

  for (const end of ["Escape", "Cancel (Esc)", "Discard"] as const) {
    it(`${end} ends the mode and drops the mark without a command`, async () => {
      const { container, apply } = await setup(modView(SEIZURE_HYPO));
      await startAttach(container);
      const row = screen.getByRole("button", { name: "Attach Severe to Seizure" });
      await waitFor(() => expect(document.activeElement).toBe(row));
      if (end === "Escape") fireEvent.keyDown(row, { key: "Escape" });
      else if (end === "Cancel (Esc)") fireEvent.click(screen.getByRole("button", { name: "Cancel (Esc)" }));
      else fireEvent.click(within(container.querySelector<HTMLElement>(".pending-mark-bar")!).getByRole("button", { name: /Discard/ }));
      await waitFor(() => expect(container.querySelector(".attach-mention-banner")).toBeNull());
      expect(screen.queryByRole("region", { name: "Attach Severe" })).toBeNull();
      expect(screen.queryByRole("region", { name: "New finding" })).toBeNull();
      expect(announcer(container)).toBe("Marked text discarded.");
      expect(payloads(apply)).toEqual([]);
    });
  }

  it("marking other text ends the mode and replaces the pending mark", async () => {
    const { container } = await setup(modView(SEIZURE_HYPO));
    await startAttach(container);
    mark(container, "Wochen");
    await waitFor(() => expect(container.querySelector(".attach-mention-banner")).toBeNull());
    expect(container.querySelector(".pending-quote")!.textContent).toBe("“Wochen”");
  });

  it("without a target the mode does not start: Create the finding first, OK discards", async () => {
    const { container, apply } = await setup(modView([]));
    await chooseSevere(container);
    expect(within(await screen.findByRole("region", { name: "Attach Severe" })).getByText("Severe is a modifier. Create the finding first, then add Severe under Modifiers.")).toBeDefined();
    expect(container.querySelector(".attach-mention-banner")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "OK" })));
    expect(announcer(container)).toBe("Severe is a modifier. Create the finding first, then add Severe under Modifiers.");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(container.querySelector(".pending-quote")).toBeNull());
    expect(payloads(apply)).toEqual([]);
  });

  it("Link a text span: the next selection sends set_modifier_segments; Esc returns to the chip", async () => {
    const { container, apply } = await setup(modView([["seizure", "HP:0001250", "Krampfanfälle", [{ term_id: "HP:0031796" }]]]));
    fireEvent.click(container.querySelector('[data-list-key="annotation:seizure"]')!);
    fireEvent.click(await screen.findByRole("button", { name: "Actions, Recurrent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Link a text span…" }));
    const banner = container.querySelector<HTMLElement>(".attach-mention-banner")!;
    expect(banner.textContent).toContain("Select the text for Recurrent, then press Enter. Esc cancels.");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(container.querySelector(".attach-mention-banner")).toBeNull());
    expect(document.activeElement?.closest('[data-modifier-chip="HP:0031796"]')).not.toBeNull();
    expect(payloads(apply)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Actions, Recurrent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Link a text span…" }));
    mark(container, "wiederholt");
    await waitFor(() => expect(payloads(apply)).toEqual([{ command: "set_modifier_segments", annotation_id: "seizure", term_id: "HP:0031796", segments: [pos("wiederholt")] }]));
    await waitFor(() => expect(announcer(container)).toBe("Linked “wiederholt” to Recurrent."));
    expect(screen.queryByRole("region", { name: "New finding" })).toBeNull();
  });

  it("hovering a finding row frames its marks and modifier segments; a click on a modifier segment selects the finding and focuses the chip", async () => {
    const { container } = await setup(modView(SEVERE_ON_SEIZURE));
    const row = container.querySelector<HTMLElement>('[data-list-key="annotation:seizure"]')!;
    fireEvent.pointerEnter(row);
    await waitFor(() => expect(runsOf(container, "ev-seizure")[0].classList.contains("run--framed")).toBe(true));
    expect(runsOf(container, "mod:seizure:HP:0012828")[0].classList.contains("run--framed")).toBe(true);
    fireEvent.pointerLeave(row);
    await waitFor(() => expect(runsOf(container, "ev-seizure")[0].classList.contains("run--framed")).toBe(false));
    fireEvent.click(runsOf(container, "mod:seizure:HP:0012828")[0]);
    await waitFor(() => expect(document.activeElement?.closest('[data-modifier-chip="HP:0012828"]')).not.toBeNull());
    expect(row.getAttribute("aria-pressed")).toBe("true");
    // The selected finding keeps its modifier segments framed.
    expect(runsOf(container, "mod:seizure:HP:0012828")[0].classList.contains("run--framed")).toBe(true);
  });

  it("“+ Add modifier…” adds without a span; remove shows an Undo toast and Ctrl+Z restores", async () => {
    const recurrent = { search_id: "s-rec", candidates: [{ term_id: "HP:0031796", label: "Recurrent", rank: 1, display_pos: 1, role: "modifier" }] };
    const { container, apply } = await setup(modView(SEVERE_ON_SEIZURE), recurrent);
    fireEvent.click(container.querySelector('[data-list-key="annotation:seizure"]')!);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add modifier…" }));
    const input = screen.getByRole("combobox", { name: "Search modifier" });
    fireEvent.change(input, { target: { value: "rec" } });
    await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(payloads(apply)).toEqual([{ command: "add_modifier", annotation_id: "seizure", term_id: "HP:0031796" }]));
    expect(await screen.findByText("Added Recurrent to Seizure. Link a text span?")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Actions, Severe" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove modifier" }));
    await waitFor(() => expect(payloads(apply)[1]).toEqual({ command: "remove_modifier", annotation_id: "seizure", term_id: "HP:0012828" }));
    expect(await screen.findByText("Removed Severe from Seizure")).toBeDefined();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(payloads(apply)[2]).toEqual({ command: "add_modifier", annotation_id: "seizure", term_id: "HP:0012828", segments: [pos("schwere")] }));
  });

  it("Change term never offers a modifier term", async () => {
    const { container } = await setup(modView(SEIZURE_HYPO));
    fireEvent.click(container.querySelector('[data-list-key="annotation:seizure"]')!);
    fireEvent.click(await screen.findByRole("button", { name: /Change term/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search term" }), { target: { value: "schwer" } });
    const option = (await screen.findAllByRole("option"))[0];
    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(option.textContent).toContain("Modifier — add it under Modifiers instead.");
  });

  describe("submit with modifier warnings", () => {
    const MILD_SEVERE: Finding[] = [["seizure", "HP:0001250", "Krampfanfälle", [{ term_id: "HP:0012825" }, { term_id: "HP:0012828" }]]];
    const modWarning = (view: WorkspaceView, warnings: { rule: string; detail: Record<string, string> }[], digest = "mod-digest") =>
      new ApiError(422, "Review warnings", "AXIS_CONFIRMATION_WARNING", {
        acknowledgement: { draft_revision: view.draft.revision, policy_revision: 1, warning_digest: digest },
        warnings: warnings.map(warning => ({ annotation_id: "seizure", ...warning })) });
    const submitted = (view: WorkspaceView) => ({ format_version: "ontocurator-submission/v2", submission_id: "mod-submitted", origin_key: view.key,
      targets: view.targets!, draft_revision: view.draft.revision, snapshots: view.draft.annotations!, decisions: [], document_checked: true,
      created_at: "2026-10-25T12:00:00Z" });
    const openSubmit = async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
      return screen.findByRole("dialog", { name: "Submit case" });
    };

    it("Two severities is listed, never blocks, and the ticked box submits with the acknowledgement in one action", async () => {
      const view = modView(MILD_SEVERE);
      await setup(view);
      const submit = vi.spyOn(api, "submitWorkspace")
        .mockRejectedValueOnce(modWarning(view, [{ rule: "exclusive_modifier_class", detail: { class: "severity" } }]))
        .mockResolvedValue(submitted(view) as never);
      const dialog = await openSubmit();
      const section = await within(dialog).findByRole("region", { name: "Modifier warnings · 1" });
      expect(section.textContent).toContain("Seizure: Two severities: Mild, Severe.");
      expect(within(dialog).queryByText(/Turn .* before submitting/)).toBeNull();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Submit with 1 modifier warnings" }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit case" }));
      await screen.findByRole("dialog", { name: "Case submitted" });
      expect(submit).toHaveBeenCalledTimes(2);
      expect((submit.mock.calls[1][1] as any).payload.warning_acknowledgement).toEqual(
        { draft_revision: view.draft.revision, policy_revision: 1, warning_digest: "mod-digest" });
    });

    it("a server warning with an extra modifier pair does not resend and lists it", async () => {
      const view = modView(MILD_SEVERE);
      await setup(view);
      const submit = vi.spyOn(api, "submitWorkspace").mockRejectedValue(modWarning(view, [
        { rule: "exclusive_modifier_class", detail: { class: "severity" } }, { rule: "cohort_modifier", detail: { term_id: "HP:0040283" } }]));
      const dialog = await openSubmit();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Submit with 1 modifier warnings" }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit case" }));
      await waitFor(() => expect(dialog.querySelector("[data-submit-status]")!.textContent).toBe("The unconfirmed values changed. Check the list again."));
      expect(submit).toHaveBeenCalledTimes(1);
      const box = within(dialog).getByRole("checkbox", { name: "Submit with 2 modifier warnings" }) as HTMLInputElement;
      expect(box.checked).toBe(false);
      expect(within(dialog).getByRole("region", { name: "Modifier warnings · 2" }).textContent).toContain("Seizure: HP:0040283 is a cohort term.");
      // No unconfirmed values row comes from the modifier pairs.
      expect(dialog.querySelector("[data-unconfirmed-values]")).toBeNull();
    });
  });

  describe("Turn into modifier… (convert mode, R3, E-c)", () => {
    // Old data: Severe stands alone as a finding on "schwere".
    const STANDALONE: Finding[] = [["sev", "HP:0012828", "schwere"], ["seizure", "HP:0001250", "Krampfanfälle"], ["hypo", "HP:0001252", "Muskelhypotonie"]];
    const convertSpy = (view: WorkspaceView) => vi.spyOn(api, "applyCommand").mockImplementation(async (_ws, envelope) => {
      const payload = envelope.payload as Record<string, any>;
      const next = structuredClone(view.draft); next.revision += 1;
      if (payload.command === "convert_to_modifier") {
        next.annotations = next.annotations!.filter(a => a.annotation.annotation_id !== payload.annotation_id);
        (next.annotations.find(a => a.annotation.annotation_id === payload.target_annotation_id)!.annotation as any).modifiers =
          [{ term_id: "HP:0012828", segments: [pos("schwere")] }];
      }
      return next;
    });
    const startConvert = async (container: HTMLElement) => {
      fireEvent.click(container.querySelector('[data-list-key="annotation:sev"]')!);
      expect(await screen.findByText("Severe is a modifier. Turn it into a modifier of another finding.")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Turn into modifier…" }));
      await screen.findByRole("region", { name: "Attach Severe" });
    };

    it("starts the attach mode without the source as target; Enter converts on the focused finding", async () => {
      const view = modView(STANDALONE);
      const { container } = await setup(view);
      const apply = convertSpy(view);
      await startConvert(container);
      const banner = container.querySelector<HTMLElement>(".attach-mention-banner")!;
      expect(banner.textContent).toContain("Attach Severe: click its finding in the list or in the text (↑ ↓ Enter in the list). Esc cancels.");
      expect(screen.getByText("The standalone finding Severe is then deleted; its text “schwere” goes with the modifier.")).toBeDefined();
      const source = container.querySelector<HTMLElement>('[data-list-key="annotation:sev"]')!;
      expect(source.textContent).toContain("Becomes a modifier of the finding you choose");
      expect(screen.queryByRole("button", { name: "Attach Severe to Severe" })).toBeNull();
      const row = screen.getByRole("button", { name: "Attach Severe to Seizure" });
      await waitFor(() => expect(document.activeElement).toBe(row));
      fireEvent.keyDown(row, { key: "Enter" });
      await waitFor(() => expect(payloads(apply)).toEqual([{ command: "convert_to_modifier", annotation_id: "sev", target_annotation_id: "seizure", link_span: true }]));
      await waitFor(() => expect(document.activeElement?.closest('[data-modifier-chip="HP:0012828"]')).not.toBeNull());
      expect(container.querySelector(".attach-mention-banner")).toBeNull();
      expect(container.querySelector('[data-list-key="annotation:sev"]')).toBeNull();
      expect(announcer(container)).toBe("Turned Severe into a modifier of Seizure.");
    });

    it("Esc only ends the mode: the finding stays and “Turn into modifier…” has focus", async () => {
      const view = modView(STANDALONE);
      const { container } = await setup(view);
      const apply = convertSpy(view);
      await startConvert(container);
      const row = screen.getByRole("button", { name: "Attach Severe to Seizure" });
      await waitFor(() => expect(document.activeElement).toBe(row));
      fireEvent.keyDown(row, { key: "Escape" });
      await waitFor(() => expect(container.querySelector(".attach-mention-banner")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Turn into modifier…" })));
      expect(container.querySelector('[data-list-key="annotation:sev"]')).not.toBeNull();
      expect(payloads(apply)).toEqual([]);
    });

    it("marking other text ends the convert mode and starts a new mark", async () => {
      const view = modView(STANDALONE);
      const { container } = await setup(view);
      await startConvert(container);
      mark(container, "Wochen");
      await waitFor(() => expect(container.querySelector(".attach-mention-banner")).toBeNull());
      expect(container.querySelector(".pending-quote")!.textContent).toBe("“Wochen”");
    });

    it("blocks the submit; “Go to Severe” focuses “Turn into modifier…”", async () => {
      const view = modView(STANDALONE);
      await setup(view);
      fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
      const dialog = await screen.findByRole("dialog", { name: "Submit case" });
      const item = await waitFor(() => dialog.querySelector<HTMLElement>('[data-open-item="modifier-as-finding"]')!);
      expect(item.textContent).toContain("Severe is a modifier. Turn it into a modifier of another finding.");
      expect(within(dialog).getByText("Turn 1 modifier used as a finding into a modifier before submitting.")).toBeDefined();
      fireEvent.click(within(item).getByRole("button", { name: "Go to Severe" }));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Turn into modifier…" })));
    });
  });

  it("re-creating a carried finding passes the source's modifiers along without text spans", async () => {
    const view = modView([]);
    const source = findingSnap(["old", "HP:0001250", "Krampfanfälle", [{ term_id: "HP:0012828", segments: [pos("schwere")] }, { term_id: "HP:0031796" }]]);
    const input = { input_id: "in-1", source_submission_id: "sub-1", source_ref: { annotation_id: "old", version: "old-v1" }, source_snapshot: source,
      target_snapshot: null, mapping_status: "needs_review", source_round_ordinal: 1 };
    view.key.round_id = "round-2"; view.draft.key = view.key;
    vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_p, terms) => terms.map(t => ({ ...t, label: LABELS[t.term_id]?.[0] ?? t.term_id })) as never);
    const apply = vi.spyOn(api, "applyCommand").mockImplementation(async (_ws, envelope) => {
      const payload = envelope.payload as Record<string, any>;
      return { ...view.draft, revision: view.draft.revision + 1, annotations: payload.command === "create_annotation" ? [findingSnap([payload.annotation_id, "HP:0001250", "Krampfanfälle"])] : view.draft.annotations } as never;
    });
    const { container } = render(<CaseScreen view={view} workspaceId="ws-carry" roundKind="carry_forward" roundInputs={[input as never]} onClose={vi.fn()} />);
    fireEvent.click(await waitFor(() => container.querySelector<HTMLElement>('[data-list-key="input:in-1"]')!));
    fireEvent.click(await screen.findByRole("button", { name: "Mark in text" }));
    mark(container, "Krampfanfälle");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save re-created finding" })); });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(3));
    const [create, ...mods] = payloads(apply);
    expect(create.command).toBe("create_annotation");
    expect(mods).toEqual([
      { command: "add_modifier", annotation_id: create.annotation_id, term_id: "HP:0012828" },
      { command: "add_modifier", annotation_id: create.annotation_id, term_id: "HP:0031796" },
    ]);
  });

  it("a failed modifier copy of a carried re-create does not stop the others or the link to the input", async () => {
    const view = modView([]);
    const source = findingSnap(["old", "HP:0001250", "Krampfanfälle", [{ term_id: "HP:0012828" }, { term_id: "HP:0031796" }, { term_id: "HP:0001252" }]]);
    const input = { input_id: "in-1", source_submission_id: "sub-1", source_ref: { annotation_id: "old", version: "old-v1" }, source_snapshot: source,
      target_snapshot: null, mapping_status: "needs_review", source_round_ordinal: 1 };
    view.key.round_id = "round-2"; view.draft.key = view.key;
    vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_p, terms) => terms.map(t => ({ ...t, label: LABELS[t.term_id]?.[0] ?? t.term_id })) as never);
    let created: any = null;
    const apply = vi.spyOn(api, "applyCommand").mockImplementation(async (_ws, envelope) => {
      const payload = envelope.payload as Record<string, any>;
      if (payload.command === "add_modifier" && payload.term_id === "HP:0031796") throw new ApiError(422, "Refused", "MODIFIER_NOT_ALLOWED", { term_id: "HP:0031796" });
      if (payload.command === "create_annotation") created = findingSnap([payload.annotation_id, "HP:0001250", "Krampfanfälle"]);
      return { ...view.draft, revision: view.draft.revision + apply.mock.calls.length, annotations: created ? [created] : [] } as never;
    });
    const { container } = render(<CaseScreen view={view} workspaceId="ws-carry" roundKind="carry_forward" roundInputs={[input as never]} onClose={vi.fn()} />);
    fireEvent.click(await waitFor(() => container.querySelector<HTMLElement>('[data-list-key="input:in-1"]')!));
    fireEvent.click(await screen.findByRole("button", { name: "Mark in text" }));
    mark(container, "Krampfanfälle");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save re-created finding" })); });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(4));
    expect(payloads(apply)[3]).toEqual(expect.objectContaining({ command: "add_modifier", term_id: "HP:0001252" }));
    await waitFor(() => expect(announcer(container)).toBe("Could not copy modifier Recurrent."));
    // The re-created finding is linked to its input: the pending mark is gone.
    expect(screen.queryByRole("button", { name: "Save re-created finding" })).toBeNull();
  });

  it("a case that turns read-only ends the link-a-span mode", async () => {
    const view = modView([["seizure", "HP:0001250", "Krampfanfälle", [{ term_id: "HP:0031796" }]]]);
    const { container, rerender } = await setup(view);
    fireEvent.click(container.querySelector('[data-list-key="annotation:seizure"]')!);
    fireEvent.click(await screen.findByRole("button", { name: "Actions, Recurrent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Link a text span…" }));
    expect(container.querySelector(".attach-mention-banner")).not.toBeNull();
    rerender(<CaseScreen view={view} workspaceId="ws-mod" onClose={vi.fn()} readOnly />);
    await waitFor(() => expect(container.querySelector(".attach-mention-banner")).toBeNull());
  });

  it("a hidden modifier layer's finding is still a target (no “Create the finding first”)", async () => {
    const view = modView(SEIZURE_HYPO);
    view.layers![0].default_visible = false;
    view.layers!.unshift({ ...view.layers![0], layer_id: "notes", label: "Notes", default_visible: true });
    view.scope.editable_layer_ids = ["notes", "phenotype"];
    view.modifier_layer_ids = ["notes", "phenotype"];
    const { container } = await setup(view, severeHits, false);
    await screen.findByRole("button", { name: "Add finding without a text span" });
    expect(container.querySelector('[data-list-key="annotation:seizure"]')).toBeNull();
    await chooseSevere(container);
    await waitFor(() => expect(container.querySelector(".attach-mention-banner")).not.toBeNull());
    expect(screen.queryByText("Severe is a modifier. Create the finding first, then add Severe under Modifiers.")).toBeNull();
  });

  it("a mark made while an attach command runs stays pending", async () => {
    const { container, apply } = await setup(modView(SEIZURE_HYPO));
    let release!: () => void;
    const original = apply.getMockImplementation()!;
    apply.mockImplementation((...args) => new Promise(resolve => { release = () => resolve(original(...args)); }));
    await startAttach(container);
    fireEvent.click(screen.getByRole("button", { name: "Attach to Seizure" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    mark(container, "Wochen");
    await act(async () => { release(); });
    await waitFor(() => expect(announcer(container)).toContain("Attached Severe to Seizure."));
    expect(container.querySelector(".pending-quote")!.textContent).toBe("“Wochen”");
  });
});
