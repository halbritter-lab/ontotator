import { expect, test, type Browser, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, loginExisting, selectText, submitCase } from './helpers';

type Assignment = components['schemas']['AssignmentView'];
type Submission = components['schemas']['SubmissionHistorySummary'];
type Opened = components['schemas']['AssignmentOpenResponse'];
type Round = components['schemas']['WorkRoundView'];
type Preflight = components['schemas']['FinalPreflight'];
type Scenario = { project: string; case_id: string; assignment_id: number; documents: { source: string; target: string }; users: { lead: string; reviewer: string; other: string; consolidator: string } };
test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });
const root = (s: Scenario) => `/api/v1/projects/${encodeURIComponent(s.project)}`;
async function actor(browser: Browser, username: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage(); await loginExisting(page, username);
  return { page, close: () => context.close() };
}
async function value<T>(page: Page, path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await authenticatedRequest(page, path, method, data);
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as T;
}
async function assign(page: Page, s: Scenario, username: string) {
  const response = await value<{ created: Assignment[]; refused: unknown[] }>(page, `${root(s)}/assignments`, 'POST', {
    task: 'annotate', rows: [{ document_id: s.documents.source, username }], confirm_language: false,
  });
  expect(response.refused).toEqual([]); return response.created[0];
}
async function finding(page: Page, assignment: Assignment, note: string) {
  await page.goto(`/#/tasks/${assignment.id}`);
  await expect(page.locator('.text-container')).toBeVisible();
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/i).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  await expect(page.locator('.sidebar .doc-item')).toHaveCount(1);
  const noteField = page.getByRole('textbox', { name: 'Annotation note' });
  if (await noteField.count()) {
    await noteField.fill(note);
    await noteField.blur();
  }
  await submitCase(page);
}

test('ordinary human carry-forward stays private, then exact consolidation is explicitly selected and consciously exported', async ({ page, browser }) => {
  const response = await page.request.post('/__test_translation_review__?workflow=true', { timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy(); const s = await response.json() as Scenario;
  await loginExisting(page, s.users.lead);
  const first = await assign(page, s, s.users.reviewer), second = await assign(page, s, s.users.other);
  const author = await actor(browser, s.users.reviewer), other = await actor(browser, s.users.other), reviewer = await actor(browser, s.users.consolidator);
  try {
    await finding(author.page, first, 'First human original note');
    const old = await value<Opened>(author.page, `/api/v1/assignments/${first.id}/open`, 'POST');
    const initialId = old.assignment.last_submission_id!; expect(initialId).toBeTruthy();
    await finding(other.page, second, 'Independent second human note');
    const secondResult = await value<Opened>(other.page, `/api/v1/assignments/${second.id}/open`, 'POST');
    const secondId = secondResult.assignment.last_submission_id!;
    await author.page.getByRole('dialog', { name: 'Case submitted' }).getByRole('button', { name: 'Stay in case', exact: true }).click();
    await author.page.getByRole('button', { name: 'Work rounds', exact: true }).click();
    const rounds = author.page.getByRole('dialog', { name: 'Work rounds', exact: true });
    await rounds.getByLabel('My submitted work to carry forward').selectOption(initialId);
    const created = author.page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/assignments/${first.id}/rounds`));
    await rounds.getByRole('button', { name: 'Start carry-forward round' }).click();
    const carry = await (await created).json() as Round;
    expect(carry.kind).toBe('carry_forward'); expect(carry.input_submission_ids).toEqual([initialId]);
    await expect(author.page.getByRole('region', { name: 'Review carried findings' })).toContainText('1 pending');
    // An ordinary annotator has no proposal browsing; only this exact private input appears.
    const privateVersions = await value<components['schemas']['VersionRef'][]>(author.page, `${root(s)}/documents/${encodeURIComponent(s.documents.source)}/annotation-versions`);
    expect(privateVersions.map(version => ({ kind: version.kind, id: version.id }))).toEqual([{ kind: 'own', id: initialId }]);
    expect(privateVersions.some(version => version.id === secondId)).toBe(false);
    await author.page.getByRole('button', { name: 'Inspect original evidence' }).click();
    await expect(author.page.getByRole('dialog', { name: 'Original carried finding' })).toBeVisible();
    await author.page.getByRole('dialog', { name: 'Original carried finding' }).getByRole('button', { name: /close/i }).click();
    await author.page.getByRole('button', { name: 'Complete carried finding review' }).click();
    await expect(author.page.getByRole('region', { name: 'Review carried findings' })).toContainText('0 pending');
    await submitCase(author.page);
    const carried = await value<Opened>(author.page, `/api/v1/assignments/${first.id}/open`, 'POST');
    const carriedId = carried.assignment.last_submission_id!; expect(carriedId).not.toBe(initialId);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}?variant=${encodeURIComponent(s.documents.source)}`);
    await page.getByRole('button', { name: 'Submissions', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Submission history' });
    await history.getByRole('button', { name: 'Consolidate results' }).click();
    await history.getByRole('checkbox', { name: `Include submission ${carriedId}`, exact: true }).check();
    await history.getByRole('checkbox', { name: `Include submission ${secondId}`, exact: true }).check();
    await history.getByLabel('Consolidation reviewer').selectOption(s.users.consolidator);
    const launched = page.waitForResponse(r => r.request().method() === 'POST' && /\/assignments\/\d+\/rounds$/.test(r.url()));
    await history.getByRole('button', { name: 'Start consolidation', exact: true }).click();
    const consolidation = await (await launched).json() as Round;
    expect(consolidation.kind).toBe('consolidation'); expect(new Set(consolidation.input_submission_ids)).toEqual(new Set([carriedId, secondId]));
    await reviewer.page.goto(`/#/tasks/${consolidation.assignment_id}`);
    await expect(reviewer.page.getByText('Consolidation review', { exact: true })).toBeVisible();
    const proposals = reviewer.page.locator('.sidebar .doc-item').filter({ hasText: 'HP:0001252' });
    await expect(proposals).toHaveCount(2);
    for (let index = 0; index < 2; index++) {
      await proposals.nth(index).click();
      await reviewer.page.getByRole('button', { name: /^Confirm/i }).first().click();
      await expect(proposals.nth(index)).toContainText(/confirmed/i);
    }
    await submitCase(reviewer.page);
    const consolidated = await value<Opened>(reviewer.page, `/api/v1/assignments/${consolidation.assignment_id}/open`, 'POST');
    const finalId = consolidated.assignment.last_submission_id!;
    await page.reload(); await page.getByRole('button', { name: 'Submissions', exact: true }).click();
    await history.getByLabel('Submitted result', { exact: true }).selectOption(finalId);
    await history.getByRole('button', { name: 'Select final result', exact: true }).click();
    await expect(history.getByRole('status').filter({ hasText: `Selected: ${finalId}` })).toBeVisible();
    await history.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByLabel('Selected final result', { exact: true })).toContainText(finalId);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/export`);
    await page.getByRole('button', { name: 'Review final export', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Export preflight' })).toBeVisible();
    const create = page.getByRole('button', { name: 'Create final export', exact: true });
    await expect(create).toBeDisabled();
    await page.getByLabel('Export these selected results with the listed warnings and omissions').check();
    const exportResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/exports/final'));
    await create.click(); expect((await exportResponse).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Download final export' })).toBeVisible({ timeout: 30_000 });
    const state = await value<Preflight>(page, `${root(s)}/exports/final/preflight`, 'POST');
    expect(state.selections.map(selection => selection.submission_id)).toEqual([finalId]);
    const historyRows = await value<Submission[]>(page, `${root(s)}/documents/${encodeURIComponent(s.documents.source)}/submissions`);
    expect(historyRows.map(row => row.submission_id)).toEqual(expect.arrayContaining([initialId, carriedId, secondId, finalId]));
    await test.info().attach('exact-workflow-identities', { body: Buffer.from(JSON.stringify({ project: s.project, initialId, carry, carriedId, secondId, consolidation, finalId, state }, null, 2)), contentType: 'application/json' });
    await page.screenshot({ path: test.info().outputPath('final-export-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath('final-export-mobile.png'), fullPage: true });
  } finally { await Promise.all([author.close(), other.close(), reviewer.close()]); }
});

test('source update review shows both immutable sources and deliberately submits unchanged translation for the exact cause', async ({ page }) => {
  const response = await page.request.post('/__test_translation_review__?assignment=target&source_update=true', { timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy(); const s = await response.json() as Scenario;
  await loginExisting(page, s.users.reviewer);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await page.getByRole('radio', { name: 'Accepted unchanged', exact: true }).check();
  const causes = await value<components['schemas']['SourceObligationView'][]>(page, `/api/v1/translation-reviews/${s.assignment_id}/source-obligations`);
  expect(causes).toHaveLength(1); const cause = causes[0];
  expect(cause.old_source_document_id).toBe(s.documents.source);
  expect(cause.old_source_text_sha256).not.toBe(cause.new_source_text_sha256);
  await page.getByRole('button', { name: `Review source update to ${cause.new_source_document_id}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review source update', exact: true });
  await expect(dialog.getByRole('region', { name: 'Original source', exact: true })).not.toContainText('Updated source: additional clinical detail.');
  await expect(dialog.getByRole('region', { name: 'Updated source', exact: true })).toContainText('Updated source: additional clinical detail.');
  await expect(dialog.getByRole('region', { name: 'Current translation', exact: true })).toContainText('Dosis 5 mg.');
  const submit = dialog.getByRole('button', { name: 'Submit review and resolve source update', exact: true });
  await expect(submit).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('source-obligation-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('source-obligation-mobile.png'), fullPage: true });
  const resolved = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/source-obligations/${encodeURIComponent(cause.cause_id)}/resolve`));
  await submit.click(); const record = await resolved; expect(record.ok(), await record.text()).toBeTruthy();
  expect(record.request().postDataJSON()).toEqual({ expected_revision: 1, translation_text_sha256: cause.translation_text_sha256, old_source_text_sha256: cause.old_source_text_sha256, new_source_text_sha256: cause.new_source_text_sha256 });
  await expect(page.getByText('Review submitted', { exact: true })).toBeVisible();
  expect(await value<unknown[]>(page, `/api/v1/translation-reviews/${s.assignment_id}/source-obligations`)).toEqual([]);
  await test.info().attach('exact-source-obligation', { body: Buffer.from(JSON.stringify({ project: s.project, assignment: s.assignment_id, cause, record: await record.json() }, null, 2)), contentType: 'application/json' });
});


test('corrected-text private carry preserves submitted history through a reported hold and agreed empty restart', async ({ page, browser }) => {
  const response = await page.request.post('/__test_translation_review__?workflow=true&source_update=true', { timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy(); const s = await response.json() as Scenario;
  await loginExisting(page, s.users.lead);
  const sourceAssignment = await assign(page, s, s.users.reviewer);
  const author = await actor(browser, s.users.reviewer);
  try {
    await finding(author.page, sourceAssignment, 'Original note before correction');
    const original = await value<Opened>(author.page, `/api/v1/assignments/${sourceAssignment.id}/open`, 'POST');
    const originalId = original.assignment.last_submission_id!;
    const docs = await value<components['schemas']['ProjectDocumentSummary'][]>(page, `${root(s)}/documents`);
    const corrected = docs.find(doc => doc.origin === 'correction' && doc.language === 'en')!;
    expect(corrected).toBeTruthy();
    const assigned = await value<{ created: Assignment[]; refused: unknown[] }>(page, `${root(s)}/assignments`, 'POST', { task: 'annotate', rows: [{ document_id: corrected.document_id, username: s.users.reviewer }], confirm_language: false });
    expect(assigned.refused).toEqual([]); const task = assigned.created[0];
    await author.page.goto(`/#/tasks/${task.id}`);
    await author.page.getByRole('button', { name: 'Work rounds', exact: true }).click();
    const rounds = author.page.getByRole('dialog', { name: 'Work rounds', exact: true });
    await rounds.getByLabel('My submitted work to carry forward').selectOption(originalId);
    const carryResponse = author.page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/v1/assignments/${task.id}/rounds`, { timeout: 60_000 });
    await rounds.getByRole('button', { name: 'Start carry-forward round' }).click();
    const carried = await carryResponse;
    expect(carried.ok(), await carried.text()).toBeTruthy();
    await expect(author.page.getByRole('region', { name: 'Review carried findings' })).toContainText('1 pending');
    await expect(author.page.locator('.text-container')).toContainText('Updated source: additional clinical detail.');
    await author.page.getByRole('button', { name: 'Complete carried finding review' }).click();
    await expect(author.page.getByRole('region', { name: 'Review carried findings' })).toContainText('0 pending');
    await submitCase(author.page);
    const submitted = await value<Opened>(author.page, `/api/v1/assignments/${task.id}/open`, 'POST');
    const carriedId = submitted.assignment.last_submission_id!;
    await author.page.getByRole('dialog', { name: 'Case submitted' }).getByRole('button', { name: 'Stay in case', exact: true }).click();
    await author.page.getByRole('button', { name: 'Report a problem', exact: true }).click();
    const reports = author.page.getByRole('dialog', { name: 'Task problem reports', exact: true });
    await reports.getByLabel('Problem description').fill('Review the corrected clinical context before continuing.');
    await reports.getByRole('button', { name: 'Report and pause my task' }).click();
    await expect(reports).toContainText('Task paused:');
    const reportRows = await value<components['schemas']['ProblemReportView'][]>(page, `${root(s)}/problem-reports`);
    const report = reportRows.find(item => item.assignment_id === task.id)!;
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/problem-reports/${encodeURIComponent(report.report_id)}`);
    await page.getByLabel('Report action').selectOption('restart');
    await page.getByLabel('I have agreed with the task owner to start an empty round').check();
    await page.getByLabel('Action reason').fill('Agreed with the author: start a separate empty annotation round.');
    await page.getByRole('button', { name: 'Apply report action', exact: true }).click();
    await expect(page.getByText('Empty round created. The task owner can open it from Work rounds.')).toBeVisible();
    await author.page.reload();
    await expect(author.page.getByRole('button', { name: 'Report a problem', exact: true })).toBeVisible();
    await expect(author.page.locator('.sidebar .doc-item')).toHaveCount(0);
    const fresh = await value<Opened>(author.page, `/api/v1/assignments/${task.id}/open`, 'POST');
    expect(fresh.assignment.last_submission_id).toBeNull();
    expect(fresh.assignment.held).toBe(false);
    const history = await value<Submission[]>(page, `${root(s)}/documents/${encodeURIComponent(corrected.document_id)}/submissions`);
    expect(history.map(row => row.submission_id)).toContain(carriedId);
    const oldHistory = await value<Submission[]>(page, `${root(s)}/documents/${encodeURIComponent(s.documents.source)}/submissions`);
    expect(oldHistory.map(row => row.submission_id)).toContain(originalId);
    await test.info().attach('corrected-carry-report-restart', { body: Buffer.from(JSON.stringify({ originalId, corrected: corrected.document_id, carriedId, report: report.report_id, newRound: fresh.assignment.active_round_id }, null, 2)), contentType: 'application/json' });
  } finally { await author.close(); }
});
