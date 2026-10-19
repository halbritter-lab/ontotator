import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type FinalPreflight } from '../src/api/client';
import { ProjectDashboardPage } from '../src/admin/ProjectDashboardPage';

const projection: FinalPreflight = { project: 'p', selections: [], warnings: [{ id: 'held', code: 'OPEN_PROBLEM_REPORT',
  cause_revision: 2, case_id: 'GSC17', language: 'de', document_id: 'old', reason: 'Text wording needs review', destination: '#/tasks/7' }],
  omissions: [{ case_id: 'GSC17', language: 'de' }], state_digest: 'a'.repeat(64) };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('shows server-projected text/language/reason and the exact direct issue destination', async () => {
  vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValue(projection);
  render(<ProjectDashboardPage projectKey="p" />);
  await screen.findByText('Text wording needs review');
  expect(screen.getByText('GSC17 · de')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Review issue' }).getAttribute('href')).toBe('#/tasks/7');
  expect(screen.getByText(/Omitted without a final selection: GSC17/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Review final export' }).getAttribute('href')).toBe('#/projects/p/export');
});

it('shows the explicit empty state and recovers a failed projection via refresh', async () => {
  vi.spyOn(api, 'getWorkflowWarnings').mockRejectedValueOnce(new Error('Warnings unavailable'))
    .mockResolvedValue({ ...projection, warnings: [], omissions: [] });
  render(<ProjectDashboardPage projectKey="p" />);
  await screen.findByText('Warnings unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh final results' }));
  await screen.findByText('No open workflow warnings.');
  expect(screen.queryByText('Warnings unavailable')).toBeNull();
});

it('drops old-project warnings immediately and ignores late replies on project replacement', async () => {
  let finish!: (state: FinalPreflight) => void;
  vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValueOnce(projection)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ProjectDashboardPage projectKey="p" />);
  await screen.findByText('Text wording needs review');
  view.rerender(<ProjectDashboardPage projectKey="other" />);
  expect(screen.queryByText('Text wording needs review')).toBeNull();
  await act(async () => finish({ ...projection, project: 'other', warnings: [], omissions: [] }));
  await screen.findByText('No open workflow warnings.');
});
