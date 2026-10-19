import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type AssignmentView, type ProblemReportView, type ProjectSummary } from '../src/api/client';
import { App } from '../src/App';
import { routeHref } from '../src/app/router';
import { deferred } from './projectFixtures';
import { testUser } from './session';

vi.mock('../src/tasks/ProblemReportDetail', () => ({ ProblemReportDetail: (props: { projectKey: string; reportId: string; canManage: boolean; action?: string; documents?: object }) =>
  <section aria-label="Authorized report detail" data-route={JSON.stringify({ action: props.action, documents: props.documents })}>{props.projectKey} · {props.reportId} · {String(props.canManage)}</section> }));
const { ProblemReportDetail } = await vi.importActual<typeof import('../src/tasks/ProblemReportDetail')>('../src/tasks/ProblemReportDetail');
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.sessionStorage.clear(); window.history.replaceState(null, '', '#/'); });
const project: ProjectSummary = { project_key: 'p/key', name: 'Project', can_manage: true, document_count: 1, description: null, roles: ['lead'], allowed_modes: ['independent'] };

it('waits for current project authority before mounting the exact encoded lead report destination', async () => {
  window.history.replaceState(null, '', '#/projects/p%2Fkey/problem-reports/report%2F1%20%25');
  const projects = deferred<ProjectSummary[]>(); vi.spyOn(api, 'listProjects').mockReturnValue(projects.promise);
  render(<App user={testUser('lead')} />);
  expect(screen.queryByRole('region', { name: 'Authorized report detail' })).toBeNull();
  await act(async () => projects.resolve([project]));
  expect((await screen.findByRole('region', { name: 'Authorized report detail' })).textContent).toBe('p/key · report/1 % · true');
});

it('does not mount a lead report surface for a project member without management authority', async () => {
  window.history.replaceState(null, '', '#/projects/p%2Fkey/problem-reports/report-1');
  vi.spyOn(api, 'listProjects').mockResolvedValue([{ ...project, can_manage: false, roles: ['annotator'] }]);
  render(<App user={testUser('owner')} />);
  await screen.findByRole('heading', { name: 'You do not have access to this page.' });
  expect(screen.queryByRole('region', { name: 'Authorized report detail' })).toBeNull();
});

it('passes the documents query and the resume action from the route to the report detail', async () => {
  window.history.replaceState(null, '', '#/projects/p%2Fkey/problem-reports/report-1?action=resume&documents_decision=all&documents_open=case%207%3Aen');
  vi.spyOn(api, 'listProjects').mockResolvedValue([project]);
  render(<App user={testUser('lead')} />);
  const detail = await screen.findByRole('region', { name: 'Authorized report detail' });
  expect(JSON.parse(detail.getAttribute('data-route') ?? '{}')).toEqual({ action: 'resume', documents: { decision: 'all', open: ['case 7:en'] } });
});

const report: ProblemReportView = { report_id: 'report-1', project_key: 'p/key', assignment_id: 1, document_id: 'doc-en', reporter_id: 1, round_id: null, submission_id: null, reason: 'Conflicting source evidence', state: 'open', revision: 2, resolution: null, held_assignment_ids: [1], events: [], reporter_label: 'Reporter', case_id: 'case 7', language: 'en', withdrawable: false, viewer_label: 'Lead', viewer_is_lead: true };
const assignment = { id: 1, project_key: 'p/key', document_id: 'doc-en', user_id: 1, username: 'ann', pseudonym: 'A1', task: 'annotate', status: 'in_progress', created_at: '2026-10-19T00:00:00Z', updated_at: '2026-10-19T00:00:00Z', revoked_at: null, last_submission_id: null, display_name: 'Annotator', workflow_revision: 1, held: true } as AssignmentView;
const documents = { decision: 'all', language: 'en', open: ['case 7:en'] };
const visitKey = `ontocurator:documents-visit:p/key:${JSON.stringify({ decision: 'all' })}`;
const snapshot = { categories: ['report'], work: [], final: null, reports: [] };
const decided = () => JSON.parse(window.sessionStorage.getItem(visitKey) ?? '{}').decided;

function mockReport() {
  vi.spyOn(api, 'listProblemReports').mockResolvedValue([report]);
  vi.spyOn(api, 'listAssignments').mockResolvedValue([assignment, { ...assignment, id: 2, display_name: 'Reviewer', held: false }]);
}

it('links back to Documents with exactly the documents query from the route', async () => {
  mockReport(); const navigate = vi.fn();
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage documents={documents} onNavigate={navigate} />);
  const back = await screen.findByRole('link', { name: 'Back to documents' });
  const expected = { name: 'projectDocuments', key: 'p/key', ...documents } as const;
  expect(back.getAttribute('href')).toBe(routeHref(expected));
  fireEvent.click(back);
  expect(navigate).toHaveBeenCalledWith(expected);
});

it('links back to the row of the report when entered directly and leaves modified clicks to the browser', async () => {
  mockReport(); const navigate = vi.fn();
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage onNavigate={navigate} />);
  const back = await screen.findByRole('link', { name: 'Back to documents' });
  const expected = { name: 'projectDocuments', key: 'p/key', case: 'case 7', language: 'en' } as const;
  expect(back.getAttribute('href')).toBe(routeHref(expected));
  fireEvent.click(back, { ctrlKey: true });
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(back);
  expect(navigate).toHaveBeenCalledWith(expected);
});

it('preselects the pause release of the paused task with action=resume and submits nothing on its own', async () => {
  mockReport(); const apply = vi.spyOn(api, 'actOnProblemReport').mockResolvedValue({ ...report, revision: 3, held_assignment_ids: [] });
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage action="resume" onNavigate={vi.fn()} />);
  expect(await screen.findByRole('combobox', { name: 'Report action' })).toHaveProperty('value', 'resume');
  expect(screen.getByRole('checkbox', { name: /Task 1/ })).toHaveProperty('checked', true);
  expect(screen.queryByRole('checkbox', { name: /Task 2/ })).toBeNull();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: /Action reason/ }), { target: { value: 'Clarified' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply report action' }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith('report-1', expect.objectContaining({ action: 'resume', assignment_ids: [1] })));
});

it('starts at resolve with nothing preselected without action=resume', async () => {
  mockReport();
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage onNavigate={vi.fn()} />);
  expect(await screen.findByRole('combobox', { name: 'Report action' })).toHaveProperty('value', 'resolve');
});

it.each(['resume', 'resolve'] as const)('records a %s in the Documents visit state when entered from Documents', async kind => {
  window.sessionStorage.setItem(visitKey, JSON.stringify({ shown: { 'case 7:en': snapshot }, decided: [] }));
  mockReport(); vi.spyOn(api, 'actOnProblemReport').mockResolvedValue({ ...report, revision: 3 });
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage documents={documents} action={kind === 'resume' ? 'resume' : undefined} onNavigate={vi.fn()} />);
  expect(await screen.findByRole('combobox', { name: 'Report action' })).toHaveProperty('value', kind);
  fireEvent.change(screen.getByRole('textbox', { name: /Action reason/ }), { target: { value: 'Done' } });
  expect(decided()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Apply report action' }));
  await screen.findByText(/Report action saved/);
  expect(decided()).toEqual(['case 7:en']);
});

it('records no decision without the documents query, for other actions, or when the action fails', async () => {
  window.sessionStorage.setItem(visitKey, JSON.stringify({ shown: { 'case 7:en': snapshot }, decided: [] }));
  mockReport(); const apply = vi.spyOn(api, 'actOnProblemReport').mockResolvedValue({ ...report, revision: 3 });
  const view = render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage onNavigate={vi.fn()} />);
  await screen.findByRole('combobox', { name: 'Report action' });
  fireEvent.change(screen.getByRole('textbox', { name: /Action reason/ }), { target: { value: 'Done' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply report action' }));
  await screen.findByText(/Report action saved/);
  expect(decided()).toEqual([]);
  view.unmount();

  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage documents={documents} onNavigate={vi.fn()} />);
  fireEvent.change(await screen.findByRole('combobox', { name: 'Report action' }), { target: { value: 'extend_hold' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Task 2/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /Action reason/ }), { target: { value: 'Same conflict' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply report action' }));
  await screen.findByText(/Report action saved/);
  expect(decided()).toEqual([]);

  apply.mockRejectedValue(new Error('Conflict'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Report action' }), { target: { value: 'resolve' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply report action' }));
  await screen.findByText('Conflict');
  expect(decided()).toEqual([]);
});
