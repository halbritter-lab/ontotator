export type DraftSaverState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface DraftSaverOptions<T> {
  save(draft: T, expectedRevision: number): Promise<number>;
  initialRevision?: number;
  delayMs?: number;
  onStateChange?(state: DraftSaverState): void;
}

export interface DraftSaver<T> {
  update(draft: T): void;
  flush(): Promise<void>;
  dispose(): void;
  readonly state: DraftSaverState;
  readonly revision: number;
  readonly error: unknown;
  readonly hasUnsavedChanges: boolean;
}

/** Sequential autosave of plain structured-cloneable data; HTTP belongs in save. */
export function createDraftSaver<T>({
  save, initialRevision = 0, delayMs = 800, onStateChange,
}: DraftSaverOptions<T>): DraftSaver<T> {
  let state: DraftSaverState = "saved";
  let revision = initialRevision;
  let error: unknown;
  let pending: { draft: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let worker: Promise<void> | undefined;
  let inFlight = false;
  let ready = false;
  let flushing = false;
  let disposed = false;
  const disposedError = new Error("Draft saver is disposed.");

  function cancelTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function transition(next: DraftSaverState) {
    if (disposed || state === next) return;
    state = next;
    onStateChange?.(next);
  }

  function run(): Promise<void> {
    if (worker) return worker;
    async function drain() {
      while (pending && (ready || flushing) && !disposed) {
        const current = pending;
        pending = undefined;
        ready = false;
        inFlight = true;
        transition("saving");
        try {
          if (disposed) throw disposedError;
          const confirmed = await save(current.draft, revision);
          if (disposed) throw disposedError;
          revision = confirmed;
          inFlight = false;
        } catch (failure) {
          inFlight = false;
          if (disposed) throw disposedError;
          // A newer snapshot supersedes the failed one, without losing work.
          pending ??= current;
          cancelTimer();
          ready = false;
          error = failure;
          const conflict = typeof failure === "object" && failure !== null
            && "status" in failure && failure.status === 409;
          transition(conflict ? "conflict" : "error");
          throw failure;
        }
      }
      if (disposed) throw disposedError;
      transition(pending ? "dirty" : "saved");
    }

    function complete(): Promise<void> | void {
      // Completion owns the same worker until observer-produced work is drained.
      // This continuation follows microtasks queued by the terminal notification.
      if (pending && (ready || flushing) && !disposed) {
        return Promise.resolve().then(drain).then(complete);
      }
      worker = undefined;
      flushing = false;
      if (disposed) throw disposedError;
    }

    // Install shared ownership before execution; release only at quiescence/error.
    worker = Promise.resolve().then(drain).then(complete).catch(failure => {
      worker = undefined;
      flushing = false;
      throw failure;
    });
    return worker;
  }

  return {
    get state() { return state; },
    get revision() { return revision; },
    get error() { return error; },
    get hasUnsavedChanges() { return pending !== undefined || inFlight; },
    update(draft) {
      if (disposed) return;
      pending = { draft: structuredClone(draft) };
      cancelTimer();
      ready = false;
      // Errors never retry implicitly, including when the caller keeps editing.
      if (state === "conflict" || state === "error") return;
      transition(worker ? "saving" : "dirty");
      if (!flushing) {
        timer = setTimeout(() => {
          timer = undefined;
          ready = true;
          // Automatic failure is retained in state; only explicit flush rejects.
          void run().catch(() => {});
        }, delayMs);
      }
    },
    flush() {
      if (disposed) return Promise.reject(disposedError);
      if (state === "conflict") return Promise.reject(error);
      cancelTimer();
      ready = true;
      flushing = true;
      error = undefined;
      return run();
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
