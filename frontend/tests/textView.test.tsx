import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type TextLayerEntry, type VersionRef } from '../src/api/client';
import { routeHref } from '../src/app/router';
import { refKey } from '../src/variants/versionState';
import { caseDetail, historical, ownRef, variant } from './variantFixtures';

const created_at = '2026-10-21T16:44:00Z';
const proposalsRef: VersionRef = { kind: 'proposals', id: '7', label: 'Tool proposals', created_at };
const tomRef: VersionRef = { kind: 'submission', id: 'sub-tom', label: 'Tom', created_at };
const leadLayers: TextLayerEntry[] = [
  { kind: 'proposals', ref: proposalsRef, label: 'Tool proposals (3)', count: 3, available: true },
  { kind: 'submission', ref: tomRef, label: 'Tom Reis, submitted 21 Oct', state: 'submitted', count: 1, available: true },
  { kind: 'person', ref: null, label: 'Mia Berg, in progress', state: 'in_progress', available: false, reason: 'Not submitted yet.' },
  { kind: 'final', ref: null, label: 'Final result', state: 'not_accepted', available: false, reason: 'Not accepted yet.' },
];
const annotatorLayers: TextLayerEntry[] = [
  { kind: 'proposals', ref: null, label: 'Tool proposals (3)', count: 3, available: false, reason: 'Hidden while you annotate from scratch.' },
  { kind: 'own', ref: ownRef, label: ownRef.label, state: 'submitted', count: 1, available: true },
];

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(api, 'listProjects').mockResolvedValue([{ project_key: 'pkg', roles: ['lead'], can_manage: true } as any]);
  vi.spyOn(api, 'getCase').mockResolvedValue({ ...caseDetail, variants: [...caseDetail.variants,
    variant('corrected', { version: 2, origin: 'correction', derived_from: 'target' })] });
  vi.spyOn(api, 'getVariantText').mockImplementation(async (_project, doc) => ({ document_id: doc, text: `Immutable ${doc}`, text_sha256: 'text' }));
  vi.spyOn(api, 'listTextLayers').mockResolvedValue(leadLayers);
  vi.spyOn(api, 'listAnnotationVersions').mockResolvedValue([]);
  vi.spyOn(api, 'getAnnotationVersion').mockResolvedValue(historical);
  vi.spyOn(api, 'listMyTasks').mockResolvedValue([]);
  vi.spyOn(api, 'resolveTermLabels').mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const props = { projectKey: 'pkg', caseId: caseDetail.case_id, variant: 'target', username: 'alice', onNavigate: vi.fn() };
const options = (select: HTMLElement) => [...(select as HTMLSelectElement).options].map(option => option.text);
const viewer = async (extra: Record<string, unknown> = {}) => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const mounted = render(<CaseViewer {...props} {...extra} />);
  await screen.findByText('Immutable target');
  await waitFor(() => expect(options(within(screen.getByRole('group', { name: 'Text view' })).getByLabelText('Show')).length).toBeGreaterThan(1));
  return { CaseViewer, mounted };
};

it('one toolbar with Documents, case id, language and version, Show, Compare, Text card', async () => {
  const documents = { language: 'de', q: 'EN' };
  await viewer({ documents });
  const toolbar = screen.getByRole('group', { name: 'Text view' });
  expect(within(toolbar).getByRole('link', { name: 'Documents' }).getAttribute('href')).toBe(routeHref({ name: 'projectDocuments', key: 'pkg', ...documents }));
  expect(within(toolbar).getByRole('heading', { level: 1 }).textContent).toBe(caseDetail.case_id);
  expect(within(toolbar).getByRole('combobox', { name: 'Language and version' })).toBeTruthy();
  expect(within(toolbar).getByRole('combobox', { name: 'Show' })).toBeTruthy();
  expect(within(toolbar).getByRole('button', { name: 'Compare' })).toBeTruthy();
  expect(within(toolbar).getByRole('link', { name: 'Text card' }).getAttribute('href'))
    .toBe(routeHref({ name: 'projectDocuments', key: 'pkg', ...documents, panel: `${caseDetail.case_id}:de` }));
  expect(screen.queryByText('Versions')).toBeNull();
  expect(toolbar.textContent).not.toContain('·');
});

it('the version select lists source and newer versions with origin words', async () => {
  await viewer();
  const select = screen.getByLabelText<HTMLSelectElement>('Language and version');
  expect(options(select)).toEqual(['en, version 1 (source text)', 'de, version 1 (machine translation) other-run',
    'de, version 1 (machine translation) target', 'de, version 2 (corrected)']);
  expect(select.value).toBe('target');
  fireEvent.change(select, { target: { value: 'corrected' } });
  expect(props.onNavigate).toHaveBeenLastCalledWith({ name: 'projectCase', key: 'pkg', caseId: caseDetail.case_id, variant: 'corrected', show: 'text' });
});

it('Show lists proposals, people, result with unavailable entries greyed and their reason', async () => {
  await viewer();
  const select = screen.getByLabelText<HTMLSelectElement>('Show');
  expect([...select.querySelectorAll('optgroup')].map(group => group.label)).toEqual(['Text', 'Proposals', 'Annotations', 'Result']);
  expect(options(select)).toEqual(['Text only', 'Tool proposals (3)', 'Tom Reis, submitted 21 Oct',
    'Mia Berg, in progress (not submitted yet)', 'Final result (not accepted yet)']);
  const disabled = [...select.options].filter(option => option.disabled).map(option => option.text);
  expect(disabled).toEqual(['Mia Berg, in progress (not submitted yet)', 'Final result (not accepted yet)']);
  expect(api.listTextLayers).toHaveBeenCalledWith('pkg', 'target');
});

it("an annotator's Show list has no entries for other people", async () => {
  vi.mocked(api.listProjects).mockResolvedValue([{ project_key: 'pkg', roles: ['annotator'], can_manage: false } as any]);
  vi.mocked(api.listTextLayers).mockResolvedValue(annotatorLayers);
  await viewer();
  const select = screen.getByLabelText<HTMLSelectElement>('Show');
  expect(options(select)).toEqual(['Text only', 'Tool proposals (3) (hidden while you annotate from scratch)', ownRef.label]);
  expect(select.textContent).not.toMatch(/Tom|Mia/);
  expect(api.listAnnotationVersions).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
});

it('choosing a layer draws its marks and lists its findings with axis colours', async () => {
  const { CaseViewer, mounted } = await viewer();
  fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'submission:sub-tom' } });
  expect(props.onNavigate).toHaveBeenLastCalledWith({ name: 'projectCase', key: 'pkg', caseId: caseDetail.case_id, variant: 'target', show: 'submission:sub-tom' });
  mounted.rerender(<CaseViewer {...props} show="submission:sub-tom" />);
  const findings = await screen.findByRole('region', { name: 'Findings' });
  expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'submission', 'sub-tom');
  expect(within(findings).getByRole('heading', { name: 'Tom Reis, submitted 21 Oct' })).toBeTruthy();
  expect(within(findings).getByText('HP:old')).toBeTruthy();
  expect(within(findings).getByText('Present').className).toContain('axis-value--present');
  expect(screen.getByLabelText<HTMLSelectElement>('Show').value).toBe('submission:sub-tom');
});

it('lists the first 20 findings and reveals the rest on request', async () => {
  const many = Array.from({ length: 23 }, (_, index) => ({ ...historical.annotations[0],
    annotation: { ...historical.annotations[0].annotation, annotation_id: `a${index}`, term_id: `HP:${index}` } }));
  vi.mocked(api.getAnnotationVersion).mockResolvedValue({ ...historical, annotations: many });
  await viewer({ show: 'proposals' });
  const findings = await screen.findByRole('region', { name: 'Findings' });
  await waitFor(() => expect(within(findings).getAllByRole('listitem')).toHaveLength(20));
  fireEvent.click(within(findings).getByRole('button', { name: '3 more…' }));
  expect(within(findings).getAllByRole('listitem')).toHaveLength(23);
});

it('Compare opens a second column with its own selects', async () => {
  await viewer();
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  const panel = await screen.findByRole('region', { name: 'Comparison' });
  await within(panel).findByText('Immutable source');
  expect(within(panel).getByRole('combobox', { name: 'Language and version' })).toBeTruthy();
  expect(within(panel).getByRole('combobox', { name: 'Show' })).toBeTruthy();
  await waitFor(() => expect(api.listTextLayers).toHaveBeenCalledWith('pkg', 'source'));
  fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
  expect(screen.queryByRole('region', { name: 'Comparison' })).toBeNull();
});

it('opens a deep-linked comparison from compare and compare_show', async () => {
  await viewer({ compare: 'target', compareShow: 'submission:sub-tom' });
  const panel = await screen.findByRole('region', { name: 'Comparison' });
  await waitFor(() => expect(within(panel).getByLabelText<HTMLSelectElement>('Show').value).toBe('submission:sub-tom'));
  await waitFor(() => expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'submission', 'sub-tom'));
  expect(within(panel).getByLabelText<HTMLSelectElement>('Language and version').value).toBe('target');
});

it('nothing is editable', async () => {
  await viewer({ show: 'submission:sub-tom' });
  await screen.findByRole('region', { name: 'Findings' });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /Save|Delete|Remove/ })).toBeNull();
});

it('legacy annotations= links map to show', async () => {
  vi.mocked(api.listTextLayers).mockResolvedValue([...leadLayers, { kind: 'own', ref: ownRef, label: ownRef.label, state: 'submitted', available: true }]);
  await viewer({ annotations: refKey(ownRef) });
  await waitFor(() => expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'own', ownRef.id));
  expect(screen.getByLabelText<HTMLSelectElement>('Show').value).toBe(`own:${ownRef.id}`);
});

it('the language is plain text with a flag, not a link', async () => {
  await viewer();
  const toolbar = screen.getByRole('group', { name: 'Text view' });
  const language = within(toolbar).getByText('de', { selector: '.language-tag' });
  expect(language.closest('a')).toBeNull();
  expect(toolbar.querySelector('.language-flag')).toBeTruthy();
});

it('a text with an accepted final opens on it and lists modifiers, the note and "No text span" (R-4)', async () => {
  const finalRef: VersionRef = { kind: 'final', id: 'sel-1', label: 'Final result, accepted 27 Oct', created_at };
  vi.mocked(api.listTextLayers).mockResolvedValue([...leadLayers.slice(0, 3), { kind: 'final', ref: finalRef, label: finalRef.label, state: 'accepted', available: true }]);
  const base = historical.annotations[0];
  vi.mocked(api.getAnnotationVersion).mockResolvedValue({ ...historical, annotations: [{ ...base, annotation: { ...base.annotation,
    modifiers: [{ term_id: 'HP:0012825', segments: [{ start: 0, end: 9 }] }], note: 'Mentioned by the nurse.' } }] });
  vi.mocked(api.resolveTermLabels).mockResolvedValue([{ layer_id: 'phenotype', term_id: 'HP:0012825', label: 'Mild' } as never]);
  await viewer();
  const findings = await screen.findByRole('region', { name: 'Findings' });
  expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'final', 'sel-1');
  expect(screen.getByLabelText<HTMLSelectElement>('Show').value).toBe('final:sel-1');
  await waitFor(() => expect(within(findings).getByText('Modifiers: Mild · “Immutable”')).toBeTruthy());
  expect(within(findings).getByText('No text span')).toBeTruthy();
  expect(within(findings).getByText('Note: Mentioned by the nurse.')).toBeTruthy();
});

it('an explicit "Text only" stays on the text even with a final result', async () => {
  const finalRef: VersionRef = { kind: 'final', id: 'sel-1', label: 'Final result, accepted 27 Oct', created_at };
  vi.mocked(api.listTextLayers).mockResolvedValue([...leadLayers.slice(0, 3), { kind: 'final', ref: finalRef, label: finalRef.label, state: 'accepted', available: true }]);
  await viewer({ show: 'text' });
  expect(screen.getByLabelText<HTMLSelectElement>('Show').value).toBe('text');
  expect(api.getAnnotationVersion).not.toHaveBeenCalled();
});

it('closing a deep-linked comparison keeps an explicit "Text only"', async () => {
  await viewer({ show: 'text', compare: 'target' });
  fireEvent.click(await screen.findByRole('button', { name: 'Close comparison' }));
  expect(props.onNavigate).toHaveBeenLastCalledWith({ name: 'projectCase', key: 'pkg', caseId: caseDetail.case_id, variant: 'target', show: 'text' });
});
