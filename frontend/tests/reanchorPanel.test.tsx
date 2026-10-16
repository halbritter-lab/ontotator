import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReanchorItem } from '../src/api/client';
import { ReanchorPanel, pendingDiffParts } from '../src/variants/ReanchorPanel';

afterEach(cleanup);
export function item(changes: Partial<ReanchorItem> = {}): ReanchorItem {
  const old = '😀old <b>x</b>', next = '😀new <b>x</b>';
  return { proposal_set_id: 4, source_ref: { annotation_id: 'source/1', version: 'v1' }, term_id: 'HP:1', layer_id: 'hpo', reason: 'changed_segment',
    old_context: { start: 100, end: 100 + Array.from(old).length, text: old }, new_context: { start: 20, end: 20 + Array.from(next).length, text: next },
    old_mentions: [{ source_ref: { evidence_id: 'ev', version: 'e1' }, segments: [{ start: 100, end: 101, text: '😀' }], cue_segments: [{ start: 102, end: 104, text: 'ld' }] }],
    old_segments: [], diff: [{ op: 'replace', old_start: 100, old_end: 100 + Array.from(old).length, new_start: 20, new_end: 20 + Array.from(next).length, old_text: old, new_text: next }], ...changes };
}
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
