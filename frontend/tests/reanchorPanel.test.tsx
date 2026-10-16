import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { item } from './reanchorFixtures';
import { ReanchorPanel, pendingDiffParts } from '../src/variants/ReanchorPanel';

afterEach(cleanup);
it('hides empty items and preserves server order, layer identity and literal codepoint mention/cue contexts', () => {
  const reveal = vi.fn();
  const mounted = render(<ReanchorPanel items={[]} labelFor={() => null} onContext={reveal} />);
  expect(screen.queryByRole('heading')).toBeNull();
  mounted.rerender(<ReanchorPanel items={[item(), item({ layer_id: 'other', proposal_set_id: 2 })]} labelFor={layer => layer === 'hpo' ? 'Finding' : null} onContext={reveal} />);
  expect(screen.getByRole('heading', { name: 'Needs review after the text change (2)' })).toBeTruthy();
  const buttons = screen.getAllByRole('button'); expect(buttons[0].textContent).toContain('Finding'); expect(buttons[1].textContent).toContain('HP:1');
  expect(mounted.container.querySelector('b')).toBeNull();
  expect([...mounted.container.querySelectorAll('[data-old-context]')].map(node => node.textContent)).toEqual([item().old_context.text, item().old_context.text]);
  expect(mounted.container.querySelector('[data-old-kind="mention"]')?.textContent).toBe('😀');
  expect(mounted.container.querySelector('[data-old-kind="cue"]')?.textContent).toBe('ld');
  fireEvent.click(buttons[0]); expect(reveal).toHaveBeenCalledWith(item().new_context);
});
it('adapts validated absolute opcodes in their original order without recomputing a word diff', () => {
  const value = item({ old_context: { start: 100, end: 105, text: 'abXZc' }, new_context: { start: 20, end: 25, text: 'abY!c' }, diff: [
    { op: 'equal', old_start: 100, old_end: 102, new_start: 20, new_end: 22, old_text: 'ab', new_text: 'ab' },
    { op: 'replace', old_start: 102, old_end: 103, new_start: 22, new_end: 23, old_text: 'X', new_text: 'Y' },
    { op: 'delete', old_start: 103, old_end: 104, new_start: 23, new_end: 23, old_text: 'Z', new_text: '' },
    { op: 'insert', old_start: 104, old_end: 104, new_start: 23, new_end: 24, old_text: '', new_text: '!' },
    { op: 'equal', old_start: 104, old_end: 105, new_start: 24, new_end: 25, old_text: 'c', new_text: 'c' },
  ] });
  expect(pendingDiffParts(value)).toEqual([{ op:'equal',text:'ab' },{op:'delete',text:'X'},{op:'insert',text:'Y'},{op:'delete',text:'Z'},{op:'insert',text:'!'},{op:'equal',text:'c'}]);
  expect(pendingDiffParts({ ...value, new_context: { ...value.new_context, text: 'wrong' } })).toBeNull();
  expect(pendingDiffParts({ ...value, diff: [{ ...value.diff[0], old_start: 99 }, ...value.diff.slice(1)] })).toBeNull();
});
it('keeps malformed contexts unavailable instead of manufacturing a highlight or diff', () => {
  const reveal = vi.fn(); render(<ReanchorPanel items={[item({ old_context: { start: 100, end: 101, text: 'corrupt' } })]} labelFor={() => null} onContext={reveal} />);
  expect(screen.getByText('Old context is unavailable.')).toBeTruthy();
  expect(screen.getByText('Text changes are unavailable.')).toBeTruthy();
});

it('keeps overlapping cues and discontiguous mentions at nonzero absolute context bases',()=>{
  const value=item({old_context:{start:50,end:57,text:'A😀BCDEF'},old_mentions:[
    {source_ref:{evidence_id:'one',version:'v'},segments:[{start:51,end:54,text:'😀BC'},{start:55,end:57,text:'EF'}],cue_segments:[{start:52,end:55,text:'BCD'}]},
    {source_ref:{evidence_id:'two',version:'v'},segments:[],cue_segments:[{start:50,end:51,text:'A'}]},
  ]});
  const mounted=render(<ReanchorPanel items={[value]} labelFor={()=>null} onContext={()=>{}}/>);
  expect(mounted.container.querySelector('[data-old-context]')?.textContent).toBe('A😀BCDEF');
  expect(mounted.container.querySelector('[data-old-kind="mention cue"]')?.textContent).toBe('BC');
  expect([...mounted.container.querySelectorAll('[data-old-kind="mention"]')].map(node=>node.textContent)).toEqual(['😀','EF']);
});

it('keeps the term ID beside the resolved label and provides a native collapsible pending section',()=>{
  const mounted=render(<ReanchorPanel items={[item()]} labelFor={()=> 'Finding'} onContext={()=>{}}/>);
  expect(screen.getByRole('button',{name:'Finding (HP:1) · hpo'})).toBeTruthy();
  const details=mounted.container.querySelector('details')!;
  expect(details.open).toBe(true);
  fireEvent.click(mounted.container.querySelector('summary')!);
  expect(details.open).toBe(false);
});

it('shows unknown reason codes literally and never resolves inherited object keys',()=>{
  const unknown=(reason:string)=>item({reason:reason as ReturnType<typeof item>['reason']});
  const mounted=render(<ReanchorPanel items={[item(),unknown('<img src=x onerror=alert(1)>'),unknown('toString'),unknown('__proto__')]} labelFor={()=>null} onContext={()=>{}}/>);
  expect(screen.getByRole('heading',{name:'Needs review after the text change (4)'})).toBeTruthy();
  expect(screen.getByText('The evidence text changed.')).toBeTruthy();
  expect(screen.getByText('Unknown reason: <img src=x onerror=alert(1)>')).toBeTruthy();
  expect(screen.getByText('Unknown reason: toString')).toBeTruthy();
  expect(screen.getByText('Unknown reason: __proto__')).toBeTruthy();
  expect(mounted.container.querySelector('img')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(4);
});
