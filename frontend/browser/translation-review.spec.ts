import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { openOlderVersions, openTextCard, rowAction, showSegment, textCard, textNamePattern } from './documentsHelpers';
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
/** The Comparison pane starts closed; "Compare with …" in the Translation column opens it. */
async function openComparison(page: Page) {
  await expect(page.getByRole('region', { name: 'Comparison', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Compare with/ }).click();
  // Several comparisons: the button is a menu of them.
  const menu = page.getByRole('menu', { name: 'Compare with…', exact: true });
  if (await menu.count()) await menu.getByRole('menuitem').first().click();
  await expect(page.getByRole('button', { name: 'Close comparison', exact: true })).toBeFocused();
}
async function saved(page: Page, id: number, text: string, decision: string) {
  await expect(review(page).locator('.translation-save-status')).toHaveText('Saved');
  const current = await workspace(page, id);
  expect(current.draft.text).toBe(text); expect(current.draft.form.decision).toBe(decision);
  expect(current.draft.revision).toBeGreaterThan(0); return current;
}
async function leadContext(browser: Browser, s: Scenario) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage(); await loginExisting(page, s.users.lead);
  return { page, close: () => context.close() };
}
/** The version list entry of one exact document in its Documents text card. */
async function documentRow(page: Page, id: string) {
  const project = decodeURIComponent(/#\/projects\/([^/?]+)\/documents/.exec(page.url())![1]);
  const docs = await (await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(project)}/documents`)).json() as components['schemas']['ProjectDocumentSummary'][];
  const doc = docs.find(item => item.document_id === id)!; expect(doc).toBeTruthy();
  // The text card (text name "Text …") on its Translation part with the version list; one card at a time.
  const card = textCard(page, doc.case_id, doc.language);
  const other = page.locator('.text-card[role="dialog"]');
  if (!await card.count() && await other.count()) await other.getByRole('button', { name: 'Close', exact: true }).first().click();
  await openTextCard(page, doc.case_id, doc.language);
  await showSegment(card, 'Translation'); await openOlderVersions(card);
  const version = card.locator('li.text-version').filter({ has: page.locator(`a[href*="${new URLSearchParams({ variant: id })}&"], a[href$="${new URLSearchParams({ variant: id })}"]`) });
  await expect(version).toHaveCount(1);
  return version;
}
async function section(page: Page, name: string) {
  const details = page.locator('.shell-reading-navigation');
  if (await details.count() && !await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator('summary').click();
  // The nav shows the open task count: "My tasks (n)".
  await page.getByRole('link', { name: name === 'My tasks' ? /^My tasks( \(\d+\))?$/ : name, exact: name !== 'My tasks' }).click();
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
/** Signed offset of a paragraph start inside its pane's scrollport (negative: above the visible area). */
async function markerOffset(surface: Locator, index: number) {
  return await surface.evaluate((el, index) => el.querySelector(`[data-paragraph="${index}"]`)!.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop, index);
}
/** "Show matching paragraph" places the target paragraph at the anchor's offset, or at the 12 px inset when the anchor starts above the view. */
async function matchedWithin(anchor: Locator, follower: Locator, index: number) {
  const offset = await markerOffset(anchor, index);
  return Math.abs(await markerOffset(follower, index) - (offset >= 0 ? offset : 12));
}
/** Focuses the translation without scrolling and puts the caret at a UTF-16 index found from a needle. */
async function placeCaret(page: Page, needle: string, delta = 0) {
  return await target(page).evaluate((el, [needle, delta]) => {
    const input = el as HTMLTextAreaElement, index = input.value.indexOf(needle as string) + (delta as number);
    input.focus({ preventScroll: true }); input.setSelectionRange(index, index); return index;
  }, [needle, delta] as const);
}
const caretState = (page: Page) => target(page).evaluate(el => {
  const input = el as HTMLTextAreaElement;
  return { selection: [input.selectionStart, input.selectionEnd], scrollTop: input.closest<HTMLElement>('.translation-editor')!.scrollTop };
});
const evidenceDir = () => resolve(test.info().config.rootDir, '../../build/editor-axes-scroll/evidence');
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `${name}.png`), fullPage: false });
}
const couplingNote = 'Paragraphs are paired by position, not by meaning. Merged or split paragraphs shift the pairing.';
const couplingEditingNote = 'While you edit, only the other texts follow your translation.';
const matchStatus = (page: Page) => review(page).locator('.translation-column-head span.review-sr-only[role="status"]');
const matchButton = (page: Page) => page.getByRole('button', { name: 'Show matching paragraph', exact: true });

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
    // Work plan: the lead turns Translation review on in the text card's Text details (VD2), then assigns it from the row action.
    const panel = textCard(lead.page, s.case_id, 'de');
    await panel.getByRole('button', { name: 'Details', exact: true }).click();
    const review = panel.getByRole('button', { name: textNamePattern('Translation review, ', s.case_id, 'de') });
    if ((await review.getAttribute('aria-pressed')) !== 'true') await review.click();
    await expect(review).toHaveAttribute('aria-pressed', 'true');
    // The card is modal: close it before the row action.
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await rowAction(lead.page, 'Assign review…', s.case_id, 'de').click();
    const dialog = lead.page.getByRole('dialog', { name: 'Assign translation review', exact: true });
    await dialog.getByRole('table', { name: 'Members' }).getByRole('radio', { name: new RegExp(s.users.reviewer) }).check();
    // The row holds two parallel de translations (target and failed); the row assigns both roots.
    await dialog.getByRole('button', { name: 'Assign 2', exact: true }).click();
    await expect(dialog).toHaveCount(0);
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${opened.variant.case_id} ${opened.variant.language}`);
  await expect(review(page)).toContainText('English → to German');
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
  // Issue 125: the task flow leaves the review (next task, else My tasks); the toast's View result reopens it read-only.
  const toast = page.locator('.ui-toast').filter({ hasText: / submitted\./ });
  await expect(toast).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(`#/tasks/${assignmentId}$`));
  const writes: string[] = []; page.on('request', r => { if (r.url().includes('/translation-reviews/') && ['POST', 'PUT'].includes(r.method())) writes.push(r.url()); });
  await toast.getByRole('button', { name: 'View result', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${assignmentId}$`));
  await expect(target(page)).toHaveValue(corrected); await expect(target(page)).toHaveAttribute('readonly', '');
  await expect(review(page)).not.toContainText(record.status_after === 'reviewed' ? 'status_after' : 'reviewed');
  await expect(page.getByRole('radio')).toHaveCount(0); await expect(submitButton(page)).toHaveCount(0);
  const summary = page.getByRole('region', { name: 'Submitted review', exact: true });
  await expect(summary).toContainText('Accepted with corrections');
  await expect(summary).toContainText('Number or unit');
  await expect(summary).toContainText('The source states the corrected dose.');
  await expect(summary).toContainText(record.reviewer_pseudonym);
  await expect(summary.locator('time')).toHaveText(/^\d{1,2} [A-Z][a-z]+ \d{4} at \d{2}:\d{2}$/);
  expect((await workspace(page, assignmentId)).submitted_record).toEqual(record); expect(writes).toEqual([]);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'My tasks', exact: true }).click();
  const submittedTask = page.getByTestId('task-row').filter({ has: page.locator(`a[href="#/tasks/${assignmentId}"]`) });
  await expect(submittedTask).toContainText('Submitted');
  // My tasks names the text as "{case ID} {language}".
  await expect(submittedTask).toContainText(new RegExp(`${s.case_id}\\W+de`));
  await submittedTask.getByRole('link', { name: 'View', exact: true }).click();
  await expect(target(page)).toHaveAttribute('readonly', ''); expect(writes).toEqual([]);
  const reopenedLead = await leadContext(browser, s);
  try {
    await reopenedLead.page.goto(documentsUrl(s));
    const original = await documentRow(reopenedLead.page, s.documents.target);
    await expect(original).toContainText('Reviewed'); await expect(await documentRow(reopenedLead.page, created.document_id)).toContainText('Accepted');
    await original.getByRole('button', { name: 'Reopen', exact: true }).click();
    const dialog = reopenedLead.page.getByRole('dialog', { name: `v1 of ${s.case_id} de` });
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
  await expect(checks.locator('.translation-checks-line')).toHaveText('1 automatic check failed: Units added in translation');
  await checks.getByRole('button', { name: 'Details', exact: true }).click();
  // The readable label is the heading; the raw code appears only as the labelled technical code.
  const failedCheck = checks.locator('.translation-check');
  await expect(failedCheck.getByRole('heading', { name: 'Units added in translation', exact: true })).toBeVisible();
  await expect(failedCheck.getByRole('heading', { name: 'units_added' })).toHaveCount(0);
  await failedCheck.getByText('Technical details', { exact: true }).click();
  await expect(failedCheck.locator('.translation-check-technical code')).toHaveText('units_added');
  await checks.getByText('Show all checks', { exact: true }).click();
  await expect(checks.locator('.translation-checks-all li').filter({ hasText: 'Numbers changed in translation' })).toContainText('Passed');
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const independent = await context.newPage(), s = await scenario(independent, 'target');
    expect(s.project).not.toBe(failed.project); expect(s.assignment_id).not.toBe(failed.assignment_id);
    await openReview(independent, s);
    const text = `${s.texts.target}\nRetained correction.`;
    await target(independent).fill(text); await independent.getByRole('radio', { name: 'Accepted unchanged', exact: true }).check();
    await expect(independent.getByRole('list', { name: 'Review issues', exact: true })).toContainText('You edited the text. Choose Accepted with corrections, or undo your edits.');
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
  await expect(review(page).locator('.translation-save-status')).toHaveText('Conflict: reload');
  await section(page, 'My tasks');
  const leave = page.getByRole('dialog', { name: 'Changes not saved', exact: true });
  await leave.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignment_id}$`)); await expect(target(page)).toHaveValue(localOnly);
  const cursor = await page.evaluate(() => window.history.state.ontotatorRouteIndex as number);
  await page.evaluate(() => { window.location.hash = '#/me'; });
  await page.getByRole('dialog', { name: 'Changes not saved', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignment_id}$`));
  await expect.poll(() => page.evaluate(() => window.history.state.ontotatorRouteIndex as number)).toBe(cursor);
  await expect(target(page)).toHaveValue(localOnly);
  await page.goBack();
  await page.getByRole('dialog', { name: 'Changes not saved', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.history.state.ontotatorRouteIndex as number)).toBe(cursor);
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
  const dialog = page.getByRole('dialog', { name: 'Log in to Ontotator', exact: true }); await expect(dialog).toBeVisible();
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
    // Another user starts afresh at "#/"; no last-used project and no lead role, so My tasks (F8, #153).
    await expect(page).toHaveURL(/#\/$/); await expect(page.getByRole('heading', { name: 'My tasks', exact: true, level: 1 })).toBeVisible();
    await expect(target(page)).toHaveCount(0); await expect(page.locator('[data-session-owner]')).toHaveCount(0);
    const denied = await authenticatedRequest(page, `/api/v1/translation-reviews/${s.assignment_id}`); expect(denied.status()).toBe(404);
  }
});

for (const width of [1280, 1024, 600]) test(`review source, the one editable translation, its change view and comparison retain codepoint text and reachable controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const s = await scenario(page, 'target', width === 1280); await openReview(page, s); await openComparison(page);
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
  // Coupling is offered wherever the texts sit side by side, also beside the editable translation; it starts off.
  const couple = page.getByRole('checkbox', { name: 'Couple scrolling', exact: true });
  if (width >= 700) { await expect(couple).toBeVisible(); await expect(couple).not.toBeChecked(); }
  else await expect(couple).toHaveCount(0);
  if (width >= 1100) {
    const initial = await editor.evaluate(el=>el.scrollTop); await alignAt(source,2); expect(await editor.evaluate(el=>el.scrollTop)).toBe(initial);
    await showChanges.check(); await expect(diff).toHaveText(s.texts.target);
    await page.getByRole('checkbox', {name:'Couple scrolling',exact:true}).check();
    await expect(page.getByText(couplingNote,{exact:true})).toBeVisible();
    await alignAt(source, 3); await alignAt(source, 2); await expect.poll(() => markerDistance(diff, 2)).toBeLessThanOrEqual(20);
    await alignAt(diff, 8); await expect.poll(() => markerDistance(comparison, 9)).toBeLessThanOrEqual(20);
  } else {
    const initial = await editor.evaluate(el => el.scrollTop); await alignAt(source, 2); expect(await editor.evaluate(el => el.scrollTop)).toBe(initial);
    // Texts stay side by side down to 700 px and stack below it.
    const sourceBox = await source.boundingBox(), editorBox = await editor.boundingBox();
    if (width >= 700) expect(sourceBox && editorBox && editorBox.x > sourceBox.x + sourceBox.width && Math.abs(editorBox.y - sourceBox.y) <= 50).toBeTruthy();
    else expect(sourceBox && editorBox && editorBox.y > sourceBox.y).toBeTruthy();
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
  // Editing the translation auto-selected Accepted with corrections; Tab enters the decisions at the selected one.
  const selectedDecision = page.getByRole('radio', { name: 'Accepted with corrections', exact: true });
  await expect(selectedDecision).toBeChecked(); await expect(selectedDecision).toBeFocused();
  await page.getByRole('radio', { name: 'Query', exact: true }).scrollIntoViewIfNeeded(); await expect(page.getByRole('radio', { name: 'Query', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`review-${width}.png`), fullPage: true });
});

test('three reading panes preserve positional progress and reject delayed feedback after equal-count merge/split', async ({page})=>{
  await page.setViewportSize({width:1280,height:900});
  const response=await page.request.post('/__test_translation_review__?assignment=target&merge_split=true'); expect(response.ok()).toBeTruthy();
  const s=await response.json() as Scenario; await openReview(page,s); await openComparison(page); await page.evaluate(()=>document.fonts.ready);
  const box=page.getByRole('checkbox',{name:'Couple scrolling',exact:true}),show=page.getByRole('checkbox',{name:'Show changes',exact:true});
  const source=page.getByRole('region',{name:'Source (en)',exact:true}),diff=page.getByRole('region',{name:'Text changes',exact:true}),comparison=page.getByRole('region',{name:'Comparison',exact:true});
  // Offered beside the editable translation, off by default.
  await expect(box).not.toBeChecked();
  await target(page).evaluate(el=>{(el as HTMLTextAreaElement).setSelectionRange(8,15);});
  await source.dispatchEvent('wheel'); await alignAt(source,1);
  expect(await target(page).evaluate(el=>[(el as HTMLTextAreaElement).selectionStart,(el as HTMLTextAreaElement).selectionEnd])).toEqual([8,15]);
  await show.check(); await box.check();
  await expect(page.getByText(couplingNote,{exact:true})).toBeVisible();
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
  // Texts side by side down to 700 px keep coupling; below, the texts stack and it is hidden, the request kept.
  await page.setViewportSize({width:1024,height:900});
  await expect(box).toBeChecked(); await expect(page.getByRole('status',{name:'Paragraph pairing'})).toBeVisible();
  await page.setViewportSize({width:600,height:900});
  await expect(box).toHaveCount(0);
  await expect(page.getByRole('status',{name:'Paragraph pairing'})).toHaveCount(0);
  await expect(page.getByText(couplingNote,{exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('coupling-unavailable-600.png')});
  await page.setViewportSize({width:1280,height:900});
  await expect(box).toBeEnabled(); await expect(box).toBeChecked();
  await expect(page.getByRole('status',{name:'Paragraph pairing'})).toBeVisible();
  // The request survives Show changes and edits; the editing note appears only beside the editable translation.
  await show.uncheck(); await expect(box).toBeChecked(); await expect(page.getByText(couplingEditingNote,{exact:true})).toBeVisible();
  await target(page).fill(s.texts.target+' Native correction.'); await expect(target(page)).toHaveValue(s.texts.target+' Native correction.');
  await expect(box).toBeChecked();
  await show.check(); await expect(box).toBeChecked(); await expect(page.getByText(couplingEditingNote,{exact:true})).toHaveCount(0);
});

for (const [w, h] of [[1440, 900], [800, 900]] as const) test(`coupling while editing at ${w}px`, async ({ page }) => {
  await page.setViewportSize({ width: w, height: h }); const s = await scenario(page, 'target'); await openReview(page, s);
  await page.evaluate(() => document.fonts.ready);
  const source = page.getByRole('region', { name: 'Source (en)', exact: true }), editor = page.locator('.translation-editor');
  const box = page.getByRole('checkbox', { name: 'Couple scrolling', exact: true });
  await expect(box).not.toBeChecked(); await box.check();
  await expect(page.getByText(couplingNote, { exact: true })).toBeVisible();
  await expect(page.getByText(couplingEditingNote, { exact: true })).toBeVisible();
  // Type a word and a new paragraph at the end of paragraph 3.
  await alignAt(editor, 2);
  const caret = await placeCaret(page, '\n\nAbsatz 4.');
  const typed = ' Ergänzung\n\nNeuer Satz.';
  await page.keyboard.type(typed);
  const afterTyping = await caretState(page);
  expect(afterTyping.selection).toEqual([caret + typed.length, caret + typed.length]);
  // The recompute (300 ms after the last edit) changes neither the caret nor the translation's scroll position.
  await page.waitForTimeout(400);
  expect(await caretState(page)).toEqual(afterTyping);
  await expect(page.getByText('Your edits changed the number of paragraphs (14 → 15). Pairing after that point may be off.', { exact: true })).toBeVisible();
  await expect(page.getByText('Paragraphs differ (source 14, translation 15); the other text may show a neighbouring paragraph.', { exact: true })).toBeVisible();
  // With every note shown, the notes sit below the panes: the translation pane starts level with the source pane.
  {
    const sourceTop = (await source.boundingBox())!.y, editorTop = (await editor.boundingBox())!.y;
    expect(Math.abs(editorTop - sourceTop)).toBeLessThanOrEqual(50);
  }
  await expect(target(page)).toBeFocused();
  // A real wheel on the translation moves the source; the source follows the paired paragraph.
  const sourceBefore = await source.evaluate(el => el.scrollTop);
  const editorBox = (await editor.boundingBox())!;
  await page.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2); await page.mouse.wheel(0, 400);
  await expect.poll(() => source.evaluate(el => el.scrollTop)).not.toBe(sourceBefore);
  await alignAt(editor, 1); await expect.poll(() => markerDistance(source, 1)).toBeLessThanOrEqual(20);
  // A wheel on the source moves only the source.
  const fixed = await caretState(page), sourceTop = await source.evaluate(el => el.scrollTop);
  const sourceBox = (await source.boundingBox())!;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2); await page.mouse.wheel(0, 500);
  await expect.poll(() => source.evaluate(el => el.scrollTop)).not.toBe(sourceTop);
  await page.waitForTimeout(250);
  expect(await caretState(page)).toEqual(fixed);
  // Deleting one blank line merges two paragraphs; the count notes follow the recompute.
  await alignAt(editor, 8); await placeCaret(page, '\n\nAbsatz 9.', 2); await page.keyboard.press('Backspace');
  await expect(page.getByText(/^Your edits changed the number of paragraphs/)).toHaveCount(0);
  await alignAt(editor, 9); await placeCaret(page, '\n\nAbsatz 11.', 2); await page.keyboard.press('Backspace');
  await expect(page.getByText('Your edits changed the number of paragraphs (14 → 13). Pairing after that point may be off.', { exact: true })).toBeVisible();
  await expect(page.getByText('Paragraphs differ (source 14, translation 13); the other text may show a neighbouring paragraph.', { exact: true })).toBeVisible();
  await expect(box).toBeChecked();
  await evidence(page, `20-coupled-editing-${w}`);
});

test('Show matching paragraph from the caret and from a source click', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); const s = await scenario(page, 'target'); await openReview(page, s); await openComparison(page);
  await page.evaluate(() => document.fonts.ready);
  const source = page.getByRole('region', { name: 'Source (en)', exact: true }), editor = page.locator('.translation-editor');
  const comparison = page.getByRole('region', { name: 'Comparison', exact: true });
  await expect(matchButton(page)).toHaveCount(1);
  await expect(matchButton(page)).toHaveAttribute('title', 'Scroll the other text to the paragraph paired with the one at your cursor or the one you clicked.');
  // From the caret in paragraph 6, with the paragraph a little below the translation's top.
  await alignAt(editor, 5); await editor.evaluate(el => { el.scrollTop -= 100; });
  const caret = await placeCaret(page, 'Absatz 6.', 20);
  await matchButton(page).click();
  await expect(target(page)).toBeFocused();
  await expect.poll(() => matchedWithin(editor, source, 5)).toBeLessThanOrEqual(4);
  await expect.poll(() => matchedWithin(editor, comparison, 5)).toBeLessThanOrEqual(4);
  await expect(matchStatus(page)).toHaveText('Source paragraph 6 and comparison paragraph 6 are shown next to translation paragraph 6.');
  expect((await caretState(page)).selection).toEqual([caret, caret]);
  // From a click into source paragraph 9.
  await alignAt(source, 8); await source.evaluate(el => { el.scrollTop -= 80; });
  const y = await source.evaluate(el => el.querySelector('[data-paragraph="8"]')!.getBoundingClientRect().top + 20);
  const sourceBox = (await source.boundingBox())!;
  await page.mouse.click(sourceBox.x + 120, y);
  await matchButton(page).click();
  await expect.poll(() => matchedWithin(source, editor, 8)).toBeLessThanOrEqual(4);
  await expect.poll(() => matchedWithin(source, comparison, 8)).toBeLessThanOrEqual(4);
  await expect(matchStatus(page)).toHaveText('Translation paragraph 9 and comparison paragraph 9 are shown next to source paragraph 9.');
  expect((await caretState(page)).selection).toEqual([caret, caret]);
  // Alt+M from the textarea does the same and types no character.
  const value = await target(page).inputValue();
  await alignAt(editor, 10); await editor.evaluate(el => { el.scrollTop -= 60; });
  const altCaret = await placeCaret(page, 'Absatz 11.', 10);
  await page.keyboard.press('Alt+KeyM');
  await expect.poll(() => matchedWithin(editor, source, 10)).toBeLessThanOrEqual(4);
  await expect(matchStatus(page)).toHaveText('Source paragraph 11 and comparison paragraph 11 are shown next to translation paragraph 11.');
  await expect(target(page)).toHaveValue(value); await expect(target(page)).toBeFocused();
  expect((await caretState(page)).selection).toEqual([altCaret, altCaret]);
});

test('390x844: checkbox hidden, action works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const s = await scenario(page, 'target'); await openReview(page, s); await openComparison(page);
  await page.evaluate(() => document.fonts.ready);
  const source = page.getByRole('region', { name: 'Source (en)', exact: true });
  await expect(page.getByRole('checkbox', { name: 'Couple scrolling', exact: true })).toHaveCount(0);
  await expect(matchButton(page)).toHaveCount(1);
  const value = await target(page).inputValue();
  // The caret's paragraph is in view inside the stacked translation pane.
  const editor = page.locator('.translation-editor');
  await editor.scrollIntoViewIfNeeded(); await alignAt(editor, 7); await editor.evaluate(el => { el.scrollTop -= 40; });
  const caret = await placeCaret(page, 'Absatz 8.', 10);
  await page.keyboard.press('Alt+KeyM');
  await expect(matchStatus(page)).toHaveText('Source paragraph 8 and comparison paragraph 8 are shown next to translation paragraph 8.');
  // Paragraph markers are empty spans, so "in view" is checked on the marker position: inside the source pane and the window.
  await expect(source).toBeInViewport();
  await expect.poll(() => source.evaluate(el => {
    const top = el.querySelector('[data-paragraph="7"]')!.getBoundingClientRect().top, pane = el.getBoundingClientRect();
    return top >= Math.max(0, pane.top) && top < Math.min(window.innerHeight, pane.bottom);
  })).toBe(true);
  await expect(target(page)).toHaveValue(value); await expect(target(page)).toBeFocused();
  expect((await caretState(page)).selection).toEqual([caret, caret]);
  await evidence(page, '21-narrow-action');
});

test('axe has no violations in the column head with coupling on', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); const s = await scenario(page, 'target'); await openReview(page, s); await openComparison(page);
  await page.getByRole('checkbox', { name: 'Couple scrolling', exact: true }).check();
  await expect(page.getByText(couplingEditingNote, { exact: true })).toBeVisible();
  await placeCaret(page, 'Absatz 3.', 5); await page.keyboard.press('Alt+KeyM');
  await expect(matchStatus(page)).not.toHaveText('');
  const results = await new AxeBuilder({ page }).include('.translation-column-head').include('.translation-column-hint').analyze();
  expect(results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(' ')}: ${n.failureSummary ?? ''}`))).toEqual([]);
});

test('Mark checked sentences: click, Shift+click and drag per side, kept on reload, task stays open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); const s = await scenario(page, 'target'); await openReview(page, s);
  const toggle = page.getByRole('checkbox', { name: 'Mark checked sentences', exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(target(page)).toHaveCount(0);
  const translation = page.getByRole('region', { name: 'Translation (de)', exact: true });
  const source = page.getByRole('region', { name: 'Source (en)', exact: true });
  const sentence = (region: Locator, index: number) => region.locator(`[data-sentence="${index}"]`);
  const saved = () => page.waitForResponse(r => r.url().endsWith(`/translation-reviews/${s.assignment_id}/checked-sentences`) && r.request().method() === 'PUT');
  await sentence(translation, 0).click();
  await expect(sentence(translation, 0)).toHaveAttribute('aria-pressed', 'true');
  await expect(sentence(source, 0)).toHaveAttribute('aria-pressed', 'false');
  await sentence(translation, 2).click({ modifiers: ['Shift'] });
  for (const index of [0, 1, 2]) await expect(sentence(translation, index)).toHaveAttribute('aria-pressed', 'true');
  // A drag from an unchecked sentence marks all sentences passed.
  // The middle of a sentence's first line box: a wrapped sentence's bounding box may centre on a gap.
  const point = (index: number) => sentence(source, index).evaluate(el => { const r = el.getClientRects()[0]; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const [first, third] = [await point(0), await point(2)];
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  await page.mouse.move(third.x, third.y, { steps: 8 });
  await expect(sentence(source, 1)).toHaveClass(/is-range-mark/);
  const done = saved();
  await page.mouse.up();
  for (const index of [0, 1, 2]) await expect(sentence(source, index)).toHaveAttribute('aria-pressed', 'true');
  expect((await done).ok()).toBe(true);
  await expect(page.getByRole('group', { name: 'Checked sentences', exact: true })).toContainText(/Source 3 of \d+ · Translation 3 of \d+ sentences checked/);
  await page.getByRole('button', { name: 'Next unchecked', exact: true }).click();
  await expect(sentence(translation, 3)).toBeFocused();
  const results = await new AxeBuilder({ page }).include('.checked-sentences-bar').include('.translation-sentences').analyze();
  expect(results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(' ')}: ${n.failureSummary ?? ''}`))).toEqual([]);
  // Marking alone does not start the task.
  const tasks = await (await authenticatedRequest(page, '/api/v1/me/tasks')).json() as { assignment_id: number; status: string }[];
  expect(tasks.find(t => t.assignment_id === s.assignment_id)?.status).toBe('open');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Mark checked sentences', exact: true })).toBeChecked();
  for (const index of [0, 1, 2]) await expect(sentence(translation, index)).toHaveAttribute('aria-pressed', 'true');
  await expect(sentence(translation, 3)).toHaveAttribute('aria-pressed', 'false');
  // Off: the translation is editable again.
  await page.getByRole('checkbox', { name: 'Mark checked sentences', exact: true }).uncheck();
  await expect(target(page)).toHaveValue(s.texts.target);
});
