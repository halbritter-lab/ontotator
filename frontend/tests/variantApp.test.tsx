import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { api } from '../src/api/client';
import { routeHref } from '../src/app/router';
import { testUser } from './session';
import { assigned, taskOf, workspaceFixture } from './assignments';
import { caseDetail } from './variantFixtures';

beforeEach(() => {
  vi.spyOn(api, 'listProjects').mockResolvedValue([]);
  vi.spyOn(api, 'getCase').mockResolvedValue(caseDetail);
  vi.spyOn(api, 'getVariantMetadata').mockResolvedValue(caseDetail.variants[1]);
  vi.spyOn(api, 'getVariantText').mockResolvedValue({ document_id: 'target', text: 'Actual immutable text', text_sha256: 'text' });
  vi.spyOn(api, 'listAnnotationVersions').mockResolvedValue([]);
  vi.spyOn(api, 'listMyTasks').mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '#/'); });

it('mounts the actual encoded case route in one reading Shell without opening work', async () => {
  window.history.replaceState(null, '', routeHref({ name: 'projectCase', key: 'p/ %', caseId: caseDetail.case_id, variant: 'target', annotations: 'text' }));
  const open = vi.spyOn(api, 'openAssignment');
  render(<App user={testUser('alice')} />);
  await screen.findByText('Actual immutable text');
  expect(api.getCase).toHaveBeenCalledWith('p/ %', caseDetail.case_id);
  expect(screen.getAllByRole('banner')).toHaveLength(1);
  expect(document.querySelectorAll('.shell')).toHaveLength(1);
  expect(document.querySelector('.shell-reading')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});
it('keeps the real task, URL and text after cancelling a failed-save sibling transition', async () => {
  const response = workspaceFixture('target');
  window.history.replaceState(null, '', '#/tasks/17');
  vi.spyOn(api, 'openAssignment').mockResolvedValue(assigned(response, 17));
  vi.mocked(api.listMyTasks).mockResolvedValue([taskOf(response.view, 17)]);
  vi.spyOn(api, 'applyCommand').mockRejectedValue(new TypeError('Offline'));
  render(<App user={testUser('alice')} />);
  fireEvent.click(await screen.findByRole('button', { name: /Mark Phenotype as verified/ }));
  await screen.findByText('Offline – changes not saved');
  const text = document.querySelector('.text-container');
  fireEvent.change(await screen.findByLabelText('Language'), { target: { value: 'en' } });
  const dialog = await screen.findByRole('dialog', { name: 'Changes not saved' });
  expect(window.location.hash).toBe('#/tasks/17');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.querySelector('.text-container')).toBe(text);
  expect(window.location.hash).toBe('#/tasks/17');
  expect(api.getVariantText).not.toHaveBeenCalled();
  expect(api.openAssignment).toHaveBeenCalledOnce();
  expect(api.openAssignment).toHaveBeenCalledWith(17);
});
it('documents case link preserves opaque IDs, guarded navigation and native modified clicks', async () => {
  const { DocumentsPage } = await import('../src/admin/DocumentsPage');
  const { documents } = await import('./assignmentFixtures');
  vi.spyOn(api, 'listProjectDocuments').mockResolvedValue([{ ...documents[0], case_id: caseDetail.case_id }]);
  vi.spyOn(api, 'getProjectSettings').mockResolvedValue({ languages: [] } as never);
  vi.spyOn(api, 'listMembers').mockResolvedValue([]);
  vi.spyOn(api, 'listAssignments').mockResolvedValue([]);
  const onNavigate = vi.fn();
  render(<DocumentsPage projectKey="p/ %" query={{}} onNavigate={onNavigate} />);
  const link = await screen.findByRole('link', { name: 'View case for z/doc' });
  const destination = { name: 'projectCase' as const, key: 'p/ %', caseId: caseDetail.case_id, variant: 'z/doc' };
  expect(link.getAttribute('href')).toBe(routeHref(destination));
  fireEvent.click(link, { ctrlKey: true }); expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.click(link); expect(onNavigate).toHaveBeenCalledWith(destination);
});
it('opens only the actual supported assignment from the viewer through the real TaskEditor', async () => {
  const response = workspaceFixture('target');
  window.history.replaceState(null, '', routeHref({ name: 'projectCase', key: 'pkg', caseId: caseDetail.case_id, variant: 'target' }));
  vi.mocked(api.listMyTasks).mockResolvedValue([taskOf(response.view, 7)]);
  vi.spyOn(api, 'openAssignment').mockResolvedValue(assigned(response, 7));
  render(<App user={testUser('alice')} />);
  fireEvent.click(await screen.findByRole('link', { name: 'Open my task' }));
  await screen.findByTestId('annotator-identity');
  expect(window.location.hash).toBe('#/tasks/7');
  expect(api.openAssignment).toHaveBeenCalledOnce();
  expect(api.openAssignment).toHaveBeenCalledWith(7);
});
