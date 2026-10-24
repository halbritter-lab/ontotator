/**
 * Lead workflow accessibility in the browser (plan L10b; spec "Accessibility", "States" › Narrow).
 *
 * Every test builds a fresh ``ROWS`` project through ``POST /__test_lead_workflow__`` (L10a) and logs
 * in as its lead: 30 cases (en, de, fr) with mixed plans, under the All tab (groups never collapse, VD5).
 * Plan chips live in the text card's Text details (VD2, U3), so chip checks open the card first.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentsReady, documentsTab, rowBox, textCard, textName, textNamePattern, textRow } from "./documentsHelpers";
import { TEST_PASSWORD } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/lead-workflow/evidence");
async function evidence(page: Page, name: string, part?: Locator) {
  mkdirSync(evidenceDir(), { recursive: true });
  const path = resolve(evidenceDir(), `${name}.png`);
  if (part) await part.screenshot({ path }); else await page.screenshot({ path, fullPage: false });
}

/** Build ``ROWS`` and log in as its lead, who used the project last: the landing (F8) opens its Documents. */
async function openRows(page: Page): Promise<LeadScenario> {
  const s = await leadScenario(page, "ROWS");
  await page.goto("/");
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [`ontocurator.lastProject.v1:${s.users.lead}`, s.project]);
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username", { exact: true }).fill(s.users.lead);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(s.display_names.lead);
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await documentsReady(page);
  // The landing opens "Needs your decision" (VD7); these checks use every row (All).
  await documentsTab(page, "All").click();
  await expect(documentsTab(page, "All")).toHaveAttribute("aria-selected", "true");
  await expect(rowBox(page, "case-0101", "de")).toBeVisible();
  return s;
}

const bar = (page: Page) => page.getByRole("region", { name: "Selection", exact: true });
const toast = (page: Page) => page.locator(".ui-toast");
const live = (page: Page) => page.locator(".documents-page > p[role=\"status\"]");
/** The narrow case card's checkbox (cards keep their case header; the table has none). */
const caseBox = (page: Page, caseId: string) => page.getByRole("checkbox", { name: `Select ${caseId} (3 texts)`, exact: true });
const chip = (page: Page, flag: "Translation review" | "Annotate", caseId: string, language: string) =>
  page.getByRole("button", { name: textNamePattern(`${flag}, `, caseId, language) });
/** The selection bar's actions (U4). */
const BAR_ACTIONS = ["Assign…", "Translation review and annotation", "Annotation only, no translation review", "Plan…", "Clear selection"];
/** The bulk "Plan…" dialog "Work plan · 1 case" (separator per U9). */
const planDialog = (page: Page) => page.getByRole("dialog", { name: /^Work plan\W+1 case$/ });
/** The "Translation review" radio group of one language in the bulk plan dialog. */
const reviewSteps = (plan: Locator, language: string) =>
  plan.getByRole("region", { name: new RegExp(`^${language} In selection`) }).getByRole("group", { name: "Translation review", exact: true });
/** Any open text card (the modal dialog of the Documents page). */
const anyCard = (page: Page) => page.locator('.text-card[role="dialog"]');

async function axeViolations(page: Page, include: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

/** Close the open text card, if any. */
async function closeCards(page: Page) {
  if (await anyCard(page).count()) await anyCard(page).getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(anyCard(page)).toHaveCount(0);
}

/** Show the Plan line of a row: the text card's Text details (from the text name, or a narrow card's "Details" sheet). */
async function showPlanLine(page: Page, caseId: string, language: string) {
  const target = textCard(page, caseId, language);
  // One card at a time: the card is modal.
  if (!(await target.count())) await closeCards(page);
  if (!(await target.count())) {
    const card = page.getByRole("article", { name: textNamePattern("", caseId, language) });
    if (await card.count()) await card.getByRole("button", { name: textNamePattern("Details, ", caseId, language) }).click();
    else await textName(page, caseId, language).click();
  }
  await expect(target).toBeVisible();
  const details = target.getByRole("button", { name: "Details", exact: true });
  if (await details.count()) await details.click();
  await expect(target.getByRole("group", { name: "Plan", exact: true })).toBeVisible();
}

/** Toggle Translation review off on a review-only fr row (case-0111…0120): saves at once and shows the Undo toast. */
async function chipToast(page: Page, caseId = "case-0112") {
  await showPlanLine(page, caseId, "fr");
  await chip(page, "Translation review", caseId, "fr").click();
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(`fr of ${caseId}: Translation review off`);
}

/** Page width and every element (main, selection bar, dialog) that sticks out of the viewport. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    // The tab strip scrolls on its own (a horizontal scroller inside the page); its tabs may sit outside the
    // viewport while the page itself does not scroll. TODO(O9): revisit with the narrow tab layout.
    const outside = [...document.querySelectorAll("main *, [role=dialog] *")]
      .filter(element => !element.closest("[role=tablist]"))
      .filter(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.right > width + 0.5 || box.left < -0.5);
      })
      .slice(0, 10)
      .map(element => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)} ${Math.round(element.getBoundingClientRect().left)}..${Math.round(element.getBoundingClientRect().right)}`);
    return { scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, outside };
  });
}

function overlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("keyboard-only range selection", async ({ page }) => {
  await openRows(page);
  // From "Select by case IDs…", Tab passes the sortable headers (VD10) and reaches the first row checkbox (VD4);
  // the not-planned en source is no row (M1 flat list).
  await page.getByRole("button", { name: "Select by case IDs…", exact: true }).focus();
  const table = page.getByRole("table", { name: "Documents", exact: true });
  for (const header of ["Text", "Translation", "Annotation", "Finalization", "Waiting on", "Next step", "Last activity"]) {
    await page.keyboard.press("Tab");
    await expect(table.getByRole("columnheader", { name: header }).getByRole("button"), header).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(rowBox(page, "case-0101", "de")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(rowBox(page, "case-0101", "de")).toBeChecked();
  // Shift+ArrowDown moves to the next row in list order and selects it.
  for (let index = 0; index < 2; index += 1) await page.keyboard.press("Shift+ArrowDown");
  await expect(rowBox(page, "case-0102", "de")).toBeFocused();
  for (const [caseId, language] of [["case-0101", "de"], ["case-0101", "fr"], ["case-0102", "de"]]) {
    await expect(rowBox(page, caseId, language)).toBeChecked();
  }
  await expect(rowBox(page, "case-0102", "fr")).not.toBeChecked();
  await expect(bar(page).getByText("3 texts in 2 cases selected", { exact: true })).toBeVisible();
  await expect(live(page)).toHaveText("3 texts in 2 cases selected");
  // Shift+ArrowUp moves back and keeps the range.
  await page.keyboard.press("Shift+ArrowUp");
  await expect(rowBox(page, "case-0101", "fr")).toBeFocused();

  // "?" help lists the group "Selection".
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help.getByText("Selection", { exact: true })).toBeVisible();
  await expect(help.getByText("Move to the next or previous row and select it", { exact: true })).toBeVisible();
  await expect(help.getByText("Select or deselect the focused row", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

test("axe has no violations on Documents with selection bar, plan dialog, assign dialog, Progress", async ({ page }) => {
  const s = await openRows(page);
  await rowBox(page, "case-0101", "de").check();
  await rowBox(page, "case-0101", "fr").check();
  await expect(bar(page).getByText("2 texts in 1 case selected", { exact: true })).toBeVisible();
  expect(await axeViolations(page, "main"), "Documents with selection bar").toEqual([]);

  await bar(page).getByRole("button", { name: "Plan…", exact: true }).click();
  const plan = planDialog(page);
  await expect(reviewSteps(plan, "de").getByRole("radio", { name: "On", exact: true })).toBeVisible();
  expect(await axeViolations(page, "[role=dialog]"), "plan dialog").toEqual([]);
  await plan.getByRole("button", { name: "Cancel", exact: true }).click();

  await bar(page).getByRole("button", { name: "Assign…", exact: true }).click();
  const assign = page.getByRole("dialog", { name: /^Assign\W/ });
  await expect(assign.getByRole("table", { name: "Members" })).toBeVisible();
  await assign.getByRole("radio", { name: new RegExp(`^${esc(s.display_names.ana)}`) }).click();
  await expect(assign.getByRole("status", { name: "Summary" })).not.toBeEmpty();
  expect(await axeViolations(page, "[role=dialog]"), "assign dialog").toEqual([]);
  await assign.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/progress`);
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Translation review" }).first()).toBeVisible();
  expect(await axeViolations(page, "main"), "Progress").toEqual([]);
});

test("390 px cards and floating selection bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRows(page);
  // One article per text, inside case cards with the case checkbox in the card header.
  await expect(page.getByRole("table", { name: "Documents" })).toHaveCount(0);
  const card = page.getByRole("article", { name: textNamePattern("", "case-0101", "de") });
  await expect(card.getByRole("heading", { name: textNamePattern("", "case-0101", "de") })).toBeVisible();
  await expect(card.getByRole("checkbox", { name: textNamePattern("Select ", "case-0101", "de") })).toBeVisible();
  await expect(card.getByRole("button", { name: textNamePattern("Assign review…, ", "case-0101", "de") })).toBeVisible();
  await expect(caseBox(page, "case-0101")).toBeVisible();
  expect(await overflow(page)).toMatchObject({ scrollWidth: 390, outside: [] });

  await caseBox(page, "case-0106").check();
  await expect(bar(page).getByText("3 texts in 1 case selected", { exact: true })).toBeVisible();
  const box = (await bar(page).boundingBox())!;
  expect(await bar(page).evaluate(element => getComputedStyle(element).position)).toBe("fixed");
  // Floats at the bottom of the viewport.
  expect(box.y + box.height).toBeGreaterThan(844 - 40);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  for (const name of BAR_ACTIONS) {
    const button = (await bar(page).getByRole("button", { name, exact: true }).boundingBox())!;
    expect(button.x + button.width, name).toBeLessThanOrEqual(390);
  }
  await evidence(page, "390-selection-bar");

  // The Undo toast and the floating bar (reported, see evidence "390-toast-and-bar").
  await chipToast(page);
  const toastBox = (await toast(page).boundingBox())!;
  const barBox = (await bar(page).boundingBox())!;
  const covered: string[] = [];
  for (const name of BAR_ACTIONS) {
    if (overlap(toastBox, (await bar(page).getByRole("button", { name, exact: true }).boundingBox())!)) covered.push(name);
  }
  test.info().annotations.push({ type: "toast over selection bar", description: `${overlap(toastBox, barBox) ? "overlaps" : "clear"}; covered buttons: ${covered.join(", ") || "none"}` });
  await evidence(page, "390-toast-and-bar");
});

test("320 px reflow without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const s = await openRows(page);
  expect(await overflow(page), "Documents").toMatchObject({ scrollWidth: 320, bodyScrollWidth: 320, outside: [] });

  await caseBox(page, "case-0106").check();
  // The floating bar fits the 320 px viewport; scrolled to the end, the last card ends above the bar (reserved space).
  const barBox = (await bar(page).boundingBox())!;
  expect(barBox.x).toBeGreaterThanOrEqual(0);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(320);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(800);
  await page.evaluate(() => { for (const element of [document.scrollingElement, ...document.querySelectorAll(".shell, .shell-main")]) element?.scrollTo(0, 1e7); });
  const lastCard = page.locator(".documents-page article").last();
  const lastBox = (await lastCard.boundingBox())!;
  expect(lastBox.y + lastBox.height, "last card above the selection bar").toBeLessThanOrEqual((await bar(page).boundingBox())!.y);
  expect(await overflow(page), "selection bar").toMatchObject({ scrollWidth: 320, outside: [] });
  await chipToast(page);
  expect(await overflow(page), "selection bar and toast").toMatchObject({ scrollWidth: 320, outside: [] });
  await evidence(page, "320-documents-selection-toast");

  await showPlanLine(page, "case-0101", "de");
  const sheet = textCard(page, "case-0101", "de");
  expect(await overflow(page), "text card sheet").toMatchObject({ scrollWidth: 320, outside: [] });
  await evidence(page, "320-text-card-sheet", sheet);
  // "Details" opens the card without changing the selection: the plan covers case-0106 only.
  await closeCards(page);

  await bar(page).getByRole("button", { name: "Plan…", exact: true }).click();
  const plan = planDialog(page);
  await expect(reviewSteps(plan, "fr").getByRole("radio", { name: "On", exact: true })).toBeVisible();
  expect(await overflow(page), "plan dialog").toMatchObject({ scrollWidth: 320, outside: [] });
  await evidence(page, "320-plan-dialog");
  await plan.getByRole("button", { name: "Cancel", exact: true }).click();

  await bar(page).getByRole("button", { name: "Assign…", exact: true }).click();
  const assign = page.getByRole("dialog", { name: /^Assign\W/ });
  await expect(assign.getByRole("radio", { name: new RegExp(`^${esc(s.display_names.ana)}`) })).toBeVisible();
  expect(await overflow(page), "assign dialog").toMatchObject({ scrollWidth: 320, outside: [] });
  await evidence(page, "320-assign-dialog");
});

test("forced colours keep pressed chips and the decision edge visible", async ({ page }) => {
  await openRows(page);
  // Plan chips sit in the text card's Text details (VD2, U3).
  await showPlanLine(page, "case-0101", "de");
  await page.emulateMedia({ forcedColors: "active" });
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);

  // Pressed chips: a border in CanvasText and the check icon; unpressed chips have no icon.
  const chips = await page.locator(".text-card-plan button[aria-pressed]").evaluateAll(elements => {
    const probe = document.createElement("span");
    probe.style.color = "CanvasText";
    document.body.append(probe);
    const canvasText = getComputedStyle(probe).color;
    probe.remove();
    return elements.slice(0, 12).map(element => {
      const style = getComputedStyle(element);
      return {
        name: element.getAttribute("aria-label"), pressed: element.getAttribute("aria-pressed"),
        width: parseFloat(style.borderTopWidth), style: style.borderTopStyle, colour: style.borderTopColor, canvasText,
        icon: element.querySelector("svg") !== null,
      };
    });
  });
  const pressed = chips.filter(item => item.pressed === "true");
  expect(pressed.length).toBeGreaterThan(0);
  for (const item of pressed) {
    expect(item.width, item.name ?? "").toBeGreaterThan(0);
    expect(item.style, item.name ?? "").not.toBe("none");
    expect(item.colour, item.name ?? "").toBe(item.canvasText);
    expect(item.icon, item.name ?? "").toBe(true);
  }

  // The stage blocks are gone (V1); the decision edge marks the rows that need the lead: a CanvasText left border.
  const edge = async (caseId: string, language: string) => textRow(page, caseId, language).locator("> :first-child").evaluate(element => {
    const probe = document.createElement("span");
    probe.style.color = "CanvasText";
    document.body.append(probe);
    const canvasText = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    return { width: parseFloat(style.borderLeftWidth), style: style.borderLeftStyle, colour: style.borderLeftColor, canvasText };
  });
  const decision = await edge("case-0102", "de");
  const other = await edge("case-0101", "de");
  expect(decision.width).toBeGreaterThan(other.width);
  expect(decision.style).toBe("solid");
  expect(decision.colour).toBe(decision.canvasText);
  await evidence(page, "forced-colours-decision-edge", textRow(page, "case-0102", "de"));
});

test("targets are at least 24 × 24 px (chips, checkboxes) and card actions at least 32 px high", async ({ page }) => {
  await openRows(page);
  const sizes = async (selector: string) => page.locator(selector).evaluateAll(elements => elements
    .filter(element => element.getBoundingClientRect().width > 0)
    .map(element => {
      const box = element.getBoundingClientRect();
      const label = (element as HTMLInputElement).labels?.[0]?.textContent ?? "";
      return { name: element.getAttribute("aria-label") ?? (label || element.textContent || ""), width: box.width, height: box.height };
    }));
  // Plan chips sit in the text card's Text details (VD2, U3): measure six rows' chips, one card at a time.
  const chips: Awaited<ReturnType<typeof sizes>> = [];
  for (const caseId of ["case-0101", "case-0106", "case-0107"]) for (const language of ["de", "fr"]) {
    await showPlanLine(page, caseId, language);
    chips.push(...await sizes(".text-card-plan button[aria-pressed]"));
  }
  await closeCards(page);
  const boxes = await sizes("main input[type=checkbox]");
  expect(chips.length).toBeGreaterThan(10);
  expect(boxes.length).toBeGreaterThan(10);
  const small = [...chips, ...boxes].filter(item => item.width < 24 || item.height < 24).map(item => `${item.name} ${Math.round(item.width)}x${Math.round(item.height)}`);
  expect([...new Set(small.map(item => item.replace(/case-\d{4}/, "case-…")))]).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("article", { name: textNamePattern("", "case-0101", "de") })).toBeVisible();
  const actions = await page.locator("main article").evaluateAll(cards => cards.flatMap(card => [...card.querySelectorAll("button")]
    .filter(button => /…, case-\d{4}\W+[a-z]{2}$/.test(button.getAttribute("aria-label") ?? "") && !button.hasAttribute("aria-pressed"))
    .map(button => ({ name: button.getAttribute("aria-label")!, height: button.getBoundingClientRect().height, width: button.getBoundingClientRect().width, card: card.getBoundingClientRect().width }))));
  expect(actions.length).toBeGreaterThan(5);
  for (const action of actions) {
    expect(action.height, action.name).toBeGreaterThanOrEqual(32);
    // Full width of the card (minus its padding).
    expect(action.width, action.name).toBeGreaterThan(action.card * 0.8);
  }
  const narrowChips = await sizes("main button[aria-pressed]");
  for (const item of narrowChips) expect(item.height, item.name).toBeGreaterThanOrEqual(24);
});

test("reduced motion shows the toast without animation", async ({ page }) => {
  await openRows(page);
  await chipToast(page, "case-0113");
  expect(await toast(page).evaluate(element => getComputedStyle(element).animationName)).not.toBe("none");
  await toast(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(chip(page, "Translation review", "case-0113", "fr")).toHaveAttribute("aria-pressed", "true");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await chipToast(page, "case-0114");
  const style = await toast(page).evaluate(element => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration }));
  expect(style.name === "none" || style.duration === "0s", JSON.stringify(style)).toBe(true);
  // The toast never takes focus.
  expect(await toast(page).evaluate(element => element.contains(document.activeElement))).toBe(false);
});
