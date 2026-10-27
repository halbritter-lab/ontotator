import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError, type DocumentRowsPage, type ProblemReportView, type ProjectSummary } from '../src/api/client';
import { App } from '../src/App';
import { routeHref, type Route } from '../src/app/router';
import { deferred } from './projectFixtures';
import { testUser } from './session';
import { hold, report as reportFixture } from './problems/fixtures';
import { group, page, row } from './documents/fixtures';

vi.mock('../src/tasks/ProblemReportDetail', () => ({ ProblemReportDetail: (props: { projectKey: string; reportId: string; canManage: boolean; action?: string; section?: string; documents?: object }) =>
  <section aria-label="Authorized report detail" data-route={JSON.stringify({ action: props.action, section: props.section, documents: props.documents })}>{props.projectKey}, {props.reportId}, {String(props.canManage)}</section> }));
const { ProblemReportDetail } = await vi.importActual<typeof import('../src/tasks/ProblemReportDetail')>('../src/tasks/ProblemReportDetail');
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.sessionStorage.clear(); window.history.replaceState(null, '', '#/'); });
const project: ProjectSummary = { project_key: 'p/key', name: 'Project', can_manage: true, document_count: 1, description: null, roles: ['lead'], allowed_modes: ['independent'] };

it('waits for current project authority before mounting the exact encoded lead report destination', async () => {
  window.history.replaceState(null, '', '#/projects/p%2Fkey/problem-reports/report%2F1%20%25');
  const projects = deferred<ProjectSummary[]>(); vi.spyOn(api, 'listProjects').mockReturnValue(projects.promise);
  render(<App user={testUser('lead')} />);
  expect(screen.queryByRole('region', { name: 'Authorized report detail' })).toBeNull();
  await act(async () => projects.resolve([project]));
  expect((await screen.findByRole('region', { name: 'Authorized report detail' })).textContent).toBe('p/key, report/1 %, true');
});

it('answers a project member without management authority with "Problem report not found or no access" and a way to My tasks', async () => {
  window.history.replaceState(null, '', '#/projects/p%2Fkey/problem-reports/report-1');
  vi.spyOn(api, 'listProjects').mockResolvedValue([{ ...project, can_manage: false, roles: ['annotator'] }]);
  vi.spyOn(api, 'listMyTasks').mockReturnValue(new Promise(() => {}));
  // Not the viewer's report: the server refuses it like an unknown one.
  const seen = vi.spyOn(api, 'markProblemReportSeen').mockRejectedValue(new ApiError(404, 'Not found', 'REPORT_NOT_FOUND'));
  render(<App user={testUser('owner')} />);
  const heading = await screen.findByRole('heading', { name: 'Problem report not found or no access' });
  expect(seen).toHaveBeenCalledWith('report-1');
  expect(screen.queryByRole('heading', { name: 'You do not have access to this page.' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Authorized report detail' })).toBeNull();
  fireEvent.click(within(heading.parentElement!).getByRole('link', { name: 'My tasks' }));
  await waitFor(() => expect(window.location.hash).toBe(routeHref({ name: 'tasks', status: 'all' })));
  expect(screen.queryByRole('heading', { name: 'Problem report not found or no access' })).toBeNull();
});

it('passes the documents query and the resume action from the route to the report detail', async () => {
  window.history.replaceState(null, '', '#/projects/p%2Fkey/problem-reports/report-1?action=resume&documents_decision=all&documents_open=case%207%3Aen');
  vi.spyOn(api, 'listProjects').mockResolvedValue([project]);
  render(<App user={testUser('lead')} />);
  const detail = await screen.findByRole('region', { name: 'Authorized report detail' });
  // A legacy `documents_open` link still names the row: it becomes the row panel.
  expect(JSON.parse(detail.getAttribute('data-route') ?? '{}')).toEqual({ action: 'resume', documents: { decision: 'all', panel: 'case 7:en' } });
});

it('passes section=decide from the route to the report detail', async () => {
  window.history.replaceState(null, '', '#/projects/p%2Fkey/problem-reports/report-1?section=decide&documents_segment=decision');
  vi.spyOn(api, 'listProjects').mockResolvedValue([project]);
  render(<App user={testUser('lead')} />);
  const detail = await screen.findByRole('region', { name: 'Authorized report detail' });
  expect(JSON.parse(detail.getAttribute('data-route') ?? '{}')).toEqual({ section: 'decide', documents: { segment: 'decision' } });
});

const ownHold = (over = {}) => hold({ assignment_id: 1, owner_label: 'Reporter', case_id: 'case 7', language: 'en', ...over });
const report: ProblemReportView = reportFixture({ report_id: 'report-1', project_key: 'p/key', assignment_id: 1, document_id: 'doc-en', reason: 'Conflicting source evidence',
  revision: 2, held_assignment_ids: [1], reporter_label: 'Reporter', case_id: 'case 7', language: 'en', withdrawable: false, viewer_label: 'Lead', viewer_is_lead: true,
  holds: [ownHold()] });
const released: ProblemReportView = { ...report, revision: 3, held_assignment_ids: [], holds: [ownHold({ active: false, release_action: 'resume', released_by_label: 'Lead' })] };
const documents = { decision: 'all', language: 'en', open: ['case 7:en'] };
const visitKey = `ontotator:documents-visit:p/key:${JSON.stringify({ decision: 'all' })}`;
const snapshot = { categories: ['report'], work: [], final: null, reports: [] };
const decided = () => JSON.parse(window.sessionStorage.getItem(visitKey) ?? '{}').decided;

function mockReport() {
  vi.spyOn(api, 'getProblemReport').mockResolvedValue(report);
  vi.spyOn(api, 'listDocumentRows').mockResolvedValue({ groups: [] } as unknown as DocumentRowsPage);
  vi.spyOn(api, 'listPauseCandidates').mockResolvedValue([{ assignment_id: 2, owner_label: 'Reviewer', case_id: 'case 7', language: 'en', task: 'review', same_text: true, paused_by_this_report: false, reporter_task: false }]);
}
const intent = (name: RegExp | string) => within(screen.getByRole('group', { name: 'Decide on this report' }))
  .getAllByRole('button', { name }).find(button => button.hasAttribute('aria-controls'))!;
function confirmWith(title: string, intentName: string | null, reason: string, confirmLabel: string) {
  if (intentName) fireEvent.click(intent(intentName));
  const box = within(screen.getByRole('group', { name: title }));
  fireEvent.change(box.getAllByRole('textbox').pop()!, { target: { value: reason } });
  fireEvent.click(box.getByRole('button', { name: confirmLabel }));
}
const loaded = () => screen.findByRole('heading', { level: 1, name: 'case 7 en' });

it('links back to Documents with exactly the documents query from the route', async () => {
  mockReport(); const navigate = vi.fn();
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage documents={documents} onNavigate={navigate} />);
  await loaded();
  const back = screen.getAllByRole('link', { name: /Back to Documents/ })[0]!;
  const expected = { name: 'projectDocuments', key: 'p/key', ...documents } as const;
  expect(back.getAttribute('href')).toBe(routeHref(expected));
  fireEvent.click(back);
  expect(navigate).toHaveBeenCalledWith(expected);
});

it('links back to the row of the report when entered directly and leaves modified clicks to the browser', async () => {
  mockReport(); const navigate = vi.fn();
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage onNavigate={navigate} />);
  await loaded();
  const back = screen.getAllByRole('link', { name: /Back to Documents/ })[0]!;
  const expected = { name: 'projectDocuments', key: 'p/key', case: 'case 7', language: 'en' } as const;
  expect(back.getAttribute('href')).toBe(routeHref(expected));
  fireEvent.click(back, { ctrlKey: true });
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(back);
  expect(navigate).toHaveBeenCalledWith(expected);
});

it('preselects the pause release of the paused task with action=resume and submits nothing on its own', async () => {
  mockReport(); const apply = vi.spyOn(api, 'actOnProblemReport').mockResolvedValue(released);
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage action="resume" onNavigate={vi.fn()} />);
  const box = within(await screen.findByRole('group', { name: 'Release pause' }));
  expect(box.getByRole('checkbox', { name: /Task 1/ })).toHaveProperty('checked', true);
  expect(box.queryByRole('checkbox', { name: /Task 2/ })).toBeNull();
  expect(apply).not.toHaveBeenCalled();
  confirmWith('Release pause', null, 'Clarified', 'Release pause');
  await waitFor(() => expect(apply).toHaveBeenCalledWith('report-1', expect.objectContaining({ action: 'resume', assignment_ids: [1] })));
});

it('opens no confirmation without action=resume', async () => {
  mockReport();
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage onNavigate={vi.fn()} />);
  await loaded();
  expect(screen.queryByRole('group', { name: 'Release pause' })).toBeNull();
  expect(intent('Release pause…').getAttribute('aria-expanded')).toBe('false');
});

it.each(['resume', 'resolve'] as const)('records a %s in the Documents visit state when entered from Documents', async kind => {
  window.sessionStorage.setItem(visitKey, JSON.stringify({ shown: { 'case 7:en': snapshot }, decided: [] }));
  mockReport(); vi.spyOn(api, 'actOnProblemReport').mockResolvedValue(kind === 'resume' ? released : { ...report, revision: 3, state: 'resolved' });
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage documents={documents} action={kind === 'resume' ? 'resume' : undefined} onNavigate={vi.fn()} />);
  await loaded();
  expect(decided()).toEqual([]);
  if (kind === 'resume') confirmWith('Release pause', null, 'Done', 'Release pause');
  else confirmWith('Close report', 'Close, keep paused…', 'Done', 'Close report');
  await screen.findByText(kind === 'resume' ? /Released the pause/ : /Report closed/);
  expect(decided()).toEqual(['case 7:en']);
});

it('records no decision without the documents query, for other actions, or when the action fails', async () => {
  window.sessionStorage.setItem(visitKey, JSON.stringify({ shown: { 'case 7:en': snapshot }, decided: [] }));
  mockReport(); const apply = vi.spyOn(api, 'actOnProblemReport').mockResolvedValue({ ...report, revision: 3, state: 'resolved' });
  const view = render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage onNavigate={vi.fn()} />);
  await loaded();
  confirmWith('Close report', 'Close, keep paused…', 'Done', 'Close report');
  await screen.findByText(/Report closed/);
  expect(decided()).toEqual([]);
  view.unmount();

  apply.mockResolvedValue({ ...report, revision: 3, holds: [ownHold(), hold({ hold_id: 'h2', assignment_id: 2, owner_label: 'Reviewer', case_id: 'case 7', language: 'en' })] });
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage documents={documents} onNavigate={vi.fn()} />);
  await loaded();
  fireEvent.click(intent('Pause other tasks…'));
  fireEvent.click(await within(screen.getByRole('group', { name: 'Pause other tasks' })).findByRole('checkbox', { name: /Task 2/ }));
  confirmWith('Pause other tasks', null, 'Same conflict', 'Pause 1 task');
  await screen.findByText(/Paused Task 2/);
  expect(decided()).toEqual([]);

  apply.mockRejectedValue(new Error('Conflict'));
  confirmWith('Close report', 'Close, keep paused…', 'Done', 'Close report');
  await screen.findByText('Could not save. Nothing changed.');
  expect(decided()).toEqual([]);
});

it('opens at Decide with its heading focused when section=decide', async () => {
  mockReport();
  const scroll = vi.fn(); const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  try {
    render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage section="decide" documents={documents} onNavigate={vi.fn()} />);
    const heading = await screen.findByRole('heading', { level: 2, name: 'Decide' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(scroll).toHaveBeenCalled();
  } finally { Element.prototype.scrollIntoView = original; }
});

it('keeps focus where it is without section=decide', async () => {
  mockReport();
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage documents={documents} onNavigate={vi.fn()} />);
  const heading = await screen.findByRole('heading', { level: 2, name: 'Decide' });
  expect(document.activeElement).not.toBe(heading);
});

it('after a decision offers Back to Documents and Next decision under a segment filter', async () => {
  const segment = { segment: 'decision', panel: 'case 7:en', panel_stage: 'annotation' };
  mockReport();
  const rows = vi.mocked(api.listDocumentRows).mockImplementation(async (_key, filters = {}) => filters.segment === 'decision'
    ? page([group('case 7', [row({ case_id: 'case 7', language: 'en' })]), group('case-0101', [row({ case_id: 'case-0101', language: 'en', retained: true })]),
      group('case-0102', [row({ case_id: 'case-0102', language: 'de' })])])
    : page([]));
  vi.spyOn(api, 'actOnProblemReport').mockResolvedValue({ ...report, revision: 3, state: 'resolved' });
  const navigate = vi.fn();
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage section="decide" documents={segment} onNavigate={navigate} />);
  await loaded();
  expect(screen.queryByRole('link', { name: /Next decision/ })).toBeNull();
  confirmWith('Close report', 'Close, keep paused…', 'Done', 'Close report');
  const outcome = (await screen.findByText(/Report closed/)).closest('.lead-outcome') as HTMLElement;
  expect(within(outcome).getByRole('link', { name: 'Back to Documents' }).getAttribute('href')).toBe(routeHref({ name: 'projectDocuments', key: 'p/key', ...segment }));
  const next = await within(outcome).findByRole('link', { name: 'Next decision: case-0102 de' });
  // The next decision opens in the row panel (the legacy `open=` list became `panel`), unfiltered.
  const expected: Route = { name: 'projectDocuments', key: 'p/key', segment: 'decision', panel: 'case-0102:de', panel_stage: undefined, panel_tab: undefined };
  expect(next.getAttribute('href')).toBe(routeHref(expected));
  expect(rows).toHaveBeenCalledWith('p/key', expect.objectContaining({ segment: 'decision' }));
  expect(within(outcome).queryAllByRole('button')).toEqual([]);
  fireEvent.click(next);
  expect(navigate).toHaveBeenCalledWith(expected);
});

it('offers no Next decision without a segment filter', async () => {
  mockReport(); vi.spyOn(api, 'actOnProblemReport').mockResolvedValue({ ...report, revision: 3, state: 'resolved' });
  render(<ProblemReportDetail projectKey="p/key" reportId="report-1" canManage documents={{ language: 'en', panel: 'case 7:en' }} onNavigate={vi.fn()} />);
  await loaded();
  confirmWith('Close report', 'Close, keep paused…', 'Done', 'Close report');
  await screen.findByText(/Report closed/);
  expect(api.listDocumentRows).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link', { name: /Next decision/ })).toBeNull();
});
