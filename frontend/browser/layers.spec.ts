import { expect, test, type Page } from "@playwright/test";
import { importPackage, openCase, submitCase } from "./helpers";

const PACKAGE_IDS: Record<string, string> = {
  review_references: "pkg-review-references",
  single: "pkg-scenario-a",
  multi_editable: "pkg-scenario-c",
  assisted: "pkg-scenario-b",
};

const importScenario = (page: Page, scenario: string, annotator: string) =>
  importPackage(page, `?scenario=${scenario}`, PACKAGE_IDS[scenario], annotator);

test.describe("Layered Annotations & Case Navigation (Browser Scenarios A/B/C)", () => {
  test("Scenario A: Single-layer baseline has zero extra interaction controls and preserves document order", async ({ page }) => {
    await importScenario(page, "single", "user-scenario-a");
    await page.locator("#mode-select").selectOption("independent");
    await openCase(page, { identity: "user-scenario-a" });

    // 1. Zero extra layer controls rendered
    await expect(page.locator(".layer-controls")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: /Layers|Schichten/i })).toHaveCount(0);

    // 2. Case navigation displays first document in document_order (doc-beta, not alphabetical doc-alpha)
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2/i);
    await expect(page.locator(".case-navigation").getByRole("button", { name: /Previous Case|Vorheriger Fall/i })).toBeDisabled();
    await expect(page.locator(".case-navigation").getByRole("button", { name: /Next Case|Nächster Fall/i })).toBeEnabled();

    // 3. Create annotation without any ontology/layer dialogs using unified search flow
    await page.getByRole("button", { name: "+ New Annotation" }).click();
    await page.getByLabel("Search ontology term").fill("HP:0001250");
    await page.locator(".candidate-card").filter({ hasText: "HP:0001250" }).first().click();
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);

    await page.locator(".case-navigation").getByRole("button", { name: /Next Case|Nächster Fall/i }).click();
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(0);
    await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 0");
    await page.getByRole("button", { name: "+ New Annotation" }).click();
    await page.getByLabel("Search ontology term").fill("HP:0001252");
    await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).first().click();
    await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001252");
    await page.locator(".case-navigation").getByRole("button", { name: /Previous Case|Vorheriger Fall/i }).click();
    await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001250");
    await expect(page.locator(".sidebar .doc-item")).not.toContainText("HP:0001252");

    // 4. A single-layer case is checked as part of submission.
    await expect(page.getByLabel(/Document verified|Dokument vollständig geprüft/i)).toHaveCount(0);
    await submitCase(page);

    // Dismiss submission modal to return to workspace
    await page.getByRole("button", { name: /Stay in case|Im Fall bleiben/i }).click();

    // 5. Navigate to next case in document order
    await page.locator(".case-navigation").getByRole("button", { name: /Next Case|Nächster Fall/i }).click();
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 2 of 2/i);
    await expect(page.locator(".case-navigation").getByRole("button", { name: /Next Case|Nächster Fall/i })).toBeDisabled();
    await expect(page.locator(".case-navigation").getByRole("button", { name: /Previous Case|Vorheriger Fall/i })).toBeEnabled();
  });

  test("Scenario B: Assisted mode with reference layer (cannot activate reference, visibility toggle)", async ({ page }) => {
    await importScenario(page, "assisted", "user-scenario-b");
    await page.locator("#mode-select").selectOption("assisted");
    await openCase(page, { identity: "user-scenario-b" });

    // 1. Layer controls visible because package has 2 layers
    await expect(page.locator(".layer-controls")).toBeVisible();
    await expect(page.getByText(/Layers & Ontologies|Schichten & Ontologien/i)).toBeVisible();

    // 2. Reference layer has badge and radio button is disabled
    const refLayer = page.locator(".layer-item").filter({ hasText: "Reference Diseases" });
    await expect(refLayer).toBeVisible();
    await expect(refLayer.locator(".badge").filter({ hasText: /Reference|Referenz/i })).toBeVisible();
    const refRadio = refLayer.locator('input[type="radio"]');
    await expect(refRadio).toBeDisabled();

    // 3. Target layer is active
    const targetLayer = page.locator(".layer-item").filter({ hasText: "Target Phenotypes" });
    await expect(targetLayer).toBeVisible();
    const targetRadio = targetLayer.locator('input[type="radio"]');
    await expect(targetRadio).toBeChecked();

    await expect(page.getByRole("button", { name: /MONDO:0005027/ })).toBeVisible();
    await page.getByRole("button", { name: /MONDO:0005027/ }).click();
    await expect(page.getByLabel(/Reference details|Referenzdetails/i)).toContainText("Reference Diseases");
    await expect(page.getByLabel(/Reference details|Referenzdetails/i)).toContainText(/Epilepsy|Epilepsie/i);
    await expect(page.getByRole("button", { name: /Change term|Delete Annotation|Begriff ändern|Annotation löschen/i })).toHaveCount(0);
    await expect(page.locator(".text-container .run--marked")).not.toHaveCount(0);

    // 4. Toggle visibility of reference layer
    const refVisibility = refLayer.locator('input[type="checkbox"]');
    await expect(refVisibility).toBeChecked();
    // Toggle off
    await refVisibility.uncheck();
    await expect(refVisibility).not.toBeChecked();
    await expect(page.getByLabel(/Reference details|Referenzdetails/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /MONDO:0005027/ })).toHaveCount(0);
    await expect(page.locator(".text-container .run--marked")).toHaveCount(0);
    // Toggle back on
    await refVisibility.check();
    await expect(refVisibility).toBeChecked();

    // 5. Annotate independently in target layer
    await page.getByRole("button", { name: "+ New Annotation" }).click();
    await page.getByLabel("Search ontology term").fill("HP:0001252");
    await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).first().click();
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
  });

  test("Review excludes reference targets and permits returning to a case with references", async ({ page }) => {
    await importScenario(page, "review_references", "review-reference-navigation");
    await page.locator("#mode-select").selectOption("review");
    await openCase(page, { identity: "review-reference-navigation" });
    // Reference annotations are not review targets: only the one proposal is listed.
    await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (1)" })).toBeVisible();
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2/i);
    await expect(page.getByRole("button", { name: /MONDO:0005027/ })).toBeVisible();

    // Case 2 has no review proposals: review navigation does not offer it.
    await expect(page.locator(".case-navigation").getByRole("button", { name: /Next Case/i })).toBeDisabled();
    const caseTwo = page.locator(".case-navigation select option").filter({ hasText: /Case 2 of 2/i });
    await expect(caseTwo).toBeDisabled();
    await expect(caseTwo).toHaveText(/no proposals/i);
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2/i);
    await expect(page.getByRole("button", { name: /MONDO:0005027/ })).toBeVisible();

    // Returning to the case with references from the dashboard works (no second identity prompt).
    await page.getByRole("button", { name: "← Dashboard" }).click();
    await openCase(page);
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2/i);
    await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: /MONDO:0005027/ })).toBeVisible();
  });

  test("Scenario C: Multi-editable layers require both layers checked before completion", async ({ page }) => {
    await importScenario(page, "multi_editable", "user-scenario-c");
    await page.locator("#mode-select").selectOption("independent");
    await openCase(page, { identity: "user-scenario-c" });

    // 1. Both layers are visible in layer controls
    await expect(page.locator(".layer-controls")).toBeVisible();
    const layer1 = page.locator(".layer-item").filter({ hasText: "Editable Layer 1" });
    const layer2 = page.locator(".layer-item").filter({ hasText: "Editable Layer 2" });
    await expect(layer1).toBeVisible();
    await expect(layer2).toBeVisible();

    // 2. Try submitting without checking either layer
    await page.getByRole("button", { name: /Finish & Submit Case|Submit Case|Fall abschließen/i }).first().click();
    await expect(page.getByRole("alert")).toContainText(/Please mark all editable layers as verified|Bitte markieren Sie alle editierbaren Schichten als geprüft/i);

    // 3. Check layer 1 only
    const checkAction = page.locator(".layer-controls").getByRole("button", { name: /Mark .* as verified|als geprüft markieren/i });
    await checkAction.click();

    // Try submitting again -> still blocked
    await page.getByRole("button", { name: /Finish & Submit Case|Submit Case|Fall abschließen/i }).first().click();
    await expect(page.getByRole("alert")).toContainText(/Please mark all editable layers as verified|Bitte markieren Sie alle editierbaren Schichten als geprüft/i);

    // 4. Switch to layer 2 and check it
    await layer2.locator('input[type="radio"]').check();
    await checkAction.click();

    // 5. Now both layers are checked -> submit succeeds
    await submitCase(page);
  });
});
