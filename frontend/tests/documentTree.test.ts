import { describe, expect, it } from 'vitest';
import { buildDocumentTree } from '../src/variants/documentTree';
import { variant } from './variantFixtures';

describe('logical text inventory', () => {
  it('groups a logical text once, separates languages and independent translation runs, and preserves correction ancestry', () => {
    const inventory = [{ case_id: 'GSC17', variants: [
      variant('original', { case_id: 'GSC17', origin: 'native', language: 'en', derived_from: null }),
      variant('run-a', { case_id: 'GSC17', derived_from: 'original' }),
      variant('run-b', { case_id: 'GSC17', derived_from: 'original' }),
      variant('fixed-a', { case_id: 'GSC17', origin: 'correction', derived_from: 'run-a', version: 2 }),
    ] }];
    const tree = buildDocumentTree(inventory, new Set(['fixed-a', 'run-b']));
    expect(tree).toHaveLength(1);
    expect(tree[0].caseId).toBe('GSC17');
    expect(tree[0].languages.map(row => row.language)).toEqual(['de']);
    const roots = tree[0].languages[0].roots;
    expect(roots.map(row => row.variant.document_id)).toEqual(['run-a', 'run-b']);
    expect(roots[0].matching).toBe(false);
    expect(roots[0].children[0]).toMatchObject({ matching: true, variant: { document_id: 'fixed-a' } });
    expect(roots[1].variant.derived_from).toBe('original');
  });

  it('keeps imported non-correction v2 separate and marks missing, cross-case and cyclic parents without inventing access', () => {
    const rows = [
      variant('imported', { origin: 'native', version: 2, derived_from: 'missing' }),
      variant('missing-parent', { origin: 'correction', derived_from: 'secret' }),
      variant('cycle-a', { origin: 'correction', derived_from: 'cycle-b' }),
      variant('cycle-b', { origin: 'correction', derived_from: 'cycle-a' }),
      variant('wrong-case', { origin: 'correction', derived_from: 'foreign' }),
      variant('foreign', { case_id: 'another-case' }),
    ];
    const roots = buildDocumentTree([{ case_id: 'EN 1/7', variants: rows }], new Set(rows.map(row => row.document_id)))[0].languages[0].roots;
    expect(roots.map(row => row.variant.document_id)).not.toContain('foreign');
    expect(roots.find(row => row.variant.document_id === 'imported')?.issue).toBeNull();
    expect(roots.find(row => row.variant.document_id === 'missing-parent')?.issue).toBe('Earlier version unavailable');
    expect(roots.find(row => row.variant.document_id === 'wrong-case')?.issue).toBe('Earlier version unavailable');
    expect(roots.filter(row => row.issue === 'Correction ancestry unavailable')).toHaveLength(2);
    expect(roots.every(row => row.children.length === 0)).toBe(true);
  });

  it('retains only branches with an explicit filtered document match, including historical-only matches', () => {
    const rows = [variant('old'), variant('new', { origin: 'correction', version: 2, derived_from: 'old' })];
    const roots = buildDocumentTree([{ case_id: 'EN 1/7', variants: rows }], new Set(['old']))[0].languages[0].roots;
    expect(roots).toHaveLength(1);
    expect(roots[0].variant.document_id).toBe('old');
    expect(roots[0].children).toEqual([]);
    expect(buildDocumentTree([{ case_id: 'EN 1/7', variants: rows }], new Set(['unauthorized']))).toEqual([]);
  });
});
