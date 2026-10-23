import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { api } from '../src/api/client';
import { routeHref } from '../src/app/router';
import { testUser } from './session';
import { assigned, taskOf, workspaceFixture as emptyWorkspaceFixture } from './assignments';
import { caseDetail } from './variantFixtures';

/** A real editable finding lets navigation tests queue an annotation save. */
function workspaceFixture(...args: Parameters<typeof emptyWorkspaceFixture>) {
  const response = emptyWorkspaceFixture(...args);
  response.view.layers![0].annotation_types[0].axes = [{ id: 'assertion', label: 'Assertion', options: ['present', 'absent'], allow_empty: true }];
  response.view.draft.annotations = [{ schema_version: 'ontocurator-annotation/v3', version: 'pending-v1',
    document_id: response.view.document.document_id, text_sha256: 'text', ontology_sha256: 'ontology', layer_config_sha256: 'layer',
    annotation: { annotation_id: 'pending-finding', document_id: response.view.document.document_id, layer_id: 'phenotype',
      type_id: 'default', term_id: 'HP:0001252', axes_values: {}, evidence_refs: [],
      provenance: { actor: { actor_id: response.view.key.annotator_id, kind: 'human' }, method: 'manual', source_refs: [] } }, evidence: [] }];
  return response;
}
async function editFinding() {
  await waitFor(() => expect(document.querySelector('[data-list-key="annotation:pending-finding"]')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-list-key="annotation:pending-finding"]')!);
  fireEvent.click(screen.getByRole('radio', { name: 'Present' }));
}


beforeEach(() => {
  vi.spyOn(api, 'listProjects').mockResolvedValue([{ project_key: 'pkg', roles: ['lead', 'annotator'], can_manage: true } as any]);
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
  vi.spyOn(api, 'getAssignmentMetadata').mockResolvedValue(assigned(response, 17).assignment);
  vi.mocked(api.listMyTasks).mockResolvedValue([taskOf(response.view, 17)]);
  vi.spyOn(api, 'applyCommand').mockRejectedValue(new TypeError('Offline'));
  render(<App user={testUser('alice')} />);
  await editFinding();
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
it('documents Open link preserves opaque IDs, guarded navigation and native modified clicks', async () => {
  const { DocumentsPage } = await import('../src/admin/DocumentsPage');
  const fixtures = await import('./documents/fixtures');
  vi.spyOn(api, 'listDocumentRows').mockResolvedValue(fixtures.page([fixtures.group(caseDetail.case_id, [
    fixtures.row({ case_id: caseDetail.case_id, language: 'en', versions: [fixtures.version({ document_id: 'z/doc' })] }),
  ])]));
  vi.spyOn(api, 'listProjectDocuments').mockResolvedValue([]);
  vi.spyOn(api, 'listCases').mockResolvedValue([]);
  vi.spyOn(api, 'getProjectSettings').mockResolvedValue({ languages: [] } as never);
  vi.spyOn(api, 'listMembers').mockResolvedValue([]);
  vi.spyOn(api, 'listAssignments').mockResolvedValue([]);
  const onNavigate = vi.fn();
  render(<DocumentsPage projectKey="p/ %" canManage query={{}} onNavigate={onNavigate} />);
  const link = await screen.findByRole('link', { name: `Open in editor, ${caseDetail.case_id}, en` });
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
  vi.spyOn(api, 'getAssignmentMetadata').mockResolvedValue(assigned(response, 7).assignment);
  render(<App user={testUser('alice')} />);
  fireEvent.click(await screen.findByRole('link', { name: 'Open my task' }));
  await screen.findByTestId('annotator-identity');
  expect(window.location.hash).toBe('#/tasks/7');
  expect(api.openAssignment).toHaveBeenCalledOnce();
  expect(api.openAssignment).toHaveBeenCalledWith(7);
});
