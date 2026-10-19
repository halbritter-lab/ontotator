import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError, type AssignmentView, type WorkRoundView } from '../src/api/client';
import { ConsolidationLauncher } from '../src/variants/ConsolidationLauncher';
import { assignment } from './assignmentFixtures';

const rows = ['first', 'second'].map((submission_id, index) => ({ submission_id, document_id: 'target',
  author_label: `Reader ${index + 1}`, created_at: '2026-10-18T12:00:00Z', mode: 'independent' }));
const reviewerTask: AssignmentView = { ...assignment, id: 42, project_key: 'p', document_id: 'target', username: 'reviewer',
  display_name: 'Reviewer', pseudonym: 'R', task: 'review', workflow_revision: 7, status: 'submitted' };
const round: WorkRoundView = { round_id: 'round-exact', project_key: 'p', assignment_id: 42, document_id: 'target', annotator_id: 'R',
  kind: 'consolidation', mode: 'review', state: 'editable', workflow_revision: 8, input_manifest_sha256: 'a'.repeat(64), input_submission_ids: ['first', 'second'], active: true };
const props = { projectKey: 'p', documentId: 'target', language: 'de', username: 'lead', rows };
beforeEach(() => {
  vi.spyOn(api, 'listMembers').mockResolvedValue([
    { username: 'reviewer', display_name: 'Reviewer', pseudonym: 'R', roles: ['adjudicator'], languages: ['de'] },
    { username: 'reader', display_name: 'Reader', pseudonym: 'A', roles: ['annotator'], languages: ['de'] },
  ]);
  vi.spyOn(api, 'listAssignments').mockResolvedValue([reviewerTask]);
  vi.spyOn(api, 'startWorkRound').mockResolvedValue(round);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function selectInputs() {
  fireEvent.click(screen.getByRole('button', { name: 'Consolidate results' }));
  await screen.findByLabelText('Consolidation reviewer');
  fireEvent.click(screen.getByLabelText('Include submission first'));
  fireEvent.click(screen.getByLabelText('Include submission second'));
  fireEvent.change(screen.getByLabelText('Consolidation reviewer'), { target: { value: 'reviewer' } });
}

it('starts a distinct consolidation from explicit exact immutable submissions and reviewer assignment revision', async () => {
  const create = vi.spyOn(api, 'createAssignments');
  const final = vi.spyOn(api, 'selectFinalResult');
  render(<ConsolidationLauncher {...props} rows={[...rows, { ...rows[0], submission_id: 'foreign', document_id: 'other' }]} />);
  expect(api.listMembers).not.toHaveBeenCalled();
  await selectInputs();
  expect(screen.queryByLabelText('Include submission foreign')).toBeNull();
  expect(screen.queryByRole('option', { name: 'Reader (reader)' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Start consolidation' }));
  await screen.findByText(/Consolidation assigned to Reviewer/);
  expect(api.startWorkRound).toHaveBeenCalledWith(42, expect.objectContaining({ kind: 'consolidation',
    source_submission_ids: ['first', 'second'], expected_workflow_revision: 7, request_id: expect.any(String) }));
  expect(create).not.toHaveBeenCalled();
  expect(final).not.toHaveBeenCalled();
});

it('creates only the deliberate exact reviewer task and leaves stale inputs unchanged after a server refusal', async () => {
  vi.mocked(api.listAssignments).mockResolvedValue([]);
  const create = vi.spyOn(api, 'createAssignments').mockResolvedValue({ created: [{ ...reviewerTask, workflow_revision: 0 }], refused: [] });
  vi.mocked(api.startWorkRound).mockRejectedValue(new ApiError(409, 'Inputs changed', 'ROUND_INPUT_STALE'));
  render(<ConsolidationLauncher {...props} />);
  await selectInputs();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start consolidation' }));
  await screen.findByText(/Selected submissions are no longer current/);
  expect(create).toHaveBeenCalledWith('p', { task: 'review', rows: [{ document_id: 'target', username: 'reviewer' }], confirm_language: false });
  expect(api.startWorkRound).toHaveBeenCalledTimes(1);
  expect(api.startWorkRound).toHaveBeenCalledWith(42, expect.objectContaining({ source_submission_ids: ['first', 'second'], expected_workflow_revision: 0 }));
  expect(screen.getByLabelText('Include submission first')).toHaveProperty('checked', true);
  expect(screen.getByLabelText('Include submission second')).toHaveProperty('checked', true);
});

it('requires at least two currently offered exact inputs after history replacement', async () => {
  const view = render(<ConsolidationLauncher {...props} />);
  await selectInputs();
  view.rerender(<ConsolidationLauncher {...props} rows={[rows[0]]} />);
  expect(screen.getByRole('button', { name: 'Start consolidation' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Start consolidation' }));
  expect(api.startWorkRound).not.toHaveBeenCalled();
});
