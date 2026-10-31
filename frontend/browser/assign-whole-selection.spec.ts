import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { rowCell, textRow } from "./documentsHelpers";
import { loginExisting } from "./helpers";

// Issue 218. Own project: every test builds a fresh one through the scenario route.
test.setTimeout(120_000);
test.use({ viewport: { width: 1280, height: 800 } });

type Scenario = { project: string; case_id: string; users: Record<"lead" | "reviewer" | "other", string> };

/** Evidence shots of a manual run (`ASSIGN_SELECTION_EVIDENCE=dir`), not part of the gate. */
async function shot(page: Page, name: string) {
  const folder = process.env.ASSIGN_SELECTION_EVIDENCE;
  if (!folder) return;
  mkdirSync(resolve(folder), { recursive: true });
  await page.screenshot({ path: resolve(folder, `${name}.png`) });
}

async function openDialog(page: Page, browser: Browser) {
  // A case with an en source and a de translation, nothing assigned.
  const response = await page.request.post("/__test_translation_review__?single=true", { timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = await response.json() as Scenario;
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const lead = await context.newPage();
  await loginExisting(lead, s.users.lead);
  await lead.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await rowCell(textRow(lead, s.case_id, "de"), "select").getByRole("checkbox").click();
  await lead.getByRole("region", { name: /selection/i }).getByRole("button", { name: /^Assign/ }).click();
  return { s, lead, dialog: lead.getByRole("dialog", { name: /^Assign/ }) };
}

test("a de + en selection walks review, then annotation; Distribute moves on; closing names what is left", async ({ page, browser }) => {
  const { s, lead, dialog } = await openDialog(page, browser);
  const members = dialog.getByRole("table", { name: "Members" });
  const overview = dialog.getByText("This selection needs", { exact: true }).locator("..");

  // Issue 233: one item per task and language, the current one marked.
  const steps = dialog.getByRole("list", { name: "Steps" }).getByRole("listitem");
  await expect(steps).toHaveText(["Translation review de", "Annotation en", "Annotation de"]);
  await expect(steps.first()).toHaveAttribute("aria-current", "step");
  await expect(overview).toContainText("Step 1 of 3");
  await expect(dialog.getByRole("table", { name: "Members" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Skip this task", exact: true })).toBeVisible();
  await shot(lead, "1-dialog-start-overview");

  await members.getByRole("radio", { name: new RegExp(s.users.reviewer) }).click();
  await dialog.getByRole("button", { name: "Assign 1", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "1 translation review assigned to" })).toContainText("Next: annotation (");
  await expect(overview).toContainText("Step 2 of 3");
  await expect(steps.first()).toContainText("✓");
  await expect(steps.nth(1)).toHaveAttribute("aria-current", "step");
  await shot(lead, "2-moved-on-to-next-task");

  await dialog.getByRole("button", { name: "Distribute evenly…", exact: true }).click();
  const distribution = lead.getByRole("dialog", { name: "Propose distribution", exact: true });
  await distribution.getByRole("button", { name: "Propose", exact: true }).click();
  await distribution.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(distribution).toHaveCount(0);
  await expect(dialog.getByRole("status").filter({ hasText: "Assignments from the even distribution saved" })).toContainText("Next: annotation (");
  await expect(overview).toContainText("Step 3 of 3");
  await expect(dialog.getByRole("button", { name: "Distribute evenly…", exact: true })).toBeVisible();
  await expect(dialog.getByText("Each ticked person gets every selected en text", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Skip this task", exact: true })).toHaveCount(0);
  await shot(lead, "3-after-distribute");

  await dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const toast = lead.locator(".ui-toast");
  await expect(toast).toContainText("Left unassigned: annotation of");
  await shot(lead, "4-closing-summary");
  await toast.getByRole("button", { name: "Select the 1 skipped case", exact: true }).click();
  await expect(lead.getByText(/next step: Assign annotation \(en\)/)).toBeVisible();
  await shot(lead, "5-left-texts-selected");
});

test("a step can be skipped without assigning; closing reports it", async ({ page, browser }) => {
  const { lead, dialog } = await openDialog(page, browser);
  await dialog.getByRole("button", { name: "Skip this task", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Next: annotation (" })).toBeVisible();
  await dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(lead.locator(".ui-toast")).toContainText("Left unassigned: translation review of");
});
