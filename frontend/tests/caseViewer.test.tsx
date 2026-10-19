import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client';
import { caseDetail, historical, ownRef } from './variantFixtures';
import { refKey } from '../src/variants/versionState';
import { routeHref } from '../src/app/router';

beforeEach(() => {
  vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValue({ project: 'pkg', selections: [], warnings: [], omissions: [], state_digest: 'a'.repeat(64) });
  vi.spyOn(api, 'listProjects').mockResolvedValue([{ project_key: 'pkg', roles: ['lead'], can_manage: true } as any]);
  vi.spyOn(api, 'getCase').mockResolvedValue(caseDetail);
  vi.spyOn(api, 'getVariantText').mockImplementation(async (_project, doc) => ({ document_id: doc, text: `Immutable ${doc} 😃`, text_sha256: 'text' }));
  vi.spyOn(api, 'listAnnotationVersions').mockResolvedValue([ownRef]);
  vi.spyOn(api, 'getAnnotationVersion').mockResolvedValue(historical);
  vi.spyOn(api, 'listMyTasks').mockResolvedValue([]);
  vi.spyOn(api, 'resolveTermLabels').mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const props = { projectKey: 'pkg', caseId: caseDetail.case_id, variant: 'target', username: 'alice', onNavigate: vi.fn() };

it('shows the exact selected final result while retaining the explicitly requested different text version', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  vi.mocked(api.getWorkflowWarnings).mockResolvedValue({ project: 'pkg', selections: [{ case_id: caseDetail.case_id, language: 'de', document_id: 'other-run', submission_id: 'pinned-result', revision: 4 }], warnings: [], omissions: [], state_digest: 'a'.repeat(64) });
  render(<CaseViewer {...props} />);
  await screen.findByText('Immutable target 😃');
  expect(screen.getByText('Final result uses another text version')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'View selected final text' }).getAttribute('href')).toContain('variant=other-run');
  expect(screen.queryByText('Immutable other-run 😃')).toBeNull();
  expect(api.getAnnotationVersion).not.toHaveBeenCalled();
});

it('returns directly to Documents with the original authorized project and filters', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const onNavigate = vi.fn();
  render(<CaseViewer {...props} onNavigate={onNavigate} documents={{ language: 'de', status: 'submitted', q: 'GSC17' }} />);
  await screen.findByText('Immutable target 😃');
  fireEvent.click(screen.getByRole('link', { name: 'Back to Documents' }));
  expect(onNavigate).toHaveBeenCalledWith({ name: 'projectDocuments', key: 'pkg', language: 'de', status: 'submitted', q: 'GSC17' });
});

it('reads immutable text without opening work and keeps Text only useful when refs are denied', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  vi.mocked(api.listAnnotationVersions).mockRejectedValue(new ApiError(404, 'Denied', 'VERSION_NOT_FOUND'));
  const open = vi.spyOn(api, 'openAssignment'), metadata = vi.spyOn(api, 'getVariantMetadata');
  render(<CaseViewer {...props} />);
  await screen.findByText('Immutable target 😃');
  expect(screen.getByText('Machine translation · accepted')).toBeTruthy();
  expect((screen.getByLabelText('Annotations') as HTMLSelectElement).value).toBe('text');
  expect(open).not.toHaveBeenCalled(); expect(metadata).not.toHaveBeenCalled();
  expect(api.getAnnotationVersion).not.toHaveBeenCalled();
});
it('renders only the offered exact snapshot and real supported task IDs', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  vi.mocked(api.listMyTasks).mockResolvedValue([
    { assignment_id: 99, workflow_revision: 0, held: false, project_key: 'pkg', project_name: 'P', document_id: 'target', language: 'de', task: 'translation_review', status: 'open', updated_at: '' },
    { assignment_id: 7, workflow_revision: 0, held: false, project_key: 'pkg', project_name: 'P', document_id: 'target', language: 'de', task: 'annotate', status: 'submitted', updated_at: '' },
    { assignment_id: 8, workflow_revision: 0, held: false, project_key: 'foreign', project_name: 'P', document_id: 'target', language: 'de', task: 'review', status: 'open', updated_at: '' },
  ]);
  render(<CaseViewer {...props} annotations={refKey(ownRef)} />);
  await screen.findByText('HP:old');
  expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'own', ownRef.id);
  expect(screen.getByText('assertion: present (defaulted)')).toBeTruthy();
  const translationTask = screen.getByRole('link', { name: 'Open my translation review task' });
  expect(translationTask.getAttribute('href')).toBe('#/tasks/99');
  fireEvent.click(translationTask);
  expect(props.onNavigate).toHaveBeenCalledWith({ name: 'task', assignmentId: 99 });
  fireEvent.click(screen.getByRole('link', { name: 'Open my annotation task' }));
  expect(props.onNavigate).toHaveBeenCalledWith({ name: 'task', assignmentId: 7 });
  expect(screen.queryByRole('link', { name: 'Open my review task' })).toBeNull();
  expect(screen.queryByText('Back to my draft')).toBeNull();
});
it('does not fetch a forged variant or ref and conceals unavailable cases', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const mounted = render(<CaseViewer {...props} variant="foreign" />);
  await screen.findByText('This text version is not available to you.');
  expect(api.getVariantText).not.toHaveBeenCalled();
  mounted.rerender(<CaseViewer {...props} annotations='["own","foreign"]' />);
  await screen.findByText('This annotation version is not available to you.');
  expect(api.getAnnotationVersion).not.toHaveBeenCalled();
  vi.mocked(api.getCase).mockRejectedValue(new ApiError(404, 'missing', 'CASE_NOT_FOUND'));
  mounted.rerender(<CaseViewer {...props} caseId="missing" />);
  await screen.findByText('This case is not available to you.');
  expect(screen.queryByText('Immutable target 😃')).toBeNull();
});
it('drops protected text and late replies on variant and user replacement', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  let finish!: (value: Awaited<ReturnType<typeof api.getVariantText>>) => void;
  vi.mocked(api.getVariantText).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const mounted = render(<CaseViewer {...props} />);
  await waitFor(() => expect(api.getVariantText).toHaveBeenCalled());
  mounted.rerender(<CaseViewer {...props} variant="source" username="bob" />);
  await screen.findByText('Immutable source 😃');
  await act(async () => finish({ document_id: 'target', text: 'STALE PRIVATE', text_sha256: 'text' }));
  expect(screen.queryByText('STALE PRIVATE')).toBeNull();
});
it('does not revive a previous snapshot while reselecting it waits for fresh authority', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const mounted = render(<CaseViewer {...props} annotations={refKey(ownRef)} />);
  await screen.findByText('HP:old');
  mounted.rerender(<CaseViewer {...props} annotations="text" />);
  expect(screen.queryByText('HP:old')).toBeNull();
  let refuse!: (error: unknown) => void;
  vi.mocked(api.getAnnotationVersion).mockImplementationOnce(() => new Promise((_resolve, reject) => { refuse = reject; }));
  mounted.rerender(<CaseViewer {...props} annotations={refKey(ownRef)} />);
  await waitFor(() => expect(api.getAnnotationVersion).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('HP:old')).toBeNull();
  await act(async () => refuse(new ApiError(404, 'No longer offered', 'VERSION_NOT_FOUND')));
  expect(screen.queryByText('HP:old')).toBeNull();
  expect(screen.getByText('Immutable target 😃')).toBeTruthy();
});
it('labels correction-run checks as inherited from the actual translation ancestor', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const { variant } = await import('./variantFixtures');
  vi.mocked(api.getCase).mockResolvedValue({ ...caseDetail, variants: [caseDetail.variants[0],
    variant('translation', { translation: { provider: 'Test provider', model: 'Model', run_id: 'run-7', checks: [{ code: 'numbers', passed: false }] } }),
    variant('correction', { origin: 'correction', version: 3, derived_from: 'translation', translation: null }),
  ] });
  render(<CaseViewer {...props} variant="correction" />);
  await screen.findByText('Immutable correction 😃');
  fireEvent.click(screen.getByText('Translation details'));
  expect(screen.getByRole('heading', { name: 'Source' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Translation' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy();
  expect(screen.getByText('Inherited translation-run checks')).toBeTruthy();
  expect(screen.getByText('Test provider')).toBeTruthy();
  expect(screen.getByText('numbers: failed')).toBeTruthy();
  expect(screen.getByText('source · en · v1')).toBeTruthy();
});
it('clears task-list failure after a successful explicit retry', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  vi.mocked(api.listMyTasks).mockRejectedValueOnce(new ApiError(503, 'Task list offline'));
  render(<CaseViewer {...props} />);
  await screen.findByText('Task list offline');
  vi.mocked(api.listMyTasks).mockResolvedValue([{ assignment_id: 7, workflow_revision: 0, held: false, project_key: 'pkg', project_name: 'P', document_id: 'target',
    language: 'de', task: 'annotate', status: 'open', updated_at: '' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('link', { name: 'Open my task' });
  expect(screen.queryByText('Task list offline')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it('opens independent comparison alongside the actual viewer without replacing left content or opening a task', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const open = vi.spyOn(api, 'openAssignment');
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const mounted = render(<CaseViewer {...props} annotations={refKey(ownRef)} />);
  await screen.findByText('HP:old');
  const left = mounted.container.querySelector('.text-container');
  const compare = screen.getByRole('button', { name: 'Compare' });
  fireEvent.click(compare);
  await screen.findByText('Immutable source 😃');
  const toolbar = screen.getByRole('toolbar', { name: 'Comparison controls' });
  const leftIdentity = screen.getByRole('group', { name: 'Current text identity' });
  const rightIdentity = screen.getByRole('group', { name: 'Comparison text identity' });
  expect(within(leftIdentity).getByRole('heading', { name: 'Current text' })).toBeTruthy();
  expect(within(rightIdentity).getByRole('heading', { name: 'Comparison text' })).toBeTruthy();
  expect(toolbar.closest('.comparison-reading')).toBe(mounted.container.querySelector('.comparison-reading'));
  expect(toolbar.closest('.compare-pane')).toBeNull();
  expect(within(toolbar).getByRole('checkbox', { name: 'Couple scrolling' })).toBeTruthy();
  expect(within(leftIdentity).getAllByRole('combobox')).toHaveLength(3);
  expect(within(rightIdentity).getAllByRole('combobox')).toHaveLength(3);
  expect(mounted.container.querySelector('.comparison-reading > .viewer-left-controls .variant-selectors')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Comparison' }).querySelector('.compare-controls .variant-selectors')).toBeTruthy();
  expect(mounted.container.querySelector('.text-container')).toBe(left);
  expect(screen.getByText('HP:old')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
  expect(mounted.container.querySelector('.text-container')).toBe(left);
  expect(document.activeElement).toBe(compare);
  vi.unstubAllGlobals();
});

it('retains comparison owner, explicit choices and coupling-off through actual deferred viewer Retry', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(api.listMyTasks).mockRejectedValueOnce(new ApiError(503, 'Task list offline'));
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const mounted = render(<CaseViewer {...props} />);
  await screen.findByText('Task list offline');
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  await screen.findByText('Immutable source 😃');
  const panel = screen.getByRole('region', { name: 'Comparison' });
  fireEvent.change(within(panel).getByLabelText('Language'), { target: { value: 'de' } });
  await within(panel).findByText('Immutable other-run 😃');
  fireEvent.change(within(panel).getByLabelText('Annotations'), { target: { value: refKey(ownRef) } });
  await within(panel).findByText('HP:old');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Couple scrolling' }));
  let finishCase!: (value: typeof caseDetail) => void;
  let finishLeft!: (value: Awaited<ReturnType<typeof api.getVariantText>>) => void;
  vi.mocked(api.getCase).mockImplementationOnce(() => new Promise(resolve => { finishCase = resolve; }));
  vi.mocked(api.getVariantText).mockImplementation((_project, doc) => doc === 'target' ? new Promise(resolve => { finishLeft = resolve; })
    : Promise.resolve({ document_id: doc, text: `Immutable ${doc} 😃`, text_sha256: 'text' }));
  const priorGets = vi.mocked(api.getAnnotationVersion).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByRole('region', { name: 'Comparison' })).toBe(panel);
  expect(within(panel).queryByText('HP:old')).toBeNull();
  expect(within(panel).queryByText('Immutable other-run 😃')).toBeNull();
  expect(within(panel).getByLabelText<HTMLSelectElement>('Text version').value).toBe('other-run');
  expect(within(panel).getByLabelText<HTMLSelectElement>('Annotations').value).toBe(refKey(ownRef));
  expect((screen.getByRole('checkbox', { name: 'Couple scrolling' }) as HTMLInputElement).checked).toBe(false);
  await act(async () => finishCase({ ...caseDetail }));
  expect(within(panel).queryByText('HP:old')).toBeNull();
  await act(async () => finishLeft({ document_id: 'target', text: 'Fresh left text', text_sha256: 'text' }));
  await within(panel).findByText('HP:old');
  expect(api.getAnnotationVersion).toHaveBeenCalledTimes(priorGets + 1);
  expect(within(panel).getByLabelText<HTMLSelectElement>('Text version').value).toBe('other-run');
  expect((screen.getByRole('checkbox', { name: 'Couple scrolling' }) as HTMLInputElement).checked).toBe(false);
  await act(async () => mounted.rerender(<CaseViewer {...props} username="bob" />));
  expect(screen.queryByRole('region', { name: 'Comparison' })).toBeNull();
  expect(screen.queryByText('HP:old')).toBeNull();
});


it('restricts ordinary annotators to text without generic browsing or forbidden deep-link payloads', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  vi.mocked(api.listProjects).mockResolvedValue([{ project_key: 'pkg', roles: ['annotator'], can_manage: false } as any]);
  const mounted = render(<CaseViewer {...props} />);
  await screen.findByText(/Immutable target/);
  expect(screen.queryByText('Versions')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
  expect(api.listAnnotationVersions).not.toHaveBeenCalled();
  mounted.rerender(<CaseViewer {...props} annotations={refKey({ kind: 'submission', id: ownRef.id })} />);
  await screen.findByText('This annotation version is not available to you.');
  expect(screen.queryByText(/Immutable target/)).toBeNull();
  expect(api.listAnnotationVersions).not.toHaveBeenCalled();
  expect(api.getAnnotationVersion).not.toHaveBeenCalled();
});

it('lets an annotator open an old own submission from the history as an own ref, never as a submission ref', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  vi.mocked(api.listProjects).mockResolvedValue([{ project_key: 'pkg', roles: ['annotator'], can_manage: false } as any]);
  vi.spyOn(api, 'listSubmissionHistory').mockResolvedValue([{ submission_id: ownRef.id, document_id: 'target', author_label: 'Reader A', created_at: '2026-10-16T00:00:00Z', mode: 'independent', round_id: null }]);
  vi.spyOn(api, 'getSubmissionHistory').mockResolvedValue({ summary: { submission_id: ownRef.id, document_id: 'target', author_label: 'Reader A', created_at: '2026-10-16T00:00:00Z', mode: 'independent', round_id: null },
    annotations: historical.annotations, evidence: [], decisions: [], checked_layer_ids: [], document_checked: false, reanchor_inputs: [], reanchor_resolutions: [], round_inputs: [], round_input_resolutions: [] });
  const rows = vi.spyOn(api, 'getRowSubmissions');
  const onNavigate = vi.fn();
  const mounted = render(<CaseViewer {...props} onNavigate={onNavigate} />);
  await screen.findByText(/Immutable target/);
  fireEvent.click(screen.getByRole('button', { name: 'Submissions' }));
  const table = await screen.findByRole('table', { name: 'Submission history' });
  expect(within(table).queryByRole('columnheader', { name: 'Final' })).toBeNull();
  fireEvent.click(within(table).getByRole('link'));
  const route = onNavigate.mock.calls.at(-1)![0];
  expect(route).toEqual({ name: 'projectCase', key: 'pkg', caseId: caseDetail.case_id, variant: 'target', annotations: refKey(ownRef) });
  mounted.rerender(<CaseViewer {...props} onNavigate={onNavigate} annotations={route.annotations} />);
  await screen.findByText('HP:old');
  expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'own', ownRef.id);
  expect(api.getAnnotationVersion).not.toHaveBeenCalledWith('pkg', 'target', 'submission', expect.anything());
  expect(rows).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
});

it('opens a deep-linked comparison with that right side and keeps annotations when it closes', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const linked = { ...ownRef, kind: 'submission' as const, id: 'sub-2', label: 'ann-0002 · submission' };
  vi.mocked(api.listAnnotationVersions).mockResolvedValue([ownRef, linked]);
  const onNavigate = vi.fn();
  const documents = { decision: 'all', page: '2', open: [`${caseDetail.case_id}:de`] };
  render(<CaseViewer {...props} onNavigate={onNavigate} annotations={refKey(ownRef)} compare={refKey(linked)} documents={documents} />);
  const panel = await screen.findByRole('region', { name: 'Comparison' });
  await waitFor(() => expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'submission', 'sub-2'));
  expect(within(panel).getByLabelText<HTMLSelectElement>('Text version').value).toBe('target');
  expect(within(panel).getByLabelText<HTMLSelectElement>('Annotations').value).toBe(refKey(linked));
  fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
  expect(onNavigate).toHaveBeenCalledWith({ name: 'projectCase', key: 'pkg', caseId: caseDetail.case_id, variant: 'target', annotations: refKey(ownRef), documents });
});

it('restores the full documents query on the back link, including open rows, page and decision', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  const onNavigate = vi.fn();
  const documents = { decision: 'confirm-final', page: '3', open: [`${caseDetail.case_id}:de`, 'other:en'], language: 'de' };
  render(<CaseViewer {...props} onNavigate={onNavigate} documents={documents} />);
  await screen.findByText('Immutable target 😃');
  const back = screen.getByRole('link', { name: 'Back to Documents' });
  expect(back.getAttribute('href')).toBe(routeHref({ name: 'projectDocuments', key: 'pkg', ...documents }));
  fireEvent.click(back);
  expect(onNavigate).toHaveBeenCalledWith({ name: 'projectDocuments', key: 'pkg', ...documents });
});

it('uses a collapsed native Versions disclosure for permitted browsing', async () => {
  const { CaseViewer } = await import('../src/variants/CaseViewer');
  render(<CaseViewer {...props} />);
  await screen.findByText(/Immutable target/);
  const disclosure = screen.getByText('Versions').closest('details')!;
  expect(disclosure.open).toBe(false);
});
