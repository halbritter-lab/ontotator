import { useEffect, useState } from 'react';

export interface CoupledScrollPane { id: string; element: HTMLElement | null; starts: readonly number[] }
export interface CoupledScrollState { leaderId: string | null; pairs: ReadonlyArray<{ paneId: string; paragraph: number }> }
const empty: CoupledScrollState = { leaderId: null, pairs: [] };
const navigationKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

/** A group has one owner until deliberate input transfers ownership. Follower scroll events never feed back. */
export function useCoupledScroll(panes: readonly CoupledScrollPane[], { enabled }: { enabled: boolean }): CoupledScrollState & { available: boolean } {
  const [state, setState] = useState<CoupledScrollState>(empty);
  const [wide] = useState(() => window.matchMedia?.('(min-width: 1100px)'));
  const [available, setAvailable] = useState(wide?.matches ?? false);
  useEffect(() => {
    if (!wide) return;
    const update = () => setAvailable(wide.matches);
    update();
    wide.addEventListener('change', update);
    return () => wide.removeEventListener('change', update);
  }, [wide]);
  useEffect(() => {
    setState(value => value.leaderId === null && !value.pairs.length ? value : empty);
    if (!enabled || !available) return;
    let detach = () => {};
    const bind = () => {
      detach();
      setState(value => value.leaderId === null && !value.pairs.length ? value : empty);
      const participants = panes.filter((pane): pane is CoupledScrollPane & { element: HTMLElement } => pane.element !== null);
      let leaderId: string | null = null;
      const decorated = new Set<HTMLElement>();
      // An input event may precede a queued programmatic scroll event. Keep its
      // written position until real movement occurs, even after ownership changes.
      const programmaticPositions = new Map<HTMLElement, number>();
      const markers = (pane: CoupledScrollPane & { element: HTMLElement }) => {
        const edge = pane.element.getBoundingClientRect().top + pane.element.clientTop;
        return [...pane.element.querySelectorAll<HTMLElement>('[data-paragraph]')].flatMap(marker => {
          const index = Number(marker.dataset.paragraph);
          if (!Number.isInteger(index) || index < 0 || index >= pane.starts.length) return [];
          marker.dataset.paragraphNumber = String(index + 1); decorated.add(marker);
          return [{ marker, index, top: pane.element.scrollTop + marker.getBoundingClientRect().top - edge }];
        }).filter(row => Number.isFinite(row.top)).sort((a,b) => a.index-b.index);
      };
      participants.forEach(markers);
      const sync = (source: typeof participants[number], move = true) => {
        const geometry = markers(source);
        const current = geometry.filter(row => row.top <= source.element.scrollTop).at(-1) ?? geometry[0];
        if (!current) return;
        const end = geometry.find(row => row.index > current.index)?.top ?? source.element.scrollHeight;
        const height = end - current.top;
        if (!Number.isFinite(height) || height <= 0) return;
        const fraction = Math.max(0, Math.min(1, (source.element.scrollTop-current.top)/height));
        const pairs: { paneId: string; paragraph: number }[] = [];
        for (const pane of participants) {
          const mapped = source.starts.length <= 1 || pane.starts.length <= 1 ? 0 : Math.round(current.index*(pane.starts.length-1)/(source.starts.length-1));
          const rows = markers(pane), partner = rows.find(row => row.index === mapped);
          rows.forEach(row => { delete row.marker.dataset.coupledActive; });
          if (!partner) continue;
          partner.marker.dataset.coupledActive = 'true'; pairs.push({paneId:pane.id,paragraph:mapped});
          if (pane === source || !move) continue;
          const partnerEnd = rows.find(row => row.index > mapped)?.top ?? pane.element.scrollHeight;
          const partnerHeight = partnerEnd-partner.top;
          if (!Number.isFinite(partnerHeight) || partnerHeight <= 0) continue;
          const target = partner.top+fraction*partnerHeight;
          if (Number.isFinite(target)) {
            pane.element.scrollTop = Math.max(0, Math.min(Math.max(0,pane.element.scrollHeight-pane.element.clientHeight),target));
            programmaticPositions.set(pane.element, pane.element.scrollTop);
          }
        }
        setState(previous => previous.leaderId === leaderId && previous.pairs.length === pairs.length && pairs.every((pair,i) => pair.paneId === previous.pairs[i].paneId && pair.paragraph === previous.pairs[i].paragraph) ? previous : { leaderId, pairs });
      };
      const removals: (() => void)[] = [];
      participants.forEach(pane => {
        const input = () => { leaderId = pane.id; };
        const key = (event: KeyboardEvent) => { if (navigationKeys.has(event.key)) input(); };
        const scroll = () => {
          if (programmaticPositions.get(pane.element) === pane.element.scrollTop) return;
          programmaticPositions.delete(pane.element);
          if (leaderId === null) leaderId = pane.id;
          if (leaderId === pane.id) sync(pane);
        };
        for (const type of ['wheel','touchstart','pointerdown']) {
          pane.element.addEventListener(type,input,{passive:true}); removals.push(()=>pane.element.removeEventListener(type,input));
        }
        pane.element.addEventListener('keydown',key); pane.element.addEventListener('scroll',scroll,{passive:true});
        removals.push(()=>{ pane.element.removeEventListener('keydown',key); pane.element.removeEventListener('scroll',scroll); });
      });
      const refreshMarkers = () => {
        // Vendor annotation redraws replace marker nodes without replacing the
        // scrollport. Observe child lists only: our attribute writes cannot loop.
        for (const marker of decorated) {
          if (!participants.some(pane => pane.element.contains(marker))) {
            delete marker.dataset.paragraphNumber;
            delete marker.dataset.coupledActive;
            decorated.delete(marker);
          }
        }
        participants.forEach(markers);
        const source = participants.find(pane => pane.id === leaderId) ?? participants[0];
        if (source) sync(source, false);
      };
      const observer = new MutationObserver(refreshMarkers);
      participants.forEach(pane => observer.observe(pane.element, { childList: true, subtree: true }));
      removals.push(() => observer.disconnect());
      refreshMarkers();
      detach = () => { removals.forEach(remove=>remove()); decorated.forEach(marker=>{ delete marker.dataset.paragraphNumber; delete marker.dataset.coupledActive; }); leaderId=null; };
    };
    bind();
    return () => detach();
  },[panes,enabled,available]);
  return { ...state, available };
}
