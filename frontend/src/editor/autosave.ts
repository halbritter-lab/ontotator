import { ApiError, ConflictError, isSessionProblem } from "../api/client";

/** 409 codes for a carried-review command that was refused, not a stale draft: no reload needed. */
const REJECTED_CONFLICT_CODES = new Set(["ROUND_INPUT_RESOLUTION_STALE", "ROUND_INPUT_CARRIED_FINDING_PRESENT"]);

export type QueueState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface MutationQueueOptions {
  initialRevision: number;
  onState?: (state: QueueState) => void;
}

interface QueuedOperation<T> {
  fn: (expectedRevision: number) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface MutationQueue {
  enqueue: <T extends { revision?: number; draft_revision?: number } | void>(
    fn: (expectedRevision: number) => Promise<T>
  ) => Promise<T>;
  getState: () => QueueState;
  getRevision: () => number;
  setRevision: (rev: number) => void;
  retry: () => Promise<void>;
  flush: () => Promise<void>;
  /** Number of operations not yet acknowledged by the server. */
  pendingCount: () => number;
  /** Number of operations the server rejected (not applied) since the queue was created. */
  rejectedCount: () => number;
  /** Last transport/server error that stopped the queue (null when healthy). */
  getLastError: () => unknown;
  /**
   * Drop every pending operation (their callers are rejected with DiscardedChangesError)
   * and leave the error/conflict state. Optionally adopt a new server revision.
   */
  discardPending: (nextRevision?: number) => number;
  dispose: () => void;
}

export class DiscardedChangesError extends Error {
  constructor(message = "Unsaved changes were discarded") {
    super(message);
    this.name = "DiscardedChangesError";
  }
}

export const SESSION_ENDED_MESSAGE =
  "Your session has ended; your changes are kept and will be saved after you log in again.";

export class UnsavedChangesError extends Error {
  readonly state: QueueState;
  /** True when the edits wait for a new login (not for the server or a reload). */
  readonly sessionEnded: boolean;
  constructor(state: QueueState, cause?: unknown) {
    const sessionEnded = state === "error" && isSessionProblem(cause);
    super(
      state === "conflict"
        ? "The case was changed elsewhere. Reload the case to continue."
        : sessionEnded
        ? SESSION_ENDED_MESSAGE
        : "Pending changes could not be saved (server unreachable?).",
    );
    this.sessionEnded = sessionEnded;
    this.name = "UnsavedChangesError";
    this.state = state;
  }
}

/** True when an error is a network failure rather than a server response. */
export function isNetworkError(error: unknown): boolean {
  return !!error && !(error instanceof ApiError) && (error instanceof TypeError || (error as Error).name === "TypeError");
}

export function createMutationQueue(options: MutationQueueOptions): MutationQueue {
  let revision = options.initialRevision;
  let state: QueueState = "saved";
  let disposed = false;
  let processing: Promise<void> | null = null;
  let lastError: unknown = null;
  let rejected = 0;
  const queue: QueuedOperation<any>[] = [];
  const updateState = (next: QueueState) => {
    if (state !== next) { state = next; options.onState?.(next); }
  };
  const adoptRevision = (result: unknown, onlyNewer: boolean) => {
    if (!result || typeof result !== "object") return;
    const r = result as { revision?: number; draft_revision?: number };
    const returned = r.revision ?? r.draft_revision;
    if (typeof returned !== "number") return;
    if (!onlyNewer || returned > revision) revision = returned;
  };
  const process = (): Promise<void> => {
    if (processing) return processing;
    if (disposed || state === "error" || state === "conflict") return Promise.resolve();
    processing = Promise.resolve().then(async () => {
      while (queue.length && !disposed && state !== "error" && state !== "conflict") {
        updateState("saving");
        const operation = queue[0];
        try {
          const result = await operation.fn(revision);
          if (queue[0] !== operation) {
            // Discarded while in flight, but the server applied it anyway: adopt
            // its (newer) revision so the next edit is not rejected as stale.
            adoptRevision(result, true);
            continue;
          }
          lastError = null;
          queue.shift();
          adoptRevision(result, false);
          operation.resolve(result);
        } catch (error) {
          if (queue[0] !== operation) continue; // discarded while in flight
          if (error instanceof ConflictError && !REJECTED_CONFLICT_CODES.has(error.code ?? "")) {
            lastError = error;
            updateState("conflict");
            operation.reject(error);
          } else if (
            error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429
            && !isSessionProblem(error)
          ) {
            // A rejected command was not applied. Let the user correct it.
            queue.shift();
            rejected += 1;
            operation.reject(error);
          } else {
            // Transport errors and an ended session (401, stale CSRF token): nothing was
            // applied, so keep the operation and its caller pending until a retry.
            lastError = error;
            updateState("error");
          }
        }
      }
      if (!queue.length && !disposed) updateState("saved");
    }).finally(() => {
      processing = null;
      // A resolved caller may enqueue its next edit before this finalizer runs.
      if (queue.length && !disposed && state !== "error" && state !== "conflict") void process();
    });
    return processing;
  };
  return {
    enqueue(fn) {
      return new Promise((resolve, reject) => {
        if (disposed) { reject(new Error("Workspace closed")); return; }
        queue.push({ fn, resolve, reject });
        void process();
      });
    },
    getState: () => state,
    getRevision: () => revision,
    setRevision(rev) {
      revision = rev;
      if (state === "conflict") updateState("saved");
    },
    async retry() {
      if (processing) await processing;
      if (state === "error") { updateState("dirty"); await process(); }
    },
    async flush() {
      while (queue.length) {
        if (state === "error" || state === "conflict") throw new UnsavedChangesError(state, lastError);
        await process();
      }
      if (state === "error" || state === "conflict") throw new UnsavedChangesError(state, lastError);
    },
    pendingCount: () => queue.length,
    rejectedCount: () => rejected,
    getLastError: () => lastError,
    discardPending(nextRevision) {
      const dropped = queue.splice(0);
      for (const operation of dropped) operation.reject(new DiscardedChangesError());
      if (nextRevision !== undefined) revision = nextRevision;
      lastError = null;
      updateState("saved");
      return dropped.length;
    },
    dispose() {
      disposed = true;
      for (const operation of queue.splice(0)) operation.reject(new Error("Workspace closed"));
    },
  };
}
