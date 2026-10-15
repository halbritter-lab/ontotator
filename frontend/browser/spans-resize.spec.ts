import { expect, test, type Locator, type Page } from "@playwright/test";
import { importPackage, mentionWithOffsets, openCase, selectText } from "./helpers";

const importFixture = (page: Page, annotator: string) => importPackage(page, "", "browser-fixture", annotator);
const revision = (page: Page) => page.locator(".status-badge");

/** Viewport point just inside the left edge of the character at `offset` (UTF-16) of the document text. */
async function pointAtOffset(page: Page, offset: number): Promise<{ x: number; y: number }> {
  return page.locator(".text-container").evaluate((container, target) => {
    for (const run of Array.from(container.querySelectorAll<HTMLElement>(".run"))) {
      const start = Number(run.dataset.start);
      const node = run.firstChild;
      const length = node?.textContent?.length ?? 0;
      if (node && start <= target && target < start + length) {
        const range = document.createRange();
        range.setStart(node, target - start);
        range.setEnd(node, target - start + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 1, y: rect.top + rect.height / 2 };
      }
    }
    throw new Error(`no character at offset ${target}`);
  }, offset);
}

async function dragHandle(page: Page, handle: Locator, toOffset: number, release = true) {
  const box = (await handle.boundingBox())!;
  const target = await pointAtOffset(page, toOffset);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  if (release) await page.mouse.up();
}

/** Create an annotation "Hypotonia" on 0..9 in an independent case; it stays selected. */
async function createHypotonia(page: Page, annotator: string) {
  await importFixture(page, annotator);
  await page.locator("#mode-select").selectOption("independent");
  await openCase(page);
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  await expect(mentionWithOffsets(page, "[0:9]")).toBeVisible();
}

test.describe("resizing mention spans", () => {
  test("dragging the end handle extends the mention and saves once", async ({ page }) => {
    await createHypotonia(page, "resize-drag");
    const handles = page.locator(".text-container .resize-handle");
    await expect(handles).toHaveCount(2);

    // Drop inside "seizure" after "sei": offset 17.
    await dragHandle(page, page.locator(".resize-handle--end"), 17);
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    await expect(mentionWithOffsets(page, "[0:17]")).toHaveText("“Hypotonia and sei”");
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia and sei");

    // Dragging the start handle inwards shortens it: start at "t" of "Hypotonia" (offset 4).
    await dragHandle(page, page.locator(".resize-handle--start"), 4);
    await expect(revision(page)).toHaveAttribute("title", "Revision 3");
    await expect(mentionWithOffsets(page, "[4:17]")).toBeVisible();

    // Dragging did not start a new annotation.
    await expect(page.getByLabel("New Annotation")).toHaveCount(0);
    await expect(page.locator(".sidebar [data-list-key^='annotation:']")).toHaveCount(1);
  });

  test("Escape during a drag restores the span and saves nothing", async ({ page }) => {
    await createHypotonia(page, "resize-escape");
    await dragHandle(page, page.locator(".resize-handle--end"), 17, false);
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia and sei");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia");
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
    await expect(mentionWithOffsets(page, "[0:9]")).toBeVisible();
    // Escape cancelled the drag only; the annotation is still selected.
    await expect(page.locator(".text-container .resize-handle")).toHaveCount(2);
  });

  test("keyboard: arrow keys move the focused edge and save after a pause", async ({ page }) => {
    await createHypotonia(page, "resize-keys");
    await page.locator(".resize-handle--end").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(mentionWithOffsets(page, "[0:7]")).toBeVisible();
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    // Saving redraws the text; the edge keeps the focus, so the next key press still moves it.
    await expect(page.locator(".resize-handle--end")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(mentionWithOffsets(page, "[0:6]")).toBeVisible();
    await expect(revision(page)).toHaveAttribute("title", "Revision 3");
  });

  test("selecting text still works next to a mention with handles", async ({ page }) => {
    await createHypotonia(page, "resize-select");
    await selectText(page, 14, 21);
    await expect(page.getByLabel("New Annotation")).toBeVisible();
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  });

  test("review: resizing an adopted copy marks the proposal as replaced", async ({ page }) => {
    await importFixture(page, "resize-review");
    await page.locator("#mode-select").selectOption("review");
    await openCase(page);
    await page.locator(".doc-item").filter({ hasText: "HP:0001250" }).click();
    // A proposal has no handles ...
    await expect(page.locator(".text-container .resize-handle")).toHaveCount(0);
    // ... its adopted copy has.
    await page.getByRole("button", { name: /Edit & Replace/i }).click();
    await expect(page.locator(".text-container .resize-handle")).toHaveCount(2);
    await dragHandle(page, page.locator(".resize-handle--start"), 10); // include "and "
    await expect(mentionWithOffsets(page, "[10:21]")).toBeVisible();
    await expect(page.locator("[data-list-key^='target:']").filter({ hasText: "HP:0001250" })).toContainText("Replaced");
  });

  test("the empty part of the pane does not pull the edge to the end of the text", async ({ page }) => {
    await createHypotonia(page, "resize-blank");
    await dragHandle(page, page.locator(".resize-handle--end"), 17, false);
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia and sei");
    const pane = (await page.locator(".text-container").boundingBox())!;
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height - 20, { steps: 6 });
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia and sei");
    await page.mouse.up();
    await expect(mentionWithOffsets(page, "[0:17]")).toBeVisible();
  });

  test("Escape takes back an unsaved keyboard step and keeps the annotation selected", async ({ page }) => {
    await createHypotonia(page, "resize-key-escape");
    await page.locator(".resize-handle--end").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotoni");
    await page.keyboard.press("Escape");
    await expect(page.locator(".text-container .run--marked")).toHaveText("Hypotonia");
    await expect(page.locator(".text-container .resize-handle")).toHaveCount(2);
    await page.waitForTimeout(700);
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  });

  test("the text stays put when a segment or a mention is being added", async ({ page }) => {
    await createHypotonia(page, "resize-still");
    const top = () => page.locator(".text-container .run").first().evaluate((el) => el.getBoundingClientRect().top);
    const before = await top();
    await page.getByRole("button", { name: "+ Segment", exact: true }).click();
    expect(await top()).toBe(before);
    await page.getByRole("button", { name: /Switch to/ }).click();
    await page.getByRole("button", { name: /Add Mention/ }).click();
    await expect(page.locator(".attach-mention-banner")).toBeVisible();
    expect(await top()).toBe(before);
  });

  test("two handles on nearly the same spot: lower half grabs the end, upper half the start", async ({ page }) => {
    await createHypotonia(page, "resize-crowded");
    await page.getByRole("button", { name: "+ Segment", exact: true }).click();
    await selectText(page, 10, 13); // "and", one space after "Hypotonia"
    await expect(mentionWithOffsets(page, "[0:9], [10:13]")).toBeVisible();
    const handles = page.locator(".text-container .resize-handle");
    await expect(handles).toHaveCount(4);
    const grab = async (index: number, part: number, toOffset: number) => {
      const box = (await handles.nth(index).boundingBox())!;
      const target = await pointAtOffset(page, toOffset);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * part);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 8 });
      await page.mouse.up();
    };
    // Both bars are a few pixels apart; pointing at either in its own half moves that edge.
    await grab(1, 0.85, 5); // end of "Hypotonia"
    await expect(mentionWithOffsets(page, "[0:5], [10:13]")).toBeVisible();
    await grab(2, 0.15, 12); // start of "and"
    await expect(mentionWithOffsets(page, "[0:5], [12:13]")).toBeVisible();
  });
});
