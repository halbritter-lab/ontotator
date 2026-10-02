import { expect, test, type Page } from "@playwright/test";

async function importScenario(page: Page, scenario: string, annotator: string) {
  await page.goto("/#token=browser-test-token");
  const fixture = await page.request.get(`/__synthetic_fixture__?scenario=${scenario}`);
  expect(fixture.ok()).toBeTruthy();
  await page.locator('input[type="file"]').setInputFiles({
    name: `${scenario}.zip`,
    mimeType: "application/zip",
    buffer: await fixture.body(),
  });
  await expect(page.locator("#package-select")).toHaveValue(
    scenario === "single" ? "pkg-scenario-a" : scenario === "assisted" ? "pkg-scenario-b" : "pkg-scenario-c"
  );
  await page.getByLabel("Ihre Annotator-Kennung").fill(annotator);
}

test.describe("Layered Annotations & Case Navigation (Browser Scenarios A/B/C)", () => {
  test("Scenario A: Single-layer baseline has zero extra interaction controls and preserves document order", async ({ page }) => {
    await importScenario(page, "single", "user-scenario-a");
    await page.locator("#mode-select").selectOption("independent");
    await page.getByRole("button", { name: /Arbeitsbereich öffnen/ }).click();

    // 1. Zero extra layer controls rendered
    await expect(page.locator(".layer-controls")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Schichten" })).toHaveCount(0);

    // 2. Case navigation displays first document in document_order (doc-beta, not alphabetical doc-alpha)
    await expect(page.getByText("Fall 1 von 2")).toBeVisible();
    await expect(page.locator(".case-navigation").getByRole("button", { name: "Vorheriger Fall" })).toBeDisabled();
    await expect(page.locator(".case-navigation").getByRole("button", { name: "Nächster Fall" })).toBeEnabled();

    // 3. Create annotation without any ontology/layer dialogs
    await page.getByRole("button", { name: /Spanlose Annotation/ }).click();
    await page.locator("#spanless-hpo-id").fill("HP:0001250");
    await page.getByRole("button", { name: "Annotation anlegen", exact: true }).click();
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);

    // 4. Single-layer check logic: submit blocked without checkmark
    await page.getByRole("button", { name: /Fall abschließen/ }).click();
    await expect(page.getByText("Bitte bestätigen Sie zuerst, dass der Fall vollständig durchgesehen wurde.")).toBeVisible();

    // 5. Checking the single checkbox allows submission
    await page.getByLabel("Dokument vollständig geprüft").click();
    await expect(page.getByLabel("Dokument vollständig geprüft")).toBeChecked();
    await page.getByRole("button", { name: /Fall abschließen/ }).click();
    await expect(page.getByText(/Erfolgreich abgegeben|Abgabe erfolgreich|Fall erfolgreich/i).first()).toBeVisible();

    // Dismiss submission modal to return to workspace
    await page.getByRole("button", { name: "Im Fall bleiben" }).click();

    // 6. Navigate to next case in document order
    await page.locator(".case-navigation").getByRole("button", { name: "Nächster Fall" }).click();
    await expect(page.getByText("Fall 2 von 2")).toBeVisible();
    await expect(page.locator(".case-navigation").getByRole("button", { name: "Nächster Fall" })).toBeDisabled();
    await expect(page.locator(".case-navigation").getByRole("button", { name: "Vorheriger Fall" })).toBeEnabled();
  });

  test("Scenario B: Assisted mode with reference layer (cannot activate reference, visibility toggle)", async ({ page }) => {
    await importScenario(page, "assisted", "user-scenario-b");
    await page.locator("#mode-select").selectOption("assisted");
    await page.getByRole("button", { name: /Arbeitsbereich öffnen/ }).click();

    // 1. Layer controls visible because package has 2 layers
    await expect(page.locator(".layer-controls")).toBeVisible();
    await expect(page.getByText("Schichten & Ontologien")).toBeVisible();

    // 2. Reference layer has badge and radio button is disabled
    const refLayer = page.locator(".layer-item").filter({ hasText: "Reference Diseases" });
    await expect(refLayer).toBeVisible();
    await expect(refLayer.getByText("Referenz")).toBeVisible();
    const refRadio = refLayer.locator('input[type="radio"]');
    await expect(refRadio).toBeDisabled();

    // 3. Target layer is active
    const targetLayer = page.locator(".layer-item").filter({ hasText: "Target Phenotypes" });
    await expect(targetLayer).toBeVisible();
    const targetRadio = targetLayer.locator('input[type="radio"]');
    await expect(targetRadio).toBeChecked();

    // 4. Toggle visibility of reference layer
    const refVisibility = refLayer.locator('input[type="checkbox"]');
    await expect(refVisibility).toBeChecked();
    // Toggle off
    await refVisibility.uncheck();
    await expect(refVisibility).not.toBeChecked();
    // Toggle back on
    await refVisibility.check();
    await expect(refVisibility).toBeChecked();

    // 5. Annotate independently in target layer
    await page.getByRole("button", { name: /Spanlose Annotation/ }).click();
    await page.locator("#spanless-hpo-id").fill("HP:0001252");
    await page.getByRole("button", { name: "Annotation anlegen", exact: true }).click();
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
  });

  test("Scenario C: Multi-editable layers require both layers checked before completion", async ({ page }) => {
    await importScenario(page, "multi_editable", "user-scenario-c");
    await page.locator("#mode-select").selectOption("independent");
    await page.getByRole("button", { name: /Arbeitsbereich öffnen/ }).click();

    // 1. Both layers are visible in layer controls
    await expect(page.locator(".layer-controls")).toBeVisible();
    const layer1 = page.locator(".layer-item").filter({ hasText: "Editable Layer 1" });
    const layer2 = page.locator(".layer-item").filter({ hasText: "Editable Layer 2" });
    await expect(layer1).toBeVisible();
    await expect(layer2).toBeVisible();

    // 2. Try submitting without checking either layer
    await page.getByRole("button", { name: /Fall abschließen/ }).click();
    await expect(page.getByText(/Bitte markieren Sie alle editierbaren Schichten als geprüft/)).toBeVisible();

    // 3. Check layer 1 only
    const checkAction = page.locator(".layer-controls").getByRole("button", { name: /als geprüft markieren/ });
    await checkAction.click();

    // Try submitting again -> still blocked
    await page.getByRole("button", { name: /Fall abschließen/ }).click();
    await expect(page.getByText(/Bitte markieren Sie alle editierbaren Schichten als geprüft/)).toBeVisible();

    // 4. Switch to layer 2 and check it
    await layer2.locator('input[type="radio"]').check();
    await checkAction.click();

    // 5. Now both layers are checked -> submit succeeds
    await page.getByRole("button", { name: /Fall abschließen/ }).click();
    await expect(page.getByText(/Erfolgreich abgegeben|Abgabe erfolgreich|Fall erfolgreich/i).first()).toBeVisible();
  });
});
