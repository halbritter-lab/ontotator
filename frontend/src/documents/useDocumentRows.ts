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
  /** Refetch now (after an own action); the shown page stays until the response arrives. */
  reload: () => void;
  /** Same as `reload`; named for the error state's "Retry". */
  retry: () => void;
}

interface Snapshot { page: DocumentRowsPage | null; error: unknown | null; loading: boolean; stale: boolean; updatedAt: Date | null }

const withoutRetain = ({ retain: _retain, ...rest }: DocumentRowsQuery): DocumentRowsQuery => rest;

/**
 * Documents rows with stale-response discard: only the latest request may update state.
 * Refetches on window focus, every 60 s and on `reload()`. `query.retain` (from the visit
 * state) is sent with every request; a change of only the retained keys is not a new request.
 * A new request keeps the previous page (marked `stale`) until its response arrives; a failed
 * refetch of the same request keeps the page and sets `error`.
 */
export function useDocumentRows(projectKey: string, query: DocumentRowsQuery): DocumentRowsState {
  const generation = useRef(0);
  const [state, setState] = useState<Snapshot>({ page: null, error: null, loading: true, stale: false, updatedAt: null });
  const identity = JSON.stringify([projectKey, query]);
  const filters = JSON.stringify([projectKey, withoutRetain(query)]);
  const latest = useRef({ projectKey, query });
  latest.current = { projectKey, query };
  const shownFilters = useRef<string | null>(null);

  const load = useCallback(() => {
    const current = ++generation.current;
    const { projectKey: key, query: request } = latest.current;
    setState(previous => ({ ...previous, loading: true }));
    api.listDocumentRows(key, request).then(
      page => { if (current === generation.current) setState({ page, error: null, loading: false, stale: false, updatedAt: new Date() }); },
      error => {
        if (current !== generation.current) return;
        // A page of an earlier request must not stand in for the failed one.
        setState(previous => (previous.stale ? { page: null, error, loading: false, stale: false, updatedAt: null } : { ...previous, error, loading: false }));
      },
    );
    // `identity` is the dependency: a new query (by value) gives a new loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    if (shownFilters.current !== null && shownFilters.current !== filters) {
      setState(previous => ({ ...previous, error: null, loading: true, stale: previous.page !== null }));
    }
    shownFilters.current = filters;
    load();
    // `filters` is derived from the same render as `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(load, DOCUMENT_ROWS_REFRESH_MS);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [load]);

  // Discard responses that arrive after unmount.
  useEffect(() => () => { generation.current += 1; }, []);

  return { ...state, reload: load, retry: load };
}
