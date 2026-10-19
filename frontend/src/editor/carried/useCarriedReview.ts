/**
 * All carried-review state and writes of the editor (plan F6a). The mutation queue keeps an
 * operation pending on transport errors, 5xx and an ended session, so errors for those cases are
 * derived from the queue state instead of waiting for a rejection; "Retry" only retries the queue.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, ConflictError, isSessionProblem, ValidationError, type Draft, type MutationEnvelope, type RoundInputView } from "../../api/client";
import { errorMessage } from "../../admin/errors";
import { DiscardedChangesError, type MutationQueue, type QueueState } from "../autosave";
import type { CarriedError } from "./CarriedSection";
import { deriveCarriedStates, progressText, rowKeyOf, type CarriedState, type SnapshotLike } from "./checkState";

export interface UseCarriedReviewArgs {
  inputs: readonly RoundInputView[];
  draft: Draft;
  workspaceId: string;
  readOnly: boolean;
  /** CaseScreen's `queueRef.current`. */
  queue: Pick<MutationQueue, "enqueue" | "retry" | "getLastError">;
  /** CaseScreen's queue state (re-renders on change). */
  queueState: QueueState;
  flushNotes: () => Promise<void>;
  hasUnsavedNotes: () => boolean;
  onDraft: (draft: Draft) => void;
  announce: (message: string) => void;
  termText: (snapshot: SnapshotLike) => string;
}

export interface CarriedReview {
  states: CarriedState[];
  byHome: Map<string, CarriedState[]>;
  placeholders: CarriedState[];
  openKeys: Set<string>;
  progress: string;
  /** inputId -> annotationId of the finding re-created via "Mark in text" (client-side only). */
  recreatedFor: Record<string, string>;
  busy(inputId: string): boolean;
  markChecked(state: CarriedState, annotationId?: string): Promise<void>;
  link(state: CarriedState, annotationId: string): Promise<void>;
  /** Sends `remove_carried_finding: true` only while the carried finding exists. */
  dismiss(state: CarriedState, reason: string): Promise<void>;
  /** Clears the resolution; the server restores a finding the dismissal removed. */
  undoDismissal(state: CarriedState): Promise<void>;
  rememberRecreated(inputId: string, annotationId: string): void;
  errorFor(inputId: string): CarriedError | null;
  /** Retries the queue; never enqueues a second operation. */
  retry(inputId: string): void;
}

type Send = (envelope: MutationEnvelope) => Promise<Draft>;

const statesOf = (inputs: readonly RoundInputView[], draft: Draft): CarriedState[] =>
  deriveCarriedStates(inputs, draft.round_input_resolutions ?? [], draft.annotations ?? []);

const termSnapshot = (state: CarriedState): SnapshotLike => state.input.target_snapshot ?? state.input.source_snapshot;

export function useCarriedReview(args: UseCarriedReviewArgs): CarriedReview {
  const { inputs, draft, queue, queueState } = args;
  const latest = useRef(args);
  latest.current = args;
  const [pending, setPending] = useState<Record<string, true>>({});
  const [errors, setErrors] = useState<Record<string, CarriedError>>({});
  const [recreatedFor, setRecreatedFor] = useState<Record<string, string>>({});
  const pendingRef = useRef(new Set<string>());

  const states = useMemo(() => statesOf(inputs, draft), [inputs, draft]);
  const byHome = useMemo(() => {
    const map = new Map<string, CarriedState[]>();
    for (const state of states) if (state.homeId) map.set(state.homeId, [...(map.get(state.homeId) ?? []), state]);
    return map;
  }, [states]);
  const placeholders = useMemo(() => states.filter(state => state.missing !== null), [states]);
  const openKeys = useMemo(() => new Set(states.filter(state => state.unchecked).map(rowKeyOf)), [states]);
  const progress = useMemo(() => progressText(states), [states]);

  // "{term} needs a new check." when a checked input becomes unchecked (an edit or delete).
  const previous = useRef<CarriedState[] | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = states;
    if (!before) return;
    const variantBefore = new Map(before.map(state => [state.input.input_id, state.variant]));
    for (const state of states) {
      if (variantBefore.get(state.input.input_id) === "checked" && state.unchecked) {
        latest.current.announce(`${latest.current.termText(termSnapshot(state))} needs a new check. ${progressText(states)}.`);
      }
    }
  }, [states]);

  const setError = (inputId: string, error: CarriedError | null) =>
    setErrors(current => {
      if (!error && !(inputId in current)) return current;
      const next = { ...current };
      if (error) next[inputId] = error; else delete next[inputId];
      return next;
    });
  const setPendingFor = (inputId: string, value: boolean) => {
    if (value) pendingRef.current.add(inputId); else pendingRef.current.delete(inputId);
    setPending(current => {
      const next = { ...current };
      if (value) next[inputId] = true; else delete next[inputId];
      return next;
    });
  };

  /** One write per user action: one `mutation_id`; the envelope is built once so a retry resends it unchanged. */
  const write = async (
    state: CarriedState,
    buildPayload: () => Record<string, unknown>,
    send: Send,
    message: (term: string, before: CarriedState, updated: Draft) => string,
  ): Promise<void> => {
    const inputId = state.input.input_id;
    if (latest.current.readOnly || pendingRef.current.has(inputId)) return;
    setError(inputId, null);
    try { await latest.current.flushNotes(); } catch { /* reported as an unsaved note below */ }
    if (latest.current.hasUnsavedNotes()) { setError(inputId, { kind: "note" }); return; }
    const mutationId = crypto.randomUUID();
    let envelope: MutationEnvelope | undefined;
    setPendingFor(inputId, true);
    try {
      const updated = await latest.current.queue.enqueue(async expectedRevision => {
        envelope ??= { mutation_id: mutationId, expected_revision: expectedRevision, payload: buildPayload() };
        return send(envelope);
      });
      setPendingFor(inputId, false);
      setError(inputId, null);
      latest.current.onDraft(updated);
      latest.current.announce(message(latest.current.termText(termSnapshot(state)), state, updated));
    } catch (error) {
      setPendingFor(inputId, false);
      if (error instanceof DiscardedChangesError) return;
      if (error instanceof ApiError && error.code === "ROUND_INPUT_RESOLUTION_STALE") { setError(inputId, { kind: "stale" }); return; }
      if (error instanceof ConflictError) throw error;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        setError(inputId, { kind: "rejected", message: errorMessage(error) });
        return;
      }
      throw error;
    }
  };

  const progressAfter = (updated: Draft) => progressText(statesOf(latest.current.inputs, updated));
  const resolve: Send = envelope => api.resolveRoundInput(latest.current.workspaceId, envelope);

  const complete = (state: CarriedState, annotationId?: string) => {
    const inputId = state.input.input_id;
    const targetId = annotationId ?? state.homeId ?? recreatedFor[inputId] ?? state.carriedId;
    return write(state, () => {
      const saved = latest.current.draft.annotations?.find(snapshot => snapshot.annotation.annotation_id === targetId);
      if (!saved) throw new ValidationError("Select a current saved finding before completing this input.");
      return { input_id: inputId, outcome: "completed", annotation_ref: { annotation_id: saved.annotation.annotation_id, version: saved.version } };
    }, resolve, (term, _before, updated) => `${term} checked. ${progressAfter(updated)}.`);
  };

  const dismiss = (state: CarriedState, reason: string) => write(state, () => ({
    input_id: state.input.input_id, outcome: "dismissed", reason,
    ...(state.carriedId ? { remove_carried_finding: true } : {}),
  }), resolve, (term, _before, updated) => `${term} dismissed. ${progressAfter(updated)}.`);

  const undoDismissal = (state: CarriedState) => write(state, () => ({
    command: "clear_round_input_resolution", input_id: state.input.input_id,
  }), envelope => api.clearRoundInputResolution(latest.current.workspaceId, envelope), (term, before, updated) => {
    const carriedRef = before.input.target_snapshot?.annotation.annotation_id;
    const restored = !before.carriedId && !!carriedRef && (updated.annotations ?? []).some(s => s.annotation.annotation_id === carriedRef);
    return `${term} ${restored ? "restored" : "dismissal undone"}. ${progressAfter(updated)}.`;
  });

  const queueFailed = queueState === "error";
  return {
    states, byHome, placeholders, openKeys, progress, recreatedFor,
    busy: inputId => !!pending[inputId] && !queueFailed,
    markChecked: complete,
    link: (state, annotationId) => complete(state, annotationId),
    dismiss,
    undoDismissal,
    rememberRecreated: (inputId, annotationId) => setRecreatedFor(current => ({ ...current, [inputId]: annotationId })),
    errorFor: inputId => {
      if (pending[inputId] && queueFailed) return { kind: isSessionProblem(queue.getLastError()) ? "session" : "network" };
      return errors[inputId] ?? null;
    },
    retry: () => { void queue.retry(); },
  };
}
