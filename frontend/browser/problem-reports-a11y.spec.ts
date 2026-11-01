/**
 * Problem reports: keyboard, accessibility and layout (plan "Problem reports" WP9d; spec
 * "Keyboard and screen reader", "Narrow viewports", "Testing > Browser"; CR-2: a ``size="md"``
 * dialog is a full-height sheet below 700 px).
 *
 * Every test builds a fresh ``base`` project through ``POST /__test_problem_reports__``. Reports are
 * filed through the reporter's own API session (the reporter flow itself is covered by
 * problem-reports-reporter.spec.ts). Person labels come from the fixture (``labels.*``).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { loginExisting, TEST_PASSWORD } from "./helpers";
import { leadTaskRef, problemReportScenario, upperFirst, type ProblemReportScenario } from "./problemReportHelpers";

type Assignment = components["schemas"]["AssignmentView"];
type ProblemReport = components["schemas"]["ProblemReportView"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const REPORT_TEXT = "The German text misses the sentence about the muscle tone.";
const requestId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/phase0-ux/evidence/p-wp9d");
async function evidence(page: Page, name: string, part?: Locator) {
  mkdirSync(evidenceDir(), { recursive: true });
  const path = resolve(evidenceDir(), `${name}.png`);
  if (part) await part.screenshot({ path }); else await page.screenshot({ path, fullPage: true });
}

/** File ``texts.length`` reports on ``task`` as its owner ``username`` (the first pauses the task); returns them. */
async function fileReports(username: string, task: number, texts: string[]): Promise<ProblemReport[]> {
  const baseURL = test.info().project.use.baseURL!;
  const context: APIRequestContext = await playwrightRequest.newContext({ baseURL });
  try {
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
    const reports: ProblemReport[] = [];
    for (const text of texts) {
      const assignment = await call<Assignment>(`/api/v1/assignments/${task}`);
      reports.push(await call<ProblemReport>(`/api/v1/assignments/${task}/problem-reports`, "POST", {
        request_id: requestId("report"),
        expected_workflow_revision: assignment.workflow_revision,
        round_id: assignment.active_round_id ?? null,
        reason: text,
      }));
    }
    return reports;
  } finally {
    await context.dispose();
  }
}

const reportUrl = (s: ProblemReportScenario, reportId: string) =>
  `/#/projects/${encodeURIComponent(s.project)}/problem-reports/${encodeURIComponent(reportId)}`;

/** Fresh ``base`` project, one report filed by the reporter, lead logged in on its report page. */
async function leadOnReport(page: Page) {
  const s = await problemReportScenario(page, "base");
  const [report] = await fileReports(s.users.reporter, s.tasks.reporter, [REPORT_TEXT]);
  await loginExisting(page, s.users.lead);
  await page.goto(reportUrl(s, report.report_id));
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  await expect(page.locator(".report-text").first()).toHaveText(REPORT_TEXT);
  return { s, report };
}

const decide = (page: Page) => page.getByRole("group", { name: "Decide on this report", exact: true });
const intent = (page: Page, name: string) => decide(page).getByRole("button", { name, exact: true });
const confirmBox = (page: Page, title: string) => page.getByRole("group", { name: title, exact: true });
/** The editor's "More actions" button: its menu holds the text-problem item; focus returns here. */
const entry = (page: Page) => page.getByRole("button", { name: "More actions", exact: true });
const problemItem = (page: Page, name: string) => page.getByRole("menuitem", { name, exact: true });
/** The reporter's dialog, named after the text, never the task number. */
const reportsDialog = (page: Page) => page.getByRole("dialog", { name: /^Problems with / });
/** The reporter as the lead reads them, and the lead's name of the reporter's task. */
const asLeadSees = (s: ProblemReportScenario) => `${s.users.reporter} (${s.labels.reporter})`;
const reporterTaskRef = (s: ProblemReportScenario, report: ProblemReport) => leadTaskRef(report, asLeadSees(s));
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Press Tab until ``target`` has focus (at most ``limit`` times); returns the visited stops. */
async function tabTo(page: Page, target: Locator, limit = 40): Promise<void> {
  const stops: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(element => element === document.activeElement)) return;
    stops.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return element ? `${element.tagName.toLowerCase()}:${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 50)}` : "none";
    }));
  }
  throw new Error(`Tab never reached the target. Stops: ${stops.join(" | ")}`);
}

async function axeViolations(page: Page, include: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

test("keyboard only: Tab reaches the intents in order; Enter, Space, Escape and Cancel open and close them; focus returns to the trigger", async ({ page }) => {
  const { s, report } = await leadOnReport(page);
  const ref = reporterTaskRef(s, report);

  const close = intent(page, "Close, keep paused…");
  const release = intent(page, "Release pause…");
  const pause = intent(page, "Pause other tasks…");
  const restart = intent(page, "Agree empty restart…");
  const reopen = intent(page, "Reopen report…");

  // Only possible intents: Reopen is not offered on an open report (no disabled button).
  await expect(reopen).toHaveCount(0);
  // Tab from the back link (the first stop of the page body) into Decide: the answer, the primary, then the intents.
  await page.getByRole("link", { name: "Back to Documents" }).first().focus();
  await tabTo(page, page.getByRole("textbox", { name: /^Answer to / }));
  await page.keyboard.press("Tab");
  await expect(decide(page).locator(".btn-primary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  for (const next of [release, pause, restart]) {
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
  }
  for (const previous of [pause, release, close]) {
    await page.keyboard.press("Shift+Tab");
    await expect(previous).toBeFocused();
  }

  // Close: Enter opens its confirmation (heading focused, aria-expanded); Escape returns focus to the intent.
  await page.keyboard.press("Enter");
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await expect(confirmBox(page, "Close report").getByRole("heading", { name: "Close report" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmBox(page, "Close report")).toHaveCount(0);
  await expect(close).toHaveAttribute("aria-expanded", "false");
  await expect(close).toBeFocused();

  // Release pause: Space opens it (single pause preselected); Tab to Cancel and Enter close it.
  await page.keyboard.press("Tab");
  await expect(release).toBeFocused();
  await page.keyboard.press("Space");
  const releaseBox = confirmBox(page, "Release pause");
  await expect(releaseBox.getByRole("heading", { name: "Release pause" })).toBeFocused();
  await expect(releaseBox.getByRole("checkbox", { name: new RegExp(`^${escaped(asLeadSees(s))}, `) })).toBeChecked();
  await tabTo(page, releaseBox.getByRole("button", { name: "Cancel", exact: true }), 10);
  await page.keyboard.press("Enter");
  await expect(releaseBox).toHaveCount(0);
  await expect(release).toBeFocused();

  // Pause other tasks and Agree empty restart: Enter opens, Escape returns.
  for (const [button, title] of [[pause, "Pause other tasks"], [restart, `Agree empty restart of ${ref}`]] as const) {
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirmBox(page, title).getByRole("heading", { name: title })).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(confirmBox(page, title)).toHaveCount(0);
    await expect(button).toBeFocused();
  }

  // Close the report with the keyboard only: the outcome message takes focus.
  for (let index = 0; index < 3; index += 1) await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  const closeBox = confirmBox(page, "Close report");
  await expect(closeBox.getByRole("heading", { name: "Close report" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeBox.getByRole("textbox", { name: new RegExp(`^Outcome for `) })).toBeFocused();
  await page.keyboard.type("Fixed in the source text.");
  await tabTo(page, closeBox.getByRole("button", { name: "Close report", exact: true }), 5);
  await page.keyboard.press("Enter");
  const outcome = page.locator(".lead-outcome");
  await expect(outcome).toContainText(`Report closed. ${upperFirst(ref)} is still paused by this report; release it when work can continue.`);
  await expect(outcome).toBeFocused();

  // Now Reopen is available: Tab reaches it, Enter opens, Escape returns.
  await tabTo(page, reopen, 20);
  await expect(reopen).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(confirmBox(page, "Reopen report").getByRole("heading", { name: "Reopen report" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmBox(page, "Reopen report")).toHaveCount(0);
  await expect(reopen).toBeFocused();
});

test("lead page at 320 CSS px: no horizontal scroll; Decide buttons stacked full width, each followed by its consequence", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { s, report } = await leadOnReport(page);
  const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);

  expect(await scrollWidth(), "page").toBeLessThanOrEqual(320);
  const layout = await decide(page).evaluate(toolbar => {
    const inner = toolbar.getBoundingClientRect();
    const style = getComputedStyle(toolbar);
    const contentWidth = inner.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Array.from(toolbar.querySelectorAll(".lead-intent")).map(block => {
      const button = block.querySelector("button")!.getBoundingClientRect();
      const line = block.querySelector(".lead-intent-line")!.getBoundingClientRect();
      return {
        label: (block.querySelector("button")!.textContent ?? "").trim(),
        left: button.left, right: button.right, top: button.top, bottom: button.bottom, width: button.width, height: button.height,
        toolbarLeft: inner.left, contentWidth, lineTop: line.top, lineRight: line.right,
      };
    });
  });
  expect(layout.map(item => item.label)).toEqual(["Close, keep paused…", "Release pause…", "Pause other tasks…", "Agree empty restart…"]);
  const primary = (await decide(page).locator(".btn-primary").boundingBox())!;
  expect(primary.x + primary.width, "primary").toBeLessThanOrEqual(320);
  await expect(decide(page).locator(".btn-primary")).toHaveText(`Close and resume ${reporterTaskRef(s, report)}`);
  for (const [index, item] of layout.entries()) {
    expect(item.right, item.label).toBeLessThanOrEqual(320);
    expect(item.height, item.label).toBeGreaterThanOrEqual(24);
    // Full width of the Decide toolbar (one button per line). Soft, so the remaining reflow checks and the evidence still run.
    expect.soft(item.width, `${item.label}: full width`).toBeGreaterThanOrEqual(item.contentWidth - 1);
    // Its consequence line sits below the button, and the next intent below that line.
    expect(item.lineTop, item.label).toBeGreaterThanOrEqual(item.bottom - 1);
    expect(item.lineRight, item.label).toBeLessThanOrEqual(320);
    if (index > 0) expect(item.top, item.label).toBeGreaterThan(layout[index - 1].lineTop);
  }
  await evidence(page, "lead-320-decide", decide(page));

  // An open confirmation stays a block below its intent, without horizontal scroll.
  await intent(page, "Release pause…").click();
  const releaseBox = confirmBox(page, "Release pause");
  await expect(releaseBox.getByRole("heading", { name: "Release pause" })).toBeFocused();
  expect(await scrollWidth(), "Release pause open").toBeLessThanOrEqual(320);
  const box = (await releaseBox.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  const button = (await intent(page, "Release pause…").boundingBox())!;
  expect(box.y).toBeGreaterThan(button.y + button.height - 1);
  await evidence(page, "lead-320-release-open", decide(page));

  await intent(page, "Pause other tasks…").click();
  const pauseBox = confirmBox(page, "Pause other tasks");
  await expect(pauseBox.getByRole("group", { name: /^Same text: / })).toBeVisible();
  expect(await scrollWidth(), "Pause other tasks open").toBeLessThanOrEqual(320);
  await evidence(page, "lead-320-pause-open", decide(page));
  expect(s.project).toBeTruthy();
});

test("reporter dialog at 390 x 844: a full-height sheet, the footer Close stays in view with a long list, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const s = await problemReportScenario(page, "base");
  const task = s.tasks.reporter;
  const texts = Array.from({ length: 6 }, (_, index) =>
    `Report ${index + 1}: the German text misses the sentence about the muscle tone in paragraph ${index + 2}; ` +
    "see the source document identifier HP-0001250-HP-0000252-HP-0001263-without-spaces for details.");
  await fileReports(s.users.reporter, task, texts);
  await loginExisting(page, s.users.reporter);
  await page.goto(`/#/tasks/${task}`);
  await expect(page.locator(".text-container")).toBeVisible();
  await expect(entry(page)).toBeVisible();
  // The menu item carries its text and the badge at this width.
  await entry(page).click();
  await problemItem(page, "Report a text problem… (Paused, 6 open)").click();
  const dialog = reportsDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("article")).toHaveCount(6);
  await expect(dialog).toHaveClass(/ui-dialog--md/);

  const rect = await dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    const body = element.querySelector(".ui-dialog-body") as HTMLElement;
    return {
      left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
      bodyScrolls: body.scrollHeight > body.clientHeight, bodyOverflowX: body.scrollWidth - body.clientWidth,
    };
  });
  expect(rect.width, "sheet width").toBeGreaterThanOrEqual(390 - 2 * 16 - 1);
  expect(rect.height, "sheet height").toBeGreaterThanOrEqual(844 - 2 * 16 - 1);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(390);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.bottom).toBeLessThanOrEqual(844);
  // The list is long enough to scroll inside the body; the body does not scroll sideways.
  expect(rect.bodyScrolls, "long report list scrolls inside the dialog body").toBe(true);
  expect(rect.bodyOverflowX, "dialog body horizontal overflow").toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const footerClose = dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true });
  const checkFooter = async (state: string) => {
    await expect(footerClose, state).toBeInViewport({ ratio: 1 });
    const box = (await footerClose.boundingBox())!;
    expect(box.y + box.height, state).toBeLessThanOrEqual(844);
    expect(box.x + box.width, state).toBeLessThanOrEqual(390);
    expect(box.height, state).toBeGreaterThanOrEqual(24);
  };
  await checkFooter("top of the list");
  await evidence(page, "reporter-390-sheet");

  // Scrolled to the last report and with its history open: the footer stays fixed.
  const last = dialog.getByRole("article").last();
  await last.locator("summary", { hasText: /^Full report and history/ }).click();
  await last.locator(".report-text").scrollIntoViewIfNeeded();
  await checkFooter("end of the list, history open");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await dialog.locator(".ui-dialog-body").evaluate(body => body.scrollWidth - body.clientWidth)).toBeLessThanOrEqual(0);
  await evidence(page, "reporter-390-sheet-scrolled");

  // Facts stack at this width: the term above its value.
  const fact = await dialog.getByRole("article").first().locator(".report-facts > div").first().evaluate(row => {
    const term = row.querySelector("dt")!.getBoundingClientRect();
    const value = row.querySelector("dd")!.getBoundingClientRect();
    return { termBottom: term.bottom, valueTop: value.top };
  });
  expect(fact.valueTop).toBeGreaterThanOrEqual(fact.termBottom - 1);

  await footerClose.click();
  await expect(dialog).toBeHidden();
  await expect(entry(page)).toBeFocused();
});

test("axe: reporter dialog (list and new report views) and lead page (default and with a confirmation open); toolbar entry names", async ({ page, browser }) => {
  const s = await problemReportScenario(page, "base");
  const task = s.tasks.reporter;
  const [report] = await fileReports(s.users.reporter, task, [REPORT_TEXT]);

  // Reporter: the menu item name carries the visible text and the pause.
  await loginExisting(page, s.users.reporter);
  await page.goto(`/#/tasks/${task}`);
  await expect(page.locator(".text-container")).toBeVisible();
  await entry(page).click();
  // The menu item has no icon (the old badge's decorative svg check is gone).
  await problemItem(page, "Report a text problem… (Paused, 1 open)").click();
  const dialog = reportsDialog(page);
  await expect(dialog.getByRole("heading", { name: REPORT_TEXT, level: 3 })).toBeFocused();
  await expect(dialog.getByRole("article", { name: REPORT_TEXT })).toBeVisible();
  expect(await axeViolations(page, '[role="dialog"]'), "reporter dialog list").toEqual([]);

  await dialog.getByRole("button", { name: "Resume my task…", exact: true }).click();
  await expect(dialog.getByRole("group", { name: /^Resume your task on / })).toBeVisible();
  expect(await axeViolations(page, '[role="dialog"]'), "reporter dialog with resume open").toEqual([]);
  await dialog.getByRole("group", { name: /^Resume your task on / }).getByRole("button", { name: "Cancel", exact: true }).click();

  await dialog.locator(".modal-actions").getByRole("button", { name: "New report", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New problem report", exact: true });
  await expect(form.getByRole("textbox", { name: /What is the problem\?/ })).toBeFocused();
  expect(await axeViolations(page, '[role="dialog"]'), "reporter dialog new report").toEqual([]);
  await form.locator(".modal-actions").getByRole("button", { name: "Report and pause my task", exact: true }).click();
  await expect(form.getByText("Describe the problem.")).toBeVisible();
  expect(await axeViolations(page, '[role="dialog"]'), "reporter dialog new report with field error").toEqual([]);
  await evidence(page, "reporter-dialog-axe");

  // Lead page.
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const lead = await context.newPage();
    await loginExisting(lead, s.users.lead);
    await lead.goto(reportUrl(s, report.report_id));
    await expect(lead.getByText(/^Problem report · /)).toBeVisible();
    await expect(lead.locator(".report-text").first()).toHaveText(REPORT_TEXT);
    await expect(lead.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await axeViolations(lead, "main"), "lead page").toEqual([]);

    for (const [name, title] of [["Release pause…", "Release pause"], ["Pause other tasks…", "Pause other tasks"], ["Agree empty restart…", `Agree empty restart of ${reporterTaskRef(s, report)}`]] as const) {
      await intent(lead, name).click();
      await expect(confirmBox(lead, title).getByRole("heading", { name: title })).toBeFocused();
      expect(await axeViolations(lead, "main"), `lead page, ${title} open`).toEqual([]);
    }
    await lead.locator("summary", { hasText: /^Technical details$/ }).click();
    expect(await axeViolations(lead, "main"), "lead page, technical details open").toEqual([]);
    await evidence(lead, "lead-axe");
  } finally {
    await context.close();
  }
});
