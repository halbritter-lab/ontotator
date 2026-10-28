import { useEffect, useState } from "react";
import { api, ApiError, NetworkError, type JobView } from "../api/client";

/** A lost connection or a server error (5xx) may pass; a 4xx answer is final. */
const transient = (error: unknown) => error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);

/** One request at a time. Each ID owns its timer and replies. */
export function useJob(jobId: number | null, { intervalMs = 1000 }: { intervalMs?: number } = {}): { job: JobView | null; error: unknown } {
  const [state, setState] = useState<{ id: number | null; job: JobView | null; error: unknown }>({ id: null, job: null, error: undefined });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const interval = Number.isFinite(intervalMs) ? Math.max(1000, intervalMs) : 1000;
    setState({ id: jobId, job: null, error: undefined });
    const schedule = () => { timer = setTimeout(() => { void poll(); }, Date.now() - started >= 30000 ? Math.max(5000, interval) : interval); };
    const poll = async () => {
      if (jobId === null) return;
      try {
        const job = await api.getJob(jobId);
        if (!active) return;
        setState({ id: jobId, job, error: undefined });
        if (job.status !== "succeeded" && job.status !== "failed") schedule();
      } catch (error: unknown) {
        if (!active) return;
        // The job keeps running on the server; keep the last state and ask again.
        if (transient(error)) schedule();
        else setState({ id: jobId, job: null, error });
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, intervalMs]);
  return state.id === jobId ? { job: state.job, error: state.error } : { job: null, error: undefined };
}
