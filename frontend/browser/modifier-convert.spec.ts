/**
 * "Turn into modifier…" (modifiers plan M7, R3, E-c): a standalone Severe finding (old data) becomes a modifier of
 * Seizure through the attach mode in convert mode, one convert_to_modifier; axe during the mode.
 *
 * Scenario: ``POST /__test_modifiers__?with_finding=1&standalone=1`` (tests/browser_modifier_scenarios.py).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginScenarioUser, type ReviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const CASE = "modifiers";

test("Turn into modifier… converts the standalone Severe onto Seizure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.request.post("/__test_modifiers__", { params: { with_finding: "1", standalone: "1" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as ReviewFlowScenario;
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments[CASE]}`);
  await expect(page.locator(".text-container")).toHaveText(s.texts[CASE]);
  await page.waitForLoadState("networkidle");

  const source = page.locator('[data-list-key="annotation:standalone-severe"]');
  await source.click();
  await page.getByRole("button", { name: "Turn into modifier…" }).click();
  await expect(page.locator(".attach-mention-banner")).toContainText("Attach Severe: click its finding in the list or in the text");
  await expect(source).toContainText("Becomes a modifier of the finding you choose");
  const panel = page.getByRole("region", { name: "Attach Severe" });
  await expect(panel).toContainText("The standalone finding Severe is then deleted; its text “schwere” goes with the modifier.");
  const target = page.getByRole("button", { name: "Attach Severe to Seizure" });
  await expect(target).toBeFocused();
  // The findings rows are `li role="button"` in a `ul` since before modifiers (list, aria-allowed-role): known, not checked here.
  const axe = await new AxeBuilder({ page }).include(".attach-mention-banner").include(".inspector-pane").include(".doc-list")
    .disableRules(["list", "aria-allowed-role"]).analyze();
  expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);

  const converted = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().method() === "POST"
    && (r.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === "convert_to_modifier");
  await page.keyboard.press("Enter");
  expect((await converted).ok()).toBeTruthy();
  await expect(source).toHaveCount(0);
  await expect(page.locator('[data-modifier-chip="HP:0012828"]')).toContainText("Severe · “schwere”");
  await expect(page.locator('[data-list-key="annotation:seizure"]').getByRole("list", { name: "Modifiers" }))
    .toContainText("Modifier: Severe HP:0012828 “schwere”");
  await expect(page.locator(".attach-mention-banner")).toHaveCount(0);
});
