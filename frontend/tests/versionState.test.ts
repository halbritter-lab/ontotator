// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { components } from '../src/api/generated';
import { annotationOptions, languagesOf, pickVariant, refForKey, refKey, versionsOf } from '../src/variants/versionState';

type Variant = components['schemas']['VariantSummary'];
type Ref = components['schemas']['VersionRef'];
const variant = (document_id: string, language: string, version: number, changes: Partial<Variant> = {}): Variant => ({
  document_id, case_id: 'case', external_id: document_id, language, version,
  origin: 'native', derived_from: null, translation: null, translation_status: null,
  status_reason: null, text_sha256: 'a'.repeat(64), assigned_to_me: false, ...changes,
});
const detail = (...variants: Variant[]) => ({ case_id: 'case', variants });
const reference = (kind: Ref['kind'], id: string, label = id): Ref => ({
  kind, id, label, created_at: '2026-10-16T00:00:00Z',
});

describe('language and immutable variant identity', () => {
  it('uses the explicit current document language before lexical alternatives', () => {
    const data = detail(variant('first', 'en', 1), variant('current', 'fr', 1), variant('de', 'de', 1), variant('en2', 'en', 2));
    expect(languagesOf(data, 'current')).toEqual(['fr', 'de', 'en']);
    expect(languagesOf(data)).toEqual(['de', 'en', 'fr']);
    expect(languagesOf(data, 'missing')).toEqual(['de', 'en', 'fr']);
    expect(languagesOf(detail())).toEqual([]);
  });

  it('sorts numeric versions and deterministic external/internal IDs without mutating frozen metadata', () => {
    const data = detail(
      variant('b', 'de', 2, { external_id: 'z' }), variant('v10', 'de', 10),
      variant('c', 'de', 2, { external_id: 'a' }), variant('a', 'de', 2, { external_id: 'a' }),
      variant('other', 'en', 99),
    );
    const before = structuredClone(data);
    for (const row of data.variants) Object.freeze(row);
    Object.freeze(data.variants);
    Object.freeze(data);
    expect(versionsOf(data, 'de').map(row => row.documentId)).toEqual(['v10', 'a', 'c', 'b']);
    languagesOf(data, 'c');
    pickVariant(data, 'de');
    expect(data).toEqual(before);
  });

  it.each([
    ['native', 'native'], ['machine_translation', 'machine translation'],
    ['human_translation', 'human translation'], ['correction', 'corrected'],
  ] as const)('labels %s with its actual status', (origin, label) => {
    const [option] = versionsOf(detail(variant('id', 'de', 2, { origin, translation_status: 'ready_for_review' })), 'de');
    expect(option).toMatchObject({ documentId: 'id', version: 2, origin, status: 'ready_for_review' });
    expect(option.label).toBe(`v2 · ${label} · ready for review`);
  });

  it('distinguishes equal-version runs with external IDs and internal IDs where still needed', () => {
    const data = detail(variant('internal/one', 'de', 1, { external_id: 'engine' }), variant('internal/two', 'de', 1, { external_id: 'engine' }), variant('third', 'de', 1, { external_id: 'other engine' }));
    const options = versionsOf(data, 'de');
    expect(new Set(options.map(row => row.label)).size).toBe(3);
    expect(options.find(row => row.documentId === 'internal/one')?.label).toContain('engine');
    expect(options.find(row => row.documentId === 'internal/one')?.label).toContain('internal/one');
    expect(options.find(row => row.documentId === 'third')?.label).toContain('other engine');
  });

  it('keeps labels distinct when an opaque external ID imitates an internal-ID suffix', () => {
    const data = detail(...[
      ['one', 'engine'], ['two', 'engine'], ['three', 'engine (one)'],
    ].map(([id, external_id]) => variant(id, 'de', 1, {
      external_id, origin: 'machine_translation', translation_status: 'accepted',
    })));
    const options = versionsOf(data, 'de');
    expect(new Set(options.map(row => row.label)).size).toBe(3);
    expect(options.map(row => row.documentId)).toEqual(['one', 'two', 'three']);
    expect(options[0].label).toContain('engine (one)');
    expect(options[2].label).toContain('engine (one)');
  });

  it('prefers newest accepted only for a default, retaining an explicitly requested version', () => {
    const data = detail(variant('v1', 'de', 1, { translation_status: 'accepted' }), variant('v10', 'de', 10), variant('v2', 'de', 2, { translation_status: 'accepted' }));
    expect(pickVariant(data, 'de')).toBe('v2');
    expect(pickVariant(data, 'de', 10)).toBe('v10');
    expect(pickVariant(data, 'de', 1)).toBe('v1');
    expect(pickVariant(detail(variant('v2', 'de', 2), variant('v10', 'de', 10)), 'de')).toBe('v10');
  });

  it('uses the same deterministic equal-version tie and exposes every selectable internal ID', () => {
    const data = detail(variant('selected /#%~de~v1', 'de', 1, { external_id: 'z' }), variant('default', 'de', 1, { external_id: 'a' }));
    expect(pickVariant(data, 'de', 1)).toBe('default');
    expect(versionsOf(data, 'de').map(row => row.documentId)).toEqual(['default', 'selected /#%~de~v1']);
  });

  it.each([0, 3, NaN, Infinity])('never substitutes another version for %s', version => {
    expect(pickVariant(detail(variant('v2', 'de', 2)), 'de', version)).toBeNull();
  });

  it('returns no selection for unavailable language or empty metadata', () => {
    const data = detail(variant('v1', 'de', 1));
    expect(pickVariant(data, 'en')).toBeNull();
    expect(pickVariant(data, '')).toBeNull();
    expect(pickVariant(detail(), 'de')).toBeNull();
    expect(versionsOf(data, 'en')).toEqual([]);
  });

  it('does not treat an empty language as a usable selection', () => {
    expect(pickVariant(detail(variant('missing-language', '', 1)), '')).toBeNull();
  });
});

describe('current server-offered annotation references', () => {
  it('adds a draft only when actually present and preserves server ref order', () => {
    const refs = Object.freeze([Object.freeze(reference('proposals', 'newer', 'Tool')), Object.freeze(reference('own', 'older', 'Own'))]);
    expect(annotationOptions(refs, false).map(option => option.value)).toEqual(refs.map(refKey));
    const options = annotationOptions(refs, true);
    expect(options[0]).toEqual({ kind: 'draft', value: 'draft', label: 'My draft' });
    expect(options.slice(1)).toEqual(annotationOptions(refs, false));
    expect(options.slice(1).map(option => option.label)).toEqual(['Tool', 'Own']);
    expect(annotationOptions([], false)).toEqual([]);
    expect(annotationOptions([], true)).toEqual([{ kind: 'draft', value: 'draft', label: 'My draft' }]);
  });

  it('deduplicates whole tuples keeping their first offered label, never coincident IDs across kinds', () => {
    const first = reference('own', 'same', 'First');
    const refs = [first, reference('proposals', 'same', 'Other kind'), reference('own', 'same', 'Repeated')];
    expect(annotationOptions(refs, false).map(option => option.label)).toEqual(['First', 'Other kind']);
    expect(refForKey(refKey(first), refs)).toBe(first);
    expect(refKey(first)).not.toBe(refKey(refs[1]));
  });

  it.each(['draft', 'text', 'x:y/z #é?%', '["own","x"]', 'a\u0000b', 'literal%2F'])('round-trips opaque ID %j without local-token or delimiter collisions', id => {
    const ref = reference('own', id);
    const key = refKey(ref);
    expect(JSON.parse(key)).toEqual(['own', id]);
    expect(key).not.toBe('draft');
    expect(key).not.toBe('text');
    expect(refForKey(key, [ref])).toBe(ref);
  });

  it.each(['draft', 'text', '', 'null', '{}', '[]', '["own"]', '["own","id","extra"]', '["own",1]', '[1,"id"]', '"own:id"', '["unknown","id"]'])('refuses malformed/local/unavailable selection %j', key => {
    expect(refForKey(key, [reference('own', 'id')])).toBeNull();
  });

  it('revalidates the entire tuple against the current offered refs', () => {
    const old = reference('own', 'same');
    expect(refForKey(refKey(old), [])).toBeNull();
    expect(refForKey(refKey(old), [reference('proposals', 'same')])).toBeNull();
    expect(annotationOptions([reference('stage_result', 'offered'), reference('release', 'actual')], false)).toHaveLength(2);
  });
});
