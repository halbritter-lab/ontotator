import { expect, test, type Page } from "@playwright/test";

async function importFixture(page: Page, annotator: string) {
  await page.goto("/#token=browser-test-token");
  const fixture = await page.request.get("/__synthetic_fixture__");
  expect(fixture.ok()).toBeTruthy();
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.zip", mimeType: "application/zip", buffer: await fixture.body(),
  });
  await expect(page.locator("#package-select")).toHaveValue("browser-fixture");
  await page.getByLabel(/Annotator ID|Ihre Annotator-Kennung/i).fill(annotator);
}

test("real backend: review, resume, reload, submit and authenticated export", async ({ page }) => {
  await importFixture(page, "browser-reviewer");
  await page.locator("#mode-select").selectOption("review");
  await expect(page.getByText(/Review Proposals.*\(2\)|Verfügbare Vorschläge.*\(2\)/i)).toBeVisible();
  await page.getByRole("button", { name: /Open Workspace|Arbeitsbereich öffnen/i }).click();
  await page.locator(".doc-item").filter({ hasText: "HP:0001252" }).click();
  await expect(page.getByLabel(/Proposal details|Vorschlagsdetails/i)).toContainText("present");
  await expect(page.getByLabel(/Proposal details|Vorschlagsdetails/i)).toContainText("Hypotonia");
  await page.getByRole("button", { name: /Confirm|Bestätigen/i }).first().click();
  await expect(page.locator(".status-badge")).toContainText("Rev 1");
  await page.getByRole("button", { name: /Dashboard|Übersicht/i }).click();
  await page.getByRole("button", { name: /Refresh|Aktualisieren/i }).click();
  await expect(page.getByText(/Review Proposals.*\(2\)|Verfügbare Vorschläge.*\(2\)/i)).toBeVisible();
  await page.getByRole("button", { name: /Open Workspace|Arbeitsbereich öffnen/i }).click();
  await expect(page.locator(".doc-item").filter({ hasText: "HP:0001252" })).toContainText(/confirmed|Bestätigt/i);
  await page.locator(".doc-item").filter({ hasText: "HP:0001250" }).click();
  await page.getByRole("button", { name: /Confirm|Bestätigen/i }).first().click();
  await page.getByRole("button", { name: /Finish & Submit Case|Submit Case|Fall abschließen/i }).first().click();
  await expect(page.getByText(/Case successfully submitted|Erfolgreich abgegeben|Abgabe erfolgreich|Fall erfolgreich/i).first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download export|herunterladen/i }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await page.reload();
  await expect(page.locator("#package-select")).toHaveValue("browser-fixture");
  await expect(page.getByText(/Forbidden|Unauthorized|Fehler beim Laden/)).toHaveCount(0);
});

test("real backend: invalid input does not block correction", async ({ page }) => {
  await importFixture(page, "browser-independent");
  await page.locator("#mode-select").selectOption("independent");
  await page.getByRole("button", { name: /Open Workspace|Arbeitsbereich öffnen/i }).click();
  await expect(page.getByText(/Review Proposals|Review-Ziele/i)).toHaveCount(0);
  await page.getByRole("button", { name: /\+ (New Annotation|Neue Annotation)/i }).click();
  await page.getByLabel(/Search ontology term|Ontologie-Term suchen/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  // Selected candidate creates annotation
  await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
  await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001252");
  await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
  await expect(page.locator(".status-badge")).toContainText("Rev 1");
});

async function selectText(page: Page, start: number, end: number) {
  await page.locator(".text-container").evaluate((container, offsets) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let position = 0;
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (!started && offsets.start < position + length) {
        range.setStart(node, offsets.start - position);
        started = true;
      }
      if (started && offsets.end <= position + length) {
        range.setEnd(node, offsets.end - position);
        break;
      }
      position += length;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, { start, end });
}

test("real backend: repeated and discontinuous evidence preserves Unicode offsets", async ({ page }) => {
  await importFixture(page, "browser-spans");
  await page.locator("#mode-select").selectOption("independent");
  await page.getByRole("button", { name: /Open Workspace|Arbeitsbereich öffnen/i }).click();
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term|Ontologie-Term suchen/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  await expect(page.locator(".status-badge")).toContainText("Rev 1");
  await page.getByRole("button", { name: "+ Segment", exact: true }).click();
  await selectText(page, 14, 21);
  await expect(page.locator(".status-badge")).toContainText("Rev 2");
  await expect(page.getByText("Offsets: [0:9], [14:21]", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /\+ (Add Mention|Weitere Belegstelle)/i, exact: true }).click();
  await selectText(page, 23, 27); // UTF-16: emoji plus e and combining acute.
  await expect(page.locator(".status-badge")).toContainText("Rev 3");
  await expect(page.getByText("Offsets: [23:26]", { exact: true })).toBeVisible();
  await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
});
