import { StrictMode, useMemo, type ReactNode } from 'react';
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCoupledScroll, type CoupledScrollPane } from '../src/variants/useCoupledScroll';
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
  return { id, element, starts: offsets };
}
function scroll(p: CoupledScrollPane, offset: number) { act(() => { p.element!.scrollTop = offset; fireEvent.scroll(p.element!); }); }
beforeEach(() => {
  width = 1280;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return width >= 1100; }, addEventListener: (_: string, cb: () => void) => changes.add(cb), removeEventListener: (_: string, cb: () => void) => changes.delete(cb) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); changes.clear(); });
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
