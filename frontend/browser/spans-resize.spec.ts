import { expect, test, type Locator, type Page } from "@playwright/test";
import { importPackage, mentionWithOffsets, openCase, selectText } from "./helpers";

const importFixture = (page: Page, annotator: string) => importPackage(page, "", "browser-fixture-spans-resize", annotator);
const revision = (page: Page) => page.locator(".status-badge");

/** Viewport point just inside the left (or right) edge of the character at `offset` (UTF-16) of the document text. */
async function pointAtOffset(page: Page, offset: number, side: "left" | "right" = "left"): Promise<{ x: number; y: number }> {
  return page.locator(".text-container").evaluate((container, target) => {
    for (const run of Array.from(container.querySelectorAll<HTMLElement>(".run"))) {
      const start = Number(run.dataset.start);
      const node = run.firstChild;
      const length = node?.textContent?.length ?? 0;
      if (node && start <= target.offset && target.offset < start + length) {
        const range = document.createRange();
        range.setStart(node, target.offset - start);
        range.setEnd(node, target.offset - start + 1);
        const rect = range.getBoundingClientRect();
        return { x: target.side === "left" ? rect.left + 1 : rect.right - 1, y: rect.top + rect.height / 2 };
      }
    }
    throw new Error(`no character at offset ${target.offset}`);
  }, { offset, side });
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
  await openCase(page, { task: "annotate" });
  await selectText(page, 0, 9);
  await page.getByLabel("Search term", { exact: true }).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  await expect(mentionWithOffsets(page, "[0:9]")).toBeVisible();
}

/** Resolves with the payload of the next ``create_annotation`` command the page posts. */
const nextCreate = (page: Page) => page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/commands")
  && (request.postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === "create_annotation")
  .then(request => (request.postDataJSON() as { payload: { segments: Array<{ start: number; end: number }> } }).payload);

/** Commands posted from now on (none may be sent before a term is chosen). */
function recordCommands(page: Page) {
  const commands: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith("/commands")) commands.push(String((request.postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command));
  });
  return commands;
}

test.describe("adjusting a pending mark", () => {
  test("pending mark: drag the end handle, choose a term, saved segments equal the adjusted span", async ({ page }) => {
    await importFixture(page, "pending-drag");
    await openCase(page, { task: "annotate" });
    const commands = recordCommands(page);
    await selectText(page, 0, 9);
    const end = page.getByRole("separator", { name: "End of marked text" });
    // Handles are empty inline boxes (Playwright calls them hidden): check they exist.
    await expect(end).toHaveCount(1);
    await expect(page.getByRole("separator", { name: "Start of marked text" })).toHaveCount(1);
    await dragHandle(page, end, 17);
    await expect(page.locator(".pending-quote")).toHaveText("“Hypotonia and sei”");
    // The search follows the span while the user has not typed.
    await expect(page.getByLabel("Search term", { exact: true })).toHaveValue("Hypotonia and sei");
    expect(commands).toEqual([]);
    await expect(page.getByLabel("New finding")).toBeVisible();

    await page.getByLabel("Search term", { exact: true }).fill("Hypotonia");
    const created = nextCreate(page);
    await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
    expect((await created).segments).toEqual([{ start: 0, end: 17 }]);
    await expect(mentionWithOffsets(page, "[0:17]")).toBeVisible();
  });

  test("pending mark: the end handle drags onto the next line under the mark bar", async ({ page }) => {
    await importFixture(page, "pending-under-bar");
    await openCase(page, { task: "annotate" });
    await selectText(page, 0, 9);
    const bar = page.locator(".pending-mark-bar");
    await expect(bar).toBeVisible();
    // "B" (offset 30) starts the next line, right under the bar.
    const target = await pointAtOffset(page, 30, "right");
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".pending-mark-bar"), target)).toBe(true);
    const end = page.getByRole("separator", { name: "End of marked text" });
    const box = (await end.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(bar).toHaveCSS("pointer-events", "none");
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".pending-quote")).toHaveText(/B”$/);
    await expect(bar).toHaveCSS("pointer-events", "auto");
  });

  test("pending mark: keyboard Tab to the handle, → twice, Enter in the search", async ({ page }) => {
    await importFixture(page, "pending-keys");
    await openCase(page, { task: "annotate" });
    const commands = recordCommands(page);
    await selectText(page, 0, 9);
    await expect(page.getByLabel("Search term", { exact: true })).toBeFocused();
    await page.locator(".text-container").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("separator", { name: "Start of marked text" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("separator", { name: "End of marked text" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".pending-quote")).toHaveText("“Hypotonia an”");
    expect(commands).toEqual([]);
    // "/" reports the waiting step and goes to the search, which follows the span.
    await page.keyboard.press("/");
    const search = page.getByLabel("Search term", { exact: true });
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("Hypotonia an");
    await search.fill("Hypotonia");
    await expect(page.locator('[role="option"][aria-selected="true"]')).toContainText("HP:0001252");
    const created = nextCreate(page);
    await page.keyboard.press("Enter");
    expect((await created).segments).toEqual([{ start: 0, end: 12 }]);
  });
});

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
    await expect(page.getByLabel("New finding")).toHaveCount(0);
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
    await expect(page.getByLabel("New finding")).toBeVisible();
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
  });

  test("review: resizing an adopted copy marks the proposal as replaced", async ({ page }) => {
    await importFixture(page, "resize-review");
    await openCase(page, { task: "review" });
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
    await page.getByRole("button", { name: "Add segment", exact: true }).click();
    await expect(page.locator(".pane-intent")).toBeVisible();
    expect(await top()).toBe(before);
    await page.locator(".pane-intent").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".pane-intent")).toHaveCount(0);
    await page.getByRole("button", { name: "Add mention", exact: true }).click();
    await expect(page.locator(".attach-mention-banner")).toBeVisible();
    expect(await top()).toBe(before);
  });

  test("two handles on nearly the same spot: lower half grabs the end, upper half the start", async ({ page }) => {
    await createHypotonia(page, "resize-crowded");
    await page.getByRole("button", { name: "Add segment", exact: true }).click();
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
