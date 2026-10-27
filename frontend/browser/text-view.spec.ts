/**
 * The text view (plan T2, spec §4): one toolbar, "Language and version" and "Show" selects with greyed entries,
 * read-only findings with the axis colours, Compare as a second column; an annotator sees no entries for other
 * people's work (D3). Scenario: tests/browser_proposal_check_scenarios.py (CHECKED).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, openTextCard, showSegment } from "./documentsHelpers";
import { loginScenarioUser, proposalCheckScenario, type ProposalCheckPerson, type ProposalCheckScenario } from "./proposalCheckHelpers";

test.setTimeout(180_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

const CASE = "EN100024";
const showSelects = (page: Page) => page.getByRole("combobox", { name: "Show", exact: true });
const versionSelects = (page: Page) => page.getByRole("combobox", { name: "Language and version", exact: true });
const findings = (page: Page) => page.getByRole("region", { name: "Findings", exact: true });

/** Choose the Show entry whose label starts with ``label``. */
async function show(select: Locator, label: string): Promise<void> {
  const value = await select.locator("option", { hasText: label }).first().getAttribute("value");
  expect(value, `Show entry ${label}`).not.toBeNull();
  await select.selectOption(value!);
}

async function openTextView(page: Page, s: ProposalCheckScenario, person: ProposalCheckPerson): Promise<void> {
  await loginScenarioUser(page, s, person);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${CASE}?variant=${encodeURIComponent(s.cases[CASE])}`);
  await expect(showSelects(page).first()).toBeVisible({ timeout: 30_000 });
}

test("the lead opens the proposals from the card, switches layers and compares", async ({ page }) => {
  const s = await proposalCheckScenario(page, "CHECKED");
  await loginScenarioUser(page, s, "lead");
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  const card = await openTextCard(page, CASE, "en");
  await showSegment(card, "Annotation");
  await card.getByRole("link", { name: `Open text, ${CASE} en`, exact: true }).click();
  await expect(page).toHaveURL(/show=proposals/);

  const select = showSelects(page).first();
  await expect(select.locator("option:checked")).toHaveText(/^Tool proposals \(3\)/);
  await expect(findings(page).getByRole("listitem")).toHaveCount(3);
  // Axis values on their fixed colour: "Present" in the present token colour.
  const present = findings(page).locator(".axis-value--present").first();
  await expect(present).toHaveText("Present");
  const expected = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--axis-present-text)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(present).toHaveCSS("color", expected);

  // People with their submission, the final result greyed until accepted.
  await expect(select.locator("option", { hasText: s.display_names.tom })).toContainText("submitted");
  await expect(select.locator("option", { hasText: s.display_names.mia })).toContainText("submitted");
  const final = select.locator("option", { hasText: "Final result" });
  // The visible label wraps the select, so toBeDisabled() would check the select; check the option itself.
  await expect(final).toHaveJSProperty("disabled", true);
  await expect(final).toHaveText("Final result (not accepted yet)");

  // Tom's layer: his correction (HP:0002133) and his confirmed p1; his rejected p2 is not a finding.
  await show(select, s.display_names.tom);
  await expect(findings(page)).toContainText("(HP:0002133)");
  await expect(page.locator(".text-container .run--marked").first()).toBeVisible();

  // Compare opens a second column with its own selects.
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(showSelects(page)).toHaveCount(2);
  await expect(versionSelects(page)).toHaveCount(2);

  // Nothing is editable.
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Save|Delete)\b/ })).toHaveCount(0);
});

test("an annotator's Show list has no entries for other people", async ({ page }) => {
  const s = await proposalCheckScenario(page, "CHECKED");
  await openTextView(page, s, "tom");
  const select = showSelects(page).first();
  // The layer entries have loaded (the select starts with "Text only" alone) before the absence checks.
  await expect(select.locator("option", { hasText: "Tool proposals" })).toHaveCount(1);
  await expect(select.locator("option", { hasText: s.display_names.mia })).toHaveCount(0);
  await expect(select.locator("option", { hasText: "Ali" })).toHaveCount(0);
  // The version select names the native text in origin words.
  await expect(versionSelects(page).first().locator("option:checked")).toHaveText(/en, version 1 \((source text|native)\)$/);
  await expect(page.getByRole("textbox")).toHaveCount(0);
});
