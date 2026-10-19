import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, loginExisting, TEST_PASSWORD } from './helpers';

test.setTimeout(90_000);
type ReviewWorkspace = components['schemas']['ReviewWorkspace'];
type ReviewRecord = components['schemas']['TranslationReviewRecord'];
type Assignment = components['schemas']['AssignmentView'];
type Variant = components['schemas']['VariantInfo'];
type Scenario = {
  project: string; case_id: string; external_id: string; import_job_id: number;
  documents: Record<'source' | 'target' | 'failed', string>;
  texts: Record<'source' | 'target' | 'failed', string>;
  users: Record<'lead' | 'reviewer' | 'other', string>;
  assignment_id: number | null; initial_statuses: Record<string, string | null>;
};
const documentsUrl = (s: Scenario) => `/#/projects/${encodeURIComponent(s.project)}/documents`;
const variantPath = (s: Scenario, id: string, suffix: string) => `/api/v1/projects/${encodeURIComponent(s.project)}/documents/${encodeURIComponent(id)}/${suffix}`;
const target = (page: Page) => page.getByRole('textbox', { name: 'Translation (de)', exact: true });
const review = (page: Page) => page.getByRole('region', { name: 'Translation review', exact: true });
const submitButton = (page: Page) => page.getByRole('button', { name: 'Submit review…', exact: true });
/** Submitting is immutable and always confirmed in a dialog. */
async function confirmSubmit(page: Page) {
  await submitButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'Submit this review?', exact: true });
  await expect(dialog).toContainText('A submitted review cannot be changed later.');
  await dialog.getByRole('button', { name: 'Submit review', exact: true }).click();
}
async function scenario(page: Page, assignment: 'none' | 'target' | 'failed' = 'none', unequal = false): Promise<Scenario> {
  const response = await page.request.post(`/__test_translation_review__?${new URLSearchParams({ assignment, unequal: String(unequal) })}`);
  expect(response.ok()).toBeTruthy();
  const s = await response.json() as Scenario;
  expect(s.initial_statuses[s.documents.target]).toBe('ready_for_review');
  expect(s.initial_statuses[s.documents.failed]).toBe('automatic_check_failed');
  expect(s.documents.target).not.toBe(s.external_id);
  await test.info().attach('fresh-review-import', { body: Buffer.from(JSON.stringify({ project: s.project, job: s.import_job_id, documents: s.documents, statuses: s.initial_statuses })), contentType: 'application/json' });
  return s;
}
async function workspace(page: Page, id: number): Promise<ReviewWorkspace> {
  const response = await authenticatedRequest(page, `/api/v1/translation-reviews/${id}`);
  expect(response.ok()).toBeTruthy(); return await response.json() as ReviewWorkspace;
}
async function openReview(page: Page, s: Scenario) {
  expect(s.assignment_id).not.toBeNull();
  await loginExisting(page, s.users.reviewer);
  await page.locator(`a[href="#/tasks/${s.assignment_id}"]`).click();
  await expect(target(page)).toHaveValue(s.texts.target);
  const projects = await (await authenticatedRequest(page, '/api/v1/projects')).json() as { project_key: string; roles: string[] }[];
  expect(projects.find(p => p.project_key === s.project)?.roles).toEqual(['annotator']);
}
async function saved(page: Page, id: number, text: string, decision: string) {
  await expect(review(page).getByRole('status')).toHaveText('Saved');
  const current = await workspace(page, id);
  expect(current.draft.text).toBe(text); expect(current.draft.form.decision).toBe(decision);
  expect(current.draft.revision).toBeGreaterThan(0); return current;
}
async function leadContext(browser: Browser, s: Scenario) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage(); await loginExisting(page, s.users.lead);
  return { page, close: () => context.close() };
}
async function documentRow(page: Page, id: string) {
  const version = page.locator('details.document-version').filter({ has: page.getByRole('checkbox', { name: `Select ${id}`, exact: true, includeHidden: true }) });
  await expect(version).toHaveCount(1);
  if (!await version.evaluate(node => (node as HTMLDetailsElement).open)) await version.locator(':scope > summary').click();
  await expect(version.getByTestId('document-row')).toBeVisible();
  return version;
}
async function section(page: Page, name: string) {
  const details = page.locator('.shell-reading-navigation');
  if (await details.count() && !await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator('summary').click();
  await page.getByRole('link', { name, exact: true }).click();
}
async function alignAt(surface: Locator, index: number) {
  await surface.dispatchEvent('wheel');
  await surface.evaluate((el, index) => {
    const marker = el.querySelector<HTMLElement>(`[data-paragraph="${index}"]`)!;
    el.scrollTop += marker.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop;
  }, index);
}
async function markerDistance(surface: Locator, index: number) {
  return await surface.evaluate((el, index) => Math.abs(el.querySelector(`[data-paragraph="${index}"]`)!.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop), index);
}

test('lead assigns the exact pending translation; ordinary reviewer corrects, submits, reloads readonly and lead reopens immutable history', async ({ page, browser }) => {
  const s = await scenario(page);
  const lead = await leadContext(browser, s);
  let assignmentId: number;
  try {
    const roles = await (await authenticatedRequest(lead.page, '/api/v1/projects')).json() as { project_key: string; roles: string[] }[];
    expect(roles.find(p => p.project_key === s.project)?.roles).toEqual(['lead']);
    await lead.page.goto(documentsUrl(s));
    const row = await documentRow(lead.page, s.documents.target);
    await expect(row).toContainText('Ready for review');
    await row.getByRole('checkbox', { name: `Select ${s.documents.target}`, exact: true }).check();
    await lead.page.getByRole('button', { name: 'Assign …', exact: true }).click();
    const dialog = lead.page.getByRole('dialog', { name: 'Assign documents', exact: true });
    await dialog.getByLabel('Task', { exact: true }).selectOption('translation_review');
    await dialog.getByRole('checkbox', { name: new RegExp(s.users.reviewer) }).check();
    await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(dialog).toContainText('Assignment request complete: 1 accepted; 0 refused.');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const inventory = await (await authenticatedRequest(lead.page, `/api/v1/projects/${encodeURIComponent(s.project)}/assignments`)).json() as Assignment[];
    const assigned = inventory.filter(a => a.document_id === s.documents.target && a.username === s.users.reviewer && a.task === 'translation_review' && !a.revoked_at);
    expect(assigned).toHaveLength(1); assignmentId = assigned[0].id;
  } finally { await lead.close(); }
  s.assignment_id = assignmentId;
  await openReview(page, s);
  const opened = await workspace(page, assignmentId);
  expect(opened.source.text).toBe(s.texts.source); expect(opened.translation_ancestor.translation?.run_id).toBe('review run /1 %é');
  expect(opened.draft.form).toEqual({});
  const requests: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/v1/assignments/') || r.url().includes('/api/v1/translation-reviews/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.goto('/');
  await page.goto(`/#/tasks/${assignmentId}`);
  await expect(target(page)).toHaveValue(s.texts.target);
  expect(requests).toContain(`GET /api/v1/assignments/${assignmentId}`);
  expect(requests).toContain(`GET /api/v1/translation-reviews/${assignmentId}`);
  expect(requests.some(r => r.endsWith('/open'))).toBe(false);
  const source = page.getByRole('region', { name: 'Source (en)', exact: true });
  await expect(source.locator('textarea,[contenteditable="true"]')).toHaveCount(0);
  await expect(source).toHaveText(s.texts.source);
  await expect(review(page)).not.toContainText('Selection intent');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(opened.variant.external_id);
  await expect(review(page)).toContainText('Translation review · English → to German');
  const details = page.locator('.translation-details');
  await expect(details.getByText('Review fixture MT', { exact: true })).toBeHidden();
  await details.getByText('Translation details', { exact: true }).click();
  await expect(details.getByText('Review fixture MT', { exact: true })).toBeVisible();
  await expect(details.getByText('clinical-example-1', { exact: true })).toBeVisible();
  const corrected = s.texts.target.replace('5 mg', '7 mg');
  await target(page).fill(corrected);
  await page.getByRole('radio', { name: 'Accepted with corrections', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Clinically relevant change', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Number or unit', exact: true }).check();
  await expect(submitButton(page)).toBeDisabled();
  await expect(page.getByRole('list', { name: 'Review issues', exact: true })).toHaveText('A clinical change needs a rationale.');
  await page.getByRole('textbox', { name: 'Rationale', exact: true }).fill('The source states the corrected dose.');
  await expect(page.locator('.translation-editor-mirror ins')).toContainText('7');
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).check();
  await expect(target(page)).toHaveCount(0);
  await expect(page.locator('.translation-diff del')).toContainText('5');
  await expect(page.locator('.translation-diff ins')).toContainText('7');
  await page.getByRole('checkbox', { name: 'Show changes', exact: true }).uncheck();
  const confirmed = await saved(page, assignmentId, corrected, 'accepted_corrected');
  const resultPromise = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/translation-reviews/${assignmentId}/submit`));
  await confirmSubmit(page);
  const result = await resultPromise; expect(result.ok()).toBeTruthy();
  expect(result.request().postDataJSON()).toEqual({ expected_revision: confirmed.draft.revision });
  const record = await result.json() as ReviewRecord;
  expect(record.proposed_text).toBe(corrected); expect(record.status_after).toBe('reviewed'); expect(record.created_variant_id).toBeTruthy();
  const createdResponse = await authenticatedRequest(page, variantPath(s, record.created_variant_id!, 'variant'));
  expect(createdResponse.ok()).toBeTruthy(); const created = await createdResponse.json() as Variant;
  expect(created.translation_status).toBe('accepted'); expect(created.version).toBeGreaterThan(opened.variant.version);
  await expect(page.getByText(`A corrected version v${created.version} was created.`, { exact: true })).toBeVisible();
  await expect(page.getByText('Your corrected text was saved as a new version, which is accepted for annotation.', { exact: true })).toBeVisible();
  await expect(review(page)).not.toContainText(record.status_after === 'reviewed' ? 'status_after' : 'reviewed');
  const writes: string[] = []; page.on('request', r => { if (r.url().includes('/translation-reviews/') && ['POST', 'PUT'].includes(r.method())) writes.push(r.url()); });
  await page.reload(); await expect(target(page)).toHaveValue(corrected); await expect(target(page)).toHaveAttribute('readonly', '');
  await expect(page.getByRole('radio')).toHaveCount(0); await expect(submitButton(page)).toHaveCount(0);
  const summary = page.getByRole('region', { name: 'Submitted review', exact: true });
  await expect(summary).toContainText('Accepted with corrections');
  await expect(summary).toContainText('Number or unit');
  await expect(summary).toContainText('The source states the corrected dose.');
  await expect(summary).toContainText(record.reviewer_pseudonym);
  await expect(summary.locator('time')).toHaveText(/^\d{1,2} [A-Z][a-z]+ \d{4} at \d{2}:\d{2}$/);
  expect((await workspace(page, assignmentId)).submitted_record).toEqual(record); expect(writes).toEqual([]);
  await page.getByRole('link', { name: 'Back to my tasks', exact: true }).click();
  const submittedTask = page.getByTestId('task-row').filter({ has: page.locator(`a[href="#/tasks/${assignmentId}"]`) });
  await expect(submittedTask).toContainText('Submitted');
  await expect(submittedTask.getByRole('cell', { name: s.external_id, exact: true })).toBeVisible();
  await submittedTask.getByRole('link', { name: 'View', exact: true }).click();
  await expect(target(page)).toHaveAttribute('readonly', ''); expect(writes).toEqual([]);
  const reopenedLead = await leadContext(browser, s);
  try {
    await reopenedLead.page.goto(documentsUrl(s));
    const original = await documentRow(reopenedLead.page, s.documents.target);
    await expect(original).toContainText('Reviewed'); await expect(await documentRow(reopenedLead.page, created.document_id)).toContainText('Accepted');
    await original.getByText('Assignment actions', { exact: true }).click();
    await original.getByRole('button', { name: 'Reopen', exact: true }).click();
    const dialog = reopenedLead.page.getByRole('dialog', { name: `Reopen ${s.documents.target}`, exact: true });
    await dialog.getByLabel('Reason (optional)', { exact: true }).fill('Inspect immutable review history');
    await dialog.getByRole('button', { name: 'Reopen assignment', exact: true }).click(); await expect(dialog).toHaveCount(0);
    const records = await authenticatedRequest(reopenedLead.page, variantPath(s, s.documents.target, 'translation-reviews'));
    expect(await records.json()).toEqual([record]);
  } finally { await reopenedLead.close(); }
  await page.reload(); await expect(target(page)).not.toHaveAttribute('readonly', '');
  await expect(page.getByRole('heading', { name: 'Previous reviews', exact: true })).toBeVisible();
  const reopened = await workspace(page, assignmentId); expect(reopened.read_only).toBe(false); expect(reopened.previous_reviews).toEqual([record]);
});

test('fresh failed checks remain visible and an independent edited Accepted unchanged task is refused without losing text', async ({ page, browser }) => {
  const failed = await scenario(page, 'failed'); await loginExisting(page, failed.users.reviewer);
  await page.locator(`a[href="#/tasks/${failed.assignment_id}"]`).click(); await expect(target(page)).toHaveValue(failed.texts.failed);
  const checks = page.getByRole('region', { name: 'Automatic translation checks', exact: true });
  await expect(checks).toContainText('1 automatic check failed');
  await expect(checks.locator('.notice')).toContainText('Units added in translation');
  await expect(checks.locator('.notice')).not.toContainText('units_added');
  await checks.getByText('Show all checks', { exact: true }).click();
  await expect(checks.locator('.translation-checks-all li').filter({ hasText: 'Numbers changed in translation' })).toContainText('Passed');
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const independent = await context.newPage(), s = await scenario(independent, 'target');
    expect(s.project).not.toBe(failed.project); expect(s.assignment_id).not.toBe(failed.assignment_id);
    await openReview(independent, s);
    const text = `${s.texts.target}\nRetained correction.`;
    await target(independent).fill(text); await independent.getByRole('radio', { name: 'Accepted unchanged', exact: true }).check();
    await expect(independent.getByRole('list', { name: 'Review issues', exact: true })).toContainText('Accepted unchanged needs text equal to the reviewed text.');
    await expect(submitButton(independent)).toBeDisabled();
    await saved(independent, s.assignment_id!, text, 'accepted_unchanged');
    // Independent current-actor oracle: the disabled UI never dispatches submit.
    const refused = await authenticatedRequest(independent, `/api/v1/translation-reviews/${s.assignment_id}/submit`, 'POST', { expected_revision: (await workspace(independent, s.assignment_id!)).draft.revision });
    expect(refused.status()).toBe(422); expect((await refused.json()).details.issues).toEqual(['TEXT_CHANGED']);
    await expect(target(independent)).toHaveValue(text);
    expect((await workspace(independent, s.assignment_id!)).previous_reviews).toEqual([]);
  } finally { await context.close(); }
});

test('live qualification refusal retains inputs and the guarded profile link flushes before profile Cancel', async ({ page }) => {
  const s = await scenario(page, 'target'); await openReview(page, s);
  const response = await authenticatedRequest(page, '/api/v1/me/profile', 'PATCH', { qualification: null }); expect(response.ok()).toBeTruthy();
  const text = s.texts.target.replace('5 mg', '8 mg'); await target(page).fill(text);
  await page.getByRole('radio', { name: 'Accepted with corrections', exact: true }).check(); await saved(page, s.assignment_id!, text, 'accepted_corrected');
  await confirmSubmit(page);
  await expect(page.getByRole('alert')).toContainText('Add your qualification before submitting a translation review.'); await expect(target(page)).toHaveValue(text);
  const latest = `${text}\nLatest unsaved sentence.`; await target(page).fill(latest);
  await page.getByRole('link', { name: 'Add your qualification in your profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  expect((await workspace(page, s.assignment_id!)).draft.text).toBe(latest);
  await page.getByRole('textbox', { name: 'Qualification', exact: true }).fill('Current reviewer qualification');
  await section(page, 'My tasks'); const dialog = page.getByRole('dialog', { name: 'Unsaved profile changes', exact: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Qualification', exact: true })).toHaveValue('Current reviewer qualification');
  await page.getByRole('form', { name: 'Profile', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible(); await section(page, 'My tasks');
  await page.locator(`a[href="#/tasks/${s.assignment_id}"]`).click(); await expect(target(page)).toHaveValue(latest);
  expect((await workspace(page, s.assignment_id!)).qualification).toBe('Current reviewer qualification');
  // A real concurrent save makes this mounted saver stale; no mocked failures.
  const current = await workspace(page, s.assignment_id!);
  const changed = await authenticatedRequest(page, `/api/v1/translation-reviews/${s.assignment_id}/draft`, 'PUT', {
    expected_revision: current.draft.revision, text: current.draft.text, form: current.draft.form,
  }); expect(changed.ok()).toBeTruthy();
  const localOnly = `${latest}\nKeep conflicted input.`; await target(page).fill(localOnly);
  await expect(review(page).getByRole('status')).toHaveText('Conflict: reload');
  await section(page, 'My tasks');
  const leave = page.getByRole('dialog', { name: 'Changes not saved', exact: true });
  await leave.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignment_id}$`)); await expect(target(page)).toHaveValue(localOnly);
  const cursor = await page.evaluate(() => window.history.state.ontocuratorRouteIndex as number);
  await page.evaluate(() => { window.location.hash = '#/me'; });
  await page.getByRole('dialog', { name: 'Changes not saved', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignment_id}$`));
  await expect.poll(() => page.evaluate(() => window.history.state.ontocuratorRouteIndex as number)).toBe(cursor);
  await expect(target(page)).toHaveValue(localOnly);
  await page.goBack();
  await page.getByRole('dialog', { name: 'Changes not saved', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.history.state.ontocuratorRouteIndex as number)).toBe(cursor);
  await expect(target(page)).toHaveValue(localOnly);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  const logoutDialog = page.getByRole('dialog', { name: 'Unsaved changes', exact: true });
  await logoutDialog.getByRole('button', { name: 'Save and log out', exact: true }).click();
  await expect(logoutDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await logoutDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(target(page)).toHaveValue(localOnly);
});

for (const actor of ['reviewer', 'other'] as const) test(`expired review session recovers in its mounted overlay as ${actor}`, async ({ page }) => {
  const s = await scenario(page, 'target'); await openReview(page, s);
  const text = `${s.texts.target}\nRetain this session edit.`;
  const before = await workspace(page, s.assignment_id!);
  const logout = await authenticatedRequest(page, '/api/v1/auth/logout', 'POST'); expect(logout.ok()).toBeTruthy();
  await target(page).fill(text); await page.getByRole('radio', { name: 'Accepted with corrections', exact: true }).check();
  const dialog = page.getByRole('dialog', { name: 'Log in to Ontocurator', exact: true }); await expect(dialog).toBeVisible();
  await expect(target(page)).toHaveValue(text); await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  const marker = await target(page).evaluate(el => { el.setAttribute('data-session-owner', 'original'); return el.getAttribute('data-session-owner'); }); expect(marker).toBe('original');
  await dialog.getByLabel('Username', { exact: true }).fill(s.users[actor]); await dialog.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await dialog.getByRole('button', { name: 'Log in', exact: true }).click(); await expect(dialog).toHaveCount(0);
  if (actor === 'reviewer') {
    await expect(target(page)).toHaveAttribute('data-session-owner', 'original'); await expect(target(page)).toHaveValue(text);
    const me = await (await authenticatedRequest(page, '/api/v1/auth/me')).json() as { csrf_token: string };
    const retry = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/translation-reviews/${s.assignment_id}/draft`));
    await page.getByRole('button', { name: 'Retry save', exact: true }).click(); const savedResponse = await retry;
    expect(savedResponse.ok()).toBeTruthy(); expect(savedResponse.request().headers()['x-csrf-token']).toBe(me.csrf_token);
    expect(savedResponse.request().postDataJSON()).toEqual({ expected_revision: before.draft.revision, text, form: { decision: 'accepted_corrected', clinical_change: false } });
    await saved(page, s.assignment_id!, text, 'accepted_corrected');
  } else {
    await expect(page).toHaveURL(/#\/$/); await expect(page.getByRole('heading', { name: 'My tasks', exact: true })).toBeVisible();
    await expect(target(page)).toHaveCount(0); await expect(page.locator('[data-session-owner]')).toHaveCount(0);
    const denied = await authenticatedRequest(page, `/api/v1/translation-reviews/${s.assignment_id}`); expect(denied.status()).toBe(404);
  }
});

for (const width of [1280, 1024, 600]) test(`review source, the one editable translation, its change view and comparison retain codepoint text and reachable controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const s = await scenario(page, 'target', width === 1280); await openReview(page, s);
  await page.evaluate(() => document.fonts.ready);
  const source = page.getByRole('region', { name: 'Source (en)', exact: true });
  const editor = page.locator('.translation-editor');
  const diff = page.getByRole('region', { name: 'Text changes', exact: true });
  const comparison = page.getByRole('region', { name: 'Comparison', exact: true });
  const showChanges = page.getByRole('checkbox', { name: 'Show changes', exact: true });
  await expect(source).toHaveText(s.texts.source); await expect(target(page)).toHaveValue(s.texts.target); await expect(comparison).toHaveText(s.texts.failed);
  // The translation appears once: an editor by default, the change view only in its place.
  await expect(diff).toHaveCount(0);
  await expect(target(page).locator('[data-paragraph]')).toHaveCount(0);
  await expect(editor.locator('.translation-editor-mirror')).toHaveAttribute('aria-hidden', 'true');
  for (const surface of [source, editor, comparison]) await expect(surface.locator('[data-paragraph="2"]')).toHaveAttribute('aria-hidden', 'true');
  const sourcePrefix = await source.evaluate(el => {
    const range = document.createRange(); range.setStart(el, 0); range.setEndBefore(el.querySelector('[data-paragraph="2"]')!);
    return Array.from(range.toString()).length;
  });
  expect(sourcePrefix).toBe(Array.from(s.texts.source.split('\n\n').slice(0, 2).join('\n\n') + '\n\n').length);
  await expect(editor.locator('[data-paragraph="2"]')).toHaveAttribute('data-paragraph-offset', String(Array.from(s.texts.target.split('\n\n').slice(0, 2).join('\n\n') + '\n\n').length));
  // The mirror lays out the textarea's exact text: equal height and no hidden inner scrolling.
  expect(await editor.evaluate(el => {
    const mirror = el.querySelector('.translation-editor-mirror')!, input = el.querySelector('textarea')!;
    return Math.abs(mirror.getBoundingClientRect().height - input.getBoundingClientRect().height) <= 1 && input.scrollHeight <= input.clientHeight + 1;
  })).toBe(true);
  await expect(page.getByRole('checkbox', {name:'Couple scrolling',exact:true})).toBeDisabled();
  if (width >= 1100) {
    const initial = await editor.evaluate(el=>el.scrollTop); await alignAt(source,2); expect(await editor.evaluate(el=>el.scrollTop)).toBe(initial);
    await showChanges.check(); await expect(diff).toHaveText(s.texts.target);
    await page.getByRole('checkbox', {name:'Couple scrolling',exact:true}).check();
    await expect(page.getByText('Paragraphs are paired by position, not by meaning',{exact:true})).toBeVisible();
    await alignAt(source, 3); await alignAt(source, 2); await expect.poll(() => markerDistance(diff, 2)).toBeLessThanOrEqual(20);
    await alignAt(diff, 8); await expect.poll(() => markerDistance(comparison, 9)).toBeLessThanOrEqual(20);
  } else {
    const initial = await editor.evaluate(el => el.scrollTop); await alignAt(source, 2); expect(await editor.evaluate(el => el.scrollTop)).toBe(initial);
    const sourceBox = await source.boundingBox(), editorBox = await editor.boundingBox(); expect(sourceBox && editorBox && editorBox.y > sourceBox.y).toBeTruthy();
    await showChanges.check(); await expect(target(page)).toHaveCount(0); await expect(diff).toHaveText(s.texts.target);
  }
  await showChanges.uncheck(); await expect(diff).toHaveCount(0);
  await target(page).fill('Native editing 😀é remains exact.'); await expect(target(page)).toHaveValue('Native editing 😀é remains exact.');
  await expect(editor.locator('.translation-editor-mirror ins').first()).toHaveText('Native');
  await showChanges.check(); await expect(diff).toBeVisible(); await expect(target(page)).toHaveCount(0);
  await showChanges.uncheck();
  if (width >= 1280) {
    // The decision rail is in view without scrolling the page.
    await expect(page.getByRole('radio', { name: 'Query', exact: true })).toBeInViewport();
    await expect(submitButton(page)).toBeInViewport();
  }
  await page.getByRole('button', { name: 'Skip to decision', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'Accepted unchanged', exact: true })).toBeFocused();
  await page.getByRole('radio', { name: 'Query', exact: true }).scrollIntoViewIfNeeded(); await expect(page.getByRole('radio', { name: 'Query', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`review-${width}.png`), fullPage: true });
});

test('three reading panes preserve positional progress and reject delayed feedback after equal-count merge/split', async ({page})=>{
  await page.setViewportSize({width:1280,height:900});
  const response=await page.request.post('/__test_translation_review__?assignment=target&merge_split=true'); expect(response.ok()).toBeTruthy();
  const s=await response.json() as Scenario; await openReview(page,s); await page.evaluate(()=>document.fonts.ready);
  const box=page.getByRole('checkbox',{name:'Couple scrolling',exact:true}),show=page.getByRole('checkbox',{name:'Show changes',exact:true});
  const source=page.getByRole('region',{name:'Source (en)',exact:true}),diff=page.getByRole('region',{name:'Text changes',exact:true}),comparison=page.getByRole('region',{name:'Comparison',exact:true});
  await expect(box).not.toBeChecked(); await expect(box).toBeDisabled();
  await target(page).evaluate(el=>{(el as HTMLTextAreaElement).setSelectionRange(8,15);});
  await source.dispatchEvent('wheel'); await alignAt(source,1);
  expect(await target(page).evaluate(el=>[(el as HTMLTextAreaElement).selectionStart,(el as HTMLTextAreaElement).selectionEnd])).toEqual([8,15]);
  await show.check(); await box.check();
  await expect(page.getByText('Paragraphs are paired by position, not by meaning',{exact:true})).toBeVisible();
  for(const leader of [source,diff,comparison]) {
    for(const fraction of [0.25,0.5,0.75]) {
      await leader.dispatchEvent('wheel');
      const position=await leader.evaluate((el,fraction)=>{const rows=el.querySelectorAll('[data-paragraph]');const top=(i:number)=>el.scrollTop+rows[i].getBoundingClientRect().top-el.getBoundingClientRect().top-el.clientTop;el.scrollTop=top(1)+(top(2)-top(1))*fraction;return el.scrollTop;},fraction);
      for(const follower of [source,diff,comparison].filter(p=>p!==leader)) {
        await expect.poll(()=>follower.evaluate(el=>{const rows=el.querySelectorAll('[data-paragraph]');const top=(i:number)=>el.scrollTop+rows[i].getBoundingClientRect().top-el.getBoundingClientRect().top-el.clientTop;return (el.scrollTop-top(1))/(top(2)-top(1));})).toBeCloseTo(fraction,2);
        await follower.dispatchEvent('scroll');
      }
      await page.waitForTimeout(180); for(const follower of [source,diff,comparison].filter(p=>p!==leader)) await follower.dispatchEvent('scroll');
      expect(await leader.evaluate(el=>el.scrollTop)).toBe(position);
      await expect(page.getByLabel('Paragraph pairing')).toHaveText('Source paragraph 2 ↔ Translation paragraph 2 ↔ Comparison paragraph 2');
    }
  }
  await page.setViewportSize({width:1024,height:900});
  await expect(box).toBeDisabled(); await expect(box).not.toBeChecked();
  await expect(page.getByText(/Widen the window/)).toBeVisible();
  await expect(page.getByRole('status',{name:'Paragraph pairing'})).toHaveCount(0);
  await expect(page.getByText('Paragraphs are paired by position, not by meaning',{exact:true})).toHaveCount(0);
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath('coupling-unavailable-1024.png')});
  await page.setViewportSize({width:1280,height:900});
  await expect(box).toBeEnabled(); await expect(box).toBeChecked();
  await expect(page.getByRole('status',{name:'Paragraph pairing'})).toBeVisible();
  await show.uncheck(); await expect(box).not.toBeChecked(); await expect(box).toBeDisabled();
  await target(page).fill(s.texts.target+' Native correction.'); await expect(target(page)).toHaveValue(s.texts.target+' Native correction.');
  await show.check(); await expect(box).not.toBeChecked();
});
