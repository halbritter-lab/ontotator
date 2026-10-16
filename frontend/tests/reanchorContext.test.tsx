import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TextPane } from '../src/editor/TextPane';
import { useReanchorContext } from '../src/variants/ReanchorPanel';

const pick=vi.fn(), select=vi.fn(), resize=vi.fn();
let retained:ReturnType<typeof useReanchorContext>['reveal'];
function Harness({text='A😀B\n\nC',identity='alice:doc'}:{text?:string;identity?:string}) {
  const [element,setElement]=useState<HTMLDivElement|null>(null);
  const context=useReanchorContext(text,element,identity); retained=context.reveal;
  return <><button onClick={()=>context.reveal({start:1,end:2,text:'😀'})}>First context</button><button onClick={()=>context.reveal({start:5,end:6,text:'C'})}>Second context</button>
    <button onClick={()=>context.reveal({start:6,end:6,text:''})}>Caret</button>
    <button onClick={()=>context.reveal({start:1,end:2,text:'wrong'})}>Invalid context</button>
    <TextPane text={text} mentions={[]} selectedEvidenceId={null} selectionIntent="new_mention" onSelection={select} onPick={pick} onChangeIntent={()=>{}} onResizeMention={resize} contextSegments={context.contextSegments} onTextElement={setElement}/>
  </>;
}
beforeEach(()=>{vi.useFakeTimers();pick.mockClear();select.mockClear();resize.mockClear();});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
it('scrolls only its actual text element and renders a two-second codepoint context without mutation',()=>{
  const mounted=render(<Harness/>);
  const pane=mounted.container.querySelector<HTMLElement>('.text-container')!;
  pane.getBoundingClientRect=()=>({top:100} as DOMRect);
  pane.querySelectorAll<HTMLElement>('.run').forEach(run=>{run.getBoundingClientRect=()=>({top:900} as DOMRect);});
  const foreign=document.createElement('div');foreign.scrollTop=47;document.body.prepend(foreign);
  fireEvent.click(screen.getByText('First context'));
  expect(pane.scrollTop).toBe(800);expect(foreign.scrollTop).toBe(47);
  const marker=pane.querySelector<HTMLElement>('.run--context')!;expect(marker.textContent).toBe('😀');expect(marker.dataset.start).toBe('1');
  fireEvent.click(marker);expect(pick).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();expect(resize).not.toHaveBeenCalled();
  act(()=>vi.advanceTimersByTime(1999));expect(pane.querySelector('.run--context')).not.toBeNull();
  act(()=>vi.advanceTimersByTime(1));expect(pane.querySelector('.run--context')).toBeNull();foreign.remove();
});
it('replaces timers, permits caret scroll without zero-length marks, and clears stale document callbacks in StrictMode',()=>{
  const mounted=render(<StrictMode><Harness/></StrictMode>);
  fireEvent.click(screen.getByText('First context'));act(()=>vi.advanceTimersByTime(1000));
  fireEvent.click(screen.getByText('Second context'));act(()=>vi.advanceTimersByTime(1000));
  expect(mounted.container.querySelector('.run--context')?.textContent).toBe('C');
  act(()=>vi.advanceTimersByTime(1000));expect(mounted.container.querySelector('.run--context')).toBeNull();
  fireEvent.click(screen.getByText('Caret'));expect(mounted.container.querySelector('.run--context')).toBeNull();
  fireEvent.click(screen.getByText('First context'));const stale=retained;
  mounted.rerender(<StrictMode><Harness text="replacement" identity="bob:next"/></StrictMode>);
  act(()=>stale({start:1,end:2,text:'😀'}));expect(mounted.container.querySelector('.run--context')).toBeNull();expect(vi.getTimerCount()).toBe(0);
  mounted.unmount();expect(vi.getTimerCount()).toBe(0);
});

it('rejects literal mismatches and preserves ordinary selection codepoints after context rendering',()=>{
  const mounted=render(<Harness/>);
  fireEvent.click(screen.getByText('First context'));
  const pane=mounted.container.querySelector<HTMLElement>('.text-container')!;
  const node=pane.querySelector('.run--context')!.firstChild!;
  const range=document.createRange();range.setStart(node,0);range.setEnd(node,2);
  window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
  fireEvent.mouseUp(pane);
  expect(select).toHaveBeenCalledWith(expect.objectContaining({segments:[{start:1,end:2}]}));
  // jsdom queues selectionchange dispatches at zero delay, independently of the owned context timer.
  act(()=>vi.advanceTimersByTime(0));
  fireEvent.click(screen.getByText('Invalid context'));
  expect(pane.querySelector('.run--context')).toBeNull();expect(vi.getTimerCount()).toBe(0);
});

function selectedOffset(pane: HTMLElement, node: Node | null, offset: number) {
  const run=(node?.nodeType===Node.ELEMENT_NODE ? node as Element : node?.parentElement)?.closest<HTMLElement>('.run');
  return run && pane.contains(run) ? Number(run.dataset.start)+offset : null;
}
it.each(['mouse','Shift'] as const)('preserves an unfinished %s selection across context expiry, including astral UTF16 offsets and backward direction', method=>{
  const mounted=render(<Harness/>);
  fireEvent.click(screen.getByText('First context'));
  const pane=mounted.container.querySelector<HTMLElement>('.text-container')!;
  const emoji=pane.querySelector('.run--context')!.firstChild!;
  const last=pane.querySelector<HTMLElement>('.run[data-start="6"]')!.firstChild!;
  const selection=window.getSelection()!;
  selection.setBaseAndExtent(method==='Shift'?last:emoji,method==='Shift'?1:0,method==='Shift'?emoji:last,method==='Shift'?0:1);
  if(method==='Shift') fireEvent.keyDown(pane,{key:'ArrowLeft',shiftKey:true});
  act(()=>vi.advanceTimersByTime(2000));
  expect(pane.querySelector('.run--context')).toBeNull();
  expect(selectedOffset(pane,selection.anchorNode,selection.anchorOffset)).toBe(method==='Shift'?7:1);
  expect(selectedOffset(pane,selection.focusNode,selection.focusOffset)).toBe(method==='Shift'?1:7);
  expect(selection.toString()).toBe('😀B\n\nC');
  expect(select).not.toHaveBeenCalled();expect(resize).not.toHaveBeenCalled();expect(pick).not.toHaveBeenCalled();
  if(method==='Shift') fireEvent.keyUp(pane,{key:'Shift'});else fireEvent.mouseUp(pane);
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith(expect.objectContaining({segments:[{start:1,end:6}]}));
});
it('preserves an owned caret across context expiry without committing work',()=>{
  const mounted=render(<Harness/>);fireEvent.click(screen.getByText('First context'));
  const pane=mounted.container.querySelector<HTMLElement>('.text-container')!;
  const selection=window.getSelection()!;selection.collapse(pane.querySelector('.run--context')!.firstChild!,2);
  act(()=>vi.advanceTimersByTime(2000));
  expect(selection.isCollapsed).toBe(true);
  expect(selectedOffset(pane,selection.anchorNode,selection.anchorOffset)).toBe(3);
  fireEvent.mouseUp(pane);expect(select).not.toHaveBeenCalled();expect(resize).not.toHaveBeenCalled();
});
it('leaves a foreign pane native range untouched during context expiry',()=>{
  render(<Harness/>);fireEvent.click(screen.getByText('First context'));
  const foreign=document.createElement('div');foreign.textContent='Other 😀 pane';document.body.append(foreign);
  const selection=window.getSelection()!;selection.setBaseAndExtent(foreign.firstChild!,8,foreign.firstChild!,6);
  act(()=>vi.advanceTimersByTime(2000));
  expect(selection.anchorNode).toBe(foreign.firstChild);expect(selection.anchorOffset).toBe(8);
  expect(selection.focusNode).toBe(foreign.firstChild);expect(selection.focusOffset).toBe(6);
  expect(select).not.toHaveBeenCalled();expect(resize).not.toHaveBeenCalled();foreign.remove();
});
