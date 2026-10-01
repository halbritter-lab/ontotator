import { ApiError, ConflictError } from "../api/client";

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
  dispose: () => void;
}

export function createMutationQueue(options: MutationQueueOptions): MutationQueue {
  let revision = options.initialRevision;
  let state: QueueState = "saved";
  let disposed = false;
  let processing: Promise<void> | null = null;
  const queue: QueuedOperation<any>[] = [];
  const updateState = (next: QueueState) => {
    if (state !== next) { state = next; options.onState?.(next); }
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
          queue.shift();
          if (result && typeof result === "object") {
            revision = result.revision ?? result.draft_revision ?? revision;
          }
          operation.resolve(result);
        } catch (error) {
          if (error instanceof ConflictError) {
            updateState("conflict");
            operation.reject(error);
          } else if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
            // A rejected command was not applied. Let the user correct it.
            queue.shift();
            operation.reject(error);
          } else {
            // Keep both the operation and its caller pending until an explicit retry.
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
        if (state === "error" || state === "conflict") throw new Error("Pending changes could not be saved");
        await process();
      }
    },
    dispose() {
      disposed = true;
      for (const operation of queue.splice(0)) operation.reject(new Error("Workspace closed"));
    },
  };
}
