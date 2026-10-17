import type { ReanchorItem } from '../src/api/client';
export function item(changes: Partial<ReanchorItem> = {}): ReanchorItem {
  const old = '😀old <b>x</b>', next = '😀new <b>x</b>';
  return { proposal_set_id: 4, source_ref: { annotation_id: 'source/1', version: 'v1' }, term_id: 'HP:1', layer_id: 'hpo', type_id:'default', reason: 'changed_segment',
    old_context: { start: 100, end: 100 + Array.from(old).length, text: old }, new_context: { start: 20, end: 20 + Array.from(next).length, text: next },
    old_mentions: [{ source_ref: { evidence_id: 'ev', version: 'e1' }, segments: [{ start: 100, end: 101, text: '😀' }], cue_segments: [{ start: 102, end: 104, text: 'ld' }] }],
    old_segments: [], diff: [{ op: 'replace', old_start: 100, old_end: 100 + Array.from(old).length, new_start: 20, new_end: 20 + Array.from(next).length, old_text: old, new_text: next }], ...changes };
}
