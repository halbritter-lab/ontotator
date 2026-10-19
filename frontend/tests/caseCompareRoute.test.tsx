import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type ProjectSummary } from '../src/api/client';
import { App } from '../src/App';
import { routeHref } from '../src/app/router';
import { refKey } from '../src/variants/versionState';
import { testUser } from './session';
import { caseDetail, historical, ownRef } from './variantFixtures';

const project: ProjectSummary = { project_key: 'pkg', name: 'Project', can_manage: true, document_count: 1, description: null, roles: ['lead'], allowed_modes: ['independent'] };
const linked = { ...ownRef, kind: 'submission' as const, id: 'sub-2', label: 'ann-0002 · submission' };

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(api, 'listProjects').mockResolvedValue([project]);
  vi.spyOn(api, 'getWorkflowWarnings').mockResolvedValue({ project: 'pkg', selections: [], warnings: [], omissions: [], state_digest: 'a'.repeat(64) });
  vi.spyOn(api, 'getCase').mockResolvedValue(caseDetail);
  vi.spyOn(api, 'getVariantText').mockImplementation(async (_project, doc) => ({ document_id: doc, text: `Immutable ${doc}`, text_sha256: 'text' }));
  vi.spyOn(api, 'listAnnotationVersions').mockResolvedValue([ownRef, linked]);
  vi.spyOn(api, 'getAnnotationVersion').mockResolvedValue(historical);
  vi.spyOn(api, 'listMyTasks').mockResolvedValue([]);
  vi.spyOn(api, 'resolveTermLabels').mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '#/'); });

it('opens the comparison with the right side of the compare query when navigated through App', async () => {
  window.history.replaceState(null, '', routeHref({ name: 'projectCase', key: 'pkg', caseId: caseDetail.case_id, variant: 'target',
    annotations: refKey(ownRef), compare: refKey(linked), documents: { decision: 'all', open: [`${caseDetail.case_id}:de`] } }));
  render(<App user={testUser('lead')} />);
  const panel = await screen.findByRole('region', { name: 'Comparison' });
  await waitFor(() => expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'submission', 'sub-2'));
  expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'own', ownRef.id);
  expect(within(panel).getByLabelText<HTMLSelectElement>('Text version').value).toBe('target');
  expect(within(panel).getByLabelText<HTMLSelectElement>('Annotations').value).toBe(refKey(linked));
});

it('keeps the viewer without a comparison when the route has no compare query', async () => {
  window.history.replaceState(null, '', routeHref({ name: 'projectCase', key: 'pkg', caseId: caseDetail.case_id, variant: 'target', annotations: refKey(ownRef) }));
  render(<App user={testUser('lead')} />);
  await screen.findByRole('button', { name: 'Compare' });
  expect(screen.queryByRole('region', { name: 'Comparison' })).toBeNull();
});
