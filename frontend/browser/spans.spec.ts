import { expect, test, type Page } from "@playwright/test";

async function importFixture(page: Page, annotator: string) {
  await page.goto("/#token=browser-test-token");
  const fixture = await page.request.get("/__synthetic_fixture__");
  expect(fixture.ok()).toBeTruthy();
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.zip",
    mimeType: "application/zip",
    buffer: await fixture.body(),
  });
  await expect(page.locator("#package-select")).toHaveValue("browser-fixture");
  await page.getByLabel("Ihre Annotator-Kennung").fill(annotator);
}

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

test.describe("Evidence Spans Proof & Verification", () => {
  test("review mode: proposal evidence spans are precisely marked with DOM metadata and visual highlights", async ({ page }) => {
    await importFixture(page, "reviewer-spans-proof");
    await page.locator("#mode-select").selectOption("review");
    await expect(page.getByText("Verfügbare Vorschläge zur Prüfung (2)")).toBeVisible();
    await page.getByRole("button", { name: /Arbeitsbereich öffnen/ }).click();

    // 1. Verify that first proposal (HP:0001252 Hypotonia, span [0:9]) is active
    await expect(page.getByLabel("Vorschlagsdetails")).toContainText("Hypotonia");

    // The text "Hypotonia" must be wrapped in a .run.run--marked element
    const hypRun = page.locator('.text-container .run--marked').filter({ hasText: "Hypotonia" });
    await expect(hypRun).toBeVisible();
    await expect(hypRun).toHaveText("Hypotonia");

    // Verify DOM metadata: data-start is 0, data-mentions contains ev-0
    const hypStart = await hypRun.getAttribute("data-start");
    expect(hypStart).toBe("0");
    const hypMentions = await hypRun.getAttribute("data-mentions");
    expect(hypMentions).toContain("ev-0");

    // Verify visual highlight CSS: background-color is var(--span-highlight) (#fef08a -> rgb(254, 240, 138))
    const hypBgColor = await hypRun.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(hypBgColor).toBe("rgb(254, 240, 138)");

    // 2. Switch to second proposal (HP:0001250 Seizure, span [14:21])
    await page.locator(".doc-item").filter({ hasText: "HP:0001250" }).click();
    await expect(page.getByLabel("Vorschlagsdetails")).toContainText(/seizure/i);

    const seizureRun = page.locator('.text-container .run--marked').filter({ hasText: "seizure" });
    await expect(seizureRun).toBeVisible();
    await expect(seizureRun).toHaveText("seizure");

    const seizureStart = await seizureRun.getAttribute("data-start");
    expect(seizureStart).toBe("14");
    const seizureMentions = await seizureRun.getAttribute("data-mentions");
    expect(seizureMentions).toContain("ev-1");

    const seizureBgColor = await seizureRun.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(seizureBgColor).toBe("rgb(254, 240, 138)");
  });

  test("independent mode: selecting text creates marked evidence spans with active highlight and handles picking", async ({ page }) => {
    await importFixture(page, "curator-spans-proof");
    await page.getByRole("button", { name: /Arbeitsbereich öffnen/ }).click();

    // Text is "Hypotonia and seizure. A😀é\r\nB"
    // Select "Hypotonia" (offsets 0 to 9)
    await selectText(page, 0, 9);
    await expect(page.locator(".status-badge")).toContainText("Rev 0");
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(0);
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(page.locator(".text-container .run--marked")).toHaveCount(0);
    await selectText(page, 0, 9);
    await page.getByLabel("Ontologie-Term suchen").fill("Hypotonia");
    await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
    await expect(page.locator(".status-badge")).toContainText("Rev 1");

    // The span must now be marked
    const markedSpan = page.locator('.text-container .run--marked').filter({ hasText: "Hypotonia" });
    await expect(markedSpan).toBeVisible();
    await expect(markedSpan).toHaveText("Hypotonia");

    // Since this span was just created/selected, it should have .run--hot
    await expect(markedSpan).toHaveClass(/run--hot/);

    // Verify active selection color: var(--span-selected) (#bae6fd -> rgb(186, 230, 253))
    const selectedBgColor = await markedSpan.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(selectedBgColor).toBe("rgb(186, 230, 253)");

    // Verify evidence offsets are displayed in sidebar
    await expect(page.getByText("Offsets: [0:9]")).toBeVisible();

    // Extend mention: switch intent to discontinuous segment
    await page.getByRole("button", { name: "+ Segment", exact: true }).click();
    await selectText(page, 14, 21); // "seizure"
    await expect(page.locator(".status-badge")).toContainText("Rev 2");
    await expect(page.getByText("Offsets: [0:9], [14:21]")).toBeVisible();

    // Now both "Hypotonia" and "seizure" are marked as evidence segments of the same mention
    const allMarked = page.locator('.text-container .run--marked');
    await expect(allMarked).toHaveCount(2);
    expect(await allMarked.nth(0).textContent()).toBe("Hypotonia");
    expect(await allMarked.nth(1).textContent()).toBe("seizure");
  });
});
