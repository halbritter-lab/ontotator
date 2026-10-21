/**
 * Text selection on Documents (documents overview VD4, lead spec D17): a set of texts
 * `"{case}:{language}"` that survives scrolling, paging and filter changes, with a range anchor
 * for Shift-click over rows in list order. The case checkbox selects or clears every text of its
 * case. It never holds texts of more than `MAX_SELECTION_CASES` cases; a path that would exceed
 * it keeps the first texts in the given order and reports truncation.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { RowRefView } from "../api/client";
import type { GroupSelectMode } from "../ui/DataTable";

export const MAX_SELECTION_CASES = 2000;

/** `"{case}:{language}"`; the language never contains a colon, the case ID may. */
export const textKeyOf = (row: Pick<RowRefView, "case_id" | "language">): string => `${row.case_id}:${row.language}`;
export const caseOfTextKey = (key: string): string => key.slice(0, Math.max(0, key.lastIndexOf(":")));
export const languageOfTextKey = (key: string): string => key.slice(key.lastIndexOf(":") + 1);
export const rowRefOf = (key: string): RowRefView => ({ case_id: caseOfTextKey(key), language: languageOfTextKey(key) });

export interface TextSelection {
  keys: ReadonlySet<string>;
  anchor: string | null;
  /** Case IDs with at least one selected text. */
  cases: ReadonlySet<string>;
  /** The selected texts in selection order. */
  rows: RowRefView[];
  /** A row checkbox; `order` is the list order of the loaded rows (range selection stays within it). */
  select: (key: string, mode: GroupSelectMode, order: readonly string[]) => { truncated: boolean };
  /** A case checkbox with the case's text keys. */
  selectCase: (caseKeys: readonly string[], mode: GroupSelectMode, order: readonly string[]) => { truncated: boolean };
  /** "all", "some" or "none" of the given texts are selected (the case checkbox's mixed state). */
  caseState: (caseKeys: readonly string[]) => "all" | "some" | "none";
  replace: (keys: Iterable<string>) => { truncated: boolean };
  /** Adds texts (capped); `selected` is the selection afterwards. */
  add: (keys: Iterable<string>) => { truncated: boolean; selected: ReadonlySet<string> };
  remove: (keys: Iterable<string>) => void;
  clear: () => void;
}

interface State { keys: ReadonlySet<string>; anchor: string | null }

/** Adds `keys` in order; a text of a new case stops the run once the case cap is reached. */
function capped(base: ReadonlySet<string>, keys: Iterable<string>): { keys: Set<string>; truncated: boolean } {
  const next = new Set(base);
  const cases = new Set([...next].map(caseOfTextKey));
  let truncated = false;
  for (const key of keys) {
    if (next.has(key)) continue;
    const caseId = caseOfTextKey(key);
    if (!cases.has(caseId)) {
      if (cases.size >= MAX_SELECTION_CASES) { truncated = true; break; }
      cases.add(caseId);
    }
    next.add(key);
  }
  return { keys: next, truncated };
}

export function useTextSelection(): TextSelection {
  const [state, setState] = useState<State>({ keys: new Set(), anchor: null });
  // The latest state, so several calls in one event see each other's result.
  const current = useRef(state);
  const commit = useCallback((next: State) => { current.current = next; setState(next); }, []);

  const range = useCallback((from: string, to: string, order: readonly string[]) => {
    const [start, end] = [order.indexOf(from), order.indexOf(to)].sort((a, b) => a - b);
    return order.slice(start, end + 1);
  }, []);

  const select = useCallback((key: string, mode: GroupSelectMode, order: readonly string[]) => {
    const { keys, anchor } = current.current;
    if (mode === "range" && anchor !== null && order.includes(anchor) && order.includes(key)) {
      const result = capped(keys, range(anchor, key, order));
      commit({ keys: result.keys, anchor });
      return { truncated: result.truncated };
    }
    if (mode === "select" || mode === "range") {
      const result = capped(keys, [key]);
      commit({ keys: result.keys, anchor: key });
      return { truncated: result.truncated };
    }
    const nextAnchor = mode === "toggle-keep-anchor" && anchor !== null ? anchor : key;
    if (keys.has(key)) {
      const next = new Set(keys);
      next.delete(key);
      commit({ keys: next, anchor: nextAnchor });
      return { truncated: false };
    }
    const result = capped(keys, [key]);
    commit({ keys: result.keys, anchor: nextAnchor });
    return { truncated: result.truncated };
  }, [commit, range]);

  const selectCase = useCallback((caseKeys: readonly string[], mode: GroupSelectMode, order: readonly string[]) => {
    const { keys, anchor } = current.current;
    if (caseKeys.length === 0) return { truncated: false };
    const first = caseKeys[0];
    if (mode === "range" && anchor !== null && order.includes(anchor) && order.includes(first)) {
      // From the anchor to the far end of the case.
      const end = order.indexOf(anchor) <= order.indexOf(first) ? caseKeys[caseKeys.length - 1] : first;
      const result = capped(keys, range(anchor, end, order));
      commit({ keys: result.keys, anchor });
      return { truncated: result.truncated };
    }
    const all = caseKeys.every(key => keys.has(key));
    const nextAnchor = mode === "toggle-keep-anchor" && anchor !== null ? anchor : first;
    if (all && mode !== "select" && mode !== "range") {
      const next = new Set(keys);
      for (const key of caseKeys) next.delete(key);
      commit({ keys: next, anchor: nextAnchor });
      return { truncated: false };
    }
    const result = capped(keys, caseKeys);
    commit({ keys: result.keys, anchor: nextAnchor });
    return { truncated: result.truncated };
  }, [commit, range]);

  const replace = useCallback((keys: Iterable<string>) => {
    const result = capped(new Set(), keys);
    commit({ keys: result.keys, anchor: null });
    return { truncated: result.truncated };
  }, [commit]);

  const add = useCallback((keys: Iterable<string>) => {
    const result = capped(current.current.keys, keys);
    commit({ keys: result.keys, anchor: current.current.anchor });
    return { truncated: result.truncated, selected: result.keys };
  }, [commit]);

  const remove = useCallback((keys: Iterable<string>) => {
    const next = new Set(current.current.keys);
    for (const key of keys) next.delete(key);
    commit({ keys: next, anchor: current.current.anchor });
  }, [commit]);

  const clear = useCallback(() => commit({ keys: new Set(), anchor: null }), [commit]);

  return useMemo(() => {
    const keys = state.keys;
    const caseState = (caseKeys: readonly string[]): "all" | "some" | "none" => {
      const count = caseKeys.filter(key => keys.has(key)).length;
      return count === 0 ? "none" : count === caseKeys.length ? "all" : "some";
    };
    return {
      keys, anchor: state.anchor,
      cases: new Set([...keys].map(caseOfTextKey)),
      rows: [...keys].map(rowRefOf),
      select, selectCase, caseState, replace, add, remove, clear,
    };
  }, [state, select, selectCase, replace, add, remove, clear]);
}
