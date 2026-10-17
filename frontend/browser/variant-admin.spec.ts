import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, loginExisting, selectText, TEST_PASSWORD } from './helpers';

test.setTimeout(120_000);
type RecordView = components['schemas']['TranslationReviewRecord'];
type Review = components['schemas']['ReviewWorkspace'];
type Assignment = components['schemas']['AssignmentView'];
type Workspace = components['schemas']['AssignmentOpenResponse'];
type Variant = components['schemas']['VariantInfo'];
type Job = components['schemas']['JobView'];
type Upload = components['schemas']['UploadView'];
type Scenario = {
  project: string; import_job_id: number; case_id: string; external_id: string;
  documents: { source: string; target: string; failed: string };
  users: { lead: string; reviewer: string; other: string; manager: string; historian: string };
  assignment_id: number; texts: { source: string; target: string; failed: string };
};
const root = (s: { project: string }) => `/api/v1/projects/${encodeURIComponent(s.project)}`;
const documentPath = (s: Scenario, id: string, suffix: string) => `${root(s)}/documents/${encodeURIComponent(id)}/${suffix}`;
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
async function attach(name: string, value: unknown) {
  await test.info().attach(name, { body: Buffer.from(JSON.stringify(value, null, 2)), contentType: 'application/json' });
}
async function scenario(page: Page): Promise<Scenario> {
  const response = await page.request.post('/__test_translation_review__?assignment=target&manager=true', { timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = await response.json() as Scenario;
  await attach('fresh-admin-review-import', { project: s.project, job: s.import_job_id, documents: s.documents, assignment: s.assignment_id });
  return s;
}
async function actor(browser: Browser, username: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage(); await loginExisting(page, username);
  return { page, close: () => context.close() };
}
async function submitReview(page: Page, s: Scenario, text = s.texts.target): Promise<RecordView> {
  const path = `/api/v1/translation-reviews/${s.assignment_id}`;
  const opened = await authenticatedRequest(page, path); expect(opened.ok()).toBeTruthy();
  const workspace = await opened.json() as Review;
  expect(workspace.read_only).toBe(false);
  const saved = await authenticatedRequest(page, `${path}/draft`, 'PUT', {
    expected_revision: workspace.draft.revision, text,
    form: { decision: text === s.texts.target ? 'accepted_unchanged' : 'accepted_corrected', clinical_change: false },
  }); expect(saved.ok(), await saved.text()).toBeTruthy();
  const revision = (await saved.json() as { revision: number }).revision;
  const submitted = await authenticatedRequest(page, `${path}/submit`, 'POST', { expected_revision: revision });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
  return await submitted.json() as RecordView;
}
async function openWorkspace(page: Page, id: number): Promise<Workspace> {
  const response = await authenticatedRequest(page, `/api/v1/assignments/${id}/open`, 'POST');
  expect(response.ok(), await response.text()).toBeTruthy(); return await response.json() as Workspace;
}
async function variant(page: Page, s: Scenario, id: string): Promise<Variant> {
  const response = await authenticatedRequest(page, documentPath(s, id, 'variant')); expect(response.ok()).toBeTruthy();
  return await response.json() as Variant;
}
async function finishedJob(page: Page, id: number): Promise<Job> {
  let result: Job | undefined;
  await expect.poll(async () => {
    const response = await authenticatedRequest(page, `/api/v1/jobs/${id}`); expect(response.ok()).toBeTruthy();
    result = await response.json() as Job; return result.status;
  }, { timeout: 30_000 }).toMatch(/^(succeeded|failed)$/);
  expect(result!.status, result!.error ?? '').toBe('succeeded'); return result!;
}
function documentRow(page: Page, id: string) {
  return page.getByTestId('document-row').filter({ has: page.getByRole('cell', { name: id, exact: true }) });
}

test('ordinary lead imports an explicit reasoned override with the real preview SHA and authoritative accepted-without-review flag', async ({ page }) => {
  const fixture = await page.request.post('/__test_admin_upload__'); expect(fixture.ok()).toBeTruthy();
  const s = await fixture.json() as { project: string; username: string; external_id: string; filename: string; base64: string; sha256: string };
  const bytes = Buffer.from(s.base64, 'base64'); expect(sha(bytes)).toBe(s.sha256);
  await loginExisting(page, s.username);
  const projects = await (await authenticatedRequest(page, '/api/v1/projects')).json() as { project_key: string; roles: string[] }[];
  expect(projects.find(p => p.project_key === s.project)?.roles).toEqual(['lead']);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await expect(page.getByRole('heading', { name: 'No documents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Upload documents', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload documents', exact: true });
  await dialog.getByLabel('Files (required)', { exact: true }).setInputFiles({ name: s.filename, mimeType: 'application/zip', buffer: bytes });
  const checking = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`${root(s)}/uploads`));
  await dialog.getByRole('button', { name: 'Check', exact: true }).click();
  const checked = await checking; expect(checked.ok()).toBeTruthy();
  const created = await checked.json() as { upload_id: number; job_id: number };
  const previewJob = await finishedJob(page, created.job_id); expect(previewJob.kind).toBe('upload_preview');
  await expect(dialog.getByRole('table', { name: 'Variants', exact: true })).toContainText('units_added');
  await expect(dialog.getByRole('table', { name: 'Variants', exact: true })).toContainText('Check failed');
  const response = await authenticatedRequest(page, `${root(s)}/uploads/${created.upload_id}`); expect(response.ok()).toBeTruthy();
  const upload = await response.json() as Upload; expect(upload.status).toBe('ready'); expect(upload.plan_sha256).toMatch(/^[a-f0-9]{64}$/);
  const planned = upload.preview!.variants!.find(v => v.language === 'de')!;
  expect(planned.external_id).toBe(s.external_id); expect(planned.failed_checks).toEqual(['units_added']);
  expect(planned.derived_in_upload).toBe(true); expect(planned.origin).toBe('machine_translation');
  const checkbox = dialog.getByRole('checkbox', { name: `Accept without review: ${s.external_id} · de · v1`, exact: true });
  await checkbox.check(); await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  const reason = 'Independent lead accepts this generic example after checking its units.';
  await dialog.getByRole('textbox', { name: `Reason: ${s.external_id} · de · v1 (required)`, exact: true }).fill(reason);
  const committing = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/uploads/${created.upload_id}/commit`));
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  const committed = await committing; expect(committed.ok(), await committed.text()).toBeTruthy();
  expect(committed.request().postDataJSON()).toEqual({ plan_sha256: upload.plan_sha256, status_overrides: [{ external_id: s.external_id, language: 'de', version: 1, reason }] });
  const commit = await committed.json() as { job_id: number };
  const job = await finishedJob(page, commit.job_id); expect(job.kind).toBe('upload_commit');
  await expect(dialog).toContainText('Imported 2 documents and 0 proposals.');
  const inventory = await (await authenticatedRequest(page, `${root(s)}/documents`)).json() as components['schemas']['ProjectDocumentSummary'][];
  const target = inventory.find(d => d.external_id === s.external_id && d.language === 'de')!;
  expect(target.accepted_without_review).toBe(true); expect(target.translation_status).toBe('accepted'); expect(target.status_reason).toBe(reason);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await page.getByLabel('Origin', { exact: true }).selectOption('machine_translation');
  await page.getByLabel('Translation status', { exact: true }).selectOption('accepted');
  const row = documentRow(page, target.document_id); await expect(row).toContainText('Accepted without review');
  await expect(row.getByTitle(reason, { exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toContain('origin=machine_translation'); expect(new URL(page.url()).hash).toContain('translation_status=accepted');
  const records = await authenticatedRequest(page, `${root(s)}/documents/${encodeURIComponent(target.document_id)}/translation-reviews`);
  expect(records.ok()).toBeTruthy(); expect(await records.json()).toEqual([]);
  await attach('real-upload-preview-and-commit', { project: s.project, public_bundle_sha256: s.sha256, upload_id: upload.id, plan_sha256: upload.plan_sha256, previewJob, commitJob: job, target });
});

test('current accepted-to-reviewed gate refuses old editable commands and submission while preserving input and immutable submitted history', async ({ page, browser }) => {
  const s = await scenario(page);
  const reviewer = await actor(browser, s.users.reviewer), lead = await actor(browser, s.users.lead), historian = await actor(browser, s.users.historian);
  try {
    const initial = await submitReview(reviewer.page, s); expect(initial.status_after).toBe('accepted');
    const assigned = await authenticatedRequest(lead.page, `${root(s)}/assignments`, 'POST', { task: 'annotate', confirm_language: false, rows: [{ document_id: s.documents.target, username: s.users.other }, { document_id: s.documents.target, username: s.users.historian }] });
    expect(assigned.ok()).toBeTruthy(); const result = await assigned.json() as { created: Assignment[]; refused: unknown[] };
    expect(result.refused).toEqual([]); expect(result.created).toHaveLength(2);
    const editableId = result.created.find(a => a.username === s.users.other)!.id, historicalId = result.created.find(a => a.username === s.users.historian)!.id;
    const historical = await openWorkspace(historian.page, historicalId);
    const historicalSubmission = await authenticatedRequest(historian.page, `/api/v1/workspaces/${encodeURIComponent(historical.workspace_id)}/submit`, 'POST', { mutation_id: randomUUID(), expected_revision: historical.view.draft.revision, payload: { command: 'submit_workspace', document_checked: true, checked_layer_ids: ['hpo'] } });
    expect(historicalSubmission.ok(), await historicalSubmission.text()).toBeTruthy(); const submission = await historicalSubmission.json() as components['schemas']['Submission'];
    await loginExisting(page, s.users.other);
    const editable = await openWorkspace(page, editableId), path = `/api/v1/workspaces/${encodeURIComponent(editable.workspace_id)}`;
    const receipt = { mutation_id: randomUUID(), expected_revision: editable.view.draft.revision, payload: { command: 'check_layer', layer_id: 'hpo', checked: true } };
    const written = await authenticatedRequest(page, `${path}/commands`, 'POST', receipt); expect(written.ok()).toBeTruthy();
    const draft = await written.json() as components['schemas']['Draft'];
    await page.locator(`a[href="#/tasks/${editableId}"]`).click(); await expect(page.locator('.status-badge')).toBeVisible();
    await selectText(page, 0, 6); const input = page.getByLabel('Search ontology term', { exact: true }); await input.fill('Hypotonia'); await expect(page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).first()).toBeVisible();
    const reopened = await authenticatedRequest(lead.page, `/api/v1/assignments/${s.assignment_id}/reopen`, 'POST', { reason: 'Correct the actual accepted translation' }); expect(reopened.ok()).toBeTruthy();
    const corrected = await submitReview(reviewer.page, s, s.texts.target.replace('Dosis 5 mg', 'Dosis 6 mg'));
    expect(corrected.status_after).toBe('reviewed'); expect(corrected.created_variant_id).not.toBeNull();
    const proof = await page.request.get('/__test_review_child__', { params: { project: s.project, review_id: corrected.id }, timeout: 40_000 }); expect(proof.ok(), await proof.text()).toBeTruthy();
    const child = await proof.json() as { children: { status: string }[] }; expect(child.children).toHaveLength(1); expect(child.children[0].status).toBe('succeeded');
    expect((await variant(lead.page, s, s.documents.target)).translation_status).toBe('reviewed');
    expect((await variant(lead.page, s, corrected.created_variant_id!)).translation_status).toBe('accepted');
    const replay = await authenticatedRequest(page, `${path}/commands`, 'POST', receipt); expect(replay.ok()).toBeTruthy(); expect(await replay.json()).toEqual(draft);
    const uiCommand = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `${path}/commands`);
    await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).first().click();
    const uiRefusal = await uiCommand; expect(uiRefusal.status()).toBe(409); expect((await uiRefusal.json()).code).toBe('TRANSLATION_NOT_ACCEPTED');
    await expect(input).toHaveValue('Hypotonia');
    const deniedCommand = await authenticatedRequest(page, `${path}/commands`, 'POST', { ...receipt, mutation_id: randomUUID(), expected_revision: draft.revision });
    expect(deniedCommand.status()).toBe(409); expect((await deniedCommand.json()).code).toBe('TRANSLATION_NOT_ACCEPTED');
    const deniedSubmit = await authenticatedRequest(page, `${path}/submit`, 'POST', { mutation_id: randomUUID(), expected_revision: draft.revision, payload: { command: 'submit_workspace', document_checked: true, checked_layer_ids: ['hpo'] } });
    expect(deniedSubmit.status()).toBe(409); expect((await deniedSubmit.json()).code).toBe('TRANSLATION_NOT_ACCEPTED');
    await expect(input).toHaveValue('Hypotonia');
    const history = await openWorkspace(historian.page, historicalId); expect(history.read_only).toBe(true);
    expect(history.assignment.last_submission_id).toBe(submission.submission_id); expect(history.view.submissions).toContainEqual(submission);
    const historyReply = await authenticatedRequest(historian.page, `/api/v1/workspaces/${encodeURIComponent(historical.workspace_id)}/submissions/${submission.submission_id}`); expect(historyReply.ok()).toBeTruthy(); expect(await historyReply.json()).toEqual(submission);
    const before = await (await authenticatedRequest(lead.page, `${root(s)}/assignments`)).json() as Assignment[];
    for (const task of ['annotate', 'review']) {
      // The reviewer gains only the actual adjudicator role needed for annotation review.
      if (task === 'review') { const role = await authenticatedRequest(lead.page, `${root(s)}/members/${encodeURIComponent(s.users.reviewer)}`, 'PUT', { roles: ['annotator', 'adjudicator'], revoke_assignments: false }); expect(role.ok()).toBeTruthy(); }
      const refused = await authenticatedRequest(lead.page, `${root(s)}/assignments`, 'POST', { task, confirm_language: false, rows: [{ document_id: s.documents.failed, username: s.users.reviewer }] });
      expect(refused.ok()).toBeTruthy(); expect(await refused.json()).toMatchObject({ created: [], refused: [{ code: 'TRANSLATION_NOT_ACCEPTED', document_id: s.documents.failed }] });
    }
    const after = await (await authenticatedRequest(lead.page, `${root(s)}/assignments`)).json() as Assignment[]; expect(after).toEqual(before);
    await attach('current-gate-and-real-correction', { project: s.project, initial, corrected, editable_assignment: editableId, historical_assignment: historicalId, submission_id: submission.submission_id, child });
  } finally { await Promise.all([reviewer.close(), lead.close(), historian.close()]); }
});

test('ordinary lead downloads real review JSONL bytes and a later current-role revocation refuses the previously succeeded job', async ({ page, browser }) => {
  const s = await scenario(page), reviewer = await actor(browser, s.users.reviewer), manager = await actor(browser, s.users.manager), other = await actor(browser, s.users.other);
  try {
    const record = await submitReview(reviewer.page, s); await loginExisting(page, s.users.lead);
    const reviewed = await variant(page, s, s.documents.target), source = await variant(page, s, s.documents.source);
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/export`);
    const card = page.getByRole('region', { name: 'Translation reviews', exact: true });
    const creating = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`${root(s)}/exports/translation-reviews`));
    await card.getByRole('button', { name: 'Create export', exact: true }).click(); const created = await creating; expect(created.ok()).toBeTruthy();
    const jobId = (await created.json() as { job_id: number }).job_id, job = await finishedJob(page, jobId);
    expect(job.kind).toBe('translation_review_export'); expect(job.result?.reviews).toBe(1);
    const downloadPromise = page.waitForEvent('download'); await card.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloadPromise; expect(download.suggestedFilename()).toMatch(/-translation-reviews-\d{8}T\d{6}Z\.jsonl$/);
    const stream = await download.createReadStream(); expect(stream).not.toBeNull(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks); expect(sha(bytes)).toBe(job.result?.sha256); expect(bytes.toString('utf8').endsWith('\n')).toBe(true);
    const rows = bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line) as { [key: string]: unknown }); expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['format', 'review_id', 'project', 'case_id', 'reviewed_variant', 'source_variant', 'reviewer', 'decision', 'clinical_change', 'categories', 'rationale', 'machine_text_sha256', 'proposed_text', 'proposed_text_sha256', 'created_variant', 'status_before', 'status_after', 'review_policy', 'reviewed_at'].sort());
    expect(rows[0]).toEqual({ format: 'ontocurator-translation-review/v1', review_id: record.id, project: s.project, case_id: s.case_id,
      reviewed_variant: { document_id: s.external_id, language: 'de', version: reviewed.version, origin: reviewed.origin, text_sha256: reviewed.text_sha256, translation: reviewed.translation },
      source_variant: { document_id: source.external_id, language: 'en', version: source.version, text_sha256: source.text_sha256 },
      reviewer: { pseudonym: record.reviewer_pseudonym, qualification: record.reviewer_qualification, languages: record.reviewer_languages },
      decision: record.decision, clinical_change: record.clinical_change, categories: record.categories, rationale: record.rationale,
      machine_text_sha256: record.machine_text_sha256, proposed_text: record.proposed_text, proposed_text_sha256: record.proposed_text_sha256,
      created_variant: null, status_before: record.status_before, status_after: record.status_after, review_policy: record.review_policy, reviewed_at: new Date(record.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z') });
    const direct = await authenticatedRequest(page, `/api/v1/jobs/${jobId}/download`); expect(direct.ok()).toBeTruthy(); expect(direct.headers()['content-type']).toBe('application/x-ndjson'); expect(await direct.body()).toEqual(bytes);
    expect((await authenticatedRequest(other.page, `/api/v1/jobs/${jobId}/download`)).status()).toBe(403);
    expect((await authenticatedRequest(other.page, documentPath(s, s.documents.target, 'translation-reviews'))).status()).toBe(404);
    await page.reload(); await expect(card.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
    const roles = await authenticatedRequest(manager.page, `${root(s)}/members/${encodeURIComponent(s.users.lead)}`, 'PUT', { roles: ['annotator'], revoke_assignments: false }); expect(roles.ok(), await roles.text()).toBeTruthy();
    // Role changes deliberately revoke sessions. Renew through normal login in
    // this page's cookie jar before testing the current export permission.
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
    const renewed = await page.request.post('/api/v1/auth/login', {
      data: { username: s.users.lead, password: TEST_PASSWORD },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(renewed.ok()).toBeTruthy();
    const identity = await renewed.json() as components['schemas']['CurrentUser'];
    expect(identity.username).toBe(s.users.lead); expect(identity.is_system_admin).toBe(false);
    const currentProjects = await (await authenticatedRequest(page, '/api/v1/projects')).json() as components['schemas']['ProjectSummary'][];
    expect(currentProjects.find(project => project.project_key === s.project)?.roles).toEqual(['annotator']);
    await expect(card.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
    expect((await finishedJob(page, jobId)).status).toBe('succeeded');
    const refusing = page.waitForResponse(r => r.request().method() === 'GET' && r.url().endsWith(`/jobs/${jobId}/download`));
    await card.getByRole('button', { name: 'Download', exact: true }).click(); const denied = await refusing; expect(denied.status()).toBe(403);
    await expect(card).toContainText('You do not have access to this page.'); await expect(card.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
    const key = `ontocurator:export:${JSON.stringify([s.users.lead, s.project, 'translation_reviews'])}`;
    expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
    await attach('real-review-jsonl-current-permission', { project: s.project, record, job, bytes_sha256: sha(bytes), forbidden_member_status: 403, revoked_download_status: denied.status() });
  } finally { await Promise.all([reviewer.close(), manager.close(), other.close()]); }
});
