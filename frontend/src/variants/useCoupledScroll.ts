import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CoupledScrollPane {
  id: string;
  element: HTMLElement | null;
  /** An array (ComparePane, unchanged) or a getter read at every sync, so new starts need no rebind. */
  starts: readonly number[] | (() => readonly number[]);
}
export interface CoupledScrollOptions {
  enabled: boolean;
  /** Viewport width from which coupling is available; default 1100 (ComparePane), 700 in the translation review. */
  minWidth?: number;
  /** When set, only this pane leads; input on other panes never makes them leader (spec 2.2 editing row). */
  fixedLeader?: string;
  /** Bump to make the hook re-read lazy starts and refresh numbers, highlight and geometry without moving any pane. */
  startsRevision?: number;
  /** Marker mutations inside this pane are ignored until the next startsRevision (spec 2.3). */
  frozenPaneId?: string;
}
export interface AlignRequest {
  anchor: { paneId: string; paragraph: number };
  targets: readonly string[];
  /** Pixels between the top of the anchor pane and its paragraph start; negative means above the visible area. */
  anchorOffset: number;
  /** Used when anchorOffset < 0 (spec 2.4: `space-3` = 12 px). */
  topInset: number;
}
export interface AlignResult {
  pairs: ReadonlyArray<{ paneId: string; paragraph: number }>;
  estimate: boolean;
}
export interface CoupledScrollState { leaderId: string | null; pairs: ReadonlyArray<{ paneId: string; paragraph: number }> }
const empty: CoupledScrollState = { leaderId: null, pairs: [] };
const navigationKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

type BoundPane = CoupledScrollPane & { element: HTMLElement };
type Row = { index: number; top: number; marker?: HTMLElement };
type Geometry = { rows: Row[]; end: number; count: number };
type FrozenGeometry = { paneId: string; rows: { index: number; top: number }[]; scrollHeight: number; count: number };

/** Same index mapping as coupling: linear when counts differ, 0 when either side has ≤ 1 paragraph. */
export function mapParagraph(index: number, fromCount: number, toCount: number): number {
  return fromCount <= 1 || toCount <= 1 ? 0 : Math.round(index * (toCount - 1) / (fromCount - 1));
}

const startsOf = (pane: CoupledScrollPane) => typeof pane.starts === 'function' ? pane.starts() : pane.starts;
const markerIndex = (marker: HTMLElement, count: number) => {
  const index = Number(marker.dataset.paragraph);
  return Number.isInteger(index) && index >= 0 && index < count ? index : null;
};
const markerElements = (element: HTMLElement) => [...element.querySelectorAll<HTMLElement>('[data-paragraph]')];
const decorate = (marker: HTMLElement, index: number, decorated: Set<HTMLElement>) => {
  marker.dataset.paragraphNumber = String(index + 1); decorated.add(marker);
};

/** Live marker geometry of a pane; never writes scrollTop. Decorates paragraph numbers when a set is given. */
function readMarkers(element: HTMLElement, count: number, decorated?: Set<HTMLElement>): (Row & { marker: HTMLElement })[] {
  const edge = element.getBoundingClientRect().top + element.clientTop;
  return markerElements(element).flatMap(marker => {
    const index = markerIndex(marker, count);
    if (index === null) return [];
    if (decorated) decorate(marker, index, decorated);
    return [{ marker, index, top: element.scrollTop + marker.getBoundingClientRect().top - edge }];
  }).filter(row => Number.isFinite(row.top)).sort((a, b) => a.index - b.index);
}

/** A group has one owner until deliberate input transfers ownership. Follower scroll events never feed back. */
export function useCoupledScroll(panes: readonly CoupledScrollPane[], options: CoupledScrollOptions): CoupledScrollState & {
  available: boolean;
  align: (request: AlignRequest) => AlignResult;
} {
  const { enabled, minWidth = 1100, fixedLeader, startsRevision, frozenPaneId } = options;
  const [state, setState] = useState<CoupledScrollState>(empty);
  const query = useMemo(() => window.matchMedia?.(`(min-width: ${minWidth}px)`), [minWidth]);
  const [available, setAvailable] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const update = () => setAvailable(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [query]);

  // An input event may precede a queued programmatic scroll event. Keep each written
  // position until real movement occurs, even after ownership changes. Shared by align().
  const programmatic = useRef(new Map<HTMLElement, number>());
  const decorated = useRef(new Set<HTMLElement>());
  const frozenGeometry = useRef<FrozenGeometry | null>(null);
  const refresh = useRef<(() => void) | undefined>(undefined);
  const latest = useRef({ panes, frozenPaneId });
  latest.current = { panes, frozenPaneId };

  const captureFrozen = useCallback(() => {
    const { panes: current, frozenPaneId: frozenId } = latest.current;
    const pane = frozenId === undefined ? undefined : current.find(row => row.id === frozenId);
    if (!pane?.element) { frozenGeometry.current = null; return; }
    const count = startsOf(pane).length;
    frozenGeometry.current = {
      paneId: pane.id, count, scrollHeight: pane.element.scrollHeight,
      rows: readMarkers(pane.element, count).map(({ index, top }) => ({ index, top })),
    };
  }, []);
  /** While a pane is frozen, its geometry is the one captured at the last revision; markers stay live. */
  const geometryOf = useCallback((pane: BoundPane, decorateInto?: Set<HTMLElement>): Geometry => {
    const frozen = frozenGeometry.current;
    if (frozen && frozen.paneId === pane.id && latest.current.frozenPaneId === pane.id) {
      const live = new Map<number, HTMLElement>();
      for (const marker of markerElements(pane.element)) {
        const index = markerIndex(marker, frozen.count);
        if (index !== null && !live.has(index)) live.set(index, marker);
      }
      return { rows: frozen.rows.map(row => ({ ...row, marker: live.get(row.index) })), end: frozen.scrollHeight, count: frozen.count };
    }
    const count = startsOf(pane).length;
    return { rows: readMarkers(pane.element, count, decorateInto), end: pane.element.scrollHeight, count };
  }, []);
  const clearActive = (element: HTMLElement) => {
    element.querySelectorAll<HTMLElement>('[data-paragraph][data-coupled-active]').forEach(marker => { delete marker.dataset.coupledActive; });
  };

  useEffect(() => {
    setState(value => value.leaderId === null && !value.pairs.length ? value : empty);
    if (!enabled || !available) return;
    let detach = () => {};
    const bind = () => {
      detach();
      setState(value => value.leaderId === null && !value.pairs.length ? value : empty);
      const participants = panes.filter((pane): pane is BoundPane => pane.element !== null);
      let leaderId: string | null = fixedLeader ?? null;
      const marks = decorated.current;
      if (frozenPaneId !== undefined) captureFrozen();
      participants.forEach(pane => readMarkers(pane.element, startsOf(pane).length, marks));
      const sync = (source: BoundPane, move = true) => {
        const sourceGeometry = geometryOf(source, marks);
        const geometry = sourceGeometry.rows;
        const current = geometry.filter(row => row.top <= source.element.scrollTop).at(-1) ?? geometry[0];
        if (!current) return;
        const end = geometry.find(row => row.index > current.index)?.top ?? sourceGeometry.end;
        const height = end - current.top;
        if (!Number.isFinite(height) || height <= 0) return;
        const fraction = Math.max(0, Math.min(1, (source.element.scrollTop-current.top)/height));
        const pairs: { paneId: string; paragraph: number }[] = [];
        for (const pane of participants) {
          const paneGeometry = pane === source ? sourceGeometry : geometryOf(pane, marks);
          const mapped = mapParagraph(current.index, sourceGeometry.count, paneGeometry.count);
          const rows = paneGeometry.rows, partner = rows.find(row => row.index === mapped);
          clearActive(pane.element);
          if (!partner) continue;
          if (partner.marker) partner.marker.dataset.coupledActive = 'true';
          pairs.push({paneId:pane.id,paragraph:mapped});
          if (pane === source || !move) continue;
          const partnerEnd = rows.find(row => row.index > mapped)?.top ?? paneGeometry.end;
          const partnerHeight = partnerEnd-partner.top;
          if (!Number.isFinite(partnerHeight) || partnerHeight <= 0) continue;
          const target = partner.top+fraction*partnerHeight;
          if (Number.isFinite(target)) {
            pane.element.scrollTop = Math.max(0, Math.min(Math.max(0,pane.element.scrollHeight-pane.element.clientHeight),target));
            programmatic.current.set(pane.element, pane.element.scrollTop);
          }
        }
        setState(previous => previous.leaderId === leaderId && previous.pairs.length === pairs.length && pairs.every((pair,i) => pair.paneId === previous.pairs[i].paneId && pair.paragraph === previous.pairs[i].paragraph) ? previous : { leaderId, pairs });
      };
      const removals: (() => void)[] = [];
      participants.forEach(pane => {
        const input = () => {
          if (fixedLeader !== undefined && pane.id !== fixedLeader) return;
          leaderId = pane.id;
        };
        const key = (event: KeyboardEvent) => { if (navigationKeys.has(event.key)) input(); };
        const scroll = () => {
          if (programmatic.current.get(pane.element) === pane.element.scrollTop) return;
          programmatic.current.delete(pane.element);
          // A follower scrolled by hand moves only itself while a fixed leader is set.
          if (fixedLeader !== undefined && pane.id !== fixedLeader) return;
          if (leaderId === null) leaderId = pane.id;
          if (leaderId === pane.id) sync(pane);
        };
        for (const type of ['wheel','touchstart','pointerdown']) {
          pane.element.addEventListener(type,input,{passive:true}); removals.push(()=>pane.element.removeEventListener(type,input));
        }
        pane.element.addEventListener('keydown',key); pane.element.addEventListener('scroll',scroll,{passive:true});
        removals.push(()=>{ pane.element.removeEventListener('keydown',key); pane.element.removeEventListener('scroll',scroll); });
      });
      /** Re-reads markers and lazy starts and refreshes pairs; never writes scrollTop. */
      const refreshMarkers = () => {
        // Vendor annotation redraws replace marker nodes without replacing the
        // scrollport. Observe child lists only: our attribute writes cannot loop.
        const valid = new Set<HTMLElement>();
        for (const pane of participants) {
          const count = startsOf(pane).length;
          for (const marker of markerElements(pane.element)) if (markerIndex(marker, count) !== null) valid.add(marker);
        }
        for (const marker of marks) {
          if (!valid.has(marker)) {
            delete marker.dataset.paragraphNumber;
            delete marker.dataset.coupledActive;
            marks.delete(marker);
          }
        }
        participants.forEach(pane => readMarkers(pane.element, startsOf(pane).length, marks));
        const source = participants.find(pane => pane.id === leaderId) ?? participants[0];
        if (source) sync(source, false);
      };
      const frozenElement = frozenPaneId === undefined ? undefined : participants.find(pane => pane.id === frozenPaneId)?.element;
      const observer = new MutationObserver(records => {
        // Marker mutations inside the frozen pane wait for the next startsRevision.
        if (frozenElement && records.every(record => frozenElement.contains(record.target))) return;
        refreshMarkers();
      });
      participants.forEach(pane => observer.observe(pane.element, { childList: true, subtree: true }));
      removals.push(() => observer.disconnect());
      refreshMarkers();
      refresh.current = refreshMarkers;
      detach = () => {
        removals.forEach(remove=>remove());
        marks.forEach(marker=>{ delete marker.dataset.paragraphNumber; delete marker.dataset.coupledActive; });
        marks.clear();
        programmatic.current.clear();
        refresh.current = undefined;
        leaderId=null;
      };
    };
    bind();
    return () => detach();
  },[panes,enabled,available,fixedLeader,frozenPaneId]);

  // A revision re-captures the frozen geometry and refreshes numbers, highlight and pairs without rebinding.
  useEffect(() => {
    captureFrozen();
    refresh.current?.();
  }, [startsRevision, frozenPaneId]);

  useEffect(() => () => {
    decorated.current.forEach(marker => { delete marker.dataset.paragraphNumber; delete marker.dataset.coupledActive; });
    decorated.current.clear();
  }, []);

  const align = useCallback((request: AlignRequest): AlignResult => {
    const current = latest.current.panes;
    const bound = (id: string) => current.find((pane): pane is BoundPane => pane.id === id && pane.element !== null);
    const anchor = bound(request.anchor.paneId);
    if (!anchor) return { pairs: [], estimate: false };
    const marks = decorated.current;
    const anchorGeometry = geometryOf(anchor);
    const pairs: { paneId: string; paragraph: number }[] = [];
    const mark = (pane: BoundPane, row: Row | undefined, paragraph: number) => {
      clearActive(pane.element);
      if (!row) return false;
      if (row.marker) { decorate(row.marker, paragraph, marks); row.marker.dataset.coupledActive = 'true'; }
      pairs.push({ paneId: pane.id, paragraph });
      return true;
    };
    mark(anchor, anchorGeometry.rows.find(row => row.index === request.anchor.paragraph), request.anchor.paragraph);
    let estimate = false;
    for (const id of request.targets) {
      const pane = bound(id);
      if (!pane || pane === anchor) continue;
      const geometry = geometryOf(pane);
      if (geometry.count !== anchorGeometry.count) estimate = true;
      const mapped = mapParagraph(request.anchor.paragraph, anchorGeometry.count, geometry.count);
      const partner = geometry.rows.find(row => row.index === mapped);
      if (!mark(pane, partner, mapped) || !partner) continue;
      const target = partner.top - (request.anchorOffset >= 0 ? request.anchorOffset : request.topInset);
      if (!Number.isFinite(target)) continue;
      pane.element.scrollTop = Math.max(0, Math.min(Math.max(0, pane.element.scrollHeight - pane.element.clientHeight), target));
      programmatic.current.set(pane.element, pane.element.scrollTop);
    }
    setState(previous => ({ leaderId: previous.leaderId, pairs }));
    return { pairs, estimate };
  }, [geometryOf]);

  return { ...state, available, align };
}
