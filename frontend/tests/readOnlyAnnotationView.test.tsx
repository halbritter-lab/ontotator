import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ReadOnlyAnnotationView } from '../src/variants/ReadOnlyAnnotationView';
import { historical } from './variantFixtures';

afterEach(cleanup);
it('preserves exact evidence versions, discontinuous Unicode spans and cue segments without resize controls', () => {
  const annotation = structuredClone(historical.annotations[0]);
  annotation.annotation.evidence_refs = [{ evidence_id: 'same', version: 'right' }];
  const evidence = { document_id: 'target', text_sha256: 'text', version: 'right', mention: {
    evidence_id: 'same', segments: [{ start: 1, end: 2 }, { start: 4, end: 5 }], cue_segments: [{ start: 2, end: 3 }],
  } };
  annotation.evidence = [evidence];
  render(<ReadOnlyAnnotationView text="A😃CDEF" annotations={[annotation]} evidence={[{ ...evidence, version: 'wrong', mention: { ...evidence.mention, segments: [{ start: 0, end: 1 }] } }]}
    labelFor={() => 'A finding'} />);
  const marked = Array.from(document.querySelectorAll('.run--marked')).map(node => node.textContent);
  expect(marked).toEqual(['😃', 'C', 'E']);
  expect(document.querySelector('.resize-handle')).toBeNull();
  expect(screen.getByText('assertion: present (defaulted)')).toBeTruthy();
  expect(screen.getByText('A finding')).toBeTruthy();
});
it('uses the current annotation actor for AI authorship and retains spanless metadata', () => {
  const human = structuredClone(historical.annotations[0]);
  human.annotation.provenance.source_refs = ['urn:annotation:tool-parent:parent'];
  const tool = structuredClone(human);
  tool.annotation.annotation_id = 'tool'; tool.version = 'tool-version';
  tool.annotation.provenance.actor = { kind: 'tool', actor_id: 'actual-tool' };
  render(<ReadOnlyAnnotationView text="Text" annotations={[human, tool]} evidence={[]} labelFor={() => null} />);
  expect(screen.getAllByText('AI')).toHaveLength(1);
  expect(screen.getAllByText('Spanless')).toHaveLength(2);
});
