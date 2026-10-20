/**
 * Documents lead table: decision flows on the scenarios S2, S3, S11 to S15
 * (plan Task 7.3; spec "Testing", "Inline confirmation", "Resolved rows and empty state"),
 * on the lead-workflow layout (row disclosure "Show details, …", stage blocks, Submissions).
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and logs in
 * as its lead. Person labels are "Display name (pseudonym)" (D1), read from the project
 * members; the lead's own read "(pseudonym, you)". Changes "elsewhere"
 * (another lead, a reviewer, an annotator) go through the API in their own sessions.
 */
import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { documentsScenario, type DocumentsScenario } from "./documentsHelpers";
import { authenticatedRequest, loginExisting, TEST_PASSWORD } from "./helpers";

type Member = components["schemas"]["Member"];
type Assignment = components["schemas"]["AssignmentView"];
type ProblemReport = components["schemas"]["ProblemReportView"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

/** "19 Oct, 15:01", optionally with seconds or a year. */
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}(?::\d{2})?`;
const OWN_RESULT_REASON = "This project keeps adjudication separate from annotation. Another lead must choose this result.";

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactly = (pattern: string) => new RegExp(`^${pattern}$`);
const requestId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Person label "Display name (pseudonym)" per fixture role name; the lead's own reads "(pseudonym, you)". */
async function labelsOf(page: Page, s: DocumentsScenario): Promise<Record<string, string>> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/members`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const members = (await response.json()) as Member[];
  const byUsername = new Map(members.map(member => [member.username, member]));
  return Object.fromEntries(Object.entries(s.users).map(([name, username]) => {
    const member = byUsername.get(username);
    if (!member) return [name, username];
    return [name, `${member.display_name} (${member.pseudonym}${username === s.users.lead ? ", you" : ""})`];
  }));
}

/** Regex source for a person in a report or pause line: "Display name (ann-0004)" or the pseudonym alone. */
function personPattern(label: string): string {
  const match = /^(.*) \((ann-\d+)\)$/.exec(label);
  if (!match) return esc(label);
  return `(?:${esc(match[1])} \\()?${match[2]}\\)?`;
}

const documentsUrl = (s: DocumentsScenario, query = "") => `/#/projects/${encodeURIComponent(s.project)}/documents${query}`;

/** Build scenario ``name`` and log in as its lead (without opening Documents yet). */
async function prepare(page: Page, name: string) {
  const s = await documentsScenario(page, name);
  await loginExisting(page, s.users.lead);
  const labels = await labelsOf(page, s);
  return { s, labels };
}

async function openDocuments(page: Page, s: DocumentsScenario, query = "") {
  await page.goto(documentsUrl(s, query));
  await expect(page.getByRole("navigation", { name: "Segments", exact: true })).toBeVisible();
}

/** Another user's API session (own cookie jar and CSRF token). */
async function session(username: string) {
  const baseURL = test.info().project.use.baseURL!;
  const context: APIRequestContext = await playwrightRequest.newContext({ baseURL });
  const login = await context.post("/api/v1/auth/login", { data: { username, password: TEST_PASSWORD }, headers: { Origin: baseURL } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const call = async (path: string, method = "GET", data?: unknown) => {
    const me = await context.get("/api/v1/auth/me");
    expect(me.ok()).toBeTruthy();
    const { csrf_token } = (await me.json()) as { csrf_token: string };
    const response = await context.fetch(path, { method, data, headers: { Origin: baseURL, ...(method === "GET" ? {} : { "X-CSRF-Token": csrf_token }) } });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  return { call, close: () => context.dispose() };
}

/** The lead's own API call in the page session; fails the test on an error status. */
async function leadCall<T>(page: Page, path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await authenticatedRequest(page, path, method, data);
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

async function assignmentsOf(page: Page, s: DocumentsScenario): Promise<Assignment[]> {
  return leadCall<Assignment[]>(page, `/api/v1/projects/${encodeURIComponent(s.project)}/assignments`);
}

/** The live (not revoked) assignment of ``username`` on ``documentId``. */
async function assignmentOf(page: Page, s: DocumentsScenario, documentId: string, username: string): Promise<Assignment> {
  const found = (await assignmentsOf(page, s)).filter(a => a.document_id === documentId && a.username === username && !a.revoked_at);
  expect(found).toHaveLength(1);
  return found[0];
}

const table = (page: Page) => page.getByRole("table", { name: "Documents", exact: true });
const disclosure = (page: Page, caseId: string, language: string) =>
  page.getByRole("button", { name: `Show details, ${caseId} · ${language}`, exact: true });
const languageRow = (page: Page, caseId: string, language: string): Locator =>
  table(page).getByRole("row").filter({ has: disclosure(page, caseId, language) });
const region = (page: Page, caseId: string, language: string) => page.getByRole("region", { name: `${caseId} · ${language}`, exact: true });
/** The page's polite live region (outside the table). */
const live = (page: Page) => page.locator('.documents-page > p[role="status"]');

/** Expand a row (if collapsed) and wait until its content (and its submissions, if any) has loaded. */
async function expand(page: Page, caseId: string, language: string): Promise<Locator> {
  const button = disclosure(page, caseId, language);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const area = region(page, caseId, language);
  await expect(area.getByRole("heading", { name: "More", level: 3 })).toBeVisible();
  await expect(area.getByText("Loading submissions…")).toHaveCount(0);
  return area;
}

const submissionsTable = (area: Locator, caseId: string, language: string) =>
  area.getByRole("table", { name: `Submissions, ${caseId} · ${language}`, exact: true });
const viewLink = (submissions: Locator, label: string) => submissions.getByRole("link", { name: exactly(`View ${label}`) });
/** The submission row whose View link is named ``View {label}`` (the inner locator is relative to the row). */
const submissionRow = (submissions: Locator, label: string) =>
  submissions.getByRole("row").filter({ has: submissions.page().getByRole("link", { name: exactly(`View ${label}`) }) });
/** The visit badge ("Resolved" / "Changed: …") next to a row header. */
const visitBadge = (row: Locator) => row.locator(".documents-row-badge");
/** The submission label of a View link ("View {label}"). */
const labelOfView = async (link: Locator) => ((await link.getAttribute("aria-label")) ?? "").replace(/^View /, "");
/** Activate a focusable ``aria-disabled`` control by keyboard (Playwright's click refuses such elements). */
async function activate(control: Locator) {
  await control.focus();
  await control.press("Enter");
}
const confirmGroup = (page: Page, title: string) => page.getByRole("group", { name: title, exact: true });

test("first selection and replace: messages, focus on the new Final row and the live outcome", async ({ page }) => {
  const { s, labels } = await prepare(page, "S13");
  const caseId = "case-0713";
  await openDocuments(page, s);
  const area = await expand(page, caseId, "en");
  const submissions = submissionsTable(area, caseId, "en");
  const firstView = viewLink(submissions, `Annotation · Round 1 · ${esc(labels["ann-0001"])} · en v1 · ${TIME}`);
  const secondView = viewLink(submissions, `Annotation · Round 1 · ${esc(labels["ann-0002"])} · en v1 · ${TIME}`);
  const first = await labelOfView(firstView);
  const second = await labelOfView(secondView);

  // First selection.
  await submissionRow(submissions, esc(first)).getByRole("button", { name: "Use as final…", exact: true }).click();
  const use = confirmGroup(page, "Use as final result");
  await expect(use.getByRole("heading", { name: "Use as final result" })).toBeFocused();
  await expect(use).toContainText(`Use ${first} as the final result for ${caseId} · en?`);
  await use.getByRole("button", { name: "Use as final", exact: true }).click();
  await expect(use).toHaveCount(0);
  await expect(live(page)).toContainText(`${first} is now the final result.`);
  await expect(page.locator(".documents-success")).toContainText(`${first} is now the final result.`);
  await expect(submissionRow(submissions, esc(first)).getByRole("cell").first()).toHaveText("Final");
  await expect(firstView).toBeFocused();

  // Replace from another row.
  await submissionRow(submissions, esc(second)).getByRole("button", { name: "Replace…", exact: true }).click();
  const replace = confirmGroup(page, "Replace final result");
  await expect(replace).toContainText(`Replace ${first} with ${second}? The previous choice stays in the history.`);
  await replace.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(replace).toHaveCount(0);
  await expect(live(page)).toContainText(`${second} is now the final result.`);
  await expect(submissionRow(submissions, esc(second)).getByRole("cell").first()).toHaveText("Final");
  await expect(submissionRow(submissions, esc(first)).getByRole("cell").first()).toHaveText("");
  await expect(secondView).toBeFocused();
});

test("S11 keep: unchecked activation explains, checked keeps and focuses the Submissions heading", async ({ page }) => {
  const { s, labels } = await prepare(page, "S11");
  const caseId = "case-0611";
  const [ann1, ann2] = [esc(labels["ann-0001"]), esc(labels["ann-0002"])];
  await openDocuments(page, s);
  const area = await expand(page, caseId, "en");
  const submissions = submissionsTable(area, caseId, "en");

  // A round with two submissions marks them "latest" and "earlier submission".
  const round1 = submissions.getByRole("row").filter({ has: page.getByRole("link", { name: new RegExp(`^View Annotation · Round 1 · ${ann1} · `) }) });
  await expect(round1).toHaveCount(2);
  await expect(round1.nth(0).getByRole("cell").nth(1)).toHaveText(/^Round 1 · earlier submission(?!.*latest)/);
  await expect(round1.nth(0).getByRole("cell").first()).toHaveText("Final");
  await expect(round1.nth(1).getByRole("cell").nth(1)).toHaveText(/^Round 1 · latest/);
  // SELECTED_RESULT_REVISED and SELECTED_NEWER_RESULT.
  await expect(area.getByText(new RegExp(`^Round 1 · ${ann1} has a newer submission \\(${TIME}\\)\\.$`))).toBeVisible();
  await expect(area.getByText(new RegExp(`^Round 1 · ${ann2} · v1 was submitted after the final result was chosen \\(${TIME}\\)\\.$`))).toBeVisible();

  await area.getByRole("button", { name: "Keep final result…", exact: true }).click();
  const keep = confirmGroup(page, "Keep final result");
  await expect(keep.getByRole("heading", { name: "Keep final result" })).toBeFocused();
  await expect(keep).toContainText(new RegExp(`Keep Annotation · Round 1 · ${ann1} · en v1 · ${TIME} as the final result for ${caseId} · en\\?`));
  const confirm = keep.getByRole("button", { name: "Keep as final", exact: true });
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  await activate(confirm);
  await expect(keep.getByRole("alert")).toHaveText("Check the box to confirm you reviewed these changes.");
  await expect(keep).toBeVisible();

  await keep.getByRole("checkbox", { name: "I reviewed these changes and keep this exact result", exact: true }).check();
  await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
  await confirm.click();
  await expect(keep).toHaveCount(0);
  await expect(live(page)).toContainText(new RegExp(`Kept Annotation · Round 1 · ${ann1} · en v1 · ${TIME}\\.`));
  await expect(area.getByRole("heading", { name: /^Submissions \(\d+\)$/, level: 3 })).toBeFocused();
  await expect(area.getByRole("button", { name: "Keep final result…" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Needs your decision (0)", exact: true })).toBeVisible();
});

test("S3 a correction accepted after keep raises the text-corrected cause again", async ({ page }) => {
  const { s, labels } = await prepare(page, "S3");
  const caseId = "case-0211";
  await openDocuments(page, s);
  let area = await expand(page, caseId, "de");
  await area.getByRole("button", { name: "Keep final result…", exact: true }).click();
  const keep = confirmGroup(page, "Keep final result");
  await keep.getByRole("checkbox", { name: "I reviewed these changes and keep this exact result", exact: true }).check();
  await keep.getByRole("button", { name: "Keep as final", exact: true }).click();
  await expect(keep).toHaveCount(0);
  await expect(area.getByRole("button", { name: "Keep final result…" })).toHaveCount(0);

  // The reviewer accepts v3 in their own session.
  const reviewer = await session(s.users.reviewer);
  try {
    const assignmentId = Number(s.open_review_assignment_id);
    const opened = (await reviewer.call(`/api/v1/translation-reviews/${assignmentId}`)) as { text: string; draft: { revision: number } };
    const saved = (await reviewer.call(`/api/v1/translation-reviews/${assignmentId}/draft`, "PUT", {
      expected_revision: opened.draft.revision, text: opened.text, form: { decision: "accepted_unchanged", clinical_change: false },
    })) as { revision: number };
    await reviewer.call(`/api/v1/translation-reviews/${assignmentId}/submit`, "POST", { expected_revision: saved.revision });
  } finally { await reviewer.close(); }

  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Segments", exact: true })).toBeVisible();
    area = await expand(page, caseId, "de");
    await expect(area.getByText(/^v3 \(Accepted\) corrects the text of the final result\./)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(area.getByRole("button", { name: "Keep final result…", exact: true })).toBeVisible();
  // v2 stays acknowledged; only v3 is raised again.
  await expect(area.getByText(/^v2 \(Accepted\) corrects the text/)).toHaveCount(0);
  await expect(area.getByText(`Waiting: translation review of v3 by ${labels.reviewer} is open.`, { exact: false })).toHaveCount(0);
});

test("S11 a kept superseded round stays acknowledged after a hold, resume and reopen", async ({ page }) => {
  const { s, labels } = await prepare(page, "S11");
  const caseId = "case-0611";
  const project = encodeURIComponent(s.project);
  const assignments = s.assignments as Record<string, number>;
  const submissions = s.submissions as Record<string, string>;
  await openDocuments(page, s);

  // The lead carries ann-0001's revised result forward: Round 1 is superseded by Round 2.
  const before = (await assignmentsOf(page, s)).find(a => a.id === assignments["ann-0001"])!;
  const created = await leadCall<{ round_id: string }>(page, `/api/v1/assignments/${before.id}/rounds`, "POST", {
    request_id: requestId("round"), expected_workflow_revision: before.workflow_revision, kind: "carry_forward", source_submission_ids: [submissions.revised],
  });
  await page.reload();
  let area = await expand(page, caseId, "en");
  await expect(area.getByText(`Round 1 · ${labels["ann-0001"]} has been superseded by Round 2.`, { exact: true })).toBeVisible();
  await area.getByRole("button", { name: "Keep final result…", exact: true }).click();
  const keep = confirmGroup(page, "Keep final result");
  await keep.getByRole("checkbox", { name: "I reviewed these changes and keep this exact result", exact: true }).check();
  await keep.getByRole("button", { name: "Keep as final", exact: true }).click();
  await expect(keep).toHaveCount(0);
  await expect(area.getByText(/has been superseded/)).toHaveCount(0);

  // ann-0001 reports a problem (task paused); the lead closes the report, reopens it, releases the pause and closes it again.
  const annotator = await session(s.users["ann-0001"]);
  let report: ProblemReport;
  try {
    const current = (await assignmentsOf(page, s)).find(a => a.id === before.id)!;
    report = (await annotator.call(`/api/v1/assignments/${before.id}/problem-reports`, "POST", {
      request_id: requestId("report"), expected_workflow_revision: current.workflow_revision, round_id: created.round_id, reason: "The second seizure is missing.",
    })) as ProblemReport;
  } finally { await annotator.close(); }
  const act = async (action: string, ids: number[] = []) => {
    report = await leadCall<ProblemReport>(page, `/api/v1/problem-reports/${report.report_id}/actions`, "POST", {
      request_id: requestId(action), expected_revision: report.revision, action, reason: `Lead ${action}.`, assignment_ids: ids,
    });
  };
  await act("resolve");
  await act("reopen");
  await act("resume", [before.id]);
  await act("resolve");
  expect((await assignmentsOf(page, s)).find(a => a.id === before.id)?.held).toBe(false);

  await page.reload();
  area = await expand(page, caseId, "en");
  await expect(area.getByText(/has been superseded/)).toHaveCount(0);
  await expect(area.getByRole("button", { name: "Keep final result…" })).toHaveCount(0);
  const rows = await leadCall<{ groups: { rows: { language: string; categories: string[] }[] }[] }>(page, `/api/v1/projects/${project}/document-rows?case=${caseId}`);
  expect(rows.groups.flatMap(group => group.rows).find(row => row.language === "en")?.categories ?? []).not.toContain("confirm-final");
});

test("S2 keep under a decision filter: the row turns Resolved and Next decision focuses the next row", async ({ page }) => {
  const { s, labels } = await prepare(page, "S2");
  const caseId = "case-0108";
  const documents = s.documents as Record<string, string>;
  // The lead restarts ann-0001's es and fr work: their final results come from abandoned rounds.
  for (const language of ["es", "fr"]) {
    const assignment = await assignmentOf(page, s, documents[language], s.users["ann-0001"]);
    await leadCall(page, `/api/v1/assignments/${assignment.id}/rounds`, "POST", {
      request_id: requestId("restart"), expected_workflow_revision: assignment.workflow_revision, kind: "clean_restart", reason: "Start over after the source review.",
    });
  }
  await openDocuments(page, s, "?decision=confirm-final");
  await expect(languageRow(page, caseId, "es")).toBeVisible();
  await expect(languageRow(page, caseId, "fr")).toBeVisible();
  await expect(disclosure(page, caseId, "de")).toHaveCount(0);

  const area = await expand(page, caseId, "es");
  await expect(area.getByText(`Round 1 · ${labels["ann-0001"]} is abandoned.`, { exact: true })).toBeVisible();
  await area.getByRole("button", { name: "Keep final result…", exact: true }).click();
  const keep = confirmGroup(page, "Keep final result");
  await keep.getByRole("checkbox", { name: "I reviewed these changes and keep this exact result", exact: true }).check();
  await keep.getByRole("button", { name: "Keep as final", exact: true }).click();
  await expect(keep).toHaveCount(0);

  // The kept row stays visible, Resolved and collapsed.
  const es = languageRow(page, caseId, "es");
  await expect(visitBadge(es)).toHaveText("Resolved");
  await expect(disclosure(page, caseId, "es")).toHaveAttribute("aria-expanded", "false");
  await expect(live(page)).toContainText(`Next decision: ${caseId} · fr.`);
  const next = page.getByRole("link", { name: `Next decision: ${caseId} · fr`, exact: true });
  await next.click();
  await expect(disclosure(page, caseId, "fr")).toBeFocused();
  await expect(disclosure(page, caseId, "fr")).toHaveAttribute("aria-expanded", "true");
});

test("S13 Changed: work assigned elsewhere marks the row Changed, and Use shows the open work", async ({ page }) => {
  const { s } = await prepare(page, "S13");
  const caseId = "case-0713";
  const documents = s.documents as Record<string, string>;
  await openDocuments(page, s, "?decision=missing-final");
  await expect(languageRow(page, caseId, "en")).toBeVisible();

  await leadCall(page, `/api/v1/projects/${encodeURIComponent(s.project)}/assignments`, "POST", {
    rows: [{ document_id: documents.v2, username: s.users["ann-0002"] }], task: "annotate",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const en = languageRow(page, caseId, "en");
  await expect(visitBadge(en)).toHaveText("Changed: Work assigned");

  const area = await expand(page, caseId, "en");
  await area.getByRole("button", { name: "Use as final…", exact: true }).first().click();
  await expect(confirmGroup(page, "Use as final result")).toContainText(/Still open: .+\./);
});

test("S11 conflict: another lead changes the selection while Keep is open; Review again reloads", async ({ page }) => {
  const { s, labels } = await prepare(page, "S11");
  const caseId = "case-0611";
  const submissions = s.submissions as Record<string, string>;
  const documents = s.documents as Record<string, string>;
  const pseudonym = `Lead-${Date.now().toString(36)}`;
  const username = pseudonym.toLowerCase();
  const created = await page.request.post(`/__test_user__?${new URLSearchParams({ username, pseudonym, projects: s.project, assign: "none" })}`);
  expect(created.ok(), await created.text()).toBeTruthy();

  await openDocuments(page, s);
  const area = await expand(page, caseId, "en");
  await area.getByRole("button", { name: "Keep final result…", exact: true }).click();
  const keep = confirmGroup(page, "Keep final result");
  await keep.getByRole("checkbox", { name: "I reviewed these changes and keep this exact result", exact: true }).check();

  const other = await session(username);
  try {
    const current = (await other.call(`/api/v1/projects/${encodeURIComponent(s.project)}/document-rows?case=${caseId}`)) as { groups: { rows: { language: string; final: { revision: number } | null }[] }[] };
    const revision = current.groups.flatMap(group => group.rows).find(row => row.language === "en")!.final!.revision;
    await other.call(`/api/v1/projects/${encodeURIComponent(s.project)}/final-selections`, "PUT", {
      document_id: documents.en, submission_id: submissions.newer, expected_revision: revision, acknowledged_cause_ids: [],
    });
  } finally { await other.close(); }

  await keep.getByRole("button", { name: "Keep as final", exact: true }).click();
  const notice = keep.getByRole("alert");
  await expect(notice).toContainText("The final result or its warnings changed since you opened this. Nothing was saved. Review the current state.");
  await expect(notice).toContainText(new RegExp(`Changed by ${esc(pseudonym)} at ${TIME}\\.`));
  await expect(notice).toBeFocused();
  await expect(keep.getByRole("button", { name: "Close", exact: true })).toBeVisible();
  await keep.getByRole("button", { name: "Review again", exact: true }).click();
  await expect(keep).toHaveCount(0);
  const table = submissionsTable(area, caseId, "en");
  await expect(submissionRow(table, `Annotation · Round 1 · ${esc(labels["ann-0002"])} · en v1 · ${TIME}`).getByRole("cell").first()).toHaveText("Final");
});

test("S13 session ends during a confirmation: nothing is saved and the confirmation stays", async ({ page }) => {
  const { s, labels } = await prepare(page, "S13");
  const caseId = "case-0713";
  await openDocuments(page, s);
  const area = await expand(page, caseId, "en");
  const submissions = submissionsTable(area, caseId, "en");
  const row = submissionRow(submissions, `Annotation · Round 1 · ${esc(labels["ann-0001"])} · en v1 · ${TIME}`);
  await row.getByRole("button", { name: "Use as final…", exact: true }).click();
  const use = confirmGroup(page, "Use as final result");
  await expect(use).toBeVisible();
  await page.context().clearCookies();
  await use.getByRole("button", { name: "Use as final", exact: true }).click();
  await expect(use.getByRole("alert")).toHaveText("Your session ended. Nothing was saved. Sign in and confirm again.");
  await expect(use.getByRole("button", { name: "Use as final", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await expect(row.getByRole("cell").first()).toHaveText("");
});

test("S12 Resume task opens the report with the pause preselected; releasing it and going back shows Resolved", async ({ page }) => {
  const { s, labels } = await prepare(page, "S12");
  const caseId = "case-0512";
  const assignments = s.assignments as Record<string, number>;
  await openDocuments(page, s, "?decision=report-or-pause");
  await expect(languageRow(page, caseId, "de")).toBeVisible();
  await expect(languageRow(page, caseId, "en")).toBeVisible();

  // The fr task is paused by the open en report: a note with "Open report", not a decision.
  await openDocuments(page, s);
  const fr = await expand(page, caseId, "fr");
  const paused = fr.getByRole("listitem").filter({ hasText: new RegExp(`^Task paused \\(${personPattern(labels["ann-0002"])}\\)\\.`) });
  await expect(paused.getByRole("link", { name: "Open report", exact: true })).toHaveAttribute("href", new RegExp(`/problem-reports/${esc(String((s.reports as Record<string, string>).open))}`));

  await openDocuments(page, s, "?decision=report-or-pause");
  const de = await expand(page, caseId, "de");
  const orphan = de.getByRole("listitem").filter({ hasText: new RegExp(`^${personPattern(labels["ann-0001"])}'s task is paused, but its report is resolved\\.`) });
  await orphan.getByRole("link", { name: "Resume task", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Problem report", level: 1 })).toBeVisible();
  const release = confirmGroup(page, "Release pause");
  await expect(release).toBeVisible();
  await expect(release.getByRole("checkbox", { name: new RegExp(`^Task ${assignments.de} · `) })).toBeChecked();
  await release.getByRole("textbox", { name: /Reason/ }).fill("The question is answered; continue the annotation.");
  await release.getByRole("button", { name: "Release pause", exact: true }).click();
  await expect(page.getByText(/^Released the pause on /)).toBeVisible();

  await page.getByRole("link", { name: "Back to Documents" }).first().click();
  await expect(page).toHaveURL(/decision=report-or-pause/);
  const row = languageRow(page, caseId, "de");
  await expect(visitBadge(row)).toHaveText("Resolved");
  await expect(languageRow(page, caseId, "en")).toBeVisible();
});

test("S14 waiting lines: an open translation review and open work after an early selection", async ({ page }) => {
  const { s, labels } = await prepare(page, "S14");
  const caseId = "case-0814";
  await openDocuments(page, s);
  const de = await expand(page, caseId, "de");
  await expect(de.getByText(`Waiting: translation review of v1 by ${labels.reviewer} is open. You can choose again once it is submitted.`, { exact: true })).toBeVisible();
  await expect(de.getByRole("button", { name: "Keep final result…" })).toHaveCount(0);
  const en = await expand(page, caseId, "en");
  await expect(en.getByText(`Waiting: Round 1 · ${labels["ann-0002"]} is in progress. You can choose again once it is submitted.`, { exact: true })).toBeVisible();
  await expect(en.getByText(`Round 1 · ${labels["ann-0002"]} · in progress, not submitted yet`, { exact: true })).toBeVisible();
  await expect(en.getByRole("button", { name: "Keep final result…" })).toHaveCount(0);
});

test("S15 the lead's own result is not selectable when adjudication is separate", async ({ page }) => {
  const { s, labels } = await prepare(page, "S15");
  const caseId = "case-0001";
  await openDocuments(page, s);
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 1 of 2");
  // More than 50 cases: only the case with a decision starts expanded.
  await expect(page.getByRole("button", { name: `${caseId} · en source`, exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "case-0002 · en source", exact: true })).toHaveAttribute("aria-expanded", "false");
  const area = await expand(page, caseId, "en");
  const submissions = submissionsTable(area, caseId, "en");

  const own = submissionRow(submissions, `Annotation · Round 1 · ${esc(labels.lead)} · en v1 · ${TIME}`);
  const blocked = own.getByRole("button", { name: "Use as final…", exact: true });
  await expect(blocked).toHaveAttribute("aria-disabled", "true");
  await expect(blocked).toHaveAccessibleDescription(new RegExp(`${esc(OWN_RESULT_REASON)}$`));
  await expect(own.getByText(OWN_RESULT_REASON, { exact: true })).toBeVisible();
  await activate(blocked);
  await expect(live(page)).toHaveText(OWN_RESULT_REASON);
  await expect(confirmGroup(page, "Use as final result")).toHaveCount(0);

  const other = submissionRow(submissions, `Annotation · Round 1 · ${esc(labels["ann-0001"])} · en v1 · ${TIME}`);
  await expect(other.getByRole("button", { name: "Use as final…", exact: true })).not.toHaveAttribute("aria-disabled", "true");
});
