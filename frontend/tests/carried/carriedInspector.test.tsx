import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AnnotationSnapshot, type Draft, type MutationEnvelope, type RoundInputView } from "../../src/api/client";
import { CaseScreen } from "../../src/app/CaseScreen";
import { historical } from "../variantFixtures";
import { workspaceFixture } from "../assignments";

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_project, terms) => terms.map(term => ({ ...term, label: "Seizure" })) as never);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const finding = (id: string, version = "v1"): AnnotationSnapshot => {
  const copy = structuredClone(historical.annotations[0]);
  copy.annotation.annotation_id = id;
  copy.version = version;
  return copy;
};
const input = (id: string, target: AnnotationSnapshot | null): RoundInputView => {
  const source = structuredClone(historical.annotations[0]);
  return {
    input_id: id, source_submission_id: "submission-2", source_ref: { annotation_id: source.annotation.annotation_id, version: source.version },
    source_snapshot: source, target_snapshot: target, mapping_status: target ? "carried" : "needs_review", source_round_ordinal: 2,
  };
};
const baseDraft = () => workspaceFixture().view.draft;
const draftWith = (revision: number, annotations: AnnotationSnapshot[], resolutions: unknown[] = []): Draft =>
  ({ ...baseDraft(), key: { ...baseDraft().key, round_id: "round-3" }, revision, annotations, round_input_resolutions: resolutions as never });

function setup({ annotations, inputs, resolutions = [], props = {} }: {
  annotations: AnnotationSnapshot[]; inputs: RoundInputView[]; resolutions?: unknown[]; props?: Record<string, unknown>;
}) {
  const view = workspaceFixture().view;
  view.key.round_id = "round-3"; view.draft.key = view.key; view.require_spanless_note = false;
  view.draft.annotations = annotations;
  view.draft.round_input_resolutions = resolutions as never;
  return render(<CaseScreen view={view} workspaceId="round-workspace" roundKind="carry_forward" roundInputs={inputs} onClose={vi.fn()} {...props} />);
}
const row = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-list-key="${key}"]`)!;
const pressed = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key][aria-pressed='true']")).map(element => element.dataset.listKey);
const liveRegion = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-carried-announcer]")!;
const section = () => screen.getByRole("region", { name: "Carried finding" });
const payloadOf = (spy: { mock: { calls: unknown[][] } }, call = 0) => (spy.mock.calls[call][1] as MutationEnvelope).payload;
const dismissWithReason = async (trigger: string, reason: string) => {
  fireEvent.click(within(section()).getByRole("button", { name: trigger }));
  const group = screen.getByRole("group", { name: "Dismiss carried finding" });
  const confirm = within(group).getByRole("button", { name: "Dismiss" });
  // Empty reason: the confirm button stays focusable but unavailable.
  expect(confirm.getAttribute("aria-disabled")).toBe("true");
  fireEvent.change(within(group).getByRole("textbox", { name: /Why does this finding not apply to this text\?/ }), { target: { value: reason } });
  expect(confirm.getAttribute("aria-disabled")).toBeNull();
  await act(async () => { fireEvent.click(confirm); });
};

describe("carried finding inspector", () => {
  it("marks a carried finding as checked from the section above the term heading", async () => {
    const carried = finding("carried");
    const resolution = { input_id: "input-1", outcome: "completed", annotation_ref: { annotation_id: "carried", version: "v1" } };
    const resolve = vi.spyOn(api, "resolveRoundInput").mockResolvedValue(draftWith(1, [carried], [resolution]));
    const { container } = setup({ annotations: [carried], inputs: [input("input-1", carried)] });
    fireEvent.click(row(container, "annotation:carried"));
    const region = section();
    const heading = container.querySelector(".inspector-pane h2")!;
    expect(region.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(region).getByText("None. This finding had no text span in Round 2 either.")).toBeDefined();
    await act(async () => { fireEvent.click(within(region).getByRole("button", { name: "Mark as checked" })); });
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(payloadOf(resolve)).toEqual({ input_id: "input-1", outcome: "completed", annotation_ref: { annotation_id: "carried", version: "v1" } });
    await waitFor(() => expect(within(row(container, "annotation:carried")).getByText("Checked")).toBeDefined());
    expect(screen.getByText("All carried findings checked")).toBeDefined();
    await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-carried-collapsed")).toBe(true));
    expect(liveRegion(container).textContent).toBe("Seizure checked. All carried findings checked.");
  });

  it("returns to check needed when the finding changes after the check", async () => {
    const carried = finding("carried", "checked-version");
    const resolution = { input_id: "input-1", outcome: "completed", annotation_ref: { annotation_id: "carried", version: "checked-version" } };
    const edited = structuredClone(carried); edited.version = "edited-version"; edited.annotation.note = "Edited";
    vi.spyOn(api, "applyCommand").mockResolvedValue(draftWith(1, [edited], [resolution]));
    const { container } = setup({ annotations: [carried], inputs: [input("input-1", carried)], resolutions: [resolution] });
    fireEvent.click(row(container, "annotation:carried"));
    const note = screen.getByRole("textbox", { name: "Annotation note" });
    fireEvent.change(note, { target: { value: "Edited" } });
    await act(async () => { fireEvent.blur(note); });
    await waitFor(() => expect(within(row(container, "annotation:carried")).getByText("Changed after your check")).toBeDefined());
    expect(within(row(container, "annotation:carried")).getByText("Check needed")).toBeDefined();
    expect(within(section()).getByText("You changed this finding after checking it. Check it again.")).toBeDefined();
  });

  it("dismisses atomically and undo restores the carried finding", async () => {
    const carried = finding("carried");
    const dismissed = { input_id: "input-1", outcome: "dismissed", reason: "Not here" };
    const resolve = vi.spyOn(api, "resolveRoundInput").mockResolvedValue(draftWith(1, [], [dismissed]));
    const clear = vi.spyOn(api, "clearRoundInputResolution").mockResolvedValue(draftWith(2, [carried], []));
    const { container } = setup({ annotations: [carried], inputs: [input("input-1", carried)] });
    fireEvent.click(row(container, "annotation:carried"));
    await dismissWithReason("Does not apply…", "Not here");
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(payloadOf(resolve)).toEqual({ input_id: "input-1", outcome: "dismissed", reason: "Not here", remove_carried_finding: true });
    await waitFor(() => expect(within(row(container, "input:input-1")).getByText("Dismissed: Not here")).toBeDefined());
    expect(row(container, "input:input-1").className).toContain("is-muted");
    expect(pressed(container)).toEqual(["input:input-1"]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Undo dismissal"));

    await act(async () => { fireEvent.click(within(section()).getByRole("button", { name: "Undo dismissal" })); });
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(payloadOf(clear)).toEqual({ command: "clear_round_input_resolution", input_id: "input-1" });
    await waitFor(() => expect(pressed(container)).toEqual(["annotation:carried"]));
    expect(within(row(container, "annotation:carried")).getByText("Check needed")).toBeDefined();
    await waitFor(() => expect((document.activeElement as HTMLElement).textContent).toContain("Mark as checked"));
    expect((document.activeElement as HTMLElement).hasAttribute("data-carried-primary")).toBe(true);
    expect(liveRegion(container).textContent).toBe("Seizure restored. 0 of 1 checked.");
  });

  it("explains deleting a carried finding, then offers the placeholder with dismissal focused", async () => {
    const carried = finding("carried");
    const plain = finding("plain");
    const apply = vi.spyOn(api, "applyCommand").mockResolvedValue(draftWith(1, [plain], []));
    const dismissed = { input_id: "input-1", outcome: "dismissed", reason: "Not here" };
    const resolve = vi.spyOn(api, "resolveRoundInput").mockResolvedValue(draftWith(2, [plain], [dismissed]));
    const clear = vi.spyOn(api, "clearRoundInputResolution").mockResolvedValue(draftWith(3, [plain], []));
    const { container } = setup({ annotations: [carried, plain], inputs: [input("input-1", carried)] });

    fireEvent.click(row(container, "annotation:plain"));
    fireEvent.click(screen.getByRole("button", { name: /Delete Annotation/ }));
    expect(within(screen.getByRole("group", { name: "Confirm deletion" })).getByText("Delete this annotation and all its mentions?")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(row(container, "annotation:carried"));
    fireEvent.click(screen.getByRole("button", { name: /Delete Annotation/ }));
    expect(within(screen.getByRole("group", { name: "Confirm deletion" })).getByText(
      "Delete this annotation and all its mentions? This is a carried finding. After deleting it, you must link another finding or dismiss it with a reason.",
    )).toBeDefined();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })); });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(payloadOf(apply)).toEqual(expect.objectContaining({ command: "delete_draft_annotation", annotation_id: "carried" }));
    await waitFor(() => expect(pressed(container)).toEqual(["input:input-1"]));
    await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-carried-dismiss")).toBe(true));
    expect(within(section()).getByText("You deleted the carried finding in this round.")).toBeDefined();

    await dismissWithReason("Dismiss with reason…", "Not here");
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(payloadOf(resolve)).toEqual({ input_id: "input-1", outcome: "dismissed", reason: "Not here" });
    await act(async () => { fireEvent.click(await within(section()).findByRole("button", { name: "Undo dismissal" })); });
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(row(container, "input:input-1")).getByText("Check needed")).toBeDefined());
    expect(pressed(container)).toEqual(["input:input-1"]);
  });

  it("re-creates a missing finding with Mark in text and links it without completing the input", async () => {
    const resolve = vi.spyOn(api, "resolveRoundInput");
    const apply = vi.spyOn(api, "applyCommand").mockImplementation(async (_workspace, envelope) => {
      const payload = envelope.payload as Record<string, unknown>;
      const created = finding(String(payload.annotation_id), "new-v1");
      return draftWith(1, [created], []);
    });
    const { container } = setup({ annotations: [], inputs: [input("input-failed", null)] });
    await screen.findByRole("button", { name: "Seizure, carried, not on this text, check needed" });
    fireEvent.click(row(container, "input:input-failed"));
    expect(within(section()).getByText("Its text span could not be found in this text.")).toBeDefined();
    fireEvent.click(within(section()).getByRole("button", { name: "Mark in text" }));
    expect(screen.getByText("Select supporting text to re-create Seizure.")).toBeDefined();

    const text = container.querySelector(".text-container")!;
    const node = text.querySelector(".run")!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.mouseUp(text);
    expect(screen.getByText("Re-create carried finding")).toBeDefined();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save re-created finding" })); });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const payload = payloadOf(apply) as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({
      command: "create_annotation", layer_id: "phenotype", type_id: "default", term_id: "HP:old",
      axes_values: { assertion: "present" }, chosen_axis_ids: [], segments: [{ start: 0, end: 7 }],
    }));
    expect(payload.annotation_id).not.toBe("old");
    const newKey = `annotation:${String(payload.annotation_id)}`;
    await waitFor(() => expect(pressed(container)).toEqual([newKey]));
    expect(within(section()).getByText("Check needed")).toBeDefined();
    expect(within(section()).getByRole("button", { name: "Mark as checked" })).toBeDefined();
    expect(within(row(container, "input:input-failed")).getByText("Linked to Seizure")).toBeDefined();
    expect(within(row(container, "input:input-failed")).getByText("Check needed")).toBeDefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("links a placeholder to an existing finding and completes it", async () => {
    const other = finding("other");
    const resolution = { input_id: "input-failed", outcome: "completed", annotation_ref: { annotation_id: "other", version: "v1" } };
    const resolve = vi.spyOn(api, "resolveRoundInput").mockResolvedValue(draftWith(1, [other], [resolution]));
    const { container } = setup({ annotations: [other], inputs: [input("input-failed", null)] });
    await screen.findByRole("button", { name: "Seizure, carried, not on this text, check needed" });
    fireEvent.click(row(container, "input:input-failed"));
    fireEvent.click(within(section()).getByRole("button", { name: "Link to an existing finding…" }));
    expect(within(section()).getByRole("radio", { name: "Seizure · no text span" })).toBeDefined();
    await act(async () => { fireEvent.click(within(section()).getByRole("button", { name: "Link and mark as checked" })); });
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(payloadOf(resolve)).toEqual({ input_id: "input-failed", outcome: "completed", annotation_ref: { annotation_id: "other", version: "v1" } });
    // Focus returns to the chooser trigger, never to the body.
    await waitFor(() => expect((document.activeElement as HTMLElement).hasAttribute("data-carried-link")).toBe(true));
  });

  it("a refused link keeps the chooser open and shows the error", async () => {
    const other = finding("other");
    vi.spyOn(api, "resolveRoundInput").mockRejectedValue(new ApiError(422, "bad", "ROUND_INPUT_INVALID"));
    const { container } = setup({ annotations: [other], inputs: [input("input-failed", null)] });
    await screen.findByRole("button", { name: "Seizure, carried, not on this text, check needed" });
    fireEvent.click(row(container, "input:input-failed"));
    fireEvent.click(within(section()).getByRole("button", { name: "Link to an existing finding…" }));
    await act(async () => { fireEvent.click(within(section()).getByRole("button", { name: "Link and mark as checked" })); });
    await waitFor(() => expect(within(section()).getByRole("alert")).toBeDefined());
    expect(within(section()).getByRole("group", { name: "Link to an existing finding" })).toBeDefined();
  });

  it("leaves the selection alone when the user moved on while a dismissal was pending", async () => {
    const carried = finding("carried");
    const plain = finding("plain");
    let finish!: (draft: Draft) => void;
    vi.spyOn(api, "resolveRoundInput").mockImplementation(() => new Promise<Draft>(resolve => { finish = resolve; }));
    const { container } = setup({ annotations: [carried, plain], inputs: [input("input-1", carried)] });
    fireEvent.click(row(container, "annotation:carried"));
    await dismissWithReason("Does not apply…", "Not here");
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.click(row(container, "annotation:plain"));
    const dismissed = { input_id: "input-1", outcome: "dismissed", reason: "Not here" };
    await act(async () => { finish(draftWith(1, [plain], [dismissed])); });
    await waitFor(() => expect(within(row(container, "input:input-1")).getByText("Dismissed: Not here")).toBeDefined());
    expect(pressed(container)).toEqual(["annotation:plain"]);
  });

  it("marks the selected carried finding as checked with C, never while typing or read-only", async () => {
    const carried = finding("carried");
    const resolve = vi.spyOn(api, "resolveRoundInput").mockResolvedValue(draftWith(1, [carried], []));
    const { container } = setup({ annotations: [carried], inputs: [input("input-1", carried)] });
    fireEvent.click(row(container, "annotation:carried"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Annotation note" }), { key: "c" });
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Mark carried finding as checked")).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => { fireEvent.keyDown(window, { key: "C", shiftKey: true }); });
    expect(resolve).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(window, { key: "c" }); });
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(payloadOf(resolve)).toEqual(expect.objectContaining({ outcome: "completed", input_id: "input-1" }));

    cleanup(); resolve.mockClear();
    const readOnly = setup({ annotations: [carried], inputs: [input("input-1", carried)], props: { readOnly: true } });
    fireEvent.click(row(readOnly.container, "annotation:carried"));
    await act(async () => { fireEvent.keyDown(window, { key: "c" }); });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("shows the section read-only in a submitted round and explains a paused task", () => {
    const carried = finding("carried");
    const submitted = setup({ annotations: [carried], inputs: [input("input-1", carried)], props: { readOnly: true } });
    fireEvent.click(row(submitted.container, "annotation:carried"));
    expect(within(section()).getByText("Check needed")).toBeDefined();
    expect(within(section()).queryByRole("button", { name: "Mark as checked" })).toBeNull();
    expect(within(section()).getByRole("button", { name: "Show original evidence" })).toBeDefined();
    cleanup();
    const paused = setup({ annotations: [carried], inputs: [input("input-1", carried)], props: { held: true, holdReason: "Problem reported" } });
    fireEvent.click(row(paused.container, "annotation:carried"));
    expect(within(section()).getByText("Checks are unavailable while the task is paused.")).toBeDefined();
    expect(within(section()).queryByRole("button", { name: "Mark as checked" })).toBeNull();
  });

  it("shows a network error with Retry that only retries the queued write", async () => {
    const carried = finding("carried");
    const resolution = { input_id: "input-1", outcome: "completed", annotation_ref: { annotation_id: "carried", version: "v1" } };
    const resolve = vi.spyOn(api, "resolveRoundInput")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(draftWith(1, [carried], [resolution]));
    const { container } = setup({ annotations: [carried], inputs: [input("input-1", carried)] });
    fireEvent.click(row(container, "annotation:carried"));
    await act(async () => { fireEvent.click(within(section()).getByRole("button", { name: "Mark as checked" })); });
    await waitFor(() => expect(within(section()).getByText("Could not save the check. Nothing changed.")).toBeDefined());
    expect(resolve).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(within(section()).getByRole("button", { name: "Retry" })); });
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect((resolve.mock.calls[1][1] as MutationEnvelope).mutation_id).toBe((resolve.mock.calls[0][1] as MutationEnvelope).mutation_id);
    await waitFor(() => expect(within(row(container, "annotation:carried")).getByText("Checked")).toBeDefined());
  });

  it("shows the stale message when the server rejects the check as stale", async () => {
    const carried = finding("carried");
    vi.spyOn(api, "resolveRoundInput").mockRejectedValue(new ApiError(422, "stale", "ROUND_INPUT_RESOLUTION_STALE"));
    const { container } = setup({ annotations: [carried], inputs: [input("input-1", carried)] });
    fireEvent.click(row(container, "annotation:carried"));
    await act(async () => { fireEvent.click(within(section()).getByRole("button", { name: "Mark as checked" })); });
    await waitFor(() => expect(within(section()).getByText("This finding changed before the check was saved. Check it again.")).toBeDefined());
  });
});
