/**
 * Issues 210 and 211. Show selected and the selection counts, Distribute evenly as the one visible dialog, the row's
 * Accept result / Compare results against the card (overview scenario S17, a project of its own), and the
 * Edit & Replace copy under its proposal (a fresh modifier scenario). EVIDENCE_DIR saves a screenshot per state.
 */
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { documentsReady, documentsTab, filterChip, rowAction, rowCell, textRow } from "./documentsHelpers";
import { loginOverviewUser, overviewScenario } from "./overviewHelpers";
import { loginScenarioUser, type ReviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1280, height: 800 } });

const shot = async (page: Page, name: string) => {
  if (process.env.EVIDENCE_DIR) await page.screenshot({ path: resolve(process.env.EVIDENCE_DIR, `${name}.png`) });
};

async function openDocuments(page: Page) {
  const s = await overviewScenario(page, "S17");
  await loginOverviewUser(page, s, "lead");
  const documents = `/#/projects/${encodeURIComponent(s.project)}/documents`;
  await page.goto(documents);
  await documentsReady(page);
  return documents;
}

async function selectByIds(page: Page, ids: string[]) {
  await page.getByRole("button", { name: "Select by case IDs…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /case IDs/ });
  await dialog.getByRole("textbox").fill(ids.join("\n"));
  const select = dialog.locator(".btn-primary");
  await expect(select).not.toHaveAttribute("aria-disabled", "true");
  await select.click();
  await expect(dialog).toHaveCount(0);
}

test("Show selected lists the hidden texts too, and the header counts texts", async ({ page }) => {
  const documents = await openDocuments(page);
  await documentsTab(page, "All").click();
  await expect(page.getByRole("checkbox", { name: "Select all 6 filtered texts", exact: true })).toBeVisible();

  await page.goto(`${documents}?language=de`);
  await expect(filterChip(page, "Language: de")).toBeVisible();
  await selectByIds(page, ["case-171", "case-172"]);
  const bar = page.getByRole("region", { name: "Selection" });
  await expect(bar).toContainText("4 texts in 2 cases selected (2 source texts not shown)");
  await shot(page, "1-counts-hidden-sources");

  const toggle = bar.getByRole("button", { name: "Show selected", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(filterChip(page, "Selected texts")).toBeVisible();
  await expect(filterChip(page, "Language: de")).toHaveCount(0);
  for (const [caseId, language] of [["case-171", "en"], ["case-171", "de"], ["case-172", "en"], ["case-172", "de"]]) {
    await expect(textRow(page, caseId, language)).toBeVisible();
  }
  await expect(textRow(page, "case-173", "en")).toHaveCount(0);
  await expect(bar).toContainText("next step: Assign translation review (de)");
  await expect(bar).not.toContainText("not shown");
  await shot(page, "2-show-selected-on");

  await filterChip(page, "Selected texts").click();
  await expect(filterChip(page, "Language: de")).toBeVisible();
  await expect(textRow(page, "case-171", "en")).toHaveCount(0);
  await expect(bar).toContainText("(2 source texts not shown)");
});

test("Distribute evenly is the one visible dialog and the walk-through goes on after it", async ({ page }) => {
  await openDocuments(page);
  await documentsTab(page, "All").click();
  await selectByIds(page, ["case-171", "case-172"]);
  await page.getByRole("region", { name: "Selection" }).getByRole("button", { name: /^Assign/ }).click();
  const assign = page.getByRole("dialog", { name: /^Assign/ });
  await assign.getByRole("button", { name: "Distribute evenly…", exact: true }).click();
  const distribution = page.getByRole("dialog", { name: "Propose distribution", exact: true });
  await expect(distribution).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await distribution.getByRole("button", { name: "Propose", exact: true }).click();
  await expect(distribution.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await shot(page, "3-distribute-one-dialog");
  await distribution.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(distribution).toHaveCount(0);
  await expect(assign.getByRole("status").filter({ hasText: "Assignments from the even distribution saved" })).toContainText("Next:");
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("the row asks to compare when submissions differ only in a note, as the card does", async ({ page }) => {
  await openDocuments(page);
  await documentsTab(page, "All").click();
  await expect(rowAction(page, "Accept result…", "case-173", "en")).toBeVisible();
  await expect(rowAction(page, "Compare results…", "case-174", "en")).toBeVisible();
  await expect(rowCell(textRow(page, "case-173", "en"), "finalization")).toContainText("ready to accept");
  await expect(rowCell(textRow(page, "case-174", "en"), "finalization")).toContainText("ready to compare");
  await shot(page, "4-row-accept-and-compare");
  await rowAction(page, "Compare results…", "case-174", "en").click();
  const card = page.getByRole("dialog", { name: "case-174 en" });
  await expect(card.getByText(/findings match/).first()).toBeVisible();
  await expect(card.getByRole("button", { name: "Accept result", exact: true })).toHaveCount(0);
});

test("the Edit & Replace copy is listed with its proposal, not under Your own findings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const response = await page.request.post("/__test_modifiers__", { params: { proposal: "1" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as ReviewFlowScenario;
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments.modifiers}`);
  const proposal = page.locator('.sidebar [data-list-key^="target:"]');
  await proposal.click();
  await page.getByRole("button", { name: /Edit & Replace/ }).click();
  const copy = page.locator('.sidebar [data-list-key^="annotation:"]');
  await expect(copy).toContainText("Your copy");
  await expect(page.getByText("Your own findings (0)", { exact: true })).toBeVisible();
  const changed = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON()?.payload?.command === "set_axes");
  await page.locator('[data-axis-field="assertion"] input[type="radio"][value="absent"]').check();
  expect((await changed).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Done, back to the proposal", exact: true }).click();
  await expect(page.locator('.sidebar li:has([data-list-key^="target:"]) + li + li [data-list-key^="annotation:"]')).toBeVisible();
  await expect(page.getByText("1 replaced proposal", { exact: true })).toBeVisible();
  await shot(page, "5-copy-under-proposal");
});
