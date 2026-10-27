import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { activityLines, documentsReady, documentsScenario, openCardHistory, openDecisionBlock, openTextCard, rowCell, textRow } from './documentsHelpers';
import { authenticatedRequest, loginExisting, selectText, submitCase, viewSubmittedResult } from './helpers';

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
/** The Work rounds dialog; its title names the text and language ("Work rounds: {text} {language}"). */
const workRounds = (page: Page) => page.getByRole('dialog', { name: /^Work rounds/ });
/** Choose the exact submission to continue from (radio group "Continue from") and start the carry-forward round. */
async function continueFrom(rounds: Locator, submissionId: string) {
  await rounds.getByRole('radiogroup', { name: 'Continue from', exact: true }).locator(`input[type="radio"][value="${submissionId}"]`).check();
  await rounds.getByRole('button', { name: 'Continue from this submission', exact: true }).click();
}
/** Sidebar progress of a carry-forward round ("0 of 1 checked", "All carried findings checked"). */
const carriedProgress = (page: Page) => page.locator('.carried-progress__status');
/** The "Open in editor" link of one exact submission in the final-result panel (its href carries the submission ref). */
const editorLink = (panel: Locator, submissionId: string) => {
  // Route hrefs keep commas literal (router querySuffix).
  const ref = new URLSearchParams({ annotations: JSON.stringify(['submission', submissionId]) }).toString().replace(/%2C/gi, ',');
  return panel.locator(`a[href*="${ref}"]`);
};
async function finding(page: Page, assignment: Assignment, note: string) {
  await page.goto(`/#/tasks/${assignment.id}`);
  await expect(page.locator('.text-container')).toBeVisible();
  await selectText(page, 0, 9);
  await page.getByLabel("Search term", { exact: true }).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  await expect(page.locator('.sidebar .doc-item')).toHaveCount(1);
  const noteField = page.getByRole('textbox', { name: 'Note', exact: true });
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
    await viewSubmittedResult(author.page);
    await author.page.getByRole('button', { name: 'Work rounds', exact: true }).click();
    const rounds = workRounds(author.page);
    const created = author.page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/assignments/${first.id}/rounds`));
    await continueFrom(rounds, initialId);
    const carry = await (await created).json() as Round;
    expect(carry.kind).toBe('carry_forward'); expect(carry.input_submission_ids).toEqual([initialId]);
    await expect(carriedProgress(author.page)).toHaveText('0 of 1 checked');
    // An ordinary annotator has no proposal browsing; only this exact private input appears.
    const privateVersions = await value<components['schemas']['VersionRef'][]>(author.page, `${root(s)}/documents/${encodeURIComponent(s.documents.source)}/annotation-versions`);
    expect(privateVersions.map(version => ({ kind: version.kind, id: version.id }))).toEqual([{ kind: 'own', id: initialId }]);
    expect(privateVersions.some(version => version.id === secondId)).toBe(false);
    await author.page.locator('.sidebar .doc-item').filter({ hasText: 'HP:0001252' }).click();
    await author.page.getByRole('button', { name: 'Show original evidence', exact: true }).click();
    const original = author.page.getByRole('dialog', { name: /^Original finding from/ });
    await expect(original).toBeVisible();
    await original.getByRole('button', { name: 'Close original evidence', exact: true }).click();
    await expect(original).toHaveCount(0);
    await author.page.getByRole('button', { name: 'Mark as checked', exact: true }).click();
    await expect(carriedProgress(author.page)).toHaveText('All carried findings checked');
    await submitCase(author.page);
    const carried = await value<Opened>(author.page, `/api/v1/assignments/${first.id}/open`, 'POST');
    const carriedId = carried.assignment.last_submission_id!; expect(carriedId).not.toBe(initialId);
    // Consolidation starts only from the text card's decision block ("Consolidate…"); the final selection happens there too (V6).
    const docs = await value<components['schemas']['ProjectDocumentSummary'][]>(page, `${root(s)}/documents`);
    const language = docs.find(doc => doc.document_id === s.documents.source)!.language;
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
    await documentsReady(page);
    const decide = new RegExp(`^(Accept result|Compare results)…, ${s.case_id}\\W+${language}$`);
    // Work is still open (no final decision yet): the text name opens the text card; two submissions offer Consolidate….
    const area = await openCardHistory(page, s.case_id, language);
    // History: the three submissions (initial, independent second, carried) with their finding counts.
    await expect(activityLines(area).filter({ hasText: /^Annotation: .*\d+ findings?/ })).toHaveCount(3);
    await area.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(area.getByText('Start consolidation…')).toHaveCount(0);
    await (await openDecisionBlock(page, s.case_id, language)).getByRole('button', { name: 'Consolidate…', exact: true }).click();
    const launcher = area.getByRole('region', { name: 'Consolidate submitted results', exact: true });
    // The inputs are named by person and round (no codes); the exact submissions are picked by their data attribute.
    for (const box of await launcher.getByRole('checkbox').all()) await box.uncheck();
    await launcher.locator(`input[data-submission-id="${carriedId}"]`).check();
    await launcher.locator(`input[data-submission-id="${secondId}"]`).check();
    await launcher.getByLabel('Consolidator', { exact: true }).selectOption(s.users.consolidator);
    // One request: POST /projects/{key}/consolidations (acceptance fixes WP-B, T3).
    const launched = page.waitForResponse(r => r.request().method() === 'POST' && /\/projects\/[^/]+\/consolidations$/.test(r.url()));
    await launcher.getByRole('button', { name: 'Start consolidation', exact: true }).click();
    const consolidation = (await (await launched).json() as { round: Round }).round;
    expect(consolidation.kind).toBe('consolidation'); expect(new Set(consolidation.input_submission_ids)).toEqual(new Set([carriedId, secondId]));
    // A started consolidation releases the decision block; the card stays open.
    await area.getByRole('button', { name: 'Close', exact: true }).click();
    await reviewer.page.goto(`/#/tasks/${consolidation.assignment_id}`);
    // The task opens the consolidation view (U6): every open group takes the first ✓ of each conflicting row, then submit.
    const view = reviewer.page;
    await expect(view.getByRole('heading', { level: 1, name: /^Consolidate / })).toBeVisible({ timeout: 30_000 });
    // A group without conflicting rows (e.g. only overlapping text spans differ) is kept.
    const open = view.locator('.cons-group-expanded:not(.cons-group-resolved)');
    const path = view.getByRole('navigation', { name: 'Text path', exact: true });
    // The path names the open groups ("consolidating, n of m groups open"); each decision changes it.
    for (let guard = 0; guard < 10 && !/, 0 of \d+ groups open/.test(await path.innerText()); guard++) {
      const before = await path.innerText();
      const rows = open.locator('tr.cons-row--conflict');
      const count = await rows.count();
      for (let index = 0; index < count; index++) await rows.nth(index).locator('button.cons-take').first().click();
      if (!count) await open.getByRole('button', { name: /^Keep/ }).first().click();
      await expect(path).not.toHaveText(before);
      await expect(view.locator('.cons-screen [aria-busy="true"]')).toHaveCount(0);
    }
    await view.getByRole('button', { name: 'Submit consolidation', exact: true }).click();
    const summary = view.getByRole('dialog', { name: 'Submit consolidation?' });
    await summary.getByRole('button', { name: 'Submit', exact: true }).click();
    // Values filled in by default are listed in the dialog first (AXIS_CONFIRMATION_WARNING); the second click acknowledges them.
    const withWarnings = summary.getByRole('button', { name: /^Submit with \d+ warnings?$/ });
    const submitted = view.getByText('Consolidation submitted. The lead then accepts the result.', { exact: true });
    await expect(withWarnings.or(submitted)).toBeVisible();
    if (await withWarnings.isVisible()) await withWarnings.click();
    await expect(submitted).toBeVisible();
    const consolidated = await value<Opened>(reviewer.page, `/api/v1/assignments/${consolidation.assignment_id}/open`, 'POST');
    const finalId = consolidated.assignment.last_submission_id!;
    await page.reload(); await documentsReady(page);
    // "Accept result…" (the consolidation alone) or "Compare results…" opens the text card; choose the exact consolidation.
    await page.getByRole('button', { name: decide }).click();
    const panel = await openDecisionBlock(page, s.case_id, language);
    await expect(editorLink(panel, finalId)).toHaveCount(1);
    const selecting = page.waitForResponse(r => r.request().method() !== 'GET' && /\/final/.test(new URL(r.url()).pathname));
    const accept = panel.getByRole('button', { name: 'Accept result', exact: true });
    if (await accept.count()) {
      await expect(panel.getByText(/^Consolidated by .+$/)).toBeVisible();
      await expect(panel.getByText('Accept this consolidation as the result?', { exact: true })).toBeVisible();
      await accept.click();
    } else {
      await panel.getByRole('row').filter({ has: editorLink(panel, finalId) }).getByRole('button', { name: 'Use as final', exact: true }).click();
    }
    expect((await selecting).ok()).toBeTruthy();
    const body = (await selecting).request().postDataJSON() as { submission_id: string };
    expect(body.submission_id).toBe(finalId);
    await expect(panel.locator('.final-panel-success')).toContainText(new RegExp(`Final result saved for ${s.case_id}\\W+${language}\\.`));
    await panel.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(rowCell(textRow(page, s.case_id, language), 'finalization')).toContainText('accepted');
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/export`);
    // D8: the preflight runs on opening Export.
    await expect(page.getByRole('region', { name: 'Export check' })).toBeVisible();
    const create = page.getByRole('button', { name: 'Create final export', exact: true });
    await expect(create).toHaveAttribute('aria-disabled', 'true');
    await page.getByLabel(/^Export the \d+ results? as (they are|it is)/).check();
    const exportResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/exports/final'));
    await create.click(); expect((await exportResponse).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Download (ZIP)' })).toBeVisible({ timeout: 30_000 });
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
    const rounds = workRounds(author.page);
    const carryResponse = author.page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/v1/assignments/${task.id}/rounds`, { timeout: 60_000 });
    await continueFrom(rounds, originalId);
    const carried = await carryResponse;
    expect(carried.ok(), await carried.text()).toBeTruthy();
    await expect(carriedProgress(author.page)).toHaveText('0 of 1 checked');
    await expect(author.page.locator('.text-container')).toContainText('Updated source: additional clinical detail.');
    await author.page.locator('.sidebar .doc-item').filter({ hasText: 'HP:0001252' }).click();
    await author.page.getByRole('button', { name: 'Mark as checked', exact: true }).click();
    await expect(carriedProgress(author.page)).toHaveText('All carried findings checked');
    await submitCase(author.page);
    const submitted = await value<Opened>(author.page, `/api/v1/assignments/${task.id}/open`, 'POST');
    const carriedId = submitted.assignment.last_submission_id!;
    await viewSubmittedResult(author.page);
    // A submitted task: "Text problems" opens on the reports, the form second (#49 R-20).
    await author.page.getByRole('button', { name: /^Text problems/ }).click();
    await author.page.getByRole('dialog', { name: `Problems with Task ${task.id}`, exact: true }).getByRole('button', { name: 'New report', exact: true }).click();
    const form = author.page.getByRole('dialog', { name: 'New problem report', exact: true });
    await form.getByRole('textbox', { name: /What is the problem\?/ }).fill('Review the corrected clinical context before continuing.');
    await form.getByRole('button', { name: 'Report and pause my task', exact: true }).click();
    await expect(author.page.getByRole('dialog', { name: `Problems with Task ${task.id}`, exact: true })).toContainText('Reported. Your task is paused until you or a project lead resume it.');
    const reportRows = await value<components['schemas']['ProblemReportView'][]>(page, `${root(s)}/problem-reports`);
    const report = reportRows.find(item => item.assignment_id === task.id)!;
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/problem-reports/${encodeURIComponent(report.report_id)}`);
    await page.getByRole('group', { name: 'Decide on this report', exact: true }).getByRole('button', { name: 'Agree empty restart…', exact: true }).click();
    const restart = page.getByRole('group', { name: `Agree empty restart of Task ${task.id}`, exact: true });
    await restart.getByLabel(/^I agreed this restart with /).check();
    await restart.getByLabel(/^Reason \(becomes the outcome/).fill('Agreed with the author: start a separate empty annotation round.');
    const restarted = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(`/problem-reports/${encodeURIComponent(report.report_id)}`));
    await restart.getByRole('button', { name: 'Restart with empty round', exact: true }).click();
    expect((await restarted).ok()).toBeTruthy();
    await expect(page.getByText(new RegExp(`^Task ${task.id} restarted with `))).toBeVisible();
    await author.page.reload();
    await expect(author.page.locator('button.problem-entry')).toBeVisible();
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


test('a lead without the Consolidator role consolidates as You, and full agreement is accepted in one click (W1)', async ({ page }) => {
  const s = await documentsScenario(page, 'S16');
  const matchCase = s.case_id!, openCase = s.open_case_id as string;
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);

  // Work still open on case-1602: the decision block offers only "Consolidate…" (two eligible submissions).
  const area = await openTextCard(page, openCase, 'en');
  const block = await openDecisionBlock(page, openCase, 'en');
  await expect(block.getByRole('button', { name: /^Accept result/ })).toHaveCount(0);
  await block.getByRole('button', { name: 'Consolidate…', exact: true }).click();
  const launcher = area.getByRole('region', { name: 'Consolidate submitted results', exact: true });
  const reviewer = launcher.getByLabel('Consolidator', { exact: true });
  await expect(reviewer.locator('option').nth(1)).toHaveText(/^You( \(.+\))?$/);
  await expect(launcher.getByText('No member has the Consolidator role yet. Give it in Settings → People.', { exact: true })).toBeVisible();
  await expect(launcher.getByRole('link', { name: 'Settings → People', exact: true })).toHaveAttribute('href', `#/projects/${encodeURIComponent(s.project)}/settings/people`);
  await reviewer.selectOption(s.users.lead);
  await expect(launcher.getByText('You will get the Consolidator role for this project.', { exact: true })).toBeVisible();
  const started = page.waitForResponse(r => r.request().method() === 'POST' && /\/projects\/[^/]+\/consolidations$/.test(r.url()));
  await launcher.getByRole('button', { name: 'Start consolidation', exact: true }).click();
  const response = await started;
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json() as { round: Round; role_granted: boolean };
  expect(body.role_granted).toBe(true);
  expect(body.round.kind).toBe('consolidation');
  await expect(page.locator('.ui-toast-message')).toHaveText(new RegExp(`^Consolidation started for ${openCase}\\W+en\\. You now have the Consolidator role for this project\\.$`));
  await expect(page.locator('.ui-toast').getByRole('button', { name: 'Open consolidation', exact: true })).toBeVisible();
  // Still signed in: the session survives the self-grant, and the lead now holds the role.
  const members = await value<components['schemas']['Member'][]>(page, `${root(s as unknown as Scenario)}/members`);
  expect(members.find(member => member.username === s.users.lead)!.roles).toContain('adjudicator');
  await page.goto(`/#/tasks/${body.round.assignment_id}`);
  await expect(page.getByRole('textbox', { name: 'Username' })).toHaveCount(0);
  // The consolidator's task opens the consolidation view (acceptance fixes WP-E).
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^Consolidate ${openCase}\\W+en v1$`) })).toBeVisible({ timeout: 30_000 });

  // Full agreement on case-1601: "Both submissions have no findings" and one "Accept result" that saves at once.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  const match = await openDecisionBlock(page, matchCase, 'en');
  await expect(match.getByText('Both submissions have no findings', { exact: true })).toBeVisible();
  await expect(match.getByRole('table')).toHaveCount(0);
  await expect(match.getByRole('link', { name: 'Open result', exact: true })).toBeVisible();
  const selecting = page.waitForResponse(r => r.request().method() === 'PUT' && /\/final-selections$/.test(new URL(r.url()).pathname));
  await match.getByRole('button', { name: 'Accept result', exact: true }).click();
  const selected = await selecting;
  expect(selected.ok(), await selected.text()).toBeTruthy();
  const submissions = s.submissions as { match: string[] };
  expect((selected.request().postDataJSON() as { submission_id: string }).submission_id).toBe(submissions.match[0]);
  await expect(match.locator('.final-panel-success')).toContainText(new RegExp(`Final result saved for ${matchCase}\\W+en\\.`));
});
