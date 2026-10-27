import { expect, test, type Page } from "@playwright/test";
import { importPackage, openCase, submitCase, viewSubmittedResult } from "./helpers";

const PACKAGE_IDS: Record<string, string> = {
  review_references: "pkg-review-references",
  single: "pkg-scenario-a",
  multi_editable: "pkg-scenario-c",
  assisted: "pkg-scenario-b",
};

const importScenario = (page: Page, scenario: string, annotator: string, options: { proposals?: boolean } = {}) =>
  importPackage(page, `?scenario=${scenario}`, PACKAGE_IDS[scenario], annotator, options);

test.describe("Layered Annotations & Case Navigation (Browser Scenarios A/B/C)", () => {
  test("Scenario A: Single-layer baseline has zero extra interaction controls and preserves document order", async ({ page }) => {
    await importScenario(page, "single", "user-scenario-a");
    await openCase(page, { task: "annotate" });

    // 1. Zero extra layer controls rendered
    await expect(page.locator(".layer-controls")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: /Layers|Schichten/i })).toHaveCount(0);

    // 2. Case navigation displays first document in document_order (doc-beta, not alphabetical doc-alpha)
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2/i);
    await expect(page.locator(".case-navigation").getByRole("button", { name: /Previous Case|Vorheriger Fall/i })).toBeDisabled();
    await expect(page.locator(".case-navigation").getByRole("button", { name: /Next Case|Nächster Fall/i })).toBeEnabled();

    // 3. Create annotation without any ontology/layer dialogs using unified search flow
    await page.getByRole("button", { name: "Add finding without a text span" }).click();
    await page.getByLabel("Reason for no text span").fill("Finding documented outside the selected excerpt");
    await page.getByLabel("Search term", { exact: true }).fill("HP:0001250");
    await page.locator(".candidate-card").filter({ hasText: "HP:0001250" }).first().click();
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);

    await page.locator(".case-navigation").getByRole("button", { name: /Next Case|Nächster Fall/i }).click();
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(0);
    await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 0");
    await page.getByRole("button", { name: "Add finding without a text span" }).click();
    await page.getByLabel("Reason for no text span").fill("Finding documented outside the selected excerpt");
    await page.getByLabel("Search term", { exact: true }).fill("HP:0001252");
    await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).first().click();
    await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001252");
    await page.locator(".case-navigation").getByRole("button", { name: /Previous Case|Vorheriger Fall/i }).click();
    await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001250");
    await expect(page.locator(".sidebar .doc-item")).not.toContainText("HP:0001252");

    // 4. A single-layer case is checked as part of submission.
    await expect(page.getByLabel(/Document verified|Dokument vollständig geprüft/i)).toHaveCount(0);
    await submitCase(page);

    // M-6: the pre-submit next task opens by itself, even though the server moves submitted tasks last.
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2:.*doc-alpha/i);
    await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001252");
    await expect(page.getByRole("button", { name: "Previous Case" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Next Case" })).toBeEnabled();

    // Submitted neighbors remain navigable in actual server order, with their
    // saved findings intact and every editing entry point hidden.
    await page.getByRole("button", { name: "Next Case" }).click();
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 2 of 2:.*doc-beta/i);
    await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001250");
    await expect(page.getByRole("button", { name: "Add finding without a text span" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Finish & Submit/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next Case" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Previous Case" })).toBeEnabled();
  });

  test("Scenario B: Assigned review with reference layer (cannot activate reference, visibility toggle)", async ({ page }) => {
    await importScenario(page, "assisted", "user-scenario-b", { proposals: true });
    await openCase(page, { task: "annotate" });

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
    await expect(page.getByRole("button", { name: /Change term|Delete finding|Begriff ändern|Annotation löschen/i })).toHaveCount(0);
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
    await page.getByRole("button", { name: "Add finding without a text span" }).click();
    await page.getByLabel("Reason for no text span").fill("Finding documented outside the selected excerpt");
    await page.getByLabel("Search term", { exact: true }).fill("HP:0001252");
    await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).first().click();
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
  });

  test("Review excludes reference targets and permits returning to a case with references", async ({ page }) => {
    await importScenario(page, "review_references", "review-reference-navigation", { proposals: true });
    await openCase(page, { task: "annotate" });
    // Reference annotations are not review targets: only the one proposal is listed.
    await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (1)" })).toBeVisible();
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2/i);
    await expect(page.getByRole("button", { name: /MONDO:0005027/ })).toBeVisible();

    // A case with no proposals still needs checking; it is annotated from scratch (D2) and can yield a negative result.
    await expect(page.locator(".case-navigation").getByRole("button", { name: /Next Case/i })).toBeEnabled();
    const caseTwo = page.locator(".case-navigation select option").filter({ hasText: /Case 2 of 2/i });
    await expect(caseTwo).toBeEnabled();
    await page.locator(".case-navigation").getByRole("button", { name: /Next Case/i }).click();
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 2 of 2/i);
    await expect(page.locator(".sidebar-header").filter({ hasText: /Review Proposals/ })).toHaveCount(0);
    await submitCase(page);
    await viewSubmittedResult(page);
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(0);
    await page.locator(".case-navigation").getByRole("button", { name: /Previous Case/i }).click();
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2/i);
    await expect(page.getByRole("button", { name: /MONDO:0005027/ })).toBeVisible();

    // Returning to the case with references from My tasks works.
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "My tasks", exact: true }).click();
    await openCase(page, { task: "annotate" });
    await expect(page.locator(".case-navigation select option:checked")).toHaveText(/Case 1 of 2/i);
    await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: /MONDO:0005027/ })).toBeVisible();
  });

  test("Scenario C: Multi-editable layers use one document confirmation", async ({ page }) => {
    await importScenario(page, "multi_editable", "user-scenario-c");
    await openCase(page, { task: "annotate" });
    await expect(page.locator(".layer-controls")).toBeVisible();
    await expect(page.locator(".layer-item")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /verified/i })).toHaveCount(0);
    await submitCase(page);
  });
});
