/**
 * Documents overview accessibility (plan O10c Step 3; spec "Accessibility", "Narrow"):
 * keyboard-only use of tabs, filter popover, row checkbox ranges, the final-result panel and
 * the "Handle text change…" dialog; reflow at 390 and 320 CSS px without horizontal scrolling
 * (cards and sheets); forced colours keep the stage symbols and the decision edge; axe on
 * table, popover, panel and dialogs. Every test builds its own scenario projects.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  axeViolations, documentsTab, documentsTabs, evidence, expectStage, horizontalOverflow, openDocuments, rowAction, rowCell, rowPanel, textRow,
} from "./documentsOverviewHelpers";
import { loginOverviewUser, overviewScenario, type OverviewScenario, type OverviewScenarioName } from "./overviewHelpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 900 } });

async function leadOn(page: Page, name: OverviewScenarioName): Promise<OverviewScenario> {
  const s = await overviewScenario(page, name);
  await page.context().clearCookies();
  await loginOverviewUser(page, s, "lead");
  await openDocuments(page, s.project);
  return s;
}

/** Press Tab until ``target`` has focus (at most ``limit`` presses). */
async function tabTo(page: Page, target: Locator, limit = 60): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

const filterButton = (page: Page) => page.getByRole("button", { name: /^Filter(, \d+ active)?$/ });
const filterPopover = (page: Page) => page.getByRole("dialog", { name: "Filter", exact: true });

test("keyboard-only: tabs, filter popover, row checkbox range, panel accept, Handle text change… dialog", async ({ page }) => {
  // Tabs, popover and range on scenario 4 (two translations needing a decision).
  const s4 = await leadOn(page, "S4");
  const tabs = documentsTabs(page);
  await tabTo(page, tabs.getByRole("tab", { selected: true }));
  await expect(tabs.getByRole("tab", { selected: true })).toHaveAccessibleName(/^All, \d+$/);
  await page.keyboard.press("Home");
  await expect(documentsTab(page, "Needs your decision")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(documentsTab(page, "To assign")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(documentsTab(page, "Needs your decision")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/segment=decision/);

  await tabTo(page, filterButton(page));
  await page.keyboard.press("Enter");
  const popover = filterPopover(page);
  await expect(popover).toBeVisible();
  await expect(filterButton(page)).toHaveAttribute("aria-expanded", "true");
  const first = popover.getByRole("checkbox").first();
  await expect(first).toBeFocused();
  await page.keyboard.press("Space");
  await expect(first).toBeChecked();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(filterButton(page)).toBeFocused();
  await expect(filterButton(page)).toHaveAccessibleName("Filter, 1 active");
  await evidence(page, "a11y-keyboard-filter");
  // "Clear all" by keyboard.
  await tabTo(page, page.getByRole("button", { name: "Clear all", exact: true }));
  await page.keyboard.press("Enter");
  await expect(filterButton(page)).toHaveAccessibleName("Filter");

  const de = page.getByRole("checkbox", { name: "Select case-104 · de", exact: true });
  const fr = page.getByRole("checkbox", { name: "Select case-104 · fr", exact: true });
  await tabTo(page, de, 80);
  await page.keyboard.press("Space");
  await expect(de).toBeChecked();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(fr).toBeFocused();
  await expect(fr).toBeChecked();
  await expect(de).toBeChecked();
  void s4;

  // Row panel accept on scenario 7a (one submission: "Accept as final…").
  await leadOn(page, "S7a");
  const accept = rowAction(page, "Accept as final…", "case-107", "de");
  await tabTo(page, accept, 80);
  await page.keyboard.press("Enter");
  const panel = rowPanel(page, "case-107", "de");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { level: 2 })).toBeFocused();
  const acceptFinal = panel.getByRole("button", { name: "Accept as final", exact: true });
  await tabTo(page, acceptFinal);
  await page.keyboard.press("Enter");
  await expect(panel.getByText("No more final results to decide.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expectStage(rowCell(textRow(page, "case-107", "de"), "final"), { line1: "✓ Final" });
  await expect(page.locator(":focus")).toHaveCount(1);

  // Handle text change… on scenario 12: open, Escape returns focus, reopen, arrow to "Let … finish on v1", Apply.
  await leadOn(page, "S12");
  const handle = rowAction(page, "Handle text change…", "case-112", "de");
  await tabTo(page, handle, 80);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Handle text change · case-112 · de", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(handle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const move = dialog.getByRole("radio", { name: /^Move to v2/ });
  await expect(move).toBeChecked();
  await tabTo(page, move);
  await page.keyboard.press("ArrowDown");
  const finish = dialog.getByRole("radio", { name: /^Let .* finish on v1/ });
  await expect(finish).toBeFocused();
  await expect(finish).toBeChecked();
  await evidence(page, "a11y-keyboard-text-change");
  await tabTo(page, dialog.getByRole("button", { name: "Apply", exact: true }));
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expectStage(rowCell(textRow(page, "case-112", "de"), "annotation"), { line1: "◐ Finishing on v1" });
});

const documentsTable = (page: Page) => page.getByRole("table", { name: "Documents", exact: true });

/** At ``width`` px on scenario 12: cards, filter sheet and dialog sheet without horizontal scrolling. */
async function reflowCardsAndSheets(page: Page, width: number, s12: OverviewScenario): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await openDocuments(page, s12.project);
  const card = page.getByRole("article", { name: "case-112 · de", exact: true });
  await expect(card).toBeVisible();
  await expect(documentsTable(page)).toHaveCount(0);
  await expect(card).toContainText("Annotation: ⚠ In progress on old text");
  await expect(card).toContainText("Waiting on: You");
  expect(await horizontalOverflow(page), `${width} px cards`).toBeLessThanOrEqual(0);
  await evidence(page, `reflow-${width}-cards`);

  await filterButton(page).click();
  await expect(filterPopover(page)).toBeVisible();
  expect(await horizontalOverflow(page), `${width} px filter sheet`).toBeLessThanOrEqual(0);
  expect(await filterPopover(page).evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
  await evidence(page, `reflow-${width}-filter`);
  await page.keyboard.press("Escape");
  await expect(filterPopover(page)).toBeHidden();

  const handle = rowAction(page, "Handle text change…", "case-112", "de");
  const box = await handle.boundingBox();
  expect(box?.height ?? 0, "full-width card action ≥ 32 px").toBeGreaterThanOrEqual(32);
  await handle.click();
  const dialog = page.getByRole("dialog", { name: "Handle text change · case-112 · de", exact: true });
  await expect(dialog).toBeVisible();
  expect(await horizontalOverflow(page), `${width} px dialog sheet`).toBeLessThanOrEqual(0);
  expect(await dialog.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
  await evidence(page, `reflow-${width}-dialog`);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

/** At ``width`` px on scenario 7a: the row panel as a full-screen sheet. */
async function reflowPanel(page: Page, width: number, s7a: OverviewScenario): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await openDocuments(page, s7a.project);
  await rowAction(page, "Accept as final…", "case-107", "de").click();
  const panel = rowPanel(page, "case-107", "de");
  await expect(panel).toBeVisible();
  expect(await horizontalOverflow(page), `${width} px panel sheet`).toBeLessThanOrEqual(0);
  // After the 150 ms slide the sheet fits the viewport.
  await expect.poll(() => panel.evaluate(element => Math.round(element.getBoundingClientRect().right)), { message: `${width} px panel right edge`, timeout: 5_000 }).toBeLessThanOrEqual(width);
  await evidence(page, `reflow-${width}-panel`);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
}

test("390 px and 320 px reflow without horizontal scrolling (cards, sheets)", async ({ page }) => {
  const s12 = await overviewScenario(page, "S12");
  await loginOverviewUser(page, s12, "lead");
  for (const width of [390, 320]) await reflowCardsAndSheets(page, width, s12);
  const s7a = await overviewScenario(page, "S7a");
  await page.context().clearCookies();
  await loginOverviewUser(page, s7a, "lead");
  for (const width of [390, 320]) await reflowPanel(page, width, s7a);
});

test("forced colours keep symbols and the decision edge", async ({ page }) => {
  await leadOn(page, "S12");
  await page.emulateMedia({ forcedColors: "active" });
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  const row = textRow(page, "case-112", "de");
  await expect(row).toHaveClass(/data-table-row--decision/);
  const edge = await row.locator(":scope > td").first().evaluate(element => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.borderLeftWidth), style: style.borderLeftStyle };
  });
  expect(edge, "decision edge in forced colours").toEqual({ width: 3, style: "solid" });
  const symbols = (await row.locator(".stage-cell-symbol").evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { text: element.textContent ?? "", visible: style.visibility !== "hidden" && style.display !== "none" && rect.width > 0, colour: style.color };
  }))).filter(symbol => symbol.text !== "");
  // Review ✓ Accepted, Annotation ⚠ In progress on old text (Final "—" has no glyph).
  expect(symbols.map(symbol => symbol.text)).toEqual(["✓", "⚠"]);
  for (const symbol of symbols) {
    expect(symbol.visible, symbol.text).toBe(true);
    expect(symbol.colour, symbol.text).not.toBe("rgba(0, 0, 0, 0)");
  }
  await evidence(page, "forced-colours");
});

test("axe has no violations on table, popover, panel and dialogs", async ({ page }) => {
  const s12 = await leadOn(page, "S12");
  expect(await axeViolations(page, "main"), "table").toEqual([]);
  await filterButton(page).click();
  await expect(filterPopover(page)).toBeVisible();
  expect(await axeViolations(page, '[role="dialog"]'), "filter popover").toEqual([]);
  await page.keyboard.press("Escape");
  await rowAction(page, "Handle text change…", "case-112", "de").click();
  const handle = page.getByRole("dialog", { name: "Handle text change · case-112 · de", exact: true });
  await expect(handle).toBeVisible();
  await expect(handle.getByText("Checking…")).toHaveCount(0);
  expect(await axeViolations(page, '[role="dialog"]'), "Handle text change dialog").toEqual([]);
  await page.keyboard.press("Escape");
  void s12;

  await leadOn(page, "S13");
  await rowAction(page, "Carry to v2…", "case-113", "de").click();
  const carry = page.getByRole("dialog", { name: "Carry to v2 · case-113 · de", exact: true });
  await expect(carry).toBeVisible();
  expect(await axeViolations(page, '[role="dialog"]'), "Carry to v2 dialog").toEqual([]);
  await page.keyboard.press("Escape");

  await leadOn(page, "S7b");
  await rowAction(page, "Compare results…", "case-107", "en").click();
  const panel = rowPanel(page, "case-107", "en");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Loading submissions…")).toHaveCount(0);
  expect(await axeViolations(page, ".row-panel"), "row panel with the decision block (compare)").toEqual([]);
  await evidence(page, "axe-panel");
});
