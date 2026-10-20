/**
 * Problem reports: reporter scenarios (plan "Problem reports" WP9b; spec "Reporter flow (editor)",
 * "Testing > Browser", resolved questions 1, 2 and 4).
 *
 * Every test builds a fresh ``base`` project through ``POST /__test_problem_reports__``. The reporter
 * works in the test's page; the lead (and, in the pause scenario, the same-text annotator) act in their
 * own browser contexts. Person labels come from the fixture (``labels.*``), never hard-coded.
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { authenticatedRequest, loginExisting } from "./helpers";
import { problemReportScenario, type ProblemReportScenario } from "./problemReportHelpers";

/** Leads see display names with the pseudonym (F4): "Name (ann-…)"; others keep pseudonyms. */
const leadSees = (s: ProblemReportScenario, role: string) => `${s.users[role]} (${s.labels[role]})`;

type ProblemReport = components["schemas"]["ProblemReportView"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const REPORT_TEXT = "The German text misses the sentence about the muscle tone.";

/** Another person's browser window (own cookie jar), logged in. */
async function actor(browser: Browser, username: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await loginExisting(page, username);
  return { page, close: () => context.close() };
}

/** Open task ``id`` in the editor and wait until its text is shown. */
async function openTask(page: Page, id: number) {
  await page.goto(`/#/tasks/${id}`);
  await expect(page.locator(".text-container")).toBeVisible();
  await expect(entry(page)).toBeVisible();
}

/** The toolbar "Report problem" button (outside any dialog, so located by its class). */
const entry = (page: Page) => page.locator("button.problem-entry");
const badge = (page: Page) => entry(page).locator(".problem-badge");
/** The editor's "Task paused: {reason}" banner. */
const banner = (page: Page) => page.getByText(/^Task paused: /);
const reportsDialog = (page: Page, task: number) => page.getByRole("dialog", { name: `Problems with Task ${task}`, exact: true });
const footer = (dialog: Locator) => dialog.locator(".modal-actions");
/** The ``<dd>`` of fact ``term`` ("Report" / "Your task") inside ``scope``. */
const fact = (scope: Locator, term: string) =>
  scope.locator(".report-facts > div").filter({ has: scope.page().locator("dt", { hasText: new RegExp(`^${term}$`) }) }).locator("dd");
const group = (scope: Locator | Page, title: string) => scope.getByRole("group", { name: title, exact: true });

/** Open the reporter dialog from the toolbar; it loads reports and task on open. */
async function openReports(page: Page, task: number): Promise<Locator> {
  await entry(page).click();
  const dialog = reportsDialog(page, task);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeReports(page: Page, task: number) {
  const dialog = reportsDialog(page, task);
  await footer(dialog).getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** File a report as the reporter (no report yet: the dialog opens in the form view). Leaves the list dialog open. */
async function fileReport(page: Page, s: ProblemReportScenario, text = REPORT_TEXT): Promise<Locator> {
  const task = s.tasks.reporter;
  await expect(entry(page)).toHaveAccessibleName("Report problem Report a problem with this task");
  await entry(page).click();
  const form = page.getByRole("dialog", { name: "New problem report", exact: true });
  await expect(form).toBeVisible();
  const field = form.getByRole("textbox", { name: /What is the problem\?/ });
  await expect(field).toBeFocused();
  await field.fill(text);
  await footer(form).getByRole("button", { name: "Report and pause my task", exact: true }).click();
  const dialog = reportsDialog(page, task);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Reported. Your task is paused until you or a project lead resume it.");
  await expect(dialog.getByRole("heading", { name: text, level: 3 })).toBeFocused();
  await expect(dialog.locator(".problem-task-status")).toContainText("Your task: Paused");
  await expect(fact(dialog, "Report")).toHaveText("Open");
  await expect(fact(dialog, "Your task")).toContainText("Paused since");
  await expect(badge(page)).toHaveText("Paused · 1 open");
  await expect(entry(page)).toHaveAccessibleName("Report problem Task paused, 1 open report");
  await expect(banner(page)).toBeVisible();
  return dialog;
}

/** The single report of the reporter's task, read by the lead. */
async function reportOf(page: Page, s: ProblemReportScenario): Promise<ProblemReport> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/problem-reports`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const reports = ((await response.json()) as ProblemReport[]).filter(r => r.assignment_id === s.tasks.reporter);
  expect(reports).toHaveLength(1);
  return reports[0];
}

/** Open the lead report page of the reporter's report. */
async function openLeadPage(page: Page, s: ProblemReportScenario) {
  const report = await reportOf(page, s);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/problem-reports/${encodeURIComponent(report.report_id)}`);
  await expect(page.getByRole("heading", { name: "Problem report", level: 1 })).toBeVisible();
  await expect(page.locator(".report-text").first()).toHaveText(REPORT_TEXT);
}

const decide = (page: Page) => page.getByRole("group", { name: "Decide on this report", exact: true });
const reportState = (page: Page) => fact(page.locator(".problem-report-detail"), "Report");
const pausedTasks = (page: Page) => fact(page.locator(".problem-report-detail"), "Paused tasks");

/** Open intent ``label`` on the lead page, fill its reason and confirm with ``confirm``; waits for the outcome. */
async function leadAct(page: Page, intent: RegExp, title: string, reasonLabel: RegExp, reason: string, confirm: string | RegExp, outcome: string) {
  await decide(page).getByRole("button", { name: intent }).click();
  const box = group(page, title);
  await expect(box.getByRole("heading", { name: title })).toBeFocused();
  await box.getByRole("textbox", { name: reasonLabel }).fill(reason);
  await box.getByRole("button", { name: confirm }).click();
  await expect(page.locator(".lead-outcome")).toContainText(outcome);
}

/** Give the reporter's window focus again (the dialog and toolbar reload on window focus). */
async function refocus(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test("report, resume with a reason, lead sees it and closes, reporter sees Closed and Resumed by you", async ({ page, browser }) => {
  const s = await problemReportScenario(page, "base");
  const task = s.tasks.reporter;
  await loginExisting(page, s.users.reporter);
  await openTask(page, task);
  let dialog = await fileReport(page, s);

  // Resume with "upsi".
  await dialog.getByRole("button", { name: "Resume my task…", exact: true }).click();
  const resume = group(dialog, `Resume Task ${task}`);
  await expect(resume).toContainText("The report stays open. A project lead decides on it.");
  await resume.getByRole("textbox", { name: /Why can you continue\?/ }).fill("upsi");
  await resume.getByRole("button", { name: "Resume my task", exact: true }).click();
  await expect(dialog).toContainText("Resumed. The report stays open.");
  await expect(fact(dialog, "Your task")).toContainText("Resumed by you");
  await expect(fact(dialog, "Report")).toHaveText("Open");
  await expect(dialog.locator(".problem-task-status")).toContainText("Your task: Active");
  await expect(banner(page)).toHaveCount(0);
  await expect(badge(page)).toHaveText("1 open");
  await closeReports(page, task);

  const lead = await actor(browser, s.users.lead);
  try {
    await openLeadPage(lead.page, s);
    await expect(pausedTasks(lead.page)).toContainText(`Resumed by reporter ${leadSees(s, "reporter")}`);
    await expect(pausedTasks(lead.page)).toContainText('"upsi"');
    await expect(lead.page.getByRole("region", { name: "History", exact: true })).toContainText("upsi");
    await expect(decide(lead.page).getByRole("button", { name: "Close report", exact: true })).toBeVisible();
    await leadAct(lead.page, /^Close report$/, "Close report", new RegExp(`Outcome for ${leadSees(s, "reporter").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "Fixed in the source text; no change needed.", "Close report",
      "Report closed. No task was paused by it. The final result did not change.");
    await expect(reportState(lead.page)).toContainText(`Closed by ${s.users.lead} (${s.labels.lead}, you)`);
  } finally {
    await lead.close();
  }

  // The reporter sees the lead's close the next time the dialog opens.
  dialog = await openReports(page, task);
  await expect(fact(dialog, "Report")).toContainText(`Closed by ${s.labels.lead}`);
  await expect(fact(dialog, "Report")).toContainText("Outcome: Fixed in the source text; no change needed.");
  await expect(fact(dialog, "Your task")).toContainText("Resumed by you");
  await expect(dialog.getByRole("button", { name: "Resume my task…" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Withdraw report…" })).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
});

test("withdraw an untouched report, lead reopens it: Open, no withdraw, task stays active", async ({ page, browser }) => {
  const s = await problemReportScenario(page, "base");
  const task = s.tasks.reporter;
  await loginExisting(page, s.users.reporter);
  await openTask(page, task);
  let dialog = await fileReport(page, s);

  await dialog.getByRole("button", { name: "Withdraw report…", exact: true }).click();
  const withdraw = group(dialog, "Withdraw report");
  await expect(withdraw).toContainText("The report is marked Withdrawn. Project leads can still read it.");
  await expect(withdraw).toContainText("Your task's pause from this report is released.");
  await withdraw.getByRole("textbox", { name: /Why are you withdrawing it\?/ }).fill("Reported by mistake.");
  await withdraw.getByRole("button", { name: "Withdraw report", exact: true }).click();
  await expect(dialog).toContainText("Withdrawn. Your task is no longer paused by this report.");
  await expect(fact(dialog, "Report")).toContainText("Withdrawn by you");
  await expect(fact(dialog, "Report")).toContainText("Reason: Reported by mistake.");
  await expect(fact(dialog, "Your task")).toContainText("Resumed when you withdrew the report");
  await expect(dialog.locator(".problem-task-status")).toContainText("Your task: Active");
  await expect(banner(page)).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
  await closeReports(page, task);

  const lead = await actor(browser, s.users.lead);
  try {
    await openLeadPage(lead.page, s);
    await expect(reportState(lead.page)).toContainText("Withdrawn");
    await expect(lead.page.locator(".lead-summary")).toHaveText("The reporter withdrew this report. Nothing is paused by it.");
    await leadAct(lead.page, /^Reopen report…$/, "Reopen report", /^Reason/, "Please keep this open until the source is checked.",
      "Reopen report", "Report reopened. No task was paused again.");
    await expect(reportState(lead.page)).toHaveText("Open");
    await expect(lead.page.locator(".lead-summary")).toHaveText("Nothing is paused by this report. The report is open until you close it.");
  } finally {
    await lead.close();
  }

  // Window focus reloads the toolbar; reopening the dialog shows the reopened report.
  await refocus(page);
  await expect(badge(page)).toHaveText("1 open");
  dialog = await openReports(page, task);
  await expect(fact(dialog, "Report")).toHaveText("Open");
  await expect(dialog.getByRole("button", { name: "Withdraw report…" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Resume my task…" })).toHaveCount(0);
  await expect(dialog.locator(".problem-task-status")).toContainText("Your task: Active");
  await expect(dialog).toContainText("A project lead has acted on this report. Resume your task with a reason and ask a project lead to close it.");
  await expect(banner(page)).toHaveCount(0);
  await expect(entry(page)).toHaveAccessibleName("Report problem 1 open report");
});

test("a lead releases the pause in another window: the open dialog and editor update on window focus", async ({ page, browser }) => {
  const s = await problemReportScenario(page, "base");
  const task = s.tasks.reporter;
  await loginExisting(page, s.users.reporter);
  await openTask(page, task);
  const dialog = await fileReport(page, s);

  const lead = await actor(browser, s.users.lead);
  try {
    await openLeadPage(lead.page, s);
    await decide(lead.page).getByRole("button", { name: "Release pause…", exact: true }).click();
    const release = group(lead.page, "Release pause");
    await expect(release.getByRole("checkbox", { name: new RegExp(`^Task ${task} · `) })).toBeChecked();
    await release.getByRole("textbox", { name: /^Reason/ }).fill("Source checked; continue.");
    await release.getByRole("button", { name: "Release pause", exact: true }).click();
    await expect(lead.page.locator(".lead-outcome")).toContainText(`Released the pause on Task ${task} · ${leadSees(s, "reporter")}. The report is still open.`);
  } finally {
    await lead.close();
  }

  // The reporter's dialog is still open and stale until the window gets focus again.
  await expect(dialog.locator(".problem-task-status")).toContainText("Your task: Paused");
  await refocus(page);
  await expect(dialog.locator(".problem-task-status")).toContainText("Your task: Active");
  await expect(fact(dialog, "Your task")).toContainText(`Resumed by ${s.labels.lead}`);
  await expect(dialog.getByRole("button", { name: "Resume my task…" })).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
  await expect(badge(page)).toHaveText("1 open");
});

test("the lead pauses the same-text task: its owner sees only the lead's reason, the reporter sees nothing of it", async ({ page, browser }) => {
  const s = await problemReportScenario(page, "base");
  const task = s.tasks.reporter;
  const other = s.tasks.same_text;
  const leadReason = "Lead check: wait until the German source sentence is confirmed.";
  await loginExisting(page, s.users.reporter);
  await openTask(page, task);
  await fileReport(page, s);
  await closeReports(page, task);

  const lead = await actor(browser, s.users.lead);
  try {
    await openLeadPage(lead.page, s);
    await decide(lead.page).getByRole("button", { name: "Pause other tasks…", exact: true }).click();
    const pause = group(lead.page, "Pause other tasks");
    const sameText = pause.getByRole("group", { name: /^Same text: / });
    const candidate = sameText.getByRole("checkbox", { name: new RegExp(`^Task ${other} · `) });
    await expect(candidate).toBeVisible();
    await candidate.check();
    await pause.getByRole("textbox", { name: /Reason shown to the task owners/ }).fill(leadReason);
    await pause.getByRole("button", { name: "Pause 1 task", exact: true }).click();
    await expect(lead.page.locator(".lead-outcome")).toContainText(`Paused Task ${other} · ${leadSees(s, "same_text")}. Their owners see your reason.`);
  } finally {
    await lead.close();
  }

  // The same-text owner: banner with only the lead's reason; nothing of the report.
  const owner = await actor(browser, s.users.same_text);
  try {
    await openTask(owner.page, other);
    await expect(banner(owner.page)).toContainText(leadReason);
    await expect(owner.page.getByText(REPORT_TEXT)).toHaveCount(0);
    await expect(badge(owner.page)).toHaveText("Paused");
    await expect(entry(owner.page)).toHaveAccessibleName("Report problem Task paused");
    await expect(owner.page.locator("body")).not.toContainText(s.labels.reporter);
    // The owner has no report of their own: the dialog opens in the new report view.
    await entry(owner.page).click();
    const ownerForm = owner.page.getByRole("dialog", { name: "New problem report", exact: true });
    await expect(ownerForm).toBeVisible();
    await expect(ownerForm).not.toContainText(REPORT_TEXT);
  } finally {
    await owner.close();
  }

  // The reporter: neither the other owner nor the lead's reason, nor the other task.
  await refocus(page);
  const dialog = await openReports(page, task);
  await expect(fact(dialog, "Your task")).toContainText("Paused since");
  await dialog.locator("summary", { hasText: /^Full report and history/ }).click();
  await expect(dialog.locator(".reporter-report-history")).toContainText("You reported the problem. Your task paused.");
  await expect(dialog).not.toContainText(s.labels.same_text);
  await expect(dialog).not.toContainText(leadReason);
  await expect(dialog).not.toContainText(`Task ${other}`);
  await expect(dialog).toContainText("A project lead has acted on this report. Resume your task with a reason and ask a project lead to close it.");
  await expect(dialog.getByRole("button", { name: "Withdraw report…" })).toHaveCount(0);
});
