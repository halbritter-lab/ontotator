import { StrictMode, useMemo, type ReactNode } from 'react';
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mapParagraph, useCoupledScroll, type CoupledScrollOptions, type CoupledScrollPane } from '../src/variants/useCoupledScroll';
let width = 1280;
const changes = new Set<() => void>();
function pane(id: string, offsets: number[], height = 2000): CoupledScrollPane {
  const element = document.createElement('div');
  Object.defineProperties(element, { scrollHeight: { value: height }, clientHeight: { value: 100 } });
  element.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  offsets.forEach((offset, index) => {
    const marker = document.createElement('span'); marker.dataset.paragraph = String(index);
    marker.setAttribute('aria-hidden', 'true');
    marker.getBoundingClientRect = () => ({ top: 100 + offset - element.scrollTop } as DOMRect);
    element.append(marker);
  });
  // Attached like a real scrollport: a frozen pane is captured only while it is connected.
  document.body.append(element);
  return { id, element, starts: offsets };
}
function scroll(p: CoupledScrollPane, offset: number) { act(() => { p.element!.scrollTop = offset; fireEvent.scroll(p.element!); }); }
beforeEach(() => {
  width = 1280;
  vi.stubGlobal('matchMedia', (query: string) => ({ get matches() { return width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN); }, addEventListener: (_: string, cb: () => void) => changes.add(cb), removeEventListener: (_: string, cb: () => void) => changes.delete(cb) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); changes.clear(); document.body.replaceChildren(); });
it('keeps panes independent when the environment cannot detect viewport support', () => {
  vi.stubGlobal('matchMedia', undefined);
  const source = pane('source', [0, 200]), target = pane('target', [0, 400]);
  const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: true }));
  expect(result.current.available).toBe(false);
  scroll(source, 100);
  expect(target.element!.scrollTop).toBe(0);
  expect(result.current.pairs).toEqual([]);
  expect(source.element!.querySelector('[data-paragraph-number]')).toBeNull();
});
it('preserves progress with positional mapping and never echoes delayed follower events', async () => {
  const source = pane('source', [0, 200, 400, 600]), target = pane('target', [0, 400, 800, 1200, 1600, 1800, 1900], 2200), comparison = pane('comparison', [0, 300, 600, 900]);
  const panes = [source, target, comparison];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: true }));
  scroll(source, 300); expect(target.element!.scrollTop).toBe(1000); expect(comparison.element!.scrollTop).toBe(450);
  await new Promise(resolve=>setTimeout(resolve,180));
  fireEvent.scroll(target.element!); fireEvent.scroll(comparison.element!);
  expect(source.element!.scrollTop).toBe(300); expect(result.current.leaderId).toBe('source');
  expect(result.current.pairs).toEqual([{ paneId: 'source', paragraph: 1 }, { paneId: 'target', paragraph: 2 }, { paneId: 'comparison', paragraph: 1 }]);
  expect(target.element!.querySelector('[data-coupled-active]')?.getAttribute('data-paragraph-number')).toBe('3');
});
it.each(['wheel', 'touchstart', 'pointerdown'])('transfers leadership on %s and permits rapid reversal', kind => {
  const a = pane('a', [0, 200, 400]), b = pane('b', [0, 400, 800]); const panes = [a,b];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: true }));
  scroll(a, 100); act(() => b.element!.dispatchEvent(new Event(kind))); scroll(b, 300);
  expect(a.element!.scrollTop).toBe(150); expect(result.current.leaderId).toBe('b');
  fireEvent.wheel(a.element!); scroll(a, 50); expect(b.element!.scrollTop).toBe(100);
});
it.each(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Spacebar'])('native %s input transfers ownership', key => {
  const a = pane('a',[0,200]), b = pane('b',[0,400]); const panes = [a,b];
  renderHook(() => useCoupledScroll(panes,{enabled:true})); scroll(a,50);
  fireEvent.keyDown(b.element!,{key}); scroll(b,200); expect(a.element!.scrollTop).toBe(100);
});
it('off, narrow, replacement and unmount clean up attributes and listeners', () => {
  const a = pane('a',[0,200]), b = pane('b',[0,400]), c = pane('c',[0,600]);
  const mounted = renderHook(({ enabled, follower }) => useCoupledScroll(useMemo(() => [a,follower], [follower]),{enabled}), {initialProps:{enabled:false,follower:b}});
  scroll(a,100); expect(b.element!.scrollTop).toBe(0); expect(a.element!.querySelector('[data-paragraph-number]')).toBeNull();
  mounted.rerender({enabled:true,follower:b}); scroll(a,100); expect(b.element!.scrollTop).toBe(200);
  mounted.rerender({enabled:true,follower:c}); expect(b.element!.querySelector('[data-paragraph-number]')).toBeNull();
  fireEvent.wheel(b.element!); scroll(b,300); expect(a.element!.scrollTop).toBe(100);
  act(() => { width=1099; changes.forEach(cb=>cb()); }); expect(a.element!.querySelector('[data-paragraph-number]')).toBeNull();
  const pausedPosition = c.element!.scrollTop;
  scroll(a, 50); expect(c.element!.scrollTop).toBe(pausedPosition);
  expect(mounted.result.current.available).toBe(false);
  expect(mounted.result.current.pairs).toEqual([]);
  act(() => { width=1100; changes.forEach(cb=>cb()); });
  expect(mounted.result.current.available).toBe(true);
  expect(c.element!.scrollTop).toBe(pausedPosition);
  scroll(a, 100); expect(c.element!.scrollTop).toBe(300);
  mounted.unmount(); expect(changes.size).toBe(0);
});
it.each([[0,0],[0,1],[1,1],[1,4],[4,1]])('keeps empty/short %i/%i geometry finite and clamped', (n,m) => {
  const a=pane('a',Array.from({length:n},(_,i)=>i*2),10), b=pane('b',Array.from({length:m},(_,i)=>i*3),10); const panes=[a,b];
  renderHook(()=>useCoupledScroll(panes,{enabled:true})); scroll(a,8); expect(Number.isFinite(b.element!.scrollTop)).toBe(true); expect(b.element!.scrollTop).toBe(0);
});

it('reads replacement markers live, ignores absent partners and cleans StrictMode listeners',()=>{
  const a=pane('a',[20,220,420]),b=pane('b',[30,430,830]);const panes=[a,b];
  const wrapper=({children}:{children:ReactNode})=><StrictMode>{children}</StrictMode>;
  const add=vi.spyOn(a.element!,'addEventListener'),remove=vi.spyOn(a.element!,'removeEventListener');
  const mounted=renderHook(()=>useCoupledScroll(panes,{enabled:true}),{wrapper});
  scroll(a,10);expect(b.element!.scrollTop).toBe(30);
  const old=b.element!.querySelector('[data-paragraph="1"]')!;old.remove();scroll(a,250);expect(b.element!.scrollTop).toBe(30);
  const replacement=document.createElement('span');replacement.dataset.paragraph='1';replacement.getBoundingClientRect=()=>({top:100+500-b.element!.scrollTop} as DOMRect);b.element!.append(replacement);
  scroll(a,220);expect(b.element!.scrollTop).toBe(500);
  mounted.unmount();expect(replacement.hasAttribute('data-paragraph-number')).toBe(false);
  expect(add.mock.calls.filter(([type])=>type==='scroll').length).toBe(remove.mock.calls.filter(([type])=>type==='scroll').length);
});

it('clamped followers retain ownership protection indefinitely and finite geometry only moves followers',()=>{
 const a=pane('a',[0,200,400]),b=pane('b',[0,300,500],700);const panes=[a,b];
 renderHook(()=>useCoupledScroll(panes,{enabled:true}));scroll(a,1900);expect(b.element!.scrollTop).toBe(600);
 scroll(a,1960);fireEvent.scroll(b.element!);expect(a.element!.scrollTop).toBe(1960);
 a.element!.querySelectorAll<HTMLElement>('[data-paragraph]').forEach(marker=>{marker.getBoundingClientRect=()=>({top:NaN} as DOMRect);});
 scroll(a,1970);expect(b.element!.scrollTop).toBe(600);
});

it('ignores an unchanged queued follower echo after explicit input transfers ownership with unequal counts',()=>{
  const source=pane('source',[0,200,400,600,800,1000,1200]);
  const follower=pane('follower',[0,200,400,600]);const panes=[source,follower];
  const {result}=renderHook(()=>useCoupledScroll(panes,{enabled:true}));
  scroll(source,250);expect(follower.element!.scrollTop).toBe(250);
  fireEvent.pointerDown(follower.element!);fireEvent.scroll(follower.element!);
  expect(source.element!.scrollTop).toBe(250);
  fireEvent.scroll(follower.element!);expect(source.element!.scrollTop).toBe(250);
  scroll(follower,275);expect(source.element!.scrollTop).toBe(475);expect(result.current.leaderId).toBe('follower');
});
it('decorates replacement markers before any scroll without rewriting clinical text or selection',async()=>{
  const source=pane('source',[0,200,400]),follower=pane('follower',[0,300,600]);const panes=[source,follower];
  document.body.append(source.element!);
  const text=document.createTextNode('µ ± α 😀');source.element!.append(text);
  const selection=window.getSelection()!,range=document.createRange();range.selectNodeContents(text);selection.removeAllRanges();selection.addRange(range);
  const mounted=renderHook(()=>useCoupledScroll(panes,{enabled:true}));scroll(source,250);
  const old=source.element!.querySelector<HTMLElement>('[data-paragraph="1"]')!;
  const replacement=document.createElement('span');replacement.dataset.paragraph='1';replacement.setAttribute('aria-hidden','true');
  replacement.getBoundingClientRect=()=>({top:100+200-source.element!.scrollTop} as DOMRect);
  const previous=follower.element!.scrollTop;
  await act(async()=>{old.replaceWith(replacement);});
  expect(replacement.getAttribute('data-paragraph-number')).toBe('2');expect(replacement.getAttribute('data-coupled-active')).toBe('true');
  expect(source.element!.textContent).toBe('µ ± α 😀');expect(selection.toString()).toBe('µ ± α 😀');
  expect(source.element!.scrollTop).toBe(250);expect(follower.element!.scrollTop).toBe(previous);
  mounted.unmount();expect(replacement.hasAttribute('data-paragraph-number')).toBe(false);source.element!.remove();
});

function trackWrites(p: CoupledScrollPane) {
  let value = 0; const writes = vi.fn();
  Object.defineProperty(p.element!, 'scrollTop', { configurable: true, get: () => value, set: (next: number) => { value = next; writes(next); } });
  return writes;
}
function moveMarker(p: CoupledScrollPane, index: number, offset: number) {
  const marker = p.element!.querySelector<HTMLElement>(`[data-paragraph="${index}"]`)!;
  marker.getBoundingClientRect = () => ({ top: 100 + offset - p.element!.scrollTop } as DOMRect);
}
function addMarker(p: CoupledScrollPane, index: number, offset: number) {
  const marker = document.createElement('span'); marker.dataset.paragraph = String(index);
  marker.getBoundingClientRect = () => ({ top: 100 + offset - p.element!.scrollTop } as DOMRect);
  p.element!.append(marker); return marker;
}

it('minWidth 700 makes coupling available at 800 px; the default stays 1100', () => {
  width = 800;
  const a = pane('a', [0, 200]), b = pane('b', [0, 400]); const panes = [a, b];
  const narrow = renderHook(() => useCoupledScroll(panes, { enabled: true, minWidth: 700 }));
  expect(narrow.result.current.available).toBe(true);
  scroll(a, 100); expect(b.element!.scrollTop).toBe(200);
  const defaults = renderHook(() => useCoupledScroll(panes, { enabled: false }));
  expect(defaults.result.current.available).toBe(false);
  act(() => { width = 699; changes.forEach(cb => cb()); });
  expect(narrow.result.current.available).toBe(false);
});

it('with fixedLeader, wheel and scroll on a follower never make it leader and never move the leader', () => {
  const source = pane('source', [0, 200, 400]), target = pane('target', [0, 400, 800]); const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: true, fixedLeader: 'target' }));
  fireEvent.wheel(source.element!); scroll(source, 100);
  expect(target.element!.scrollTop).toBe(0); expect(source.element!.scrollTop).toBe(100);
  fireEvent.keyDown(source.element!, { key: 'PageDown' }); scroll(source, 150);
  expect(target.element!.scrollTop).toBe(0); expect(result.current.leaderId).not.toBe('source');
  scroll(target, 400); expect(source.element!.scrollTop).toBe(200); expect(result.current.leaderId).toBe('target');
  fireEvent.pointerDown(source.element!); scroll(source, 300); expect(target.element!.scrollTop).toBe(400);
  scroll(target, 500); expect(source.element!.scrollTop).toBe(250);
});

it('a startsRevision change re-reads lazy starts without unbinding, without resetting the leader and without writing scrollTop', () => {
  const source = pane('source', [0, 200, 400]), target = pane('target', [0, 400, 800]);
  let targetStarts: readonly number[] = [0, 400];
  const panes = [source, { ...target, starts: () => targetStarts }];
  const sourceWrites = trackWrites(source), targetWrites = trackWrites(target);
  const removeSource = vi.spyOn(source.element!, 'removeEventListener'), removeTarget = vi.spyOn(target.element!, 'removeEventListener');
  const { result, rerender } = renderHook(({ revision }) => useCoupledScroll(panes, { enabled: true, startsRevision: revision }), { initialProps: { revision: 0 } });
  const third = target.element!.querySelector('[data-paragraph="2"]')!;
  expect(third.hasAttribute('data-paragraph-number')).toBe(false);
  scroll(source, 250); expect(result.current.leaderId).toBe('source');
  sourceWrites.mockClear(); targetWrites.mockClear();
  targetStarts = [0, 400, 800];
  rerender({ revision: 1 });
  expect(third.getAttribute('data-paragraph-number')).toBe('3');
  expect(removeSource).not.toHaveBeenCalled(); expect(removeTarget).not.toHaveBeenCalled();
  expect(sourceWrites).not.toHaveBeenCalled(); expect(targetWrites).not.toHaveBeenCalled();
  expect(result.current.leaderId).toBe('source');
  expect(result.current.pairs).toEqual([{ paneId: 'source', paragraph: 1 }, { paneId: 'target', paragraph: 1 }]);
});

it('marker mutations inside the frozen pane do not refresh pairs until the next revision', async () => {
  const source = pane('source', [0, 200, 400]), target = pane('target', [0, 400, 800]);
  let targetStarts: readonly number[] = [0, 400, 800];
  const panes = [source, { ...target, starts: () => targetStarts }];
  const options = (revision: number): CoupledScrollOptions => ({ enabled: true, fixedLeader: 'target', frozenPaneId: 'target', startsRevision: revision });
  const { result, rerender } = renderHook(({ revision }) => useCoupledScroll(panes, options(revision)), { initialProps: { revision: 0 } });
  scroll(target, 450);
  const before = [{ paneId: 'source', paragraph: 1 }, { paneId: 'target', paragraph: 1 }];
  expect(result.current.pairs).toEqual(before);
  const sourcePosition = source.element!.scrollTop;
  moveMarker(target, 1, 600);
  await act(async () => { addMarker(target, 3, 1000); });
  expect(result.current.pairs).toEqual(before);
  targetStarts = [0, 600, 800, 1000];
  rerender({ revision: 1 });
  expect(result.current.pairs).toEqual([{ paneId: 'source', paragraph: 0 }, { paneId: 'target', paragraph: 0 }]);
  expect(source.element!.scrollTop).toBe(sourcePosition);
});

it('type then scroll within 300 ms uses the geometry of the last revision', async () => {
  const source = pane('source', [0, 200, 400]), target = pane('target', [0, 400, 800]);
  let targetStarts: readonly number[] = [0, 400, 800];
  const panes = [source, { ...target, starts: () => targetStarts }];
  const { rerender } = renderHook(({ revision }) => useCoupledScroll(panes, { enabled: true, fixedLeader: 'target', frozenPaneId: 'target', startsRevision: revision }), { initialProps: { revision: 0 } });
  // Typing moves the mirror markers and adds a paragraph before the debounced recompute.
  moveMarker(target, 1, 500); moveMarker(target, 2, 900);
  await act(async () => { addMarker(target, 3, 1300); });
  scroll(target, 500);
  expect(source.element!.scrollTop).toBe(250);
  targetStarts = [0, 500, 900, 1300];
  rerender({ revision: 1 });
  scroll(target, 600);
  expect(source.element!.scrollTop).toBe(250);
  scroll(target, 700);
  expect(source.element!.scrollTop).toBe(300);
});

it('align scrolls each target once so its paired paragraph sits at the anchor offset, clamped', () => {
  const source = pane('source', [0, 200, 400, 600]), target = pane('target', [0, 400, 800, 1200]), comparison = pane('comparison', [0, 300, 600, 900], 700);
  const panes = [source, target, comparison];
  const targetWrites = trackWrites(target), comparisonWrites = trackWrites(comparison);
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: true }));
  let outcome!: ReturnType<typeof result.current.align>;
  act(() => { outcome = result.current.align({ anchor: { paneId: 'source', paragraph: 3 }, targets: ['target', 'comparison'], anchorOffset: 30, topInset: 12 }); });
  expect(target.element!.scrollTop).toBe(1170);
  expect(comparison.element!.scrollTop).toBe(600);
  expect(targetWrites).toHaveBeenCalledTimes(1); expect(comparisonWrites).toHaveBeenCalledTimes(1);
  expect(source.element!.scrollTop).toBe(0);
  expect(outcome).toEqual({ pairs: [{ paneId: 'source', paragraph: 3 }, { paneId: 'target', paragraph: 3 }, { paneId: 'comparison', paragraph: 3 }], estimate: false });
  expect(result.current.pairs).toEqual(outcome.pairs);
});

it('align uses topInset when the anchor paragraph starts above the visible area', () => {
  const source = pane('source', [0, 200, 400, 600]), target = pane('target', [0, 400, 800, 1200]); const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: true }));
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 2 }, targets: ['target'], anchorOffset: -50, topInset: 12 }); });
  expect(target.element!.scrollTop).toBe(788);
});

it('align keeps the shown part of a long anchor paragraph level when its top is above the view', () => {
  // Paragraph 0 is 1000 px in the source and 2000 px in the target; the source shows 500 px into it.
  const source = pane('source', [0, 1000, 1100]), target = pane('target', [0, 2000, 2200], 4000); const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: false }));
  act(() => { source.element!.scrollTop = 500; });
  // Without a caret: the line at the top inset (512 px = 51.2 %) is matched to the same share of the partner.
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 0 }, targets: ['target'], anchorOffset: -500, topInset: 12 }); });
  expect(target.element!.scrollTop).toBe(1012);
  // With the caret at 55 % of the paragraph (550 px, 50 px into the view): that line is matched, at the same height.
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 0 }, targets: ['target'], anchorOffset: -500, topInset: 12, anchorFraction: 0.55 }); });
  expect(target.element!.scrollTop).toBe(1050);
});

it('align still matches paragraph tops when the anchor paragraph starts in view, even with a caret fraction', () => {
  const source = pane('source', [0, 200, 400, 600]), target = pane('target', [0, 400, 800, 1200]); const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: false }));
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 2 }, targets: ['target'], anchorOffset: 30, topInset: 12, anchorFraction: 0.9 }); });
  expect(target.element!.scrollTop).toBe(770);
});

it('align marks the paired markers and reports estimate when counts differ', () => {
  const source = pane('source', [0, 200, 400, 600]), target = pane('target', [0, 200, 400, 600, 800, 1000, 1200], 2200); const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: false }));
  let outcome!: ReturnType<typeof result.current.align>;
  act(() => { outcome = result.current.align({ anchor: { paneId: 'source', paragraph: 2 }, targets: ['target'], anchorOffset: 0, topInset: 12 }); });
  expect(outcome).toEqual({ pairs: [{ paneId: 'source', paragraph: 2 }, { paneId: 'target', paragraph: 4 }], estimate: true });
  expect(target.element!.querySelector('[data-coupled-active]')?.getAttribute('data-paragraph')).toBe('4');
  expect(target.element!.querySelector('[data-coupled-active]')?.getAttribute('data-paragraph-number')).toBe('5');
  expect(source.element!.querySelector('[data-coupled-active]')?.getAttribute('data-paragraph')).toBe('2');
  act(() => { outcome = result.current.align({ anchor: { paneId: 'source', paragraph: 1 }, targets: ['target'], anchorOffset: 0, topInset: 12 }); });
  expect(target.element!.querySelectorAll('[data-coupled-active]')).toHaveLength(1);
  expect(target.element!.querySelector('[data-coupled-active]')?.getAttribute('data-paragraph')).toBe('2');
  const equal = pane('equal', [0, 300, 600, 900]); const equalPanes = [source, equal];
  const second = renderHook(() => useCoupledScroll(equalPanes, { enabled: false }));
  act(() => { outcome = second.result.current.align({ anchor: { paneId: 'source', paragraph: 1 }, targets: ['equal'], anchorOffset: 0, topInset: 12 }); });
  expect(outcome.estimate).toBe(false);
});

it('positions written by align never make the target leader and never feed back', () => {
  const source = pane('source', [0, 200, 400, 600]), target = pane('target', [0, 400, 800, 1200]); const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: true }));
  scroll(source, 50); expect(result.current.leaderId).toBe('source');
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 2 }, targets: ['target'], anchorOffset: 10, topInset: 12 }); });
  expect(target.element!.scrollTop).toBe(790);
  fireEvent.scroll(target.element!);
  expect(source.element!.scrollTop).toBe(50); expect(result.current.leaderId).toBe('source');
  scroll(source, 300); expect(target.element!.scrollTop).toBe(600);
});

it('align works while coupling is off', () => {
  const source = pane('source', [0, 200, 400]), target = pane('target', [0, 400, 800]); const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: false }));
  act(() => { result.current.align({ anchor: { paneId: 'target', paragraph: 1 }, targets: ['source'], anchorOffset: 20, topInset: 12 }); });
  expect(source.element!.scrollTop).toBe(180);
  expect(result.current.leaderId).toBeNull();
  scroll(source, 300); expect(target.element!.scrollTop).toBe(0);
});

it('mapParagraph maps linearly and returns 0 for single-paragraph sides', () => {
  expect(mapParagraph(2, 4, 7)).toBe(4);
  expect(mapParagraph(3, 4, 4)).toBe(3);
  expect(mapParagraph(5, 7, 4)).toBe(3);
  expect(mapParagraph(0, 1, 5)).toBe(0);
  expect(mapParagraph(3, 5, 1)).toBe(0);
  expect(mapParagraph(0, 0, 0)).toBe(0);
});

it('ComparePane defaults are unchanged', () => {
  width = 1099;
  const a = pane('a', [0, 200, 400]), b = pane('b', [0, 400, 800]); const panes = [a, b];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: true }));
  expect(result.current.available).toBe(false);
  act(() => { width = 1100; changes.forEach(cb => cb()); });
  expect(result.current.available).toBe(true);
  scroll(a, 100); expect(b.element!.scrollTop).toBe(200); expect(result.current.leaderId).toBe('a');
  fireEvent.wheel(b.element!); scroll(b, 400); expect(a.element!.scrollTop).toBe(200); expect(result.current.leaderId).toBe('b');
});

function stubResizeObserver() {
  const observers: { callback: ResizeObserverCallback; elements: Element[] }[] = [];
  vi.stubGlobal('ResizeObserver', class {
    entry: { callback: ResizeObserverCallback; elements: Element[] };
    constructor(callback: ResizeObserverCallback) { this.entry = { callback, elements: [] }; observers.push(this.entry); }
    observe(element: Element) { this.entry.elements.push(element); }
    unobserve() {}
    disconnect() { this.entry.elements = []; }
  });
  return (element: Element) => act(() => observers.filter(o => o.elements.includes(element)).forEach(o => o.callback([], {} as ResizeObserver)));
}

it('a width change of the frozen pane re-captures its geometry without writing scrollTop', () => {
  const fire = stubResizeObserver();
  const source = pane('source', [0, 200, 400]), target = pane('target', [0, 400, 800]); const panes = [source, target];
  let width = 600;
  Object.defineProperty(target.element!, 'clientWidth', { configurable: true, get: () => width });
  renderHook(() => useCoupledScroll(panes, { enabled: true, fixedLeader: 'target', frozenPaneId: 'target', startsRevision: 0 }));
  const sourceWrites = trackWrites(source), targetWrites = trackWrites(target);
  // A narrower pane rewraps the text: the paragraphs start lower.
  moveMarker(target, 1, 600); moveMarker(target, 2, 1000);
  fire(target.element!);
  expect(sourceWrites).not.toHaveBeenCalled();
  width = 500; fire(target.element!);
  expect(sourceWrites).not.toHaveBeenCalled(); expect(targetWrites).not.toHaveBeenCalled();
  scroll(target, 600);
  expect(source.element!.scrollTop).toBe(200);
});

it('never captures a detached frozen element, and align reads live geometry', () => {
  const source = pane('source', [0, 200, 400, 600]);
  // The replaced surface (old change view) is detached: its markers report no layout.
  const old = pane('target', [0, 0, 0, 0], 0); old.element!.remove();
  const fresh = pane('target', [0, 400, 800, 1200]);
  const { result, rerender } = renderHook(({ target }) => useCoupledScroll(useMemo(() => [source, target], [target]), { enabled: false, frozenPaneId: 'target', startsRevision: 0 }), { initialProps: { target: old } });
  rerender({ target: fresh });
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 2 }, targets: ['target'], anchorOffset: 0, topInset: 12 }); });
  expect(fresh.element!.scrollTop).toBe(800);
  // Markers moved after the last capture (typing before the recompute): align still uses the live position.
  moveMarker(fresh, 3, 1300);
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 3 }, targets: ['target'], anchorOffset: 0, topInset: 12 }); });
  expect(fresh.element!.scrollTop).toBe(1300);
});

it('align uses topInset when the anchor paragraph starts below the visible area (spec gap)', () => {
  const source = pane('source', [0, 200, 400, 600]), target = pane('target', [0, 400, 800, 1200]); const panes = [source, target];
  const { result } = renderHook(() => useCoupledScroll(panes, { enabled: false }));
  // The anchor pane is 100 px high; an offset of 150 px lies below its view.
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 2 }, targets: ['target'], anchorOffset: 150, topInset: 12 }); });
  expect(target.element!.scrollTop).toBe(788);
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 1 }, targets: ['target'], anchorOffset: 100, topInset: 12 }); });
  expect(target.element!.scrollTop).toBe(300);
});

it('reports the origin of the pairs: bind, scroll, refresh and align', () => {
  const source = pane('source', [0, 200, 400]), target = pane('target', [0, 400, 800]);
  let targetStarts: readonly number[] = [0, 400];
  const panes = [source, { ...target, starts: () => targetStarts }];
  const { result, rerender } = renderHook(({ revision }) => useCoupledScroll(panes, { enabled: true, startsRevision: revision }), { initialProps: { revision: 0 } });
  expect(result.current.origin).toBe('bind');
  scroll(source, 250); expect(result.current.origin).toBe('scroll');
  targetStarts = [0, 400, 800]; rerender({ revision: 1 });
  expect(result.current.origin).toBe('refresh');
  act(() => { result.current.align({ anchor: { paneId: 'source', paragraph: 2 }, targets: ['target'], anchorOffset: 0, topInset: 12 }); });
  expect(result.current.origin).toBe('align');
  // A scroll that yields the same pairs as the refresh still reports a scroll.
  scroll(source, 260); expect(result.current.origin).toBe('scroll');
});
