import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import { SubmissionHistory } from '../src/variants/SubmissionHistory';
import { historical } from './variantFixtures';

const summary = { submission_id: 'immutable/submission', document_id: 'target', author_label: 'Reader A',
  created_at: '2026-10-18T12:00:00Z', mode: 'independent' as const, round_id: null };
const detail = { summary, annotations: historical.annotations, evidence: [], decisions: [{
  decision_id: 'decision', target: { annotation_id: 'proposal', version: 'v1' }, outcome: 'uncertain' as const,
  note: 'Review reason remains historical', reviewer_id: 'reader',
}] };
beforeEach(() => {
  vi.spyOn(api, 'listSubmissionHistory').mockResolvedValue([summary, { ...summary, submission_id: 'later', created_at: '2026-10-18T13:00:00Z' }]);
  vi.spyOn(api, 'getSubmissionHistory').mockResolvedValue(detail);
  vi.spyOn(api, 'getVariantText').mockResolvedValue({ document_id: 'target', text: 'Historical clinical text', text_sha256: 'text' });
  vi.spyOn(api, 'resolveTermLabels').mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('loads own authorized history on demand, keeping annotation-only results separate on one text version', async () => {
  const browse = vi.spyOn(api, 'getCase');
  render(<SubmissionHistory projectKey="pkg" documentId="target" username="alice" />);
  expect(api.listSubmissionHistory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submissions' }));
  await screen.findByText('2 submissions');
  fireEvent.click(screen.getByRole('button', { name: /View submission immutable\/submission/ }));
  await screen.findByText('HP:old');
  expect(api.getSubmissionHistory).toHaveBeenCalledWith('pkg', 'target', 'immutable/submission');
  expect(screen.getByText('Review reason remains historical')).toBeTruthy();
  expect(screen.getByText('Review reasons')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Save|Submit case/ })).toBeNull();
  expect(browse).not.toHaveBeenCalled();
});

it('drops historical payloads and ignores late replies after account or exact document replacement', async () => {
  let finish!: (value: typeof detail) => void;
  vi.mocked(api.getSubmissionHistory).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<SubmissionHistory projectKey="pkg" documentId="target" username="alice" />);
  fireEvent.click(screen.getByRole('button', { name: 'Submissions' }));
  fireEvent.click(await screen.findByRole('button', { name: /View submission immutable\/submission/ }));
  await waitFor(() => expect(api.getSubmissionHistory).toHaveBeenCalled());
  view.rerender(<SubmissionHistory projectKey="pkg" documentId="different" username="bob" />);
  await act(async () => finish(detail));
  expect(screen.queryByText('HP:old')).toBeNull();
  expect(screen.queryByText('Reader A')).toBeNull();
});

it('retains an explicit retry after a history read fails', async () => {
  vi.mocked(api.listSubmissionHistory).mockRejectedValueOnce(new Error('History unavailable'));
  render(<SubmissionHistory projectKey="pkg" documentId="target" username="alice" />);
  fireEvent.click(screen.getByRole('button', { name: 'Submissions' }));
  await screen.findByText('History unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry submissions' }));
  await screen.findByText('2 submissions');
});
