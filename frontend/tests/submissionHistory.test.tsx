import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import { SubmissionHistory, type SubmissionHistoryProps } from '../src/variants/SubmissionHistory';
import { refKey } from '../src/variants/versionState';
import { final, group, page, row, submission, submissions } from './documents/fixtures';
import { historical } from './variantFixtures';
import { guidelineListing, guidelineSummary } from './projectFixtures';

const summary = { submission_id: 'immutable/submission', document_id: 'target', author_label: 'Reader A',
  created_at: '2026-10-18T12:00:00Z', mode: 'independent' as const, round_id: null, guideline_withdrawn: false };
const detail = { summary, annotations: historical.annotations, evidence: [], decisions: [], checked_layer_ids: [], document_checked: false,
  reanchor_inputs: [], reanchor_resolutions: [], round_inputs: [], round_input_resolutions: [] };
const leadRows = submissions('case 1', 'de', { submissions: [
  submission({ submission_id: 'sub-1', document_id: 'target', author_label: 'ann-0001', recorded_at: '2026-10-18T10:00:00Z' }),
  submission({ submission_id: 'sub-2', document_id: 'target', author_label: 'ann-0002', recorded_at: '2026-10-18T11:00:00Z' }),
] });
const leadPage = page([group('case 1', [row({ case_id: 'case 1', language: 'de', final: final({ case_id: 'case 1', language: 'de', document_id: 'target', submission_id: 'sub-2' }) })])]);
const documents = { decision: 'all', page: '2', open: ['case 1:de'] };
const base: SubmissionHistoryProps = { projectKey: 'pkg', caseId: 'case 1', documentId: 'target', language: 'de', version: 1,
  username: 'alice', canManage: false, onNavigate: vi.fn() };

beforeEach(() => {
  vi.spyOn(api, 'listSubmissionHistory').mockResolvedValue([summary, { ...summary, submission_id: 'later', created_at: '2026-10-18T13:00:00Z' }]);
  vi.spyOn(api, 'getSubmissionHistory').mockResolvedValue(detail);
  vi.spyOn(api, 'getRowSubmissions').mockResolvedValue(leadRows);
  vi.spyOn(api, 'listDocumentRows').mockResolvedValue(leadPage);
  vi.spyOn(api, 'listGuidelines').mockResolvedValue(guidelineListing([guidelineSummary(3), guidelineSummary(2)]));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openHistory = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Submissions' }));
  return screen.findByRole('table', { name: 'Submission history' });
};

it('shows leads every submission read-only with the Final column and submission View links', async () => {
  const onNavigate = vi.fn();
  render(<SubmissionHistory {...base} canManage onNavigate={onNavigate} documents={documents} />);
  expect(api.getRowSubmissions).not.toHaveBeenCalled();
  const table = await openHistory();
  expect(api.getRowSubmissions).toHaveBeenCalledWith('pkg', 'case 1', 'de');
  expect(api.listDocumentRows).toHaveBeenCalledWith('pkg', { case: 'case 1', language: 'de' });
  expect(within(table).getByRole('columnheader', { name: 'Final' })).toBeTruthy();
  expect(within(table).queryByRole('columnheader', { name: 'Actions' })).toBeNull();
  expect(within(table).getAllByText('Final')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Use as final|Replace|Compare/ })).toBeNull();
  expect(screen.queryByText(/Start consolidation/)).toBeNull();
  expect(api.listSubmissionHistory).not.toHaveBeenCalled();
  const links = within(table).getAllByRole('link');
  expect(links).toHaveLength(2);
  fireEvent.click(links[0]);
  expect(onNavigate).toHaveBeenCalledWith({ name: 'projectCase', key: 'pkg', caseId: 'case 1', variant: 'target',
    annotations: refKey({ kind: 'submission', id: 'sub-1' }), documents });
  expect(screen.queryByRole('table', { name: 'Submission history' })).toBeNull();
});

it('shows non-leads only their own submissions without the Final column and links own refs', async () => {
  const onNavigate = vi.fn();
  render(<SubmissionHistory {...base} onNavigate={onNavigate} />);
  const table = await openHistory();
  expect(api.listSubmissionHistory).toHaveBeenCalledWith('pkg', 'target');
  expect(api.getRowSubmissions).not.toHaveBeenCalled();
  expect(api.listDocumentRows).not.toHaveBeenCalled();
  expect(within(table).queryByRole('columnheader', { name: 'Final' })).toBeNull();
  expect(within(table).getAllByText('Reader A (you)')).toHaveLength(2);
  expect(within(table).getAllByRole('cell', { name: String(historical.annotations.length) })).toHaveLength(2);
  fireEvent.click(within(table).getAllByRole('link')[0]);
  expect(onNavigate).toHaveBeenCalledWith({ name: 'projectCase', key: 'pkg', caseId: 'case 1', variant: 'target',
    annotations: refKey({ kind: 'own', id: 'immutable/submission' }) });
});

it('ignores late replies after account or exact document replacement', async () => {
  let finish!: (value: typeof leadRows) => void;
  vi.mocked(api.getRowSubmissions).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<SubmissionHistory {...base} canManage />);
  fireEvent.click(screen.getByRole('button', { name: 'Submissions' }));
  await waitFor(() => expect(api.getRowSubmissions).toHaveBeenCalled());
  view.rerender(<SubmissionHistory {...base} canManage documentId="different" username="bob" />);
  await act(async () => finish(leadRows));
  expect(screen.queryByText('ann-0001')).toBeNull();
  expect(screen.queryByRole('table', { name: 'Submission history' })).toBeNull();
});

it('retains an explicit retry after a history read fails', async () => {
  vi.mocked(api.listSubmissionHistory).mockRejectedValueOnce(new Error('History unavailable'));
  render(<SubmissionHistory {...base} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submissions' }));
  await screen.findByText('History unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry submissions' }));
  await screen.findByRole('table', { name: 'Submission history' });
});

it('labels history entries with the text label', async () => {
  vi.mocked(api.getRowSubmissions).mockResolvedValue(submissions('case-0101', 'de', { submissions: [
    submission({ submission_id: 'sub-1', document_id: 'target', author_label: 'ann-0001', recorded_at: '2026-10-18T10:00:00Z' }),
    submission({ submission_id: 'sub-2', document_id: 'target-v2', version: 2, author_label: 'ann-0002', recorded_at: '2026-10-18T11:00:00Z' }),
  ] }));
  vi.mocked(api.listDocumentRows).mockResolvedValue(page([group('case-0101', [row({ case_id: 'case-0101', language: 'de' })])]));
  render(<SubmissionHistory {...base} caseId="case-0101" canManage />);
  const table = await openHistory();
  expect(within(table).getByRole('cell', { name: 'case-0101 · de v1' })).toBeTruthy();
  expect(within(table).getByRole('cell', { name: 'case-0101 · de v2' })).toBeTruthy();
});

it('shows Guidelines v2 (current: v3)', async () => {
  vi.mocked(api.getRowSubmissions).mockResolvedValue(submissions('case 1', 'de', { submissions: [
    submission({ submission_id: 'sub-1', document_id: 'target', author_label: 'ann-0001', guideline_version: 2 }),
  ] }));
  render(<SubmissionHistory {...base} canManage />);
  const table = await openHistory();
  expect(api.listGuidelines).toHaveBeenCalledWith('pkg');
  expect(await within(table).findByText('Guidelines v2 (current: v3)')).toBeTruthy();
  cleanup();
  vi.mocked(api.listSubmissionHistory).mockResolvedValue([{ ...summary, guideline_version: 3 }]);
  render(<SubmissionHistory {...base} />);
  expect(await within(await openHistory()).findByText('Guidelines v3')).toBeTruthy();
});

it('shows Guidelines: not recorded', async () => {
  vi.mocked(api.listGuidelines).mockRejectedValue(new Error('Guidelines unavailable'));
  render(<SubmissionHistory {...base} />);
  const table = await openHistory();
  expect(within(table).getAllByText('Guidelines: not recorded')).toHaveLength(2);
  expect(screen.queryByText('Guidelines unavailable')).toBeNull();
});
