import { expect, test, type Page } from "@playwright/test";
import { importPackage, mentionWithOffsets, openCase, selectText } from "./helpers";

const importFixture = (page: Page, annotator: string) => importPackage(page, "", "browser-fixture", annotator);

test.describe("Evidence Spans Proof & Verification", () => {
  test("review mode: proposal evidence spans are precisely marked with DOM metadata and visual highlights", async ({ page }) => {
    await importFixture(page, "reviewer-spans-proof");
    await page.locator("#mode-select").selectOption("review");
    await openCase(page);
    await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (2)" })).toBeVisible();

    // 1. Select and verify that first proposal (HP:0001252 Hypotonia, span [0:9]) is active
    await page.locator(".doc-item").filter({ hasText: "HP:0001252" }).click();
    await expect(page.getByLabel(/Proposal details|Vorschlagsdetails/i)).toContainText("Hypotonia");

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
    expect(hypBgColor).toMatch(/rgb\(251, 207, 232\)|rgb\(254, 240, 138\)/);

    // 2. Switch to second proposal (HP:0001250 Seizure, span [14:21])
    await page.locator(".doc-item").filter({ hasText: "HP:0001250" }).click();
    await expect(page.getByLabel(/Proposal details|Vorschlagsdetails/i)).toContainText(/seizure/i);

    const seizureRun = page.locator('.text-container .run--marked').filter({ hasText: "seizure" });
    await expect(seizureRun).toBeVisible();
    await expect(seizureRun).toHaveText("seizure");

    const seizureStart = await seizureRun.getAttribute("data-start");
    expect(seizureStart).toBe("14");
    const seizureMentions = await seizureRun.getAttribute("data-mentions");
    expect(seizureMentions).toContain("ev-1");

    const seizureBgColor = await seizureRun.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(seizureBgColor).toMatch(/rgb\(254, 240, 138\)|rgb\(187, 247, 208\)|rgb\(254, 215, 170\)|rgb\(233, 213, 255\)|rgb\(251, 207, 232\)|rgb\(191, 219, 254\)/);
  });

  test("independent mode: selecting text creates marked evidence spans with active highlight and handles picking", async ({ page }) => {
    await importFixture(page, "curator-spans-proof");
    await page.locator("#mode-select").selectOption("independent");
    await openCase(page);

    // Text is "Hypotonia and seizure. A😀é\r\nB"
    // Select "Hypotonia" (offsets 0 to 9)
    await selectText(page, 0, 9);
    await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 0");
    await expect(page.locator(".sidebar .doc-item")).toHaveCount(0);
    await page.getByRole("button", { name: /Cancel|Abbrechen/i, exact: true }).click();
    await expect(page.locator(".text-container .run--marked")).toHaveCount(0);
    await selectText(page, 0, 9);
    await page.getByLabel(/Search ontology term|Ontologie-Term suchen/i).fill("Hypotonia");
    await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
    await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");

    // The span must now be marked
    const markedSpan = page.locator('.text-container .run--marked').filter({ hasText: "Hypotonia" });
    await expect(markedSpan).toBeVisible();
    await expect(markedSpan).toHaveText("Hypotonia");

    // Since this span was just created/selected, it should have .run--hot
    await expect(markedSpan).toHaveClass(/run--hot/);

    // Verify active selection color: var(--span-selected) (#bae6fd -> rgb(186, 230, 253))
    const selectedBgColor = await markedSpan.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(["rgb(186, 230, 253)", "rgb(251, 207, 232)"]).toContain(selectedBgColor);

    // The mention shows the quoted text; its exact offsets are in the tooltip
    await expect(mentionWithOffsets(page, "[0:9]")).toHaveText("“Hypotonia”");

    // Extend mention: switch intent to discontinuous segment
    await page.getByRole("button", { name: "+ Segment", exact: true }).click();
    await selectText(page, 14, 21); // "seizure"
    await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 2");
    await expect(mentionWithOffsets(page, "[0:9], [14:21]")).toHaveText("“Hypotonia … seizure”");

    // Now both "Hypotonia" and "seizure" are marked as evidence segments of the same mention
    const allMarked = page.locator('.text-container .run--marked');
    await expect(allMarked).toHaveCount(2);
    expect(await allMarked.nth(0).textContent()).toBe("Hypotonia");
    expect(await allMarked.nth(1).textContent()).toBe("seizure");
  });
});
