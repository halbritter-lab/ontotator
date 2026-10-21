import { useEffect, useState } from "react";
import { api, onSessionRestored } from "../api/client";
import { DOCUMENTS_CHANGED } from "./documentsEvents";

/** Background refresh interval of the navigation counter. */
export const DOCUMENTS_SUMMARY_REFRESH_MS = 60_000;

/**
 * Navigation counter "Documents (n)": `needs_decision` of the project (undecided rows included, V10).
 * Loaded once, on window focus, on a restored session, every 60 s and on `documents-changed`.
 * Null while unknown, when disabled (non-leads) or without a project; a failed reload keeps the last value.
 */
export function useDocumentsSummary(projectKey: string | undefined, enabled: boolean): number | null {
  const [count, setCount] = useState<{ key: string; value: number } | null>(null);
  const key = enabled ? projectKey : undefined;
  useEffect(() => {
    if (key === undefined) return;
    let active = true;
    let generation = 0;
    const load = () => {
      const request = ++generation;
      api.documentsSummary(key).then(summary => {
        if (active && request === generation) setCount({ key, value: summary.needs_decision });
      }, () => { /* The link keeps its last label; Documents itself reports errors. */ });
    };
    load();
    window.addEventListener("focus", load);
    window.addEventListener(DOCUMENTS_CHANGED, load);
    const timer = window.setInterval(load, DOCUMENTS_SUMMARY_REFRESH_MS);
    const stopRestored = onSessionRestored(load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      window.removeEventListener(DOCUMENTS_CHANGED, load);
      window.clearInterval(timer);
      stopRestored();
    };
  }, [key]);
  return key !== undefined && count?.key === key ? count.value : null;
}
