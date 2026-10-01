import { ConflictError } from "../api/client";

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
  let isProcessing = false;
  let isDisposed = false;

  const queue: QueuedOperation<any>[] = [];

  const updateState = (next: QueueState) => {
    if (state !== next) {
      state = next;
      options.onState?.(state);
    }
  };

  const processNext = async (): Promise<void> => {
    if (isProcessing || isDisposed || state === "conflict") {
      return;
    }

    if (queue.length === 0) {
      if (state === "saving" || state === "dirty") {
        updateState("saved");
      }
      return;
    }

    isProcessing = true;
    updateState("saving");

    const currentOp = queue[0];

    try {
      const result = await currentOp.fn(revision);

      // Successfully processed: remove from queue
      queue.shift();

      if (result && typeof result === "object") {
        if (typeof result.revision === "number") {
          revision = result.revision;
        } else if (typeof result.draft_revision === "number") {
          revision = result.draft_revision;
        }
      }

      currentOp.resolve(result);

      if (queue.length === 0) {
        updateState("saved");
      }
    } catch (err: unknown) {
      if (err instanceof ConflictError) {
        // Revision conflict: Halt queue immediately, do not auto-retry
        updateState("conflict");
        currentOp.reject(err);
      } else {
        // Other error (e.g. 500, network error): Halt queue and report error
        updateState("error");
        currentOp.reject(err);
      }
    } finally {
      isProcessing = false;
      if (state === "saving" && queue.length > 0) {
        processNext();
      }
    }
  };

  return {
    enqueue<T extends { revision?: number; draft_revision?: number } | void>(
      fn: (expectedRevision: number) => Promise<T>
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        processNext();
      });
    },

    getState(): QueueState {
      return state;
    },

    getRevision(): number {
      return revision;
    },

    setRevision(rev: number): void {
      revision = rev;
      if (state === "conflict") {
        updateState("saved");
      }
    },

    async retry(): Promise<void> {
      if (state === "error") {
        updateState("saving");
        await processNext();
      }
    },

    async flush(): Promise<void> {
      while (queue.length > 0 && state !== "conflict") {
        await processNext();
      }
    },

    dispose(): void {
      isDisposed = true;
      queue.length = 0;
    },
  };
}
