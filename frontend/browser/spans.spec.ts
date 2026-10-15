import { expect, test, type Locator, type Page } from "@playwright/test";
import { importPackage, mentionWithOffsets, openCase, selectText } from "./helpers";

const importFixture = (page: Page, annotator: string) => importPackage(page, "", "browser-fixture", annotator);

/** The six mark fills of the design tokens, as computed `rgb(...)` strings. */
const markFills = (page: Page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return [0, 1, 2, 3, 4, 5].map((n) => {
      const hex = root.getPropertyValue(`--mark-${n}-fill`).trim();
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return `rgb(${r}, ${g}, ${b})`;
    });
  });

/** The palette fill a mark is painted with: marks are a highlighter gradient, so the fill is in background-image. */
const paintedFill = async (fills: string[], run: Locator) => {
  const image = await run.evaluate((el) => window.getComputedStyle(el).backgroundImage);
  return fills.find((fill) => image.includes(fill)) ?? image;
};

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

    // The mark is coloured from the palette: one of the six --mark-N-fill tokens.
    const fills = await markFills(page);
    expect(fills).toHaveLength(6);
    expect(fills).toContain(await paintedFill(fills, hypRun));

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

    expect(fills).toContain(await paintedFill(fills, seizureRun));
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

    // The selected mark keeps its palette fill (the selection is a frame, not a colour).
    const allFills = await markFills(page);
    expect(allFills).toContain(await paintedFill(allFills, markedSpan));

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
