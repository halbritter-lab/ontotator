import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type ProjectSummary } from '../src/api/client';
import { App } from '../src/App';
import { deferred } from './projectFixtures';
import { testUser } from './session';

vi.mock('../src/tasks/ProblemReportDetail', () => ({ ProblemReportDetail: (props: { projectKey: string; reportId: string; canManage: boolean }) =>
  <section aria-label="Authorized report detail">{props.projectKey} · {props.reportId} · {String(props.canManage)}</section> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '#/'); });
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
