/**
 * Values block in a real browser (editor axes spec Part 1, plan WP X1): segmented control per axis,
 * the measured fit rule (row → stacked → boxes), keys, focus ring, forced colours and axe.
 *
 * Every test builds a fresh project through ``POST /__test_values__`` (WP X0): ``VALUES_STANDARD``
 * carries the standard clinical axes, ``VALUES_LONG`` an axis with long option values.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginScenarioUser, type ReviewFlowScenario } from "./reviewFlowHelpers";
import { selectText } from "./helpers";
import { valuesScenario, type ValuesScenarioName } from "./valuesHelpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const WIDE = { width: 1440, height: 900 };
/** At 1024 px and below the inspector spans the width under the text, so the section is much wider. */
const BELOW = { width: 1024, height: 900 };
const CASE = "values";

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/editor-axes-scroll/evidence");
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `values-block-${name}.png`), fullPage: false });
}

const textPane = (page: Page) => page.locator(".text-container");
const search = (page: Page) => page.locator("#search-input");
const activeHit = (page: Page) => page.getByRole("listbox", { name: "Terms", exact: true }).locator('[role="option"][aria-selected="true"]');
const section = (page: Page) => page.locator(".values-section");

const commandResponse = (page: Page, command: string) => page.waitForResponse(response =>
  response.url().endsWith("/commands") && response.request().method() === "POST"
  && (response.request().postDataJSON() as { payload?: { command?: string } } | null)?.payload?.command === command);

/** Fresh scenario, the annotator logged in, the task open, "seizure" marked and created with defaults. */
async function openWithFinding(page: Page, name: ValuesScenarioName, size = WIDE): Promise<ReviewFlowScenario> {
  await page.setViewportSize(size);
  const s = await valuesScenario(page, name);
  await loginScenarioUser(page, s, "annotator");
  await page.goto(`/#/tasks/${s.assignments[CASE]}`);
  await expect(textPane(page)).toHaveText(s.texts[CASE]);
  await page.evaluate(() => document.fonts.ready);
  const start = s.texts[CASE].indexOf("seizure");
  await selectText(page, start, start + "seizure".length);
  await expect(search(page)).toBeFocused();
  await expect(activeHit(page)).toBeVisible();
  const created = commandResponse(page, "create_annotation");
  await page.keyboard.press("Enter");
  expect((await created).ok()).toBeTruthy();
  await expect(section(page)).toBeVisible();
  return s;
}

type Layout = "row" | "stacked" | "boxes";

/** The fit rule of ``chooseValuesLayout`` on mount (no current layout, so no hysteresis). */
function expectedLayout(required: number[], row: number, stacked: number): Layout {
  if (required.every(width => width <= row)) return "row";
  if (required.every(width => width <= stacked)) return "stacked";
  return "boxes";
}

/**
 * The Values block measured in the page as the hook does: intrinsic segment widths (inner text width
 * plus horizontal padding, plus n + 1 px outline and separators), the row cell (content − 96 − 8) and
 * the section content width.
 */
async function measure(page: Page) {
  const numbers = await section(page).evaluate(element => {
    const px = (value: string) => parseFloat(value) || 0;
    const style = getComputedStyle(element);
    const content = element.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
    const controls = Array.from(element.querySelectorAll<HTMLElement>(".axis-field")).flatMap(field => {
      const control = field.querySelector<HTMLElement>(".axis-options");
      if (!control) return [];
      const segments = Array.from(control.querySelectorAll<HTMLElement>(":scope > .axis-option"));
      const required = segments.reduce((sum, segment) => {
        const text = segment.querySelector<HTMLElement>(":scope > span:not(.visually-hidden)")!;
        const segmentStyle = getComputedStyle(segment);
        return sum + Math.max(text.scrollWidth, Math.ceil(text.getBoundingClientRect().width))
          + px(segmentStyle.paddingLeft) + px(segmentStyle.paddingRight);
      }, segments.length + 1);
      return [{ axis: field.dataset.axisField ?? "", legend: field.querySelector("legend")?.textContent ?? "", required,
        shown: Math.round(control.getBoundingClientRect().width) }];
    });
    return { layout: element.dataset.valuesLayout ?? null, content, row: content - 96 - 8, controls };
  });
  const required = numbers.controls.map(control => control.required);
  return { ...numbers, maxRequired: Math.max(0, ...required), expected: expectedLayout(required, numbers.row, numbers.content) };
}

/** No segment is narrower than its content. */
async function expectNoSegmentOverflow(page: Page) {
  const overflowing = await section(page).locator(".axis-option").evaluateAll(elements => elements
    .filter(element => element.scrollWidth > element.clientWidth)
    .map(element => element.textContent));
  expect(overflowing).toEqual([]);
}

test("standard profile at 1440x900 gets row or stacked and no segment overflows", async ({ page }) => {
  await openWithFinding(page, "VALUES_STANDARD");
  const numbers = await measure(page);
  await test.info().attach("values-widths-new.json", { body: JSON.stringify(numbers, null, 2), contentType: "application/json" });
  console.log(`values-widths-new ${JSON.stringify(numbers)}`);
  expect(["row", "stacked"]).toContain(numbers.expected);
  await expect(section(page)).toHaveAttribute("data-values-layout", numbers.expected);
  await expectNoSegmentOverflow(page);
  // Every control fits the space it is shown in.
  for (const control of numbers.controls) expect(control.required).toBeLessThanOrEqual(control.shown + 1);
  await evidence(page, `01-standard-1440-${numbers.expected}`);
});

test("long option values fall back to boxes and are never truncated", async ({ page }) => {
  await openWithFinding(page, "VALUES_LONG");
  await expect(section(page)).toHaveAttribute("data-values-layout", "boxes");
  const certainty = section(page).locator('[data-axis-field="certainty"]');
  // Profile option identifiers are shown as words, never as raw values.
  for (const label of ["Confirmed by genetic testing", "Clinically suspected only", "Excluded after workup"]) {
    const option = certainty.locator(".axis-option").filter({ hasText: label });
    await expect(option).toBeVisible();
    await expect(option.locator("span").first()).toHaveText(label);
  }
  await expect(certainty).not.toContainText("_");
  await expectNoSegmentOverflow(page);
  // The default is marked with the same "Default" tag as in the other layouts.
  await expect(certainty.locator("legend .axis-default-tag")).toHaveText("Default");
  await expect(section(page).locator(".axis-default-suffix")).toHaveCount(0);
  const clipped = await section(page).evaluate(element => Array.from(element.querySelectorAll<HTMLElement>("*"))
    .filter(node => {
      const style = getComputedStyle(node);
      const clamp = style.getPropertyValue("-webkit-line-clamp");
      return (clamp !== "" && clamp !== "none") || style.textOverflow === "ellipsis";
    })
    .map(node => node.className));
  expect(clipped).toEqual([]);
  const numbers = await measure(page);
  console.log(`values-widths-long ${JSON.stringify(numbers)}`);
  expect(numbers.expected).toBe("boxes");
  await evidence(page, "02-long-boxes");
});

test("V, arrows, Tab and D keep their flow", async ({ page }) => {
  await openWithFinding(page, "VALUES_STANDARD");
  const confirm = page.locator("[data-confirm-defaults]");
  await expect(confirm).toBeFocused();
  await expect(confirm).toHaveText(/^Confirm defaults \(3\)/);
  await page.keyboard.press("v");
  const assertion = section(page).locator('[data-axis-field="assertion"]');
  await expect(assertion.locator('input[type="radio"]:checked')).toBeFocused();
  await expect(assertion.locator('input[type="radio"]:checked')).toHaveValue("present");
  const changed = commandResponse(page, "set_axes");
  await page.keyboard.press("ArrowRight");
  await expect(assertion.locator('input[type="radio"]:checked')).toHaveValue("absent");
  await expect(assertion.locator('input[type="radio"]:checked')).toBeFocused();
  expect((await changed).ok()).toBeTruthy();
  await page.keyboard.press("Tab");
  await expect(section(page).locator('[data-axis-field="experiencer"] input[type="radio"]:checked')).toBeFocused();
  await expect(confirm).toHaveText(/^Confirm defaults \(2\)/);
  const confirmed = commandResponse(page, "set_axes");
  await textPane(page).focus();
  await page.keyboard.press("d");
  expect((await confirmed).ok()).toBeTruthy();
  await expect(confirm).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("text-container") ?? false)).toBe(true);
  await expect(section(page).locator(".axis-default-tag")).toHaveCount(0);
  await expect(section(page).locator('[data-axis-field="assertion"] input[type="radio"]:checked')).toHaveValue("absent");
});

test("clicking the default confirms only that axis", async ({ page }) => {
  await openWithFinding(page, "VALUES_STANDARD");
  const confirm = page.locator("[data-confirm-defaults]");
  await expect(confirm).toHaveText(/^Confirm defaults \(3\)/);
  const assertion = section(page).locator('[data-axis-field="assertion"]');
  const confirmed = commandResponse(page, "set_axes");
  await assertion.locator(".axis-option.is-default").click();
  expect((await confirmed).ok()).toBeTruthy();
  await expect(assertion.locator(".axis-default-tag")).toHaveCount(0);
  await expect(section(page).locator(".axis-default-tag")).toHaveCount(2);
  await expect(confirm).toHaveText(/^Confirm defaults \(2\)/);
  await expect(assertion.locator('input[type="radio"]:checked')).toHaveValue("present");
});

test("Space on the checked default confirms only that axis", async ({ page }) => {
  await openWithFinding(page, "VALUES_STANDARD");
  const confirm = page.locator("[data-confirm-defaults]");
  await expect(confirm).toBeFocused();
  const experiencer = section(page).locator('[data-axis-field="experiencer"]');
  const checked = experiencer.locator('input[type="radio"]:checked');
  // Confirm defaults precedes the rows: Tab reaches Assertion, then Experiencer.
  await page.keyboard.press("Tab");
  await expect(section(page).locator('[data-axis-field="assertion"] input[type="radio"]:checked')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(checked).toBeFocused();
  await expect(checked).toHaveValue("patient");
  const confirmed = commandResponse(page, "set_axes");
  await page.keyboard.press("Space");
  expect((await confirmed).ok()).toBeTruthy();
  await expect(experiencer.locator(".axis-default-tag")).toHaveCount(0);
  await expect(section(page).locator(".axis-default-tag")).toHaveCount(2);
  await expect(confirm).toHaveText(/^Confirm defaults \(2\)/);
  await expect(checked).toBeFocused();
});

test("focus ring is fully visible on the first, middle and last segment", async ({ page }) => {
  await openWithFinding(page, "VALUES_STANDARD");
  await page.keyboard.press("v");
  const assertion = section(page).locator('[data-axis-field="assertion"]');
  await expect(assertion.locator('input[type="radio"]:checked')).toBeFocused();
  const sectionBox = (await section(page).boundingBox())!;
  // Assertion: Not specified · Present · Absent · Uncertain; the arrows move focus and choice.
  const steps: Array<[string, string[], string]> = [
    ["first", ["ArrowLeft"], ""],
    ["middle", ["ArrowRight"], "present"],
    ["last", ["ArrowRight", "ArrowRight"], "uncertain"],
  ];
  for (const [name, keys, value] of steps) {
    for (const key of keys) await page.keyboard.press(key);
    const radio = assertion.locator('input[type="radio"]:checked');
    await expect(radio).toHaveValue(value);
    await expect(radio).toBeFocused();
    const segment = assertion.locator(".axis-option").filter({ has: page.locator("input:checked") });
    const style = await segment.evaluate(element => {
      const computed = getComputedStyle(element);
      return { outline: computed.outlineStyle, width: computed.outlineWidth, zIndex: computed.zIndex };
    });
    expect(style).toEqual({ outline: "solid", width: "2px", zIndex: "1" });
    const box = (await segment.boundingBox())!;
    expect(box.x - 4).toBeGreaterThanOrEqual(sectionBox.x);
    expect(box.y - 4).toBeGreaterThanOrEqual(sectionBox.y);
    expect(box.x + box.width + 4).toBeLessThanOrEqual(sectionBox.x + sectionBox.width);
    expect(box.y + box.height + 4).toBeLessThanOrEqual(sectionBox.y + sectionBox.height);
    await evidence(page, `03-focus-${name}`);
  }
});

test("forced colours keep the chosen segment and the dashed default outline", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openWithFinding(page, "VALUES_STANDARD");
  const defaults = section(page).locator(".axis-option.is-default");
  await expect(defaults).toHaveCount(3);
  for (const style of await defaults.evaluateAll(elements => elements.map(element => getComputedStyle(element).outlineStyle))) {
    expect(style).toBe("dashed");
  }
  await expect(defaults.first()).toContainText("· default");
  await evidence(page, "04-forced-colours");
});

async function valuesViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(".values-section").analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

test("axe has no violations in the Values block in the row layout", async ({ page }) => {
  await openWithFinding(page, "VALUES_STANDARD", BELOW);
  await expect(section(page)).toHaveAttribute("data-values-layout", "row");
  expect(await valuesViolations(page)).toEqual([]);
  await evidence(page, "05-axe-row");
});

test("axe has no violations in the Values block in the boxes layout", async ({ page }) => {
  await openWithFinding(page, "VALUES_LONG");
  await expect(section(page)).toHaveAttribute("data-values-layout", "boxes");
  expect(await valuesViolations(page)).toEqual([]);
  await evidence(page, "06-axe-boxes");
});

test("narrow then wide returns to row", async ({ page }) => {
  // The 380 px inspector at 1440 px is the narrow section; at 1024 px the inspector spans the width under the text.
  await openWithFinding(page, "VALUES_STANDARD");
  const narrow = await measure(page);
  console.log(`values-widths-narrow ${JSON.stringify(narrow)}`);
  expect(narrow.expected, "the standard profile does not fit a row in the 380 px inspector").not.toBe("row");
  await expect(section(page)).toHaveAttribute("data-values-layout", narrow.expected);
  await page.setViewportSize(BELOW);
  await expect.poll(async () => (await measure(page)).expected).toBe("row");
  const wide = await measure(page);
  console.log(`values-widths-wide ${JSON.stringify(wide)}`);
  // Stretched segments are wider than their content here, so only intrinsic measuring returns to row.
  await expect(section(page)).toHaveAttribute("data-values-layout", "row");
  await evidence(page, "06-wide-row");
});
