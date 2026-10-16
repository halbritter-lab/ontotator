import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client';
import { caseDetail, historical, ownRef } from './variantFixtures';
import { refKey } from '../src/variants/versionState';

beforeEach(() => {
  vi.spyOn(api, 'getCase').mockResolvedValue(caseDetail);
  vi.spyOn(api, 'getVariantText').mockImplementation(async (_project, doc) => ({ document_id: doc, text: `Immutable ${doc} 😃`, text_sha256: 'text' }));
  vi.spyOn(api, 'listAnnotationVersions').mockResolvedValue([ownRef]);
  vi.spyOn(api, 'getAnnotationVersion').mockResolvedValue(historical);
  vi.spyOn(api, 'listMyTasks').mockResolvedValue([]);
  vi.spyOn(api, 'resolveTermLabels').mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const props = { projectKey: 'pkg', caseId: caseDetail.case_id, variant: 'target', username: 'alice', onNavigate: vi.fn() };

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
    { assignment_id: 99, project_key: 'pkg', project_name: 'P', document_id: 'target', language: 'de', task: 'translation_review', status: 'open', updated_at: '' },
    { assignment_id: 7, project_key: 'pkg', project_name: 'P', document_id: 'target', language: 'de', task: 'annotate', status: 'submitted', updated_at: '' },
    { assignment_id: 8, project_key: 'foreign', project_name: 'P', document_id: 'target', language: 'de', task: 'review', status: 'open', updated_at: '' },
  ]);
  render(<CaseViewer {...props} annotations={refKey(ownRef)} />);
  await screen.findByText('HP:old');
  expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'own', ownRef.id);
  expect(screen.getByText('assertion: present (defaulted)')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Open my task' }));
  expect(props.onNavigate).toHaveBeenCalledWith({ name: 'task', assignmentId: 7 });
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
  vi.mocked(api.listMyTasks).mockResolvedValue([{ assignment_id: 7, project_key: 'pkg', project_name: 'P', document_id: 'target',
    language: 'de', task: 'annotate', status: 'open', updated_at: '' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('link', { name: 'Open my task' });
  expect(screen.queryByText('Task list offline')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});
