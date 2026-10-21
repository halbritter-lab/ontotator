import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError, type AssignmentView, type Member, type StartConsolidationResponse, type WorkRoundView } from '../src/api/client';
import { ConsolidationLauncher } from '../src/variants/ConsolidationLauncher';
import { assignment } from './assignmentFixtures';

const rows = ['first', 'second'].map((submission_id, index) => ({ submission_id, document_id: 'target',
  author_label: `Reader ${index + 1}`, label: `Reader ${index + 1} · Round 1`, created_at: '2026-10-18T12:00:00Z', mode: 'independent', guideline_withdrawn: false }));
const lead: Member = { username: 'lead', display_name: 'Mia Kühn', pseudonym: 'lead-0002', roles: ['lead'], languages: ['de'] };
const luc: Member = { username: 'luc', display_name: 'Luc Martin', pseudonym: 'ann-0004', roles: ['adjudicator', 'annotator'], languages: ['de'] };
const rita: Member = { username: 'rita', display_name: 'Rita Rev', pseudonym: 'rev-0009', roles: ['adjudicator'], languages: ['fr'] };
const reader: Member = { username: 'reader', display_name: 'Reader', pseudonym: 'A', roles: ['annotator'], languages: ['de'] };
const reviewerTask: AssignmentView = { ...assignment, id: 42, project_key: 'p', document_id: 'target', username: 'rita',
  display_name: 'Rita Rev', pseudonym: 'rev-0009', task: 'review', workflow_revision: 7, status: 'submitted' };
const annotateTask = (username: string): AssignmentView => ({ ...assignment, id: 50, project_key: 'p', document_id: 'target', username, task: 'annotate', status: 'submitted' });
const round: WorkRoundView = { round_id: 'round-exact', project_key: 'p', assignment_id: 42, document_id: 'target', annotator_id: 'R',
  kind: 'consolidation', mode: 'review', state: 'editable', workflow_revision: 8, input_manifest_sha256: 'a'.repeat(64), input_submission_ids: ['first', 'second'], active: true, submission_count: 0, input_count: 2 };
const started = (roleGranted = false): StartConsolidationResponse => ({ round, role_granted: roleGranted });
const props = { projectKey: 'p', documentId: 'target', language: 'de', username: 'lead', rows };

beforeEach(() => {
  vi.spyOn(api, 'listMembers').mockResolvedValue([lead, luc, rita, reader]);
  vi.spyOn(api, 'listAssignments').mockResolvedValue([]);
  vi.spyOn(api, 'startConsolidation').mockResolvedValue(started());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const reviewerSelect = () => screen.getByLabelText('Consolidation reviewer') as HTMLSelectElement;
const options = () => within(reviewerSelect()).getAllByRole('option').map(option => option.textContent);

async function openForm(extra: Partial<Parameters<typeof ConsolidationLauncher>[0]> = {}) {
  render(<ConsolidationLauncher {...props} defaultOpen defaultSelected={['first', 'second']} {...extra} />);
  await screen.findByLabelText('Consolidation reviewer');
}

it('lists You (Mia Kühn) first, then the members with the Adjudicator role', async () => {
  await openForm();
  expect(options()).toEqual(['Choose a reviewer', 'You (Mia Kühn)', 'Luc Martin (ann-0004)', 'Rita Rev (rev-0009)']);
  expect(screen.queryByText(/No member has the Adjudicator role yet/)).toBeNull();
});

it('choosing yourself says that you get the Adjudicator role, and starts with one request', async () => {
  const create = vi.spyOn(api, 'createAssignments');
  const startRound = vi.spyOn(api, 'startWorkRound');
  const onStarted = vi.fn();
  vi.mocked(api.startConsolidation).mockResolvedValue(started(true));
  await openForm({ onStarted });
  fireEvent.change(reviewerSelect(), { target: { value: 'lead' } });
  expect(screen.getByText('You will get the Adjudicator role for this project.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Start consolidation' }));
  await screen.findByText(/Consolidation assigned to you/);
  expect(api.startConsolidation).toHaveBeenCalledTimes(1);
  expect(api.startConsolidation).toHaveBeenCalledWith('p', {
    document_id: 'target', reviewer: 'lead', source_submission_ids: ['first', 'second'], reason: null, confirm_language: false,
    request_id: expect.any(String), expected_workflow_revision: null,
  });
  expect(create).not.toHaveBeenCalled();
  expect(startRound).not.toHaveBeenCalled();
  expect(onStarted).toHaveBeenCalledWith(round, { self: true, roleGranted: true });
  expect(screen.getByRole('link', { name: 'Open my consolidation task' }).getAttribute('href')).toBe('#/tasks/42');
});

it('says nothing about the role when you already hold it', async () => {
  vi.mocked(api.listMembers).mockResolvedValue([{ ...lead, roles: ['lead', 'adjudicator'] }, luc]);
  await openForm();
  fireEvent.change(reviewerSelect(), { target: { value: 'lead' } });
  expect(screen.queryByText('You will get the Adjudicator role for this project.')).toBeNull();
});

it('disables people who annotated this text with the reason, while the project keeps adjudication separate', async () => {
  vi.mocked(api.listAssignments).mockResolvedValue([annotateTask('lead'), { ...annotateTask('luc'), id: 51 }]);
  await openForm({ adjudicatorNotAnnotator: true });
  const own = within(reviewerSelect()).getByRole('option', { name: 'You (Mia Kühn) — You annotated this text' }) as HTMLOptionElement;
  const other = within(reviewerSelect()).getByRole('option', { name: 'Luc Martin (ann-0004) — Luc Martin annotated this text' }) as HTMLOptionElement;
  expect(own.disabled).toBe(true);
  expect(other.disabled).toBe(true);
  expect((within(reviewerSelect()).getByRole('option', { name: 'Rita Rev (rev-0009)' }) as HTMLOptionElement).disabled).toBe(false);
  cleanup();
  // Without the rule annotators may consolidate.
  await openForm({ adjudicatorNotAnnotator: false });
  expect(options()).toContain('Luc Martin (ann-0004)');
});

it('explains a project without adjudicators and links Settings → Members', async () => {
  vi.mocked(api.listMembers).mockResolvedValue([lead, reader]);
  await openForm();
  expect(options()).toEqual(['Choose a reviewer', 'You (Mia Kühn)']);
  const note = screen.getByText(/No member has the Adjudicator role yet\. Give it in/);
  expect(note.textContent).toBe('No member has the Adjudicator role yet. Give it in Settings → Members.');
  expect(within(note).getByRole('link', { name: 'Settings → Members' }).getAttribute('href')).toBe('#/projects/p/settings/members');
});

it('keeps the missing-language confirmation and reuses an existing review assignment revision', async () => {
  vi.mocked(api.listAssignments).mockResolvedValue([reviewerTask]);
  await openForm();
  fireEvent.change(reviewerSelect(), { target: { value: 'rita' } });
  const start = screen.getByRole('button', { name: 'Start consolidation' });
  expect(start.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(start.getAttribute('aria-describedby')!)!.textContent).toBe('Confirm the reviewer despite missing de.');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Assign this reviewer despite missing de in their profile' }));
  fireEvent.click(start);
  await screen.findByText(/Consolidation assigned to Rita Rev/);
  expect(api.startConsolidation).toHaveBeenCalledWith('p', expect.objectContaining({ reviewer: 'rita', confirm_language: true, expected_workflow_revision: 7 }));
});

it('requires at least two selected inputs and a reviewer', async () => {
  const view = render(<ConsolidationLauncher {...props} defaultOpen />);
  await screen.findByLabelText('Consolidation reviewer');
  expect(screen.getByText('Select at least two submissions.')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Reader 1 · Round 1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Reader 2 · Round 1' }));
  expect(screen.getByText('Choose a reviewer.')).toBeTruthy();
  view.rerender(<ConsolidationLauncher {...props} rows={[rows[0]]} defaultOpen />);
  fireEvent.change(reviewerSelect(), { target: { value: 'luc' } });
  expect(screen.getByRole('button', { name: 'Start consolidation' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Start consolidation' }));
  expect(api.startConsolidation).not.toHaveBeenCalled();
});

it('keeps the inputs after a refusal and words a stale input', async () => {
  vi.mocked(api.startConsolidation).mockRejectedValue(new ApiError(409, 'Inputs changed', 'ROUND_INPUT_STALE'));
  await openForm();
  fireEvent.change(reviewerSelect(), { target: { value: 'luc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start consolidation' }));
  await screen.findByText(/Selected submissions are no longer current/);
  expect(screen.getByRole('checkbox', { name: 'Reader 1 · Round 1' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'Reader 2 · Round 1' })).toHaveProperty('checked', true);
});

it('opens behind Consolidate results without defaultOpen and lists only inputs on this text', async () => {
  render(<ConsolidationLauncher {...props} rows={[...rows, { ...rows[0], submission_id: 'foreign', document_id: 'other' }]} />);
  expect(api.listMembers).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Consolidate results' }));
  await screen.findByLabelText('Consolidation reviewer');
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.queryByText(/first|second|foreign/)).toBeNull();
});
