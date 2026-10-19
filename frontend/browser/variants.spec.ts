import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, loginExisting, openCase, selectText, submitCase } from './helpers';

test.setTimeout(90_000);

type VersionRef = components['schemas']['VersionRef'];
type Workspace = components['schemas']['AssignmentOpenResponse'];
type Scenario = {
  project: string; case_id: string;
  import_job_id: number;
  children: { id: number; status: string; error: string | null; result: { sets: number; carried: number; needs_review: number }; old_document_id: string; new_document_id: string }[];
  documents: Record<'source' | 'target' | 'other' | 'corrected', string>;
  texts: Record<'source' | 'target', string>;
  users: Record<'alice' | 'bob' | 'reader' | 'reviewer' | 'lead', string>;
  assignments: Record<'alice' | 'alice_source' | 'bob' | 'reader', number>;
};
const documentPath = (s: Scenario, document: string, suffix: string) =>
  `/api/v1/projects/${encodeURIComponent(s.project)}/documents/${encodeURIComponent(document)}/${suffix}`;
const viewerUrl = (s: Scenario, document: string, annotations = 'text') =>
  `/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}?${new URLSearchParams({ variant: document, annotations })}`;
const token = (ref: VersionRef) => JSON.stringify([ref.kind, ref.id]);

async function openVersions(page: Page) {
  const disclosure = page.locator('details.case-version-controls, details.comparison-identity-choices');
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).toBeVisible();
  if (!await disclosure.evaluate(node => (node as HTMLDetailsElement).open)) {
    await disclosure.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
  }
}
async function scenario(page: Page): Promise<Scenario> {
  const response = await page.request.post('/__test_variants__', { params: { browse: 'true' }, timeout: 90_000 });
  expect(response.ok()).toBeTruthy();
  const value = await response.json() as Scenario;
  const proof = { project: value.project, import_job_id: value.import_job_id, children: value.children };
  await test.info().attach('fixture-import-children', { body: Buffer.from(JSON.stringify(proof, null, 2)), contentType: 'application/json' });
  console.log('Fixture import-child proof:', JSON.stringify(proof));
  for (const child of value.children) expect(child.status).toBe('succeeded');
  return value;
}
async function offered(page: Page, s: Scenario, document = s.documents.target): Promise<VersionRef[]> {
  const response = await authenticatedRequest(page, documentPath(s, document, 'annotation-versions'));
  expect(response.ok()).toBeTruthy();
  return await response.json() as VersionRef[];
}
async function leadPage(browser: Browser, s: Scenario) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await loginExisting(page, s.users.lead);
  return { page, close: () => context.close() };
}
async function reopen(browser: Browser, s: Scenario, assignmentId: number) {
  const lead = await leadPage(browser, s);
  try {
    const response = await authenticatedRequest(lead.page, `/api/v1/assignments/${assignmentId}/reopen`, 'POST', { reason: 'Browser history inspection' });
    expect(response.ok()).toBeTruthy();
  } finally { await lead.close(); }
}
/** Setup outside the tested journey: genuine commands/submission through this actor's cookies. */
async function ownSubmission(page: Page, assignmentId: number) {
  const opened = await authenticatedRequest(page, `/api/v1/assignments/${assignmentId}/open`, 'POST');
  expect(opened.ok()).toBeTruthy();
  const workspace = await opened.json() as Workspace;
  const path = `/api/v1/workspaces/${encodeURIComponent(workspace.workspace_id)}`;
  const created = await authenticatedRequest(page, `${path}/commands`, 'POST', {
    mutation_id: randomUUID(), expected_revision: workspace.view.draft.revision,
    payload: { command: 'create_annotation', annotation_id: randomUUID(), evidence_id: randomUUID(),
      layer_id: 'hpo', type_id: 'phenotype', term_id: 'HP:0001252', segments: [{ start: 0, end: 9 }],
      axes_values: { assertion: 'present', experiencer: 'patient', temporality: 'current' } },
  });
  expect(created.ok()).toBeTruthy();
  const draft = await created.json() as components['schemas']['Draft'];
  const submitted = await authenticatedRequest(page, `${path}/submit`, 'POST', {
    mutation_id: randomUUID(), expected_revision: draft.revision,
    payload: { command: 'submit_workspace', document_checked: true, checked_layer_ids: ['hpo'] },
  });
  expect(submitted.ok()).toBeTruthy();
  return await submitted.json() as components['schemas']['Submission'];
}
const textSurface = (page: Page) => page.locator('.text-container');
async function expectExactText(page: Page, text: string) {
  await expect.poll(() => textSurface(page).textContent()).toBe(text);
}
async function options(page: Page) {
  await openVersions(page);
  return page.getByLabel('Annotations', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, label: node.textContent })));
}

test('mixed-role assigned task opens the real case, exact equal-version runs and opaque immutable text survive reload', async ({ page }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.alice);
  const me = await (await authenticatedRequest(page, '/api/v1/auth/me')).json();
  expect(me.is_system_admin).toBe(false);
  const projects = await (await authenticatedRequest(page, '/api/v1/projects')).json() as { project_key: string; roles: string[] }[];
  expect(projects.find(project => project.project_key === s.project)?.roles).toEqual(['adjudicator', 'annotator']);
  await openCase(page, { documentId: s.documents.target });
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignments.alice}$`));
  await openVersions(page);
  await expect(page.getByLabel('Text version', { exact: true })).toHaveValue(s.documents.target);
  await openVersions(page);
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await expectExactText(page, s.texts.source);
  expect(decodeURIComponent(new URL(page.url()).hash)).toContain(s.case_id);
  await page.reload();
  await expectExactText(page, s.texts.source);
  await openVersions(page);
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await openVersions(page);
  await page.getByLabel('Text version', { exact: true }).selectOption(s.documents.target);
  await expectExactText(page, s.texts.target);
  await openVersions(page);
  const versions = await page.getByLabel('Text version', { exact: true }).locator('option').allTextContents();
  expect(versions.filter(label => label.startsWith('v1'))).toHaveLength(2);
  expect(new Set(versions).size).toBe(versions.length);
  await openVersions(page);
  await page.getByLabel('Text version', { exact: true }).selectOption(s.documents.other);
  const selectedUrl = page.url();
  await page.reload();
  await openVersions(page);
  await expect(page.getByLabel('Text version', { exact: true })).toHaveValue(s.documents.other);
  await expect(page).toHaveURL(selectedUrl);
  await expect(page.getByRole('link', { name: 'Open my task', exact: true })).toHaveCount(0);
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && /\/api\/v1\/(workspaces|assignments)/.test(request.url())) writes.push(request.url()); });
  await page.goto(viewerUrl(s, s.documents.source));
  await expectExactText(page, s.texts.source);
  expect(writes).toEqual([]);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/not-readable`);
  await expect(page.getByText('This case is not available to you.', { exact: true })).toBeVisible();
  await expect(textSurface(page)).toHaveCount(0);
});

test('own history is genuinely submitted, read-only and return-to-draft preserves submitted locking then reopened work', async ({ page, browser }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.alice);
  await openCase(page, { documentId: s.documents.target });
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  const assertion = page.getByRole('group', { name: 'Assertion', exact: true }).getByRole('radio', { name: 'Present', exact: true });
  const temporality = page.getByRole('group', { name: 'Temporality', exact: true }).getByRole('radio', { name: 'Current', exact: true });
  const experiencer = page.getByLabel('Experiencer', { exact: true });
  await assertion.click();
  await expect(assertion).toBeChecked();
  await expect(page.locator('.status-badge')).toContainText('Saved');
  await experiencer.selectOption('patient');
  await expect(experiencer).toHaveValue('patient');
  await expect(page.locator('.status-badge')).toContainText('Saved');
  await temporality.click();
  await expect(temporality).toBeChecked();
  await expect(page.locator('.status-badge')).toContainText('Saved');
  await submitCase(page);
  await page.reload();
  const refs = await offered(page, s);
  const own = refs.find(ref => ref.kind === 'own');
  expect(own).toBeTruthy();
  await openVersions(page);
  await page.getByLabel('Annotations', { exact: true }).selectOption(token(own!));
  await expect(page.getByText(`Viewing ${own!.label} (read-only)`, { exact: true })).toBeVisible();
  await expect(page.locator('.readonly-annotations')).toContainText('HP:0001252');
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/workspaces\/.+\/(commands|decisions|submit)/.test(request.url())) writes.push(request.url()); });
  await textSurface(page).focus();
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('n');
  await selectText(page, 14, 20);
  await expect(page.locator('.resize-handle')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Submit case', exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Back to my draft', exact: true }).click();
  await expect(page.getByRole('button', { name: /Finish & Submit Case/ })).toBeDisabled();
  await reopen(browser, s, s.assignments.alice);
  await page.reload();
  await expect(page.getByRole('button', { name: /Finish & Submit Case/ })).toBeEnabled();
  await expect(page.locator('.sidebar')).toContainText('HP:0001252');
  await openVersions(page);
  await page.getByLabel('Annotations', { exact: true }).selectOption(token(own!));
  await expect(page.locator('.readonly-annotations')).toContainText('HP:0001252');
  await page.getByRole('button', { name: 'Back to my draft', exact: true }).click();
  await expect(page.getByRole('button', { name: /Finish & Submit Case/ })).toBeEnabled();
  await expect(page.locator('.sidebar')).toContainText('HP:0001252');
  await expect(page.locator('.sidebar .badge-ai')).toHaveCount(0);
});

test('current own refs, foreign submissions and sibling proposal sets are independently authorized', async ({ page, browser }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.bob);
  const bob = await ownSubmission(page, s.assignments.bob);
  // A fresh actor context; no blanket role provisioning on either login.
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const alice = await context.newPage();
  try {
    await loginExisting(alice, s.users.alice);
    const own = await ownSubmission(alice, s.assignments.alice);
    const refs = await offered(alice, s);
    expect(refs.filter(ref => ref.kind === 'own').map(ref => ref.id)).toEqual([own.submission_id]);
    expect(refs.some(ref => ref.id === bob.submission_id)).toBe(false);
    const forged = await authenticatedRequest(alice, documentPath(s, s.documents.target, `annotation-versions/own/${encodeURIComponent(bob.submission_id)}`));
    expect(forged.status()).toBe(404);
    await alice.goto(viewerUrl(s, s.documents.target));
    await expectExactText(alice, s.texts.target);
    await expect.poll(async () => (await options(alice)).filter(option => option.value !== 'text').map(option => option.value)).toEqual(refs.map(token));
    const readerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const reader = await readerContext.newPage();
    try {
      await loginExisting(reader, s.users.reader);
      const missing = await authenticatedRequest(reader, documentPath(s, 'unassigned-other-case', 'text'));
      expect(missing.status()).toBe(404);
      const sibling = await authenticatedRequest(reader, documentPath(s, s.documents.target, 'text'));
      expect(sibling.ok()).toBeTruthy();
      const proposals = (await offered(reader, s, s.documents.source)).find(ref => ref.kind === 'proposals');
      expect(proposals).toBeTruthy();
      await reader.goto(viewerUrl(s, s.documents.source, token(proposals!)));
      await expect(reader.locator('.readonly-annotations')).toContainText('HP:0001252');
      const denied = await authenticatedRequest(alice, documentPath(s, s.documents.source, `annotation-versions/proposals/${encodeURIComponent(proposals!.id)}`));
      expect(denied.status()).toBe(404);
      const producer = await authenticatedRequest(alice, `/api/v1/projects/${encodeURIComponent(s.project)}/proposal-sets/${encodeURIComponent(proposals!.id)}`);
      expect(producer.status()).toBe(404);
    } finally { await readerContext.close(); }
    const lead = await leadPage(browser, s);
    try {
      const foreign = await authenticatedRequest(lead.page, documentPath(s, s.documents.target, `annotation-versions/own/${encodeURIComponent(own.submission_id)}`));
      expect(foreign.status()).toBe(404);
      const revoked = await authenticatedRequest(lead.page, `/api/v1/assignments/${s.assignments.alice}/revoke`, 'POST', { reason: 'Exact read authority removed' });
      expect(revoked.ok()).toBeTruthy();
    } finally { await lead.close(); }
    // The retained source assignment grants sibling text, never revoked exact history.
    await alice.goto(viewerUrl(s, s.documents.target));
    await expectExactText(alice, s.texts.target);
    expect(await offered(alice, s)).toEqual([]);
    const concealed = await authenticatedRequest(alice, documentPath(s, s.documents.target, `annotation-versions/own/${encodeURIComponent(own.submission_id)}`));
    expect(concealed.status()).toBe(404);
  } finally { await context.close(); }
});

test('dirty failed-save snapshot cancellation preserves focus and real native Back/Forward history', async ({ page, browser }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.alice);
  await ownSubmission(page, s.assignments.alice);
  await reopen(browser, s, s.assignments.alice);
  await page.goto('/');
  await openCase(page, { documentId: s.documents.target });
  const taskUrl = page.url();
  await openVersions(page);
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await expectExactText(page, s.texts.source);
  await page.goBack();
  await expect(page).toHaveURL(taskUrl);
  await openVersions(page);
  await expect(page.getByLabel('Annotations', { exact: true })).toHaveValue('draft');
  const failCommands = '**/api/v1/workspaces/*/commands';
  await page.route(failCommands, route => route.abort('failed'));
  await page.locator('.sidebar [data-list-key^="annotation:"]').first().click();
  const absent = page.getByRole('group', { name: 'Assertion', exact: true }).getByRole('radio', { name: 'Absent', exact: true });
  await absent.click();
  await expect(page.locator('.status-badge')).toContainText('Offline – changes not saved');
  await openVersions(page);
  const annotations = page.getByLabel('Annotations', { exact: true });
  const own = (await offered(page, s)).find(ref => ref.kind === 'own')!;
  await annotations.focus();
  await annotations.selectOption(token(own));
  const cancel = async () => {
    const dialog = page.getByRole('dialog', { name: 'Changes not saved', exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(taskUrl);
    await expect(annotations).toHaveValue('draft');
  };
  await cancel();
  await expect(annotations).toBeFocused();
  await page.goForward(); await cancel();
  await page.goBack(); await cancel();
  await page.goBack(); await cancel();
  await page.unroute(failCommands);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.status-badge')).toContainText('Saved');
  await openVersions(page);
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await expectExactText(page, s.texts.source);
  await page.reload(); await expectExactText(page, s.texts.source);
});

test('wide editor keeps the real text and docked inspector/tree floors with visible selectors', async ({ page, browser }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.alice);
  await ownSubmission(page, s.assignments.alice);
  await reopen(browser, s, s.assignments.alice);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/#/tasks/${s.assignments.alice}`);
  await page.locator('.sidebar [data-list-key^="annotation:"]').first().click();
  await page.getByRole('button', { name: 'Show in tree', exact: true }).click();
  await expect(page.getByRole('tree', { name: 'Terms' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const rect = async (selector: string) => {
    const box = await page.locator(selector).boundingBox(); expect(box).not.toBeNull(); return box!;
  };
  const text = await rect('.app-layout > .center-pane'), sidebar = await rect('.app-layout > .sidebar');
  const inspector = await rect('.inspector-pane'), tree = await rect('.tree-host');
  expect(text.width).toBeGreaterThanOrEqual(500); expect(text.height).toBeGreaterThanOrEqual(500);
  expect(inspector.width).toBeGreaterThanOrEqual(370); expect(inspector.height).toBeGreaterThanOrEqual(200);
  expect(tree.height).toBeGreaterThanOrEqual(300); expect(tree.width).toBeGreaterThanOrEqual(300);
  expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(text.x + 1);
  expect(text.x + text.width).toBeLessThanOrEqual(inspector.x + 1);
  expect(Math.abs(tree.x - inspector.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tree.y - inspector.y - inspector.height)).toBeLessThanOrEqual(1);
  expect(tree.x + tree.width).toBeLessThanOrEqual(1281); expect(tree.y + tree.height).toBeLessThanOrEqual(721);
  await openVersions(page);
  await expect(page.getByLabel('Language', { exact: true })).toBeVisible();
  await openVersions(page);
  await expect(page.getByLabel('Text version', { exact: true })).toBeVisible();
  await openVersions(page);
  await expect(page.getByLabel('Annotations', { exact: true })).toBeVisible();
});

for (const width of [1024, 700, 600]) test(`viewer selectors and immutable text remain reachable at ${width}px`, async ({ page }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.alice);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viewerUrl(s, s.documents.target));
  await expectExactText(page, s.texts.target);
  await page.evaluate(() => document.fonts.ready);
  await openVersions(page);
  for (const label of ['Language', 'Text version', 'Annotations']) {
    const select = page.getByLabel(label, { exact: true }); await expect(select).toBeVisible();
    await select.focus(); await expect(select).toBeFocused();
    const box = await select.boundingBox(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  const text = await textSurface(page).boundingBox(); expect(text).not.toBeNull();
  expect(text!.height).toBeGreaterThanOrEqual(200); expect(text!.width).toBeGreaterThanOrEqual(280);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: test.info().outputPath(`variants-${width}.png`), fullPage: true });
});


test('restricted annotator completes exact assigned work and retains pending own history without general browsing', async ({ page }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.bob);
  const projects = await (await authenticatedRequest(page, '/api/v1/projects')).json() as { project_key: string; roles: string[] }[];
  expect(projects.find(row => row.project_key === s.project)?.roles).toEqual(['annotator']);
  const generalReads: string[] = [];
  page.on('request', request => { if (request.method() === 'GET' && /annotation-versions|\/cases\//.test(request.url())) generalReads.push(request.url()); });
  await openCase(page, { documentId: s.documents.target });
  await expect(page.locator('.text-container')).toHaveText(s.texts.target);
  await expect(page.getByText('Versions', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveCount(0);
  expect(generalReads).toEqual([]);
  const own = await ownSubmission(page, s.assignments.bob);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Submission history', exact: true })).toBeVisible();
  const historyLabel = await page.evaluate(createdAt => `Submission 1 · ${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(createdAt))}`, own.created_at);
  await page.getByRole('button', { name: historyLabel, exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Historical submission' });
  await history.getByText('Technical details', { exact: true }).click();
  await expect(history.getByText(own.submission_id, { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('restricted-own-history.png'), fullPage: true });
  for (const suffix of ['variant', 'text']) {
    const denied = await authenticatedRequest(page, documentPath(s, s.documents.source, suffix));
    expect(denied.status()).toBe(404);
    expect((await denied.json()).code).toBe('DOCUMENT_NOT_FOUND');
  }
  const forbidden = await authenticatedRequest(page, documentPath(s, s.documents.target, 'annotation-versions/proposals/1'));
  expect(forbidden.status()).toBe(404);
  expect((await forbidden.json()).code).toBe('VERSION_NOT_FOUND');
  await page.goto(viewerUrl(s, s.documents.target, token({ kind: 'own', id: own.submission_id } as VersionRef)));
  await expect(page.getByText('This annotation version is not available to you.', { exact: true })).toBeVisible();
  await expect(textSurface(page)).toHaveCount(0);
  await page.goto(viewerUrl(s, s.documents.source));
  await expect(page.getByText('This text version is not available to you.', { exact: true })).toBeVisible();
  await expect(textSurface(page)).toHaveCount(0);
});
