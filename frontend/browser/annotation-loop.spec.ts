/**
 * Annotation term loop in a real browser (review-and-annotation plan V2; spec "Acceptance" 8–9,
 * B.2, B.3, B.5, B.7, B.9): mark → Enter → Enter, the keys / V D, the no-move rule for the text,
 * coalesced arrow-key value changes, narrow widths and accessibility.
 *
 * Every test builds a fresh ``ANNOTATION_LOOP`` project (V0, ``POST /__test_review_flow__``): rule
 * off, creation defaults Present / Patient / Current for hpo phenotype, German HPO names loaded, and
 * three native texts (``loop-en``, ``loop-de``, ``loop-fr``) whose annotate tasks the annotator owns.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { loginScenarioUser, reviewFlowScenario, type AnnotationLoopCase, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { selectText } from "./helpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const WIDE = { width: 1440, height: 900 };
const BELOW = { width: 1024, height: 700 };
const NARROW = { width: 390, height: 844 };

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/review-annotation/evidence");
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `annotation-loop-${name}.png`), fullPage: false });
}

const textPane = (page: Page) => page.locator(".text-container");
const search = (page: Page) => page.locator("#search-input");
const hits = (page: Page) => page.getByRole("listbox", { name: "Terms", exact: true });
const activeHit = (page: Page) => hits(page).locator('[role="option"][aria-selected="true"]');
const confirmDefaults = (page: Page) => page.locator("[data-confirm-defaults]");
const newFinding = (page: Page) => page.getByRole("region", { name: "New finding", exact: true });
const termHeading = (page: Page) => page.locator(".inspector-pane h2.term-heading");
const announcer = (page: Page) => page.locator("[data-carried-announcer]");

/** Fresh ANNOTATION_LOOP project, the annotator logged in at ``size``. */
async function startLoop(page: Page, size = WIDE): Promise<ReviewFlowScenario> {
  await page.setViewportSize(size);
  const s = await reviewFlowScenario(page, "ANNOTATION_LOOP");
  await loginScenarioUser(page, s, "annotator");
  return s;
}

/** Open the annotate task of ``name`` by its address and wait for the text and fonts. */
async function openLoop(page: Page, s: ReviewFlowScenario, name: AnnotationLoopCase) {
  await page.goto(`/#/tasks/${s.assignments[name]}`);
  await expect(textPane(page)).toHaveText(s.texts[name]);
  await page.evaluate(() => document.fonts.ready);
}

/** UTF-16 offsets of ``word`` in the case text. */
function offsetsOf(s: ReviewFlowScenario, name: AnnotationLoopCase, word: string): [number, number] {
  const start = s.texts[name].indexOf(word);
  expect(start, `"${word}" in ${name}`).toBeGreaterThanOrEqual(0);
  return [start, start + word.length];
}

/** Viewport box of the text between two offsets (the mark once it exists) and the pane's scroll offset. */
async function textGeometry(page: Page, start: number, end: number) {
  return textPane(page).evaluate((container, offsets) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let position = 0;
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (!started && offsets.start < position + length) { range.setStart(node, offsets.start - position); started = true; }
      if (started && offsets.end <= position + length) { range.setEnd(node, offsets.end - position); break; }
      position += length;
    }
    const box = range.getBoundingClientRect();
    const pane = container.getBoundingClientRect();
    return {
      // Relative to the text pane and absolute in the viewport.
      inPane: { x: Math.round(box.x - pane.x), y: Math.round(box.y - pane.y) },
      viewport: { x: Math.round(box.x), y: Math.round(box.y) },
      paneTop: Math.round(pane.y),
      scrollTop: container.scrollTop,
    };
  }, { start, end });
}

/** Offset of the collapsed caret in the text pane, or null when the selection is elsewhere. */
async function caretOffset(page: Page): Promise<number | null> {
  return textPane(page).evaluate(container => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || !selection.isCollapsed || !container.contains(selection.anchorNode)) return null;
    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    return range.toString().length;
  });
}

/** Axes that show an unconfirmed default: "(default)" on the checked radio or the selected option (long lists). */
const defaultedAxes = (page: Page) => page.locator(".values-section [data-axis-field]").evaluateAll(fields => fields
  .filter(field => !!field.querySelector(".axis-option.is-default")
    || (field.querySelector("select")?.getAttribute("aria-label") ?? "").endsWith("(default)"))
  .map(field => (field as HTMLElement).dataset.axisField));

const focusIsTextPane =(page: Page) => page.evaluate(() => document.activeElement?.classList.contains("text-container") ?? false);

/** The editor commands the page posts, in order (``payload.command`` plus the payload). */
function recordCommands(page: Page) {
  const commands: Array<{ command: string; payload: Record<string, unknown>; at: number }> = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/commands")) return;
    const payload = (request.postDataJSON() as { payload?: Record<string, unknown> } | null)?.payload;
    if (payload?.command) commands.push({ command: String(payload.command), payload, at: Date.now() });
  });
  return {
    all: commands,
    of: (command: string) => commands.filter(entry => entry.command === command),
  };
}

const commandResponse = (page: Page, command: string) => page.waitForResponse(response =>
  response.url().endsWith("/commands") && response.request().method() === "POST"
  && (response.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === command);

/** Mark ``word`` (action 1) and wait for the prefilled search with its first hit. */
async function markAndWaitForHits(page: Page, s: ReviewFlowScenario, name: AnnotationLoopCase, word: string) {
  const [start, end] = offsetsOf(s, name, word);
  await selectText(page, start, end);
  await expect(search(page)).toBeFocused();
  await expect(activeHit(page)).toBeVisible();
  return [start, end] as const;
}

/** Mark ``word``, Enter (top hit), Enter (Confirm defaults): one finding with confirmed values. */
async function addConfirmedFinding(page: Page, s: ReviewFlowScenario, name: AnnotationLoopCase, word: string, term: string) {
  await markAndWaitForHits(page, s, name, word);
  await expect(activeHit(page)).toContainText(term);
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toBeFocused();
  const confirmed = commandResponse(page, "set_axes");
  await page.keyboard.press("Enter");
  expect((await confirmed).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toHaveCount(0);
}

test("three actions per finding with right top hit and defaults", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  const commands = recordCommands(page);
  const [start, end] = offsetsOf(s, "loop-en", "seizure");
  const before = await textGeometry(page, start, end);

  // Action 1: mark. The search is focused, prefilled with the marked text, selected, and hits arrive without typing.
  await selectText(page, start, end);
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("seizure");
  expect(await search(page).evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 7]);
  await expect(newFinding(page).getByRole("heading", { name: "New finding", exact: true })).toBeVisible();
  await expect(newFinding(page).locator(".pending-quote")).toHaveText("“seizure”");
  await expect(activeHit(page)).toContainText("Seizure");
  await expect(activeHit(page)).toContainText("HP:0001250");
  await expect(search(page)).toHaveAttribute("aria-expanded", "true");
  await expect(search(page)).toHaveAttribute("aria-activedescendant", (await activeHit(page).getAttribute("id"))!);
  await expect(newFinding(page).locator(".search-hint")).toContainText(/\d+ terms?\W.*choose\W.*add\W.*cancel/);
  expect(await textGeometry(page, start, end)).toEqual(before);
  await evidence(page, "1-marked");

  // Action 2: Enter adds the active hit; focus goes to "Confirm defaults (3)".
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(termHeading(page)).toContainText("Seizure");
  await expect(confirmDefaults(page)).toBeFocused();
  await expect(confirmDefaults(page)).toHaveText(/^Confirm defaults \(3\)/);
  await expect(announcer(page)).toHaveText("Seizure added. Values from defaults: Present, Patient, Current. Confirm defaults or change a value.");
  await expect.poll(() => defaultedAxes(page)).toEqual(["assertion", "experiencer", "temporality"]);
  expect(await textGeometry(page, start, end)).toEqual(before);
  await evidence(page, "2-term-added");

  // Action 3: Enter confirms all three defaults in one set_axes; focus returns to the text after the mark.
  const confirmed = commandResponse(page, "set_axes");
  await page.keyboard.press("Enter");
  expect((await confirmed).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toHaveCount(0);
  await expect.poll(() => focusIsTextPane(page)).toBe(true);
  expect(await caretOffset(page)).toBe(end);
  await expect(announcer(page)).toHaveText("Confirmed: Assertion Present, Experiencer Patient, Temporality Current.");
  await expect.poll(() => defaultedAxes(page)).toEqual([]);
  expect(await textGeometry(page, start, end)).toEqual(before);
  await evidence(page, "3-confirmed");

  // B.9: three actions, two mutations (create, one set_axes for all three axes).
  await page.waitForTimeout(500);
  expect(commands.of("create_annotation")).toHaveLength(1);
  const axes = commands.of("set_axes");
  expect(axes).toHaveLength(1);
  expect([...(axes[0].payload.chosen_axis_ids as string[])].sort()).toEqual(["assertion", "experiencer", "temporality"]);
});

test("D confirms from the text and V plus arrows changes one value", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  const commands = recordCommands(page);
  const [start, end] = offsetsOf(s, "loop-en", "hypotonia");
  const before = await textGeometry(page, start, end);

  // Keystrokes: mark (1), Enter (2), V (3), → (4), D (5).
  await markAndWaitForHits(page, s, "loop-en", "hypotonia");
  await expect(activeHit(page)).toContainText("Hypotonia");
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toBeFocused();
  await expect(confirmDefaults(page)).toHaveText(/^Confirm defaults \(3\)/);

  await page.keyboard.press("v");
  const assertion = page.locator('[data-axis-field="assertion"]');
  const firstDefault = assertion.locator('input[type="radio"]:checked');
  await expect(firstDefault).toBeFocused();
  await expect(firstDefault).toHaveValue("present");

  // Two quick arrow presses on the same axis are coalesced into one set_axes 300 ms after the last.
  const pressedAt = Date.now();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const chosen = await assertion.locator('input[type="radio"]:checked').inputValue();
  expect(chosen).not.toBe("present");
  await page.waitForTimeout(150);
  expect(commands.of("set_axes"), "nothing is sent before the 300 ms pause").toHaveLength(0);
  await expect.poll(() => commands.of("set_axes").length).toBe(1);
  const change = commands.of("set_axes")[0];
  expect(change.at - pressedAt).toBeGreaterThanOrEqual(280);
  expect(change.payload.chosen_axis_ids).toEqual(["assertion"]);
  expect((change.payload.axes_values as Record<string, string>).assertion).toBe(chosen);
  await expect(confirmDefaults(page)).toHaveText(/^Confirm defaults \(2\)/);
  await expect(assertion.locator('input[type="radio"]:checked')).toHaveValue(chosen);
  await expect(assertion.locator(".axis-option.is-default")).toHaveCount(0);

  // D from the text: focus is in the text pane with the finding still selected.
  await textPane(page).focus();
  await expect(termHeading(page)).toContainText("Hypotonia");
  const confirmed = commandResponse(page, "set_axes");
  await page.keyboard.press("d");
  expect((await confirmed).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  const axes = commands.of("set_axes");
  expect(axes).toHaveLength(2);
  expect([...(axes[1].payload.chosen_axis_ids as string[])].sort()).toEqual(["experiencer", "temporality"]);
  expect((axes[1].payload.axes_values as Record<string, string>).assertion).toBe(chosen);
  await expect(page.locator('[data-axis-field="assertion"] input[type="radio"]:checked')).toHaveValue(chosen);
  await expect.poll(() => focusIsTextPane(page)).toBe(true);
  expect(await textGeometry(page, start, end)).toEqual(before);
  await evidence(page, "4-value-changed-and-confirmed");

  // The change survives a reload.
  await page.reload();
  await expect(textPane(page)).toHaveText(s.texts["loop-en"]);
  await page.locator(".sidebar-section .doc-item").filter({ hasText: "Hypotonia" }).first().click();
  await expect(page.locator('[data-axis-field="assertion"] input[type="radio"]:checked')).toHaveValue(chosen);
});

test("Enter before results arrive adds the current hit once they do, never a stale one (#31)", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  const commands = recordCommands(page);
  await page.route(url => new URL(url).pathname === "/api/v1/search", async route => {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000));
    await route.continue().catch(() => undefined);
  });

  // Enter while the prefilled search runs, then a new query: the queued Enter is dropped, nothing stale is added.
  const [start, end] = offsetsOf(s, "loop-en", "seizure");
  await selectText(page, start, end);
  await expect(search(page)).toBeFocused();
  await expect(newFinding(page).getByRole("status")).toHaveText("Searching…");
  await page.keyboard.press("Enter");
  await page.keyboard.type("hypotonia");
  await expect(activeHit(page)).toContainText("Hypotonia", { timeout: 10_000 });
  await page.waitForTimeout(300);
  expect(commands.of("create_annotation")).toHaveLength(0);

  // Enter before the new query's hits arrive: its top hit is added when they do.
  await page.keyboard.press("Backspace");
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(termHeading(page)).toContainText("Hypotoni");
  expect(commands.of("create_annotation")).toHaveLength(1);
});

test("German text prefills with German names; French text explains the missing languages", async ({ page }) => {
  const s = await startLoop(page);
  // Marked at once: if the search languages are still loading, the prefill follows when they arrive.
  await openLoop(page, s, "loop-de");
  await markAndWaitForHits(page, s, "loop-de", "Krampfanfall");
  await expect(search(page)).toHaveValue("Krampfanfall");
  await expect(activeHit(page)).toContainText("Seizure");
  await expect(activeHit(page).locator(".candidate-match")).toHaveText("Matched German name “Krampfanfall”");
  await evidence(page, "5-german-prefill");

  await openLoop(page, s, "loop-fr");
  const [start, end] = offsetsOf(s, "loop-fr", "crise");
  await selectText(page, start, end);
  await expect(search(page)).toBeFocused();
  // U6: always prefilled; the hint says French is not searched.
  await expect(search(page)).toHaveValue("crise");
  await expect(newFinding(page).locator(".search-hint")).toContainText("Names are searched in English. Type an English name or a code.");
  await evidence(page, "6-french-prefill-hint");
});

test("/ and Esc", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  const [start, end] = offsetsOf(s, "loop-en", "seizure");
  await selectText(page, start, end);
  await expect(search(page)).toBeFocused();

  // / brings the focus back to the search of the new finding.
  await textPane(page).focus();
  await page.keyboard.press("/");
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("seizure");

  // Esc cancels the new finding; the caret is in the text at the selection end.
  await page.keyboard.press("Escape");
  await expect(newFinding(page)).toHaveCount(0);
  await expect.poll(() => focusIsTextPane(page)).toBe(true);
  expect(await caretOffset(page)).toBe(end);

  // With an own finding selected, / opens Change term; Esc closes it and focuses "Change term".
  await addConfirmedFinding(page, s, "loop-en", "seizure", "Seizure");
  await expect.poll(() => focusIsTextPane(page)).toBe(true);
  await page.keyboard.press("/");
  await expect(search(page)).toBeFocused();
  await expect(page.getByRole("button", { name: /^Close search/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Change term/ })).toBeFocused();
  await expect(termHeading(page)).toContainText("Seizure");
});

test("Esc from the text discards the marked text", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  const [, end] = await markAndWaitForHits(page, s, "loop-en", "seizure");
  await textPane(page).focus();
  await page.keyboard.press("Escape");
  await expect(newFinding(page)).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Marked text", exact: true })).toHaveCount(0);
  await expect(announcer(page)).toHaveText("Marked text discarded.");
  await expect.poll(() => focusIsTextPane(page)).toBe(true);
  expect(await caretOffset(page)).toBe(end);
  await expect(textPane(page).locator(".resize-handle")).toHaveCount(0);
});

test("Shift+Tab from the search field reaches the inspector Discard", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  await markAndWaitForHits(page, s, "loop-en", "seizure");
  const discard = newFinding(page).getByRole("button", { name: "Discard", exact: true });
  await expect(discard).toBeVisible();
  // Count the focusable elements between the heading's Discard and the search field: Shift+Tab walks them back.
  const between = await page.evaluate(() => {
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]"))
      .filter(element => element.tabIndex >= 0 && !(element as HTMLButtonElement).disabled && element.getClientRects().length > 0);
    const region = document.querySelector('section[aria-label="New finding"]')!;
    const from = focusable.findIndex(element => region.contains(element) && element.textContent?.startsWith("Discard"));
    const to = focusable.indexOf(document.querySelector<HTMLElement>("#search-input")!);
    return to - from;
  });
  expect(between).toBeGreaterThan(0);
  const order: string[] = [];
  for (let step = 0; step < between; step += 1) {
    await page.keyboard.press("Shift+Tab");
    order.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      return `${element.tagName.toLowerCase()}:${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30) ?? ""}`;
    }));
  }
  await expect(discard, `Shift+Tab order: ${order.join(" | ")}`).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(newFinding(page)).toHaveCount(0);
  await expect(announcer(page)).toHaveText("Marked text discarded.");
});

test("the Marked text bar never moves the text", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  const [start, end] = offsetsOf(s, "loop-en", "seizure");
  const before = await textGeometry(page, 0, 3);
  await markAndWaitForHits(page, s, "loop-en", "seizure");
  const bar = page.getByRole("group", { name: "Marked text", exact: true });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Drag the edges to adjust");
  expect(await textGeometry(page, 0, 3)).toEqual(before);
  // The bar sits under (or, near the pane bottom, above) the mark and never covers it.
  const mark = await textGeometry(page, start, end);
  const box = (await bar.boundingBox())!;
  const markLine = await textPane(page).evaluate((container, offsets) => {
    const run = Array.from(container.querySelectorAll<HTMLElement>(".run[data-mentions]"))
      .find(element => Number(element.dataset.start) <= offsets.start && offsets.start < Number(element.dataset.start) + (element.textContent?.length ?? 0))!;
    const rect = run.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }, { start, end });
  expect(box.y >= markLine.bottom - 1 || box.y + box.height <= markLine.top + 1, "bar overlaps the mark").toBe(true);
  expect(mark.viewport.y).toBeGreaterThan(0);
  mkdirSync(resolve(test.info().config.rootDir, "../../build/annotator-ui/evidence"), { recursive: true });
  await page.screenshot({ path: resolve(test.info().config.rootDir, "../../build/annotator-ui/evidence/pending-mark-bar.png") });
  await bar.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(newFinding(page)).toHaveCount(0);
  expect(await textGeometry(page, 0, 3)).toEqual(before);
});

test("keys never fire in text fields", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  const commands = recordCommands(page);

  // In the term search the keys are typed text.
  await markAndWaitForHits(page, s, "loop-en", "seizure");
  await page.keyboard.type("dv/c");
  await expect(search(page)).toHaveValue("dv/c");
  await expect(search(page)).toBeFocused();
  await search(page).fill("seizure");
  await expect(activeHit(page)).toContainText("Seizure");
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toBeFocused();

  // In the note: no confirmation, no focus jump.
  const note = page.getByRole("textbox", { name: "Note", exact: true });
  await note.click();
  await page.keyboard.type("d v / c n");
  await expect(note).toHaveValue("d v / c n");
  await expect(note).toBeFocused();
  await page.waitForTimeout(500);
  expect(commands.of("set_axes")).toHaveLength(0);
  await expect(confirmDefaults(page)).toHaveText(/^Confirm defaults \(3\)/);
});

test("? help lists group Finding with /, V and D", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  await markAndWaitForHits(page, s, "loop-en", "seizure");
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toBeFocused();

  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  const group = help.locator(".shortcut-help-group").filter({ has: page.getByRole("heading", { name: "Finding", exact: true }) });
  await expect(group).toHaveCount(1);
  await expect(group.locator(".shortcut-help-row").filter({ hasText: "Focus the term search" }).locator("kbd")).toHaveText("/");
  await expect(group.locator(".shortcut-help-row").filter({ hasText: "Focus the values" }).locator("kbd")).toHaveText(/^v$/i);
  await expect(group.locator(".shortcut-help-row").filter({ hasText: "Confirm all default values" }).locator("kbd")).toHaveText(/^d$/i);
  await evidence(page, "7-help");
});

test("1024 px: the inspector below the text scrolls into view without moving the text pane", async ({ page }) => {
  const s = await startLoop(page, BELOW);
  await openLoop(page, s, "loop-en");
  const [start, end] = offsetsOf(s, "loop-en", "seizure");
  const before = await textGeometry(page, start, end);
  await selectText(page, start, end);
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("seizure");
  await expect(search(page)).toBeInViewport();
  const after = await textGeometry(page, start, end);
  // The text pane's own scroll offset and the mark's place inside it never change.
  expect(after.scrollTop).toBe(before.scrollTop);
  expect(after.inPane).toEqual(before.inPane);
  await evidence(page, "8-1024-marked");
});

test("390 px: the New finding bar, Choose term, Back to text", async ({ page }) => {
  const s = await startLoop(page, NARROW);
  await openLoop(page, s, "loop-en");
  const [start, end] = offsetsOf(s, "loop-en", "seizure");
  const before = await textGeometry(page, start, end);
  await selectText(page, start, end);

  // No automatic pane switch while marking: the bar leads to the term search.
  const bar = page.getByRole("group", { name: "New finding", exact: true });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("New finding “seizure”");
  await expect(textPane(page)).toBeVisible();
  expect(await textGeometry(page, start, end)).toEqual(before);
  await evidence(page, "9-390-bar");

  await bar.getByRole("button", { name: "Choose term", exact: true }).click();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("seizure");
  await expect(activeHit(page)).toContainText("Seizure");
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toBeFocused();
  const confirmed = commandResponse(page, "set_axes");
  await page.keyboard.press("Enter");
  expect((await confirmed).ok()).toBeTruthy();
  const back = page.getByRole("button", { name: "Back to text", exact: true });
  await expect(back).toBeFocused();
  await evidence(page, "10-390-back-to-text");

  await page.keyboard.press("Enter");
  await expect(textPane(page)).toBeVisible();
  await expect.poll(() => focusIsTextPane(page)).toBe(true);
  expect(await caretOffset(page)).toBe(end);
});

for (const [label, size] of [["1440", WIDE], ["1024", BELOW]] as const) {
  test(`marking modes never move the text at ${label} px: adding a mention and adding a segment`, async ({ page }) => {
    const s = await startLoop(page, size);
    await openLoop(page, s, "loop-en");
    const [start, end] = offsetsOf(s, "loop-en", "seizure");
    await addConfirmedFinding(page, s, "loop-en", "seizure", "Seizure");
    await textPane(page).scrollIntoViewIfNeeded();
    const before = await textGeometry(page, start, end);
    /** The marking line overlays the text sheet but never covers its first line. */
    const expectFirstLineClear = async (line: ReturnType<typeof page.locator>) => {
      const box = (await line.boundingBox())!;
      const firstLine = await textGeometry(page, 0, 3);
      expect(box.y + box.height).toBeLessThanOrEqual(firstLine.viewport.y + 1);
    };

    await page.getByRole("button", { name: "Add mention", exact: true }).click();
    const banner = page.locator(".attach-mention-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Adding a mention to Seizure. Mark the text. Esc cancels.");
    expect(await textGeometry(page, start, end), "Add mention mode moved the text").toEqual(before);
    await expectFirstLineClear(banner);
    await evidence(page, `11-add-mention-mode-${label}`);
    await page.keyboard.press("Escape");
    await expect(banner).toHaveCount(0);
    expect(await textGeometry(page, start, end)).toEqual(before);

    await page.getByRole("button", { name: "Add segment", exact: true }).click();
    const intent = page.locator(".pane-intent");
    await expect(intent).toBeVisible();
    await expect(intent).toContainText("Adding a segment to mention 1 of Seizure. Mark the text. Esc cancels.");
    expect(await textGeometry(page, start, end), "Add segment mode moved the text").toEqual(before);
    await expectFirstLineClear(intent);
    await evidence(page, `12-add-segment-mode-${label}`);
    await intent.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(intent).toHaveCount(0);
    expect(await textGeometry(page, start, end)).toEqual(before);
  });
}

/** The fixture HPO has eleven terms, too few for a long hit list: answer ``query`` with ten hits of mixed
 * label and definition length (the first one's definition is far longer than the five-line detail area). */
const LIST_QUERY = "abnormal";
const LONG_DEFINITION = "An abnormality of the nervous system that is described here at great length, ".repeat(8).trim();
async function routeTenHits(page: Page) {
  await page.route(url => new URL(url).pathname === "/api/v1/search", async route => {
    const body = route.request().postDataJSON() as { query?: string } | null;
    if (body?.query !== LIST_QUERY) return route.continue();
    const response = await route.fetch();
    const real = await response.json() as Record<string, unknown>;
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      term_id: `HP:99000${String(index).padStart(2, "0")}`,
      label: index % 3 === 1 ? `Abnormal finding ${index} with a long label that wraps onto a second line` : `Abnormal finding ${index}`,
      definition: index === 0 ? LONG_DEFINITION : index % 4 === 3 ? "" : `Definition ${index}. `.repeat(index * 3).trim(),
      matched_term: index % 2 ? `Abnormality ${index}` : `Abnormal finding ${index}`,
      match_kind: index % 2 ? "hasExactSynonym" : "label",
      rank: index + 1,
      display_pos: index + 1,
      obsolete: false,
    }));
    await route.fulfill({ response, json: { ...real, candidates, displayed_ids: candidates.map(c => c.term_id), ranked_ids: candidates.map(c => c.term_id) } });
  });
}

/** Tops of every hit row and of the search field relative to the list's top (↓ may scroll the active row
 * into view, which moves everything together), and the detail area's height. */
const listGeometry = (page: Page) => page.evaluate(() => {
  const list = document.querySelector('[role="listbox"][aria-label="Terms"]')!;
  const origin = list.getBoundingClientRect().top;
  return {
    field: document.querySelector("#search-input")!.getBoundingClientRect().top - origin,
    rows: Array.from(list.querySelectorAll('[role="option"]')).map(option => option.getBoundingClientRect().top - origin),
    detail: document.querySelector("[data-search-detail]")?.getBoundingClientRect().height ?? null,
  };
});

function expectSameGeometry(after: Awaited<ReturnType<typeof listGeometry>>, before: Awaited<ReturnType<typeof listGeometry>>) {
  expect(Math.abs(after.field - before.field)).toBeLessThanOrEqual(0.5);
  expect(after.rows).toHaveLength(before.rows.length);
  after.rows.forEach((top, index) => expect(Math.abs(top - before.rows[index]), `row ${index}`).toBeLessThanOrEqual(0.5));
  expect(after.detail).not.toBeNull();
  expect(Math.abs(after.detail! - before.detail!)).toBeLessThanOrEqual(0.5);
}

/** Search ``LIST_QUERY`` in the focused field, press ↓ five times and check that nothing moved. */
async function expectStableRowsOnArrowDown(page: Page) {
  // Keep the pointer off the list: hover moves the active hit too.
  await page.mouse.move(1, 1);
  await search(page).fill(LIST_QUERY);
  await expect(hits(page).getByRole("option")).toHaveCount(10);
  await expect(activeHit(page)).toContainText("Abnormal finding 0");
  await expect(page.locator("[data-search-detail]")).toContainText(LONG_DEFINITION);
  const before = await listGeometry(page);
  for (let step = 1; step <= 5; step += 1) {
    await page.keyboard.press("ArrowDown");
    await expect(activeHit(page)).toContainText(`Abnormal finding ${step}`);
    await expect(page.locator("[data-search-detail] .search-detail__label")).toHaveAttribute("data-text", new RegExp(`^Abnormal finding ${step}( |$)`));
    expectSameGeometry(await listGeometry(page), before);
  }
}

test("hit rows keep their positions while ↓ moves the active hit", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  await routeTenHits(page);
  await markAndWaitForHits(page, s, "loop-en", "seizure");
  await expectStableRowsOnArrowDown(page);
  await evidence(page, "15-stable-hit-rows");
});

test("narrow inspector keeps rows constant", async ({ page }) => {
  const s = await startLoop(page, { width: 360, height: 780 });
  await openLoop(page, s, "loop-en");
  await routeTenHits(page);
  const [start, end] = offsetsOf(s, "loop-en", "seizure");
  await selectText(page, start, end);
  await page.getByRole("group", { name: "New finding", exact: true }).getByRole("button", { name: "Choose term", exact: true }).click();
  await expect(search(page)).toBeFocused();
  const inspectorWidth = await page.locator(".inspector-pane").evaluate(element => element.getBoundingClientRect().width);
  expect(inspectorWidth).toBeLessThan(380);
  await expectStableRowsOnArrowDown(page);
  // Nothing overflows horizontally: the rows, the detail area and the inspector fit their width.
  const overflow = await page.locator(".inspector-pane").evaluate(pane => [pane, ...pane.querySelectorAll(".search-panel, .search-detail, .candidate-list, [role=option]")]
    .filter(element => element.scrollWidth > element.clientWidth + 1)
    .map(element => element.className || element.tagName));
  expect(overflow).toEqual([]);
  await evidence(page, "16-stable-hit-rows-360");
});

test("axe has no violations with the combobox open and the Values block", async ({ page }) => {
  const s = await startLoop(page);
  await openLoop(page, s, "loop-en");
  const violations = async () => {
    const results = await new AxeBuilder({ page }).include(".inspector-pane").analyze();
    return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
  };
  await routeTenHits(page);
  await markAndWaitForHits(page, s, "loop-en", "seizure");
  expect(await violations()).toEqual([]);
  // An active hit whose definition overflows the detail area: the area scrolls but is aria-hidden.
  await search(page).fill(LIST_QUERY);
  await expect(page.locator("[data-search-detail]")).toContainText(LONG_DEFINITION);
  const detailScrolls = await page.locator("[data-search-detail]").evaluate(element => element.scrollHeight > element.clientHeight);
  expect(detailScrolls).toBe(true);
  expect(await violations()).toEqual([]);
  await search(page).fill("seizure");
  await expect(activeHit(page)).toContainText("Seizure");
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(confirmDefaults(page)).toBeFocused();
  expect(await violations()).toEqual([]);
});

test("forced colours keep the active hit and the dashed default border", async ({ page }) => {
  const s = await startLoop(page);
  await page.emulateMedia({ forcedColors: "active" });
  await openLoop(page, s, "loop-en");
  await markAndWaitForHits(page, s, "loop-en", "seizure");
  const outline = await activeHit(page).evaluate(element => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
  await evidence(page, "13-forced-colours-hit");
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  const defaults = page.locator(".values-section .axis-option.is-default");
  await expect.poll(() => defaultedAxes(page)).toEqual(["assertion", "experiencer", "temporality"]);
  await expect(defaults).toHaveCount(2);
  for (const style of await defaults.evaluateAll(elements => elements.map(element => getComputedStyle(element).outlineStyle))) {
    expect(style).toBe("dashed");
  }
  await expect(defaults.first()).toContainText("(default)");
  await evidence(page, "14-forced-colours-defaults");
});
