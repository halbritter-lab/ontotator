import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { rowAction } from "./documentsHelpers";
import { authenticatedRequest, loginExisting } from "./helpers";

// Issue 213. Own project: every test builds a fresh one through the scenario route.
test.setTimeout(120_000);
test.use({ viewport: { width: 1280, height: 800 } });

type Scenario = {
  project: string; case_id: string; assignment_id: number;
  documents: Record<"target", string>; users: Record<"lead" | "reviewer" | "other", string>;
};

/** Evidence shots of a manual run (`ASSIGN_REVIEW_EVIDENCE=dir`), not part of the gate. */
async function shot(page: Page, name: string) {
  const folder = process.env.ASSIGN_REVIEW_EVIDENCE;
  if (!folder) return;
  mkdirSync(resolve(folder), { recursive: true });
  await page.screenshot({ path: resolve(folder, `${name}.png`) });
}

async function session(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await loginExisting(page, username);
  return page;
}

async function scenario(page: Page): Promise<Scenario> {
  const response = await page.request.post("/__test_translation_review__?assignment=target&single=true", { timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as Scenario;
}

test("annotation assigned during the review waits, then opens without a lead step", async ({ page, browser }) => {
  const s = await scenario(page);
  const lead = await session(browser, s.users.lead);
  await lead.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await rowAction(lead, "Assign annotation…", s.case_id, "de").click();
  const dialog = lead.getByRole("dialog", { name: "Assign annotation", exact: true });
  const name = new RegExp(s.users.other);
  const members = dialog.getByRole("table", { name: "Members" });
  await members.getByRole("checkbox", { name }).or(members.getByRole("radio", { name })).click();
  await expect(dialog.getByRole("status", { name: "Summary" })).toContainText("the task opens once the review is accepted");
  await expect(dialog.getByRole("status", { name: "Summary" })).toContainText("Open tasks:");
  await shot(lead, "1-assign-dialog-open-review");
  await dialog.getByRole("button", { name: /^Assign/ }).last().click();
  await expect(dialog).toBeHidden();

  await expect(lead.getByRole("cell", { name: `waiting for review (${s.users.other})`, exact: true })).toBeVisible();
  await shot(lead, "2-documents-row-waiting");
  const assignments = await (await authenticatedRequest(lead, `/api/v1/projects/${encodeURIComponent(s.project)}/assignments`)).json() as { id: number; task: string }[];
  const task = assignments.find(item => item.task === "annotate")!;

  const annotator = await session(browser, s.users.other);
  const row = annotator.getByTestId("task-row").filter({ hasText: "Waiting for translation review" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Opens after the review")).toBeVisible();
  await expect(row.getByRole("link")).toHaveCount(0);
  await shot(annotator, "3-my-tasks-waiting");
  await annotator.goto(`/#/tasks/${task.id}`);
  await expect(annotator.getByRole("heading", { name: "Waiting for translation review" })).toBeVisible();
  await expect(annotator.getByText("This task opens by itself once the translation review of the text is accepted.")).toBeVisible();
  await shot(annotator, "4-direct-url-message");

  const reviewer = await session(browser, s.users.reviewer);
  await reviewer.goto(`/#/tasks/${s.assignment_id}`);
  await reviewer.getByRole("radio", { name: "Accepted unchanged", exact: true }).check();
  await reviewer.getByRole("button", { name: "Submit review…", exact: true }).click();
  await reviewer.getByRole("dialog", { name: "Submit this review?", exact: true }).getByRole("button", { name: "Submit review", exact: true }).click();
  await expect(reviewer.getByRole("button", { name: "Submit review…", exact: true })).toBeHidden();

  await annotator.getByRole("link", { name: "My tasks", exact: false }).first().click();
  const open = annotator.getByTestId("task-row").filter({ hasText: s.case_id }).filter({ has: annotator.getByRole("link", { name: "Start", exact: true }) });
  await expect(open).toBeVisible();
  await expect(annotator.getByText("Waiting for translation review")).toHaveCount(0);
  await shot(annotator, "5-my-tasks-open");
  await open.getByRole("link", { name: "Start", exact: true }).click();
  await expect(annotator.getByRole("button", { name: "Finish & submit text", exact: true })).toBeVisible();
  await shot(annotator, "6-task-opened");
});
