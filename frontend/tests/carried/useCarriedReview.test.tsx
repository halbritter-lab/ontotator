import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft, MutationEnvelope, RoundInputView } from "../../src/api/client";
import type { MutationQueue, QueueState } from "../../src/editor/autosave";
import type { CarriedState } from "../../src/editor/carried/checkState";

const apiMock = vi.hoisted(() => ({ resolveRoundInput: vi.fn(), clearRoundInputResolution: vi.fn() }));
vi.mock("../../src/api/client", async importOriginal => ({ ...(await importOriginal<object>()), api: apiMock }));

const { ApiError, AuthError, ConflictError } = await import("../../src/api/client");
const { DiscardedChangesError } = await import("../../src/editor/autosave");
const { useCarriedReview } = await import("../../src/editor/carried/useCarriedReview");

const annotation = (id: string) => ({ annotation_id: id, layer_id: "hpo", type_id: "phenotype", term_id: "HP:0001250" });
const snapshot = (id: string, version = "v1") => ({ annotation: annotation(id), version });

const input = {
  input_id: "in-1",
  source_submission_id: "sub-1",
  source_ref: { annotation_id: "src-1", version: "v1" },
  source_snapshot: snapshot("src-1"),
  target_snapshot: snapshot("a-1"),
  mapping_status: "carried",
  source_round_ordinal: 2,
} as unknown as RoundInputView;

const draftOf = (annotations: ReturnType<typeof snapshot>[], resolutions: unknown[] = [], revision = 1) =>
  ({ revision, annotations, round_input_resolutions: resolutions } as unknown as Draft);

const baseDraft = draftOf([snapshot("a-1")]);
const checkedDraft = draftOf([snapshot("a-1")], [{ input_id: "in-1", outcome: "completed", annotation_ref: { annotation_id: "a-1", version: "v1" } }], 2);

interface Op { fn: (revision: number) => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }

function fakeQueue() {
  const ops: Op[] = [];
  let lastError: unknown = null;
  const queue = {
    enqueue: vi.fn((fn: Op["fn"]) => new Promise((resolve, reject) => { ops.push({ fn, resolve, reject }); })),
    retry: vi.fn(async () => {}),
    getLastError: vi.fn(() => lastError),
  };
  return {
    queue, ops,
    setLastError(error: unknown) { lastError = error; },
    /** Runs the head operation once; returns its result or the thrown error. */
    async attempt(revision = 1): Promise<{ result?: unknown; error?: unknown }> {
      try { return { result: await ops[0].fn(revision) }; } catch (error) { return { error }; }
    },
  };
}

function setup(overrides: Partial<{ hasUnsavedNotes: () => boolean; draft: Draft; readOnly: boolean }> = {}) {
  const fq = fakeQueue();
  const announce = vi.fn();
  const onDraft = vi.fn();
  const flushNotes = vi.fn(async () => {});
  const props = {
    inputs: [input], draft: overrides.draft ?? baseDraft, workspaceId: "ws-1", readOnly: overrides.readOnly ?? false,
    queue: fq.queue as unknown as Pick<MutationQueue, "enqueue" | "retry" | "getLastError">, queueState: "saved" as QueueState,
    flushNotes, hasUnsavedNotes: overrides.hasUnsavedNotes ?? (() => false), onDraft,
    announce, termText: () => "Seizure",
  };
  const hook = renderHook((p: typeof props) => useCarriedReview(p), { initialProps: props });
  const rerender = (next: Partial<typeof props>) => { Object.assign(props, next); hook.rerender({ ...props }); };
  const state = (): CarriedState => hook.result.current.states[0];
  return { ...fq, hook, rerender, announce, onDraft, flushNotes, state };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  apiMock.resolveRoundInput.mockReset();
  apiMock.clearRoundInputResolution.mockReset();
});

describe("useCarriedReview", () => {
  it("derives states, progress and open keys", () => {
    const t = setup();
    expect(t.hook.result.current.progress).toBe("0 of 1 checked");
    expect([...t.hook.result.current.openKeys]).toEqual(["annotation:a-1"]);
    expect(t.hook.result.current.byHome.get("a-1")?.[0].input.input_id).toBe("in-1");
    expect(t.hook.result.current.placeholders).toEqual([]);
  });

  it("markChecked sends one completed resolution and announces the result", async () => {
    const t = setup();
    let done!: Promise<boolean>;
    await act(async () => { done = t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    expect(t.flushNotes).toHaveBeenCalled();
    expect(t.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(t.hook.result.current.busy("in-1")).toBe(true);
    apiMock.resolveRoundInput.mockResolvedValueOnce(checkedDraft);
    const { result } = await t.attempt(1);
    const [workspaceId, envelope] = apiMock.resolveRoundInput.mock.calls[0] as [string, MutationEnvelope];
    expect(workspaceId).toBe("ws-1");
    expect(envelope.expected_revision).toBe(1);
    expect(envelope.payload).toEqual({ input_id: "in-1", outcome: "completed", annotation_ref: { annotation_id: "a-1", version: "v1" } });
    let applied: boolean | undefined;
    await act(async () => { t.ops[0].resolve(result); applied = await done; });
    expect(applied).toBe(true);
    expect(t.hook.result.current.busy("in-1")).toBe(false);
    expect(t.onDraft).toHaveBeenCalledWith(checkedDraft);
    expect(t.announce).toHaveBeenCalledWith("Seizure checked. All carried findings checked.");
  });

  it("network failure: pending operation shows a network error and retry never enqueues again", async () => {
    const t = setup();
    await act(async () => { void t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    apiMock.resolveRoundInput.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await t.attempt();
    t.setLastError(new TypeError("Failed to fetch"));
    t.rerender({ queueState: "error" });
    expect(t.hook.result.current.errorFor("in-1")).toEqual({ kind: "network", action: "check" });
    expect(t.hook.result.current.busy("in-1")).toBe(false);
    act(() => t.hook.result.current.retry("in-1"));
    expect(t.queue.retry).toHaveBeenCalledTimes(1);
    expect(t.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("lost response: the retry resends the identical envelope and the replay applies the draft", async () => {
    const t = setup();
    let done!: Promise<boolean>;
    await act(async () => { done = t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    apiMock.resolveRoundInput.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(checkedDraft);
    await t.attempt(1);
    t.setLastError(new TypeError("Failed to fetch"));
    t.rerender({ queueState: "error" });
    act(() => t.hook.result.current.retry("in-1"));
    t.rerender({ queueState: "saving" });
    const { result } = await t.attempt(1);
    const [first, second] = apiMock.resolveRoundInput.mock.calls.map(call => call[1] as MutationEnvelope);
    expect(second.mutation_id).toBe(first.mutation_id);
    expect(second).toEqual(first);
    await act(async () => { t.ops[0].resolve(result); await done; });
    t.rerender({ queueState: "saved" });
    expect(t.hook.result.current.errorFor("in-1")).toBeNull();
    expect(t.onDraft).toHaveBeenCalledWith(checkedDraft);
    expect(t.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("401: the session error is distinguished from a network error", async () => {
    const t = setup();
    await act(async () => { void t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    t.setLastError(new AuthError("Not authenticated", undefined, "NOT_AUTHENTICATED", 401));
    t.rerender({ queueState: "error" });
    expect(t.hook.result.current.errorFor("in-1")).toEqual({ kind: "session", action: "check" });
    expect(t.hook.result.current.busy("in-1")).toBe(false);
    act(() => t.hook.result.current.retry("in-1"));
    expect(t.queue.retry).toHaveBeenCalledTimes(1);
    expect(t.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("recovery: queue back to saved and the operation resolves clears the error and announces", async () => {
    const t = setup();
    let done!: Promise<boolean>;
    await act(async () => { done = t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    t.setLastError(new TypeError("Failed to fetch"));
    t.rerender({ queueState: "error" });
    expect(t.hook.result.current.errorFor("in-1")).toEqual({ kind: "network", action: "check" });
    t.setLastError(null);
    t.rerender({ queueState: "saved" });
    await act(async () => { t.ops[0].resolve(checkedDraft); await done; });
    expect(t.hook.result.current.errorFor("in-1")).toBeNull();
    expect(t.announce).toHaveBeenCalledWith("Seizure checked. All carried findings checked.");
  });

  it("stale rejection maps to stale; other 4xx to rejected; conflicts are rethrown", async () => {
    const t = setup();
    let done!: Promise<boolean>;
    await act(async () => { done = t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    let applied: boolean | undefined;
    await act(async () => { t.ops[0].reject(new ConflictError("stale", "ROUND_INPUT_RESOLUTION_STALE")); applied = await done; });
    expect(applied).toBe(false);
    expect(t.hook.result.current.errorFor("in-1")).toEqual({ kind: "stale", action: "check" });
    expect(t.hook.result.current.busy("in-1")).toBe(false);

    await act(async () => { done = t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    expect(t.hook.result.current.errorFor("in-1")).toBeNull();
    await act(async () => { t.ops[1].reject(new ApiError(422, "bad", "ROUND_INPUT_INVALID")); applied = await done; });
    expect(applied).toBe(false);
    expect(t.hook.result.current.errorFor("in-1")).toEqual({ kind: "rejected", action: "check", message: "Choose the exact eligible submissions shown for this task." });

    await act(async () => { done = t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    const conflict = new ConflictError();
    let thrown: unknown;
    await act(async () => { t.ops[2].reject(conflict); await done.catch(error => { thrown = error; }); });
    expect(thrown).toBe(conflict);
    expect(t.hook.result.current.busy("in-1")).toBe(false);
  });

  it("a refused carried command (409 without reload) reads as rejected for the action that failed", async () => {
    const t = setup();
    let done!: Promise<boolean>;
    await act(async () => { done = t.hook.result.current.dismiss(t.state(), "Not in this text"); await Promise.resolve(); });
    let applied: boolean | undefined;
    await act(async () => { t.ops[0].reject(new ConflictError("present", "ROUND_INPUT_CARRIED_FINDING_PRESENT")); applied = await done; });
    expect(applied).toBe(false);
    expect(t.hook.result.current.errorFor("in-1")).toMatchObject({ kind: "rejected", action: "dismiss" });
  });

  it("unsaved note on a dismissal records the dismiss action; clearError removes it", async () => {
    const t = setup({ hasUnsavedNotes: () => true });
    let applied: boolean | undefined;
    await act(async () => { applied = await t.hook.result.current.dismiss(t.state(), "No"); });
    expect(applied).toBe(false);
    expect(t.hook.result.current.errorFor("in-1")).toEqual({ kind: "note", action: "dismiss" });
    act(() => t.hook.result.current.clearError("in-1"));
    expect(t.hook.result.current.errorFor("in-1")).toBeNull();
  });

  it("discarded changes clear busy silently", async () => {
    const t = setup();
    let done!: Promise<boolean>;
    await act(async () => { done = t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    await act(async () => { t.ops[0].reject(new DiscardedChangesError()); await done; });
    expect(t.hook.result.current.busy("in-1")).toBe(false);
    expect(t.hook.result.current.errorFor("in-1")).toBeNull();
    expect(t.announce).not.toHaveBeenCalled();
  });

  it("unsaved note: shows the note error and enqueues nothing", async () => {
    const t = setup({ hasUnsavedNotes: () => true });
    await act(async () => { await t.hook.result.current.markChecked(t.state()); });
    expect(t.flushNotes).toHaveBeenCalled();
    expect(t.hook.result.current.errorFor("in-1")).toEqual({ kind: "note", action: "check" });
    expect(t.queue.enqueue).not.toHaveBeenCalled();
  });

  it("dismiss sends remove_carried_finding only while the carried finding exists", async () => {
    const t = setup();
    await act(async () => { void t.hook.result.current.dismiss(t.state(), "Not in this text"); await Promise.resolve(); });
    apiMock.resolveRoundInput.mockResolvedValue(baseDraft);
    await t.attempt();
    expect((apiMock.resolveRoundInput.mock.calls[0][1] as MutationEnvelope).payload).toEqual({
      input_id: "in-1", outcome: "dismissed", reason: "Not in this text", remove_carried_finding: true,
    });

    const p = setup({ draft: draftOf([]) });
    expect(p.state().carriedId).toBeNull();
    expect(p.hook.result.current.placeholders).toHaveLength(1);
    await act(async () => { void p.hook.result.current.dismiss(p.state(), "Not in this text"); await Promise.resolve(); });
    await p.attempt();
    const payload = (apiMock.resolveRoundInput.mock.calls[1][1] as MutationEnvelope).payload;
    expect(payload).toEqual({ input_id: "in-1", outcome: "dismissed", reason: "Not in this text" });
    expect("remove_carried_finding" in payload).toBe(false);
  });

  it("undoDismissal clears the resolution and announces a restored finding", async () => {
    const dismissed = draftOf([], [{ input_id: "in-1", outcome: "dismissed", reason: "No" }], 3);
    const t = setup({ draft: dismissed });
    expect(t.state().variant).toBe("dismissed");
    let done!: Promise<boolean>;
    await act(async () => { done = t.hook.result.current.undoDismissal(t.state()); await Promise.resolve(); });
    const restored = draftOf([snapshot("a-1")], [], 4);
    apiMock.clearRoundInputResolution.mockResolvedValueOnce(restored);
    const { result } = await t.attempt(3);
    const [workspaceId, envelope] = apiMock.clearRoundInputResolution.mock.calls[0] as [string, MutationEnvelope];
    expect(workspaceId).toBe("ws-1");
    expect(envelope.expected_revision).toBe(3);
    expect(envelope.payload).toEqual({ command: "clear_round_input_resolution", input_id: "in-1" });
    await act(async () => { t.ops[0].resolve(result); await done; });
    expect(t.onDraft).toHaveBeenCalledWith(restored);
    expect(t.announce).toHaveBeenCalledWith("Seizure restored. 0 of 1 checked.");
  });

  it("announces when a checked input needs a new check after an edit", async () => {
    const t = setup({ draft: checkedDraft });
    expect(t.state().variant).toBe("checked");
    t.rerender({ draft: draftOf([snapshot("a-1", "v2")], [{ input_id: "in-1", outcome: "completed", annotation_ref: { annotation_id: "a-1", version: "v1" } }], 3) });
    await flush();
    expect(t.announce).toHaveBeenCalledWith("Seizure needs a new check. 0 of 1 checked.");
  });

  it("remembers recreated findings and links to them", async () => {
    const t = setup({ draft: draftOf([snapshot("b-2", "v7")]) });
    act(() => t.hook.result.current.rememberRecreated("in-1", "b-2"));
    expect(t.hook.result.current.recreatedFor).toEqual({ "in-1": "b-2" });
    await act(async () => { void t.hook.result.current.markChecked(t.state()); await Promise.resolve(); });
    apiMock.resolveRoundInput.mockResolvedValueOnce(baseDraft);
    await t.attempt();
    expect((apiMock.resolveRoundInput.mock.calls[0][1] as MutationEnvelope).payload).toEqual({
      input_id: "in-1", outcome: "completed", annotation_ref: { annotation_id: "b-2", version: "v7" },
    });
  });

  it("does nothing when read-only", async () => {
    const t = setup({ readOnly: true });
    await act(async () => { await t.hook.result.current.markChecked(t.state()); });
    expect(t.queue.enqueue).not.toHaveBeenCalled();
  });
});
