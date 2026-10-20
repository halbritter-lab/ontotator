/**
 * Case selection on Documents (spec D17): a set of case IDs that survives scrolling, paging and
 * filter changes, with a range anchor for Shift-click. It never holds more than `MAX_SELECTION`
 * cases; a path that would exceed it keeps the first cases in the given order and reports truncation.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { GroupSelectMode } from "../ui/DataTable";

export const MAX_SELECTION = 2000;

export interface CaseSelection {
  ids: ReadonlySet<string>;
  anchor: string | null;
  /** `order` is the current list order of the loaded page (range selection stays within it). */
  select: (caseId: string, mode: GroupSelectMode, order: readonly string[]) => { truncated: boolean };
  replace: (ids: Iterable<string>) => { truncated: boolean };
  add: (ids: Iterable<string>) => { truncated: boolean };
  remove: (ids: Iterable<string>) => void;
  clear: () => void;
}

interface State { ids: ReadonlySet<string>; anchor: string | null }

/** Adds `ids` in order until the cap. */
function capped(base: ReadonlySet<string>, ids: Iterable<string>): { ids: Set<string>; truncated: boolean } {
  const next = new Set(base);
  let truncated = false;
  for (const id of ids) {
    if (next.has(id)) continue;
    if (next.size >= MAX_SELECTION) { truncated = true; break; }
    next.add(id);
  }
  return { ids: next, truncated };
}

export function useCaseSelection(): CaseSelection {
  const [state, setState] = useState<State>({ ids: new Set(), anchor: null });
  // The latest state, so several calls in one event see each other's result.
  const current = useRef(state);
  const commit = useCallback((next: State) => { current.current = next; setState(next); }, []);

  const select = useCallback((caseId: string, mode: GroupSelectMode, order: readonly string[]) => {
    const { ids, anchor } = current.current;
    if (mode === "range" && anchor !== null && order.includes(anchor) && order.includes(caseId)) {
      const [from, to] = [order.indexOf(anchor), order.indexOf(caseId)].sort((a, b) => a - b);
      const result = capped(ids, order.slice(from, to + 1));
      commit({ ids: result.ids, anchor });
      return { truncated: result.truncated };
    }
    if (mode === "select" || mode === "range") {
      const result = capped(ids, [caseId]);
      commit({ ids: result.ids, anchor: caseId });
      return { truncated: result.truncated };
    }
    const nextAnchor = mode === "toggle-keep-anchor" && anchor !== null ? anchor : caseId;
    if (ids.has(caseId)) {
      const next = new Set(ids);
      next.delete(caseId);
      commit({ ids: next, anchor: nextAnchor });
      return { truncated: false };
    }
    const result = capped(ids, [caseId]);
    commit({ ids: result.ids, anchor: nextAnchor });
    return { truncated: result.truncated };
  }, [commit]);

  const replace = useCallback((ids: Iterable<string>) => {
    const result = capped(new Set(), ids);
    commit({ ids: result.ids, anchor: null });
    return { truncated: result.truncated };
  }, [commit]);

  const add = useCallback((ids: Iterable<string>) => {
    const result = capped(current.current.ids, ids);
    commit({ ids: result.ids, anchor: current.current.anchor });
    return { truncated: result.truncated };
  }, [commit]);

  const remove = useCallback((ids: Iterable<string>) => {
    const next = new Set(current.current.ids);
    for (const id of ids) next.delete(id);
    commit({ ids: next, anchor: current.current.anchor });
  }, [commit]);

  const clear = useCallback(() => commit({ ids: new Set(), anchor: null }), [commit]);

  return useMemo(() => ({ ids: state.ids, anchor: state.anchor, select, replace, add, remove, clear }), [state, select, replace, add, remove, clear]);
}
