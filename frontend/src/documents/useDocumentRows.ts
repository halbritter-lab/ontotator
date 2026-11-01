import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DocumentRowsPage, type DocumentRowsQuery } from "../api/client";

/** Background refresh interval of the Documents rows and bar. */
export const DOCUMENT_ROWS_REFRESH_MS = 60_000;

export interface DocumentRowsState {
  /**
   * The shown page. Kept while any refetch loads (after a filter or page change it is the previous
   * request's page, see `stale`) and after a failed refetch of the same request; null only before
   * the first page of a request arrived or after that first load failed.
   */
  page: DocumentRowsPage | null;
  /** The last request failed; with a page it was a background refetch ("Could not refresh"). */
  error: unknown | null;
  loading: boolean;
  /** The shown page belongs to an earlier request (other filters or page) while the new one loads. */
  stale: boolean;
  /** When the shown page arrived ("Updated 10:42"); null before the first page. */
  updatedAt: Date | null;
  /**
   * Refetch now (after an own action); the shown page stays until the response arrives. Resolves once the newest
   * request has settled (its rows are shown, or it failed), so a confirmation can wait for the updated rows (issue 248).
   */
  reload: () => Promise<void>;
  /** Same as `reload`; named for the error state's "Retry". */
  retry: () => Promise<void>;
}

interface Snapshot { page: DocumentRowsPage | null; error: unknown | null; loading: boolean; stale: boolean; updatedAt: Date | null }

const withoutRetain = ({ retain: _retain, ...rest }: DocumentRowsQuery): DocumentRowsQuery => rest;

/**
 * Documents rows with stale-response discard: only the latest request may update state.
 * Refetches on window focus, every 60 s and on `reload()`. `query.retain` (from the visit
 * state) is sent with every request; a change of only the retained keys is not a new request.
 * A new request keeps the previous page (marked `stale`) until its response arrives; a failed
 * refetch of the same request keeps the page and sets `error`. With `enabled: false` nothing loads yet (the
 * page records its visit first).
 */
export function useDocumentRows(projectKey: string, query: DocumentRowsQuery, options: { enabled?: boolean } = {}): DocumentRowsState {
  const enabled = options.enabled ?? true;
  const generation = useRef(0);
  const [state, setState] = useState<Snapshot>({ page: null, error: null, loading: true, stale: false, updatedAt: null });
  const identity = JSON.stringify([projectKey, query]);
  const filters = JSON.stringify([projectKey, withoutRetain(query)]);
  const latest = useRef({ projectKey, query });
  latest.current = { projectKey, query };
  const shownFilters = useRef<string | null>(null);
  // Callers waiting for the rows (`reload()` promises); a superseded request leaves them to the newest one.
  const waiting = useRef<(() => void)[]>([]);
  const settle = () => { const done = waiting.current; waiting.current = []; for (const resolve of done) resolve(); };

  const load = useCallback((): Promise<void> => {
    const settled = new Promise<void>(resolve => { waiting.current.push(resolve); });
    const current = ++generation.current;
    const { projectKey: key, query: request } = latest.current;
    setState(previous => ({ ...previous, loading: true }));
    api.listDocumentRows(key, request).then(
      page => {
        if (current !== generation.current) return;
        setState({ page, error: null, loading: false, stale: false, updatedAt: new Date() });
        settle();
      },
      error => {
        if (current !== generation.current) return;
        // A page of an earlier request must not stand in for the failed one.
        setState(previous => (previous.stale ? { page: null, error, loading: false, stale: false, updatedAt: null } : { ...previous, error, loading: false }));
        settle();
      },
    );
    return settled;
    // `identity` is the dependency: a new query (by value) gives a new loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    if (!enabled) return;
    if (shownFilters.current !== null && shownFilters.current !== filters) {
      setState(previous => ({ ...previous, error: null, loading: true, stale: previous.page !== null }));
    }
    shownFilters.current = filters;
    load();
    // `filters` is derived from the same render as `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(load, DOCUMENT_ROWS_REFRESH_MS);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [load, enabled]);

  // Discard responses that arrive after unmount.
  useEffect(() => () => { generation.current += 1; settle(); }, []);

  return { ...state, reload: load, retry: load };
}
