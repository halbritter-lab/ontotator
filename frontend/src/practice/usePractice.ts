import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PracticeState } from "../api/client";

export type PracticeLoad = { kind: "loading" } | { kind: "ready"; state: PracticeState } | { kind: "error"; error: unknown };

/**
 * The user's practice state (issue 266). `pollMs` re-reads it while the page is visible, so the steps of
 * "Your practice" tick themselves after the editor saved.
 */
export function usePractice(pollMs?: number): { load: PracticeLoad; reload: () => void; set: (state: PracticeState) => void } {
  const [load, setLoad] = useState<PracticeLoad>({ kind: "loading" });
  const generation = useRef(0);
  const alive = useRef(true);
  const reload = useCallback(() => {
    const request = ++generation.current;
    api.getPractice().then(state => {
      if (alive.current && request === generation.current) setLoad({ kind: "ready", state });
    }, error => {
      if (alive.current && request === generation.current) setLoad(current => current.kind === "ready" ? current : { kind: "error", error });
    });
  }, []);
  const set = useCallback((state: PracticeState) => { generation.current++; setLoad({ kind: "ready", state }); }, []);
  useEffect(() => {
    alive.current = true;
    reload();
    const visible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", visible);
    const timer = pollMs ? window.setInterval(() => { if (document.visibilityState === "visible") reload(); }, pollMs) : undefined;
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", visible);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [reload, pollMs]);
  return { load, reload, set };
}

const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** "1 Dec 2026"; invalid input is returned unchanged. */
export function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : day.format(date);
}
