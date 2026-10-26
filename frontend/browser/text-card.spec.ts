/**
 * The text card of Documents (plan T2, spec §2): the path Translation, Annotation, Finalization with its parts,
 * History and Details inside the card, removing an assignment from the chip menu, assigning yourself, the toggling
 * row click with the selection bar for two or more texts, ‹ › through the table order, the 390 px sheet and axe.
 * Scenarios: tests/browser_proposal_check_scenarios.py.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cardRow, cardSegment, documentsReady, chipMenu, documentsTable, openTextCard, robotIcon, showSegment, textCard, textName } from "./documentsHelpers";
import { authenticatedRequest } from "./helpers";
import { loginScenarioUser, proposalCheckScenario, type ProposalCheckScenario } from "./proposalCheckHelpers";

test.setTimeout(180_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

const CASE = "EN100024";

async function openDocuments(page: Page, s: ProposalCheckScenario, query = ""): Promise<void> {
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents${query}`);
  await documentsReady(page);
}

/** The row checkbox "Select {case} {language}" (separator-free after U9). */
const rowCheckbox = (page: Page, caseId: string): Locator =>
  documentsTable(page).getByRole("checkbox", { name: new RegExp(`^Select ${caseId}\\W+en$`) });

/** A click on the row area (a status cell), not on the text name or a button. */
const clickRow = (page: Page, caseId: string) => cardRow(page, caseId, "en").getByRole("cell").nth(1).click();

const selectionBar = (page: Page) => page.getByRole("region", { name: "Selection", exact: true });

test("path segments, details and actions", async ({ page }) => {
  const s = await proposalCheckScenario(page, "ONE_ASSIGNED");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s);
  const card = await openTextCard(page, CASE, "en");
  await expect(cardSegment(card, "Annotation")).toHaveAttribute("aria-current", "step");
  await expect(cardSegment(card, "Translation")).toContainText("source text");

  await showSegment(card, "Translation");
  await expect(card.getByRole("heading", { name: "Translation", exact: true })).toBeVisible();
  await expect(card.getByText("Source text", { exact: true })).toBeVisible();
  await showSegment(card, "Finalization");
  await expect(card.getByRole("heading", { name: "Finalization", exact: true })).toBeVisible();
  await showSegment(card, "Annotation");
  await expect(card.getByText(s.display_names.tom, { exact: true })).toBeVisible();

  // History and Text details open inside the card; Back returns to the path.
  await card.getByRole("button", { name: /^History( \(\d+\))?$/ }).click();
  await expect(card.getByRole("navigation", { name: "Text path" })).toHaveCount(0);
  await card.getByRole("button", { name: "Back", exact: true }).click();
  await expect(cardSegment(card, "Annotation")).toBeVisible();
  await card.getByRole("button", { name: "Details", exact: true }).click();
  await expect(card.getByRole("heading", { name: "Technical details", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Back", exact: true }).click();
  await expect(cardSegment(card, "Annotation")).toBeVisible();
});

test("remove an assignment after confirming", async ({ page }) => {
  const s = await proposalCheckScenario(page, "ONE_ASSIGNED");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s);
  const row = cardRow(page, CASE, "en");
  // The icon stays while someone is assigned (spec 2026-10-25 §1).
  await expect(robotIcon(row, 3)).toBeVisible();
  const card = await openTextCard(page, CASE, "en");
  await showSegment(card, "Annotation");
  const tom = s.display_names.tom;
  const confirm = page.getByRole("dialog", { name: "Remove assignment?", exact: true });

  await chipMenu(card, tom).click();
  await expect(page.getByRole("menuitem", { name: "Reassign to someone else…", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Remove (draft is discarded)", exact: true }).click();
  await expect(confirm.getByText(`Remove ${tom} from the annotation of ${CASE}? Their draft is discarded.`, { exact: true })).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(chipMenu(card, tom)).toBeVisible();

  await chipMenu(card, tom).click();
  await page.getByRole("menuitem", { name: "Remove (draft is discarded)", exact: true }).click();
  const removed = page.waitForResponse(r => r.request().method() === "POST" && /\/assignments\/\d+\/remove$/.test(r.url()));
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();
  expect((await removed).ok()).toBeTruthy();
  await expect(chipMenu(card, tom)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(robotIcon(row, 3)).toBeVisible();
});

test("the lead assigns themselves in the assign dialog; the consolidator rule is said there", async ({ page }) => {
  const s = await proposalCheckScenario(page, "FRESH");
  await loginScenarioUser(page, s, "lead");
  const rule = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/settings`, "PATCH", { adjudicator_not_annotator: true });
  expect(rule.ok(), await rule.text()).toBeTruthy();
  await openDocuments(page, s);
  const card = await openTextCard(page, CASE, "en");
  await showSegment(card, "Annotation");
  await expect(card.getByRole("button", { name: "Annotate from proposals myself", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Assign annotators…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Assign / });
  await expect(dialog.getByText(/0 of \d+ assigned · limit \d+ per text/)).toBeVisible();
  await expect(dialog.getByText("If you annotate this text yourself, you cannot consolidate it afterwards (project rule \"the consolidator is not an annotator\").", { exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: new RegExp(`^${s.display_names.lead}.*\\(you\\)`) }).check();
  const saved = page.waitForResponse(r => r.request().method() === "POST" && /\/assignments$/.test(r.url()));
  await dialog.getByRole("button", { name: "Assign 1 person", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(dialog).toHaveCount(0);
  await expect(chipMenu(card, s.display_names.lead)).toBeVisible();
});

test("row click opens only the card; the checkboxes select and the bar needs two texts", async ({ page }) => {
  const s = await proposalCheckScenario(page, "FRESH");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s);
  const card = textCard(page, CASE, "en");

  await clickRow(page, CASE);
  await expect(card).toBeVisible();
  await expect(rowCheckbox(page, CASE)).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  await textName(page, CASE, "en").click();
  await expect(card).toBeVisible();
  await expect(rowCheckbox(page, CASE)).not.toBeChecked();
  await page.keyboard.press("Escape");

  await rowCheckbox(page, CASE).check();
  await expect(selectionBar(page)).toHaveCount(0);
  await rowCheckbox(page, "EN100017").check();
  await expect(selectionBar(page)).toBeVisible();
  await expect(selectionBar(page)).toContainText("2");
});

test("‹ › step through the table order", async ({ page }) => {
  const s = await proposalCheckScenario(page, "FRESH");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s);
  const names = await documentsTable(page).getByRole("button", { name: /^Open text card, / }).evaluateAll(
    buttons => buttons.map(button => (button.getAttribute("aria-label") ?? "").replace(/^Open text card, /, "")));
  expect(names.length).toBeGreaterThanOrEqual(3);
  const [first, second] = names.map(name => name.split(" ") as [string, string]);

  const card = await openTextCard(page, ...first);
  await card.getByRole("button", { name: "Next text", exact: true }).click();
  await expect(textCard(page, ...second)).toBeVisible();
  await textCard(page, ...second).getByRole("button", { name: "Previous text", exact: true }).click();
  await expect(textCard(page, ...first)).toBeVisible();
  // J / K do the same while the card is on top.
  await page.keyboard.press("j");
  await expect(textCard(page, ...second)).toBeVisible();
  await page.keyboard.press("k");
  await expect(textCard(page, ...first)).toBeVisible();
});

test("390 px: the card is a full-width sheet without letter-by-letter wrapping", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const s = await proposalCheckScenario(page, "ONE_ASSIGNED");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s, `?panel=${encodeURIComponent(`${CASE}:en`)}`);
  const card = textCard(page, CASE, "en");
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/\btext-card--sheet\b/);
  const box = await card.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(380);
  const heading = card.locator(".text-card-heading");
  const lines = await heading.evaluate(element => {
    const style = getComputedStyle(element);
    const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    return element.getBoundingClientRect().height / line;
  });
  expect(lines).toBeLessThanOrEqual(2.05);
});

for (const width of [1280, 390]) {
  test(`axe is clean with the card open at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const s = await proposalCheckScenario(page, "ONE_ASSIGNED");
    await loginScenarioUser(page, s, "lead");
    await openDocuments(page, s, `?panel=${encodeURIComponent(`${CASE}:en`)}`);
    await expect(textCard(page, CASE, "en")).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations).toEqual([]);
  });
}
