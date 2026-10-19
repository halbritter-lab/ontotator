import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError, type FinalPreflight, type SubmissionHistorySummary } from '../src/api/client';
import { FinalResultSelector } from '../src/variants/FinalResultSelector';
import { formatDateTime } from '../src/app/labels';

const result = { case_id: 'case', language: 'de', document_id: 'text-v1', submission_id: 'old', revision: 3 };
const projection = (selections: FinalPreflight['selections'] = []): FinalPreflight => ({ project: 'p', selections, warnings: [], omissions: [], state_digest: 'a'.repeat(64) });
const rows: SubmissionHistorySummary[] = ['old', 'new'].map((submission_id, index) => ({ submission_id, document_id: 'text-v1', author_label: 'Reader A', created_at: `2026-10-18T1${index}:00:00Z`, mode: 'independent' }));
const props = { projectKey: 'p', documentId: 'text-v1', caseId: 'case', language: 'de', rows };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('requires an explicit immutable result, never chooses newest, and publishes a project-scoped successful update', async () => {
  const read = vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValue(projection());
  const save = vi.spyOn(api, 'selectFinalResult').mockImplementation(async () => {
    read.mockResolvedValue(projection([result]));
    return result;
  });
  const changed = vi.fn();
  window.addEventListener('ontocurator:final-selection-changed', changed);
  try {
    render(<FinalResultSelector {...props} />);
    await screen.findByText('No final result selected for this text and language.');
    expect(screen.getByLabelText('Submitted result')).toHaveProperty('value', '');
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Submitted result'), { target: { value: 'old' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select final result' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('p', { document_id: 'text-v1', submission_id: 'old', expected_revision: 0, acknowledged_cause_ids: [] }));
    await screen.findByText(/Selected: old/);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].detail).toEqual({ projectKey: 'p' });
  } finally { window.removeEventListener('ontocurator:final-selection-changed', changed); }
});

it('requires reload and a fresh deliberate choice after a stale CAS, including a selection on another text version', async () => {
  const read = vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValueOnce(projection([result]))
    .mockResolvedValue(projection([{ ...result, document_id: 'text-v2', submission_id: 'other', revision: 9 }]));
  const save = vi.spyOn(api, 'selectFinalResult').mockRejectedValueOnce(new ApiError(409, 'Selection changed elsewhere', 'REVISION_CONFLICT'))
    .mockResolvedValue({ ...result, revision: 10 });
  render(<FinalResultSelector {...props} />);
  await screen.findByText(/Selected: old/);
  fireEvent.change(screen.getByLabelText('Submitted result'), { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Replace final selection' }));
  await screen.findByRole('button', { name: 'Reload final selection' });
  expect(save).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Submitted result')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload final selection' }));
  await screen.findByText(/Selected: other/);
  expect(screen.getByLabelText('Submitted result')).toHaveProperty('value', '');
  fireEvent.change(screen.getByLabelText('Submitted result'), { target: { value: 'old' } });
  fireEvent.click(screen.getByRole('button', { name: 'Replace final selection' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith('p', expect.objectContaining({ submission_id: 'old', expected_revision: 9 })));
});

it('disables a result removed from the authorized history before an explicit save', async () => {
  vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValue(projection());
  const save = vi.spyOn(api, 'selectFinalResult');
  const view = render(<FinalResultSelector {...props} />);
  await screen.findByText('No final result selected for this text and language.');
  fireEvent.change(screen.getByLabelText('Submitted result'), { target: { value: 'old' } });
  view.rerender(<FinalResultSelector {...props} rows={[rows[1]]} />);
  expect(screen.getByRole('button', { name: 'Select final result' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Select final result' }));
  expect(save).not.toHaveBeenCalled();
});

it('requires conscious reaffirmation of current finite causes without resolving task or source problems', async () => {
  const state = projection([result]);
  state.warnings = [
    { id: 'w1', code: 'SELECTED_TEXT_CORRECTED', cause_id: 'correction-1', cause_revision: 1, case_id: 'case', language: 'de', reason: 'A corrected text is available.', destination: '#/case' },
    { id: 'w2', code: 'TASK_ON_HOLD', cause_id: 'hold-1', cause_revision: 1, case_id: 'case', language: 'de', reason: 'Task paused.', destination: '#/report' },
  ];
  vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValue(state);
  const save = vi.spyOn(api, 'selectFinalResult').mockResolvedValue({ ...result, revision: 4 });
  render(<FinalResultSelector {...props} />);
  await screen.findByText(/Selected: old/);
  expect(screen.getByText('A corrected text is available.')).toBeTruthy();
  const reaffirm = screen.getByRole('button', { name: 'Keep selected result after review' });
  expect(reaffirm).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByLabelText('I reviewed these changes and want to keep the exact selected result'));
  fireEvent.click(reaffirm);
  await waitFor(() => expect(save).toHaveBeenCalledWith('p', { document_id: 'text-v1', submission_id: 'old', expected_revision: 3, acknowledged_cause_ids: ['correction-1'] }));
  expect(save).toHaveBeenCalledTimes(1);
});

it('labels options with the same local time string as the submission history', async () => {
  vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValue(projection());
  render(<FinalResultSelector {...props} />);
  const select = await screen.findByLabelText('Submitted result') as HTMLSelectElement;
  const labels = [...select.options].slice(1).map(option => option.textContent);
  expect(labels).toEqual(expect.arrayContaining(rows.map(row => `${row.author_label} · ${formatDateTime(row.created_at)} · ${row.submission_id}`)));
  expect(labels.join(' ')).not.toMatch(/T\d\d:\d\d:\d\dZ/);
});
