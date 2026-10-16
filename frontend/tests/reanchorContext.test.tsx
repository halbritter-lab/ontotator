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
