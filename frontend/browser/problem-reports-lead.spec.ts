/**
 * Problem reports: lead and restart scenarios (plan "Problem reports" WP9c; spec "Lead flow",
 * "Testing > Browser", resolved questions 2 and 3).
 *
 * Every test builds a fresh project through ``POST /__test_problem_reports__``. The lead works in the
 * test's page; reporters file their reports through their own API session (the reporter flow itself is
 * covered by problem-reports-reporter.spec.ts) and, in the translation scenario, open their editor in
 * their own browser context. Person labels come from the fixture (``labels.*``), never hard-coded.
 */
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { documentsReady, openTextCard, rowAction, rowCell, textCard, textRow } from "./documentsHelpers";
import { authenticatedRequest, loginExisting, TEST_PASSWORD } from "./helpers";
import { problemReportScenario, type ProblemReportScenario } from "./problemReportHelpers";

type Assignment = components["schemas"]["AssignmentView"];
type ProblemReport = components["schemas"]["ProblemReportView"];
type DocumentRowsPage = components["schemas"]["DocumentRowsPage"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const REPORT_TEXT = "The German text misses the sentence about the muscle tone.";
const OTHER_REPORT_TEXT = "The heading of the second paragraph is cut off.";

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * A person as the lead reads it on the report page (follow-up spec F4, D1): "Name (ann-…)". The fixture's
 * display names are the usernames; the lead's own record reads "Name (lead-…, you)".
 */
const asLeadSees = (s: ProblemReportScenario, role: "reporter") => `${s.users[role]} (${s.labels[role]})`;
const leadSelf = (s: ProblemReportScenario) => `${s.users.lead} (${s.labels.lead}, you)`;
const requestId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Another user's API session (own cookie jar and CSRF token). */
async function session(username: string) {
  const baseURL = test.info().project.use.baseURL!;
  const context: APIRequestContext = await playwrightRequest.newContext({ baseURL });
  const login = await context.post("/api/v1/auth/login", { data: { username, password: TEST_PASSWORD }, headers: { Origin: baseURL } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const call = async <T>(path: string, method = "GET", data?: unknown): Promise<T> => {
    const me = await context.get("/api/v1/auth/me");
    expect(me.ok()).toBeTruthy();
    const { csrf_token } = (await me.json()) as { csrf_token: string };
    const response = await context.fetch(path, { method, data, headers: { Origin: baseURL, ...(method === "GET" ? {} : { "X-CSRF-Token": csrf_token }) } });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return (await response.json()) as T;
  };
  return { call, close: () => context.dispose() };
}

/** File a report on ``task`` as its owner ``username`` (pauses the task); returns the report. */
async function fileReport(username: string, task: number, text = REPORT_TEXT): Promise<ProblemReport> {
  const owner = await session(username);
  try {
    const assignment = await owner.call<Assignment>(`/api/v1/assignments/${task}`);
    return await owner.call<ProblemReport>(`/api/v1/assignments/${task}/problem-reports`, "POST", {
      request_id: requestId("report"),
      expected_workflow_revision: assignment.workflow_revision,
      round_id: assignment.active_round_id ?? null,
      reason: text,
    });
  } finally {
    await owner.close();
  }
}

/** Another person's browser window (own cookie jar), logged in. */
async function actor(browser: Browser, username: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await loginExisting(page, username);
  return { page, close: () => context.close() };
}

const reportUrl = (s: ProblemReportScenario, reportId: string, query = "") =>
  `/#/projects/${encodeURIComponent(s.project)}/problem-reports/${encodeURIComponent(reportId)}${query}`;
const documentsUrl = (s: ProblemReportScenario, query = "") => `/#/projects/${encodeURIComponent(s.project)}/documents${query}`;

/** Open the lead page of ``report`` and wait for its text. */
async function openLeadPage(page: Page, s: ProblemReportScenario, report: ProblemReport, text = REPORT_TEXT) {
  await page.goto(reportUrl(s, report.report_id));
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  await expect(page.locator(".report-text").first()).toHaveText(text);
}

async function openDocuments(page: Page, s: ProblemReportScenario, query = "") {
  await page.goto(documentsUrl(s, query));
  await documentsReady(page);
}

/** Sorted ``name=value`` pairs of the hash query (order-independent comparison). */
function hashQueryOf(url: string): string[] {
  const hash = new URL(url).hash;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return [...new URLSearchParams(query).entries()].map(([name, value]) => `${name}=${value}`).sort();
}

const detail = (page: Page) => page.locator(".problem-report-detail");
/** The ``<dd>`` of fact ``term`` ("Report" / "Task 4" / "Final result") in the lead page's decision card. */
const fact = (page: Page, term: string) =>
  detail(page).locator(".report-facts > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${term}$`) }) }).locator("dd");
const decide = (page: Page) => page.getByRole("group", { name: "Decide on this report", exact: true });
const group = (scope: Locator | Page, title: string) => scope.getByRole("group", { name: title, exact: true });
const outcome = (page: Page) => page.locator(".lead-outcome");
const history = (page: Page) => page.getByRole("region", { name: "History", exact: true });
const cardTitle = (page: Page, title: string) => page.getByRole("heading", { level: 2, name: title, exact: true });

/** Open intent ``intent`` in Decide and return its confirmation (heading focused). */
async function openIntent(page: Page, intent: string | RegExp, title: string): Promise<Locator> {
  await decide(page).getByRole("button", { name: intent }).click();
  const box = group(page, title);
  await expect(box.getByRole("heading", { name: title })).toBeFocused();
  return box;
}

const restartTitle = (task: number) => `Agree empty restart of Task ${task}`;

/** Fill and send the restart confirmation (agreement + reason). */
async function confirmRestart(box: Locator, reporter: string, reason: string) {
  await box.getByRole("checkbox", { name: new RegExp(`^I agreed this restart with ${esc(reporter)}( \\(required\\))?$`) }).check();
  await box.getByRole("textbox", { name: new RegExp(`^Reason \\(becomes the outcome ${esc(reporter)} sees\\)`) }).fill(reason);
  await box.getByRole("button", { name: "Restart with empty round", exact: true }).click();
}

/** Documents table helpers (documentsHelpers.ts; the same accessible names as the Documents specs). */
const languageRow = textRow;
const expand = openTextCard;

/** The final result's submission id of the reporter's row (A de), read by the lead. */
async function finalSubmissionOf(page: Page, s: ProblemReportScenario): Promise<string | null> {
  const response = await authenticatedRequest(page,
    `/api/v1/projects/${encodeURIComponent(s.project)}/document-rows?${new URLSearchParams({ case: s.case_ids.a, language: "de" })}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const rows = ((await response.json()) as DocumentRowsPage).groups.flatMap(g => g.rows).filter(r => r.case_id === s.case_ids.a && r.language === "de");
  expect(rows).toHaveLength(1);
  return rows[0].final?.submission_id ?? null;
}

test("close while paused: Documents shows the orphaned pause, Resume task releases it, the report stays findable as Closed", async ({ page }) => {
  const s = await problemReportScenario(page, "base");
  const task = s.tasks.reporter;
  const caseId = s.case_ids.a;
  const report = await fileReport(s.users.reporter, task);
  await loginExisting(page, s.users.lead);
  await openLeadPage(page, s, report);

  // Close while the reporter's task is paused: the pause stays.
  await expect(fact(page, `Task ${task}`)).toContainText("Paused since");
  const close = await openIntent(page, "Close, keep paused…", "Close report");
  await expect(close).toContainText(`Task ${task} stays paused. Release it separately with Release pause.`);
  await close.getByRole("textbox", { name: new RegExp(`^Outcome for ${esc(asLeadSees(s, "reporter"))}`) }).fill("Source corrected; continue later.");
  await close.getByRole("button", { name: "Close report", exact: true }).click();
  await expect(outcome(page)).toContainText(`Report closed. Task ${task} is still paused by this report; release it when work can continue.`);
  await expect(fact(page, "Report")).toContainText(`Closed by ${leadSelf(s)}`);
  // Closed while paused: one step left, the release is the primary; nothing else but Reopen.
  await expect(cardTitle(page, "One step left")).toBeVisible();
  await expect(decide(page).locator(".btn-primary")).toHaveText(`Release pause on Task ${task}…`);
  await expect(decide(page).getByRole("button")).toHaveText([`Release pause on Task ${task}…`, "Reopen report…"]);

  // Documents: the row needs a decision as "Problem report or paused task".
  await openDocuments(page, s, "?decision=report-or-pause");
  const row = languageRow(page, caseId, "de");
  await expect(row).toBeVisible();
  // The orphaned pause is the row's next step (a decision for the lead): "Resume task…" in the Action column.
  await expect(row).toHaveClass(/data-table-row--decision/);
  await expect(rowCell(row, "annotation")).toContainText("⏸");
  await rowAction(page, "Resume task…", caseId, "de").click();

  // The report page opens "Release pause" with the reporter's task preselected; nothing was sent yet.
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  const release = group(page, "Release pause");
  await expect(release).toBeVisible();
  await expect(release.getByRole("checkbox", { name: new RegExp(`^Task ${task}\\W`) })).toBeChecked();
  await expect(fact(page, `Task ${task}`)).toContainText("Paused");
  await release.getByRole("textbox", { name: /^Reason/ }).fill("Source corrected; continue the annotation.");
  await release.getByRole("button", { name: "Release pause", exact: true }).click();
  await expect(outcome(page)).toContainText(new RegExp(`Released the pause on Task ${task}\\W+${esc(asLeadSees(s, "reporter"))}\\. The report is still closed\\.`));
  await expect(cardTitle(page, "Decided")).toBeVisible();
  await expect(detail(page).getByText("Nothing left to decide.", { exact: true })).toBeVisible();
  await expect(decide(page).getByRole("button")).toHaveText(["Reopen report…"]);

  // Back in Documents: the row is decided, has no problem issue, and the report is listed as Closed.
  await page.getByRole("link", { name: "Back to Documents" }).first().click();
  await expect(page).toHaveURL(/decision=report-or-pause/);
  await expect(languageRow(page, caseId, "de").locator(".documents-row-badge")).toHaveText("Resolved");
  await openDocuments(page, s);
  const plain = languageRow(page, caseId, "de");
  await expect(plain).toBeVisible();
  await expect(rowAction(page, "Resume task…", caseId, "de")).toHaveCount(0);
  await expect(rowAction(page, "Decide on report…", caseId, "de")).toHaveCount(0);
  await expect(rowCell(plain, "annotation")).not.toContainText("⏸");
  const expanded = await expand(page, caseId, "de");
  await expect(expanded.getByText(/task is paused, but its report is resolved/)).toHaveCount(0);
  await expect(expanded.getByRole("link", { name: "Resume task" })).toHaveCount(0);
  // The closed report: no banner, listed under Text details.
  await expect(expanded.locator(".text-card-banner")).toHaveCount(0);
  await expanded.getByRole("button", { name: "Details", exact: true }).click();
  const reports = expanded.locator("section").filter({ has: page.getByRole("heading", { name: "Problem reports (1)" }) });
  const listed = reports.getByRole("listitem");
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText(REPORT_TEXT);
  await expect(listed).toContainText("Report: Closed");
  await expect(listed).toContainText("Paused tasks: 0");
  await expect(listed.getByRole("link", { name: "Open report", exact: true })).toHaveAttribute("href", new RegExp(`/problem-reports/${esc(report.report_id)}`));
});

test("restart is refused while another report pauses the task, succeeds after that pause is released; the final result stays", async ({ page }) => {
  const s = await problemReportScenario(page, "final");
  const task = s.tasks.reporter;
  const final = s.final!;
  const report = await fileReport(s.users.reporter, task);
  await loginExisting(page, s.users.lead);
  expect(await finalSubmissionOf(page, s)).toBe(final.submission_id);
  await openLeadPage(page, s, report);

  const finalLine = fact(page, "Final result");
  for (const part of final.label_parts) await expect(finalLine).toContainText(part);
  await expect(finalLine).not.toContainText("None");
  await expect(finalLine).toContainText("never changed here");

  // Meanwhile the reporter files a second report: it pauses the same task.
  const other = await fileReport(s.users.reporter, task, OTHER_REPORT_TEXT);

  // This page still offers the restart; the server refuses it.
  let restart = await openIntent(page, "Agree empty restart…", restartTitle(task));
  const finalStays = restart.getByRole("listitem").filter({ hasText: /^Final result stays: / });
  for (const part of final.label_parts) await expect(finalStays).toContainText(part);
  await expect(finalStays).not.toContainText("None");
  await confirmRestart(restart, asLeadSees(s, "reporter"), "Agreed with the reporter: start over.");
  await expect(restart).toContainText(`Task ${task} is also paused by another report. Nothing changed. Release that pause first.`);
  await expect(outcome(page)).toHaveCount(0);
  await expect(fact(page, "Report")).toHaveCount(0);
  await expect(cardTitle(page, "Decide")).toBeVisible();
  await expect(fact(page, `Task ${task}`)).toContainText("Also paused by another report");
  // The open confirmation stays and explains; no "Unavailable: …" line in the card.
  await expect(decide(page).getByRole("button", { name: "Agree empty restart…" })).toHaveAttribute("aria-disabled", "true");
  await expect(restart).toContainText(`Task ${task} is also paused by another report. Release that pause first.`);
  await expect(decide(page)).not.toContainText("Unavailable:");

  // "Open report" leads to the other report; release its pause there.
  await restart.getByRole("link", { name: "Open report", exact: true }).click();
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  await expect(page.locator(".report-text").first()).toHaveText(OTHER_REPORT_TEXT);
  const release = await openIntent(page, "Release pause…", "Release pause");
  await expect(release.getByRole("checkbox", { name: new RegExp(`^Task ${task}\\W`) })).toBeChecked();
  await expect(release).toContainText("Also paused by another report: stays paused");
  await release.getByRole("textbox", { name: /^Reason/ }).fill("Second report can wait; the restart goes first.");
  await release.getByRole("button", { name: "Release pause", exact: true }).click();
  await expect(outcome(page)).toContainText(new RegExp(`Released the pause on Task ${task}\\W+${esc(asLeadSees(s, "reporter"))}\\. The report is still open\\. Task ${task} is still paused by another report\\.`));
  expect(other.report_id).not.toBe(report.report_id);

  // Back on the first report: the restart now succeeds and the final result is unchanged.
  await openLeadPage(page, s, report);
  await expect(fact(page, `Task ${task}`)).not.toContainText("Also paused by another report");
  restart = await openIntent(page, "Agree empty restart…", restartTitle(task));
  for (const part of final.label_parts) await expect(restart.getByRole("listitem").filter({ hasText: /^Final result stays: / })).toContainText(part);
  await confirmRestart(restart, asLeadSees(s, "reporter"), "Agreed with the reporter: start over.");
  await expect(outcome(page)).toContainText(/^Task \d+ restarted with an empty Round \d+\. Round \d+ is kept in the history\. Report closed\. The final result did not change\./);
  await expect(outcome(page)).toContainText(`Task ${task} restarted`);
  await expect(fact(page, "Report")).toContainText(`Closed by ${leadSelf(s)}`);
  for (const part of final.label_parts) await expect(fact(page, "Final result")).toContainText(part);
  await expect(fact(page, "Final result")).not.toContainText("None");
  expect(await finalSubmissionOf(page, s)).toBe(final.submission_id);
});

test("restart, reopen, restart again: the second confirmation and the history name the actual rounds", async ({ page }) => {
  const s = await problemReportScenario(page, "base");
  const task = s.tasks.reporter;
  const report = await fileReport(s.users.reporter, task);
  const n = report.round_ordinal!;
  expect(n).toBeGreaterThanOrEqual(1);
  await loginExisting(page, s.users.lead);
  await openLeadPage(page, s, report);
  await expect(page.locator(".lead-report-eyebrow")).toContainText(`Round ${n}`);

  // First restart: the reported round is the current one.
  let restart = await openIntent(page, "Agree empty restart…", restartTitle(task));
  await expect(restart).toContainText(`Round ${n} is abandoned and kept; Round ${n + 1} starts empty.`);
  await confirmRestart(restart, asLeadSees(s, "reporter"), "First restart agreed.");
  await expect(outcome(page)).toContainText(`Task ${task} restarted with an empty Round ${n + 1}. Round ${n} is kept in the history. Report closed. The final result did not change.`);

  // Reopen: nothing is paused again.
  const reopen = await openIntent(page, "Reopen report…", "Reopen report");
  await reopen.getByRole("textbox", { name: /^Reason/ }).fill("The new round shows the same problem.");
  await reopen.getByRole("button", { name: "Reopen report", exact: true }).click();
  await expect(outcome(page)).toContainText("Report reopened. No task was paused again.");
  await expect(fact(page, "Report")).toHaveCount(0);
  await expect(fact(page, `Task ${task}`)).toContainText("Restarted");
  await expect(fact(page, `Task ${task}`)).not.toContainText("Paused");

  // Second restart: names the round the first restart created, not the reported one.
  await expect(page.locator(".lead-report-eyebrow")).toContainText(`Round ${n}`);
  restart = await openIntent(page, "Agree empty restart…", restartTitle(task));
  await expect(restart).toContainText(`Round ${n + 1} is abandoned and kept; Round ${n + 2} starts empty.`);
  await expect(restart).not.toContainText(`Round ${n} is abandoned`);
  await confirmRestart(restart, asLeadSees(s, "reporter"), "Second restart agreed.");
  await expect(outcome(page)).toContainText(`Task ${task} restarted with an empty Round ${n + 2}. Round ${n + 1} is kept in the history. Report closed. The final result did not change.`);

  // History: both restarts with their actual abandoned rounds, and the reopen in between.
  const items = history(page).locator(".report-timeline-sentence");
  const restarts = items.filter({ hasText: `agreed an empty restart of Task ${task}.` });
  await expect(restarts).toHaveCount(2);
  await expect(restarts.nth(0)).toContainText(`Round ${n} abandoned and kept; Round ${n + 1} started empty. Report closed.`);
  await expect(restarts.nth(1)).toContainText(`Round ${n + 1} abandoned and kept; Round ${n + 2} started empty. Report closed.`);
  await expect(items.filter({ hasText: "reopened the report." })).toHaveCount(1);
  await expect(history(page)).toContainText("First restart agreed.");
  await expect(history(page)).toContainText("Second restart agreed.");
});

test("restart of a translation review keeps the old draft in the history; the reporter's editor starts fresh", async ({ page, browser }) => {
  const s = await problemReportScenario(page, "translation");
  const task = s.tasks.reporter;
  const translation = s.translation!;
  expect(translation.assignment_id).toBe(task);
  const report = await fileReport(s.users.reporter, task);
  await loginExisting(page, s.users.lead);
  await openLeadPage(page, s, report);
  await expect(page.locator(".lead-report-eyebrow")).toContainText("Translation review");

  const restart = await openIntent(page, "Agree empty restart…", restartTitle(task));
  await expect(restart).toContainText("The current translation draft is kept in the report history; the text and form start fresh.");
  await confirmRestart(restart, asLeadSees(s, "reporter"), "Agreed: review the translation again from scratch.");
  await expect(outcome(page)).toContainText(`Task ${task} restarted with`);
  await expect(outcome(page)).toContainText("Report closed. The final result did not change.");

  // The history keeps the archived draft text and form values behind a disclosure.
  const draft = history(page).locator("details.report-draft");
  await expect(draft).toHaveCount(1);
  const summary = draft.locator("summary");
  await expect(summary).toHaveText("Translation draft kept from before the restart");
  await summary.click();
  await expect(draft).toHaveAttribute("open", "");
  await expect(draft.locator(":scope > p.report-text")).toHaveText(translation.draft_text);
  const formFact = (term: string) => draft.locator(".report-facts > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${term}$`) }) }).locator("dd");
  await expect(formFact("decision")).toHaveText(String(translation.form.decision));
  await expect(formFact("rationale")).toHaveText(String(translation.form.rationale));
  await expect(formFact("clinical change")).toHaveText(String(translation.form.clinical_change));

  // The reporter's editor opens with a fresh draft: the document text, no decision, no rationale.
  const reporter = await actor(browser, s.users.reporter);
  try {
    await reporter.page.goto(`/#/tasks/${task}`);
    const target = reporter.page.getByRole("textbox", { name: "Translation (de)", exact: true });
    await expect(target).toBeVisible();
    const fresh = await target.inputValue();
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh).not.toBe(translation.draft_text);
    expect(translation.draft_text.startsWith(fresh)).toBeTruthy();
    await expect(reporter.page.getByText(/^Task paused: /)).toHaveCount(0);
    await expect(reporter.page.getByRole("radio", { name: "Accepted with corrections", exact: true })).not.toBeChecked();
    const rationale = reporter.page.getByRole("textbox", { name: "Rationale", exact: true });
    if (await rationale.count()) await expect(rationale).toHaveValue("");
  } finally {
    await reporter.close();
  }
});

test("the back link restores the full Documents query (decision, panel, page)", async ({ page }) => {
  const s = await problemReportScenario(page, "base");
  const caseId = s.case_ids.a;
  const report = await fileReport(s.users.reporter, s.tasks.reporter);
  await loginExisting(page, s.users.lead);

  // From Documents: decision filter and the text card, then the report (its banner) and back.
  const open = `${caseId}:de`;
  await openDocuments(page, s, `?decision=report-or-pause&panel=${encodeURIComponent(open)}`);
  const area = await expand(page, caseId, "de");
  const query = hashQueryOf(page.url());
  expect(query).toEqual(["decision=report-or-pause", `panel=${open}`]);
  await area.locator(".text-card-banner").getByRole("link", { name: /^Open problem report, / }).click();
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/problem-reports/${esc(report.report_id)}\\?`));
  const back = page.getByRole("link", { name: "Back to Documents" }).first();
  await back.click();
  await documentsReady(page);
  expect(hashQueryOf(page.url())).toEqual(query);
  await expect(textCard(page, caseId, "de")).toBeVisible();

  // A deep link carrying a page number keeps it too (a legacy documents_open becomes the text card).
  await page.goto(reportUrl(s, report.report_id,
    `?${new URLSearchParams([["documents_decision", "report-or-pause"], ["documents_open", open], ["documents_page", "2"]])}`));
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  const deepBack = page.getByRole("link", { name: "Back to Documents" }).first();
  await expect(deepBack).toHaveAttribute("href", /decision=report-or-pause/);
  await expect(deepBack).toHaveAttribute("href", /page=2/);
  await deepBack.click();
  await expect(page).toHaveURL(/\/documents\?/);
  expect(hashQueryOf(page.url())).toEqual(["decision=report-or-pause", "page=2", `panel=${open}`]);

  // Without a Documents query the back link falls back to the report's text and language.
  await page.goto(reportUrl(s, report.report_id));
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  await page.getByRole("link", { name: "Back to Documents" }).first().click();
  await expect(page).toHaveURL(/\/documents\?/);
  expect(hashQueryOf(page.url())).toEqual([`case=${caseId}`, "language=de"]);
});
