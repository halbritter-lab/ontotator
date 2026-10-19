import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginExisting } from "./helpers";

/**
 * Editor layout (editor spec sections 6, 8 and 10; plan F10): dialogs keep Close reachable
 * without scrolling, the findings column is resizable by pointer and keyboard and remembers its
 * width, layout transitions at 1024 and 700 px, 320 px reflow, forced colours and focus-ring
 * contrast. Data: the ``t5`` carry-forward scenario (tests/browser_carry_fixture.py).
 */

interface CarryScenario {
  assignment_id: number;
  username: string;
}

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/phase0-ux/evidence/e-f10");
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `${name}.png`) });
}

async function openT5(page: Page): Promise<CarryScenario> {
  const response = await page.request.post("/__test_carry_forward__", { params: { scenario: "t5" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = (await response.json()) as CarryScenario;
  await loginExisting(page, s.username);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.locator(".text-container")).toBeVisible();
  return s;
}

const separator = (page: Page) => page.getByRole("separator", { name: "Resize findings column", exact: true });
const sidebar = (page: Page) => page.locator("#findings-column");
const widthOf = (locator: Locator) => locator.evaluate(element => element.getBoundingClientRect().width);
const storageKey = (username: string) => `ontocurator.editor.sidebarWidth.v1:${username}`;
const stored = (page: Page, username: string) => page.evaluate(key => localStorage.getItem(key), storageKey(username));
const paneTab = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name });

/** WCAG relative luminance contrast of two `rgb()`/`rgba()` colours (alpha ignored). */
function contrast(a: string, b: string): number {
  const luminance = (colour: string) => {
    const [r, g, bl] = colour.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The first opaque background colour of `locator` or its ancestors. */
const backgroundOf = (locator: Locator) => locator.evaluate(element => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (colour && colour !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(colour)) return colour;
  }
  return "rgb(255, 255, 255)";
});

/** Close sits in the dialog's footer (not in the scrolling body) and inside the viewport, unscrolled. */
async function expectCloseInView(page: Page, dialog: Locator, name: string) {
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const close = dialog.locator(".modal-actions").getByRole("button", { name, exact: true });
  await expect(close).toBeVisible();
  await expect(close).toBeInViewport({ ratio: 1 });
  const box = (await close.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await expect(dialog.locator(".ui-dialog-header [data-dialog-close]")).toBeInViewport({ ratio: 1 });
  const layout = await dialog.evaluate(element => ({
    inBody: !!element.querySelector(".ui-dialog-body .modal-actions"),
    pageScrolled: window.scrollY !== 0,
  }));
  expect(layout).toEqual({ inBody: false, pageScrolled: false });
}

for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`dialogs at ${size.width}×${size.height}: Close of original evidence, Work rounds and submit stays in view`, async ({ page }) => {
    await page.setViewportSize(size);
    await openT5(page);
    const narrow = size.width <= 700;

    // Original evidence of the carried "Seizure".
    if (narrow) await paneTab(page, /^Findings/).click();
    await page.locator('.sidebar [data-list-key^="annotation:"]').filter({ hasText: "Seizure" }).click();
    await page.getByRole("region", { name: "Carried finding", exact: true }).getByRole("button", { name: "Show original evidence", exact: true }).click();
    const original = page.getByRole("dialog", { name: "Original finding from Round 1", exact: true });
    await expectCloseInView(page, original, "Close original evidence");
    await expect(original).toContainText("This finding had no text span in Round 1.");
    await evidence(page, `original-evidence-${size.width}`);
    await original.locator(".modal-actions").getByRole("button", { name: "Close original evidence", exact: true }).click();
    await expect(original).toBeHidden();

    // Work rounds.
    await page.getByRole("button", { name: "Work rounds", exact: true }).click();
    const rounds = page.getByRole("dialog", { name: /^Work rounds · / });
    await expect(rounds.getByText("Round 2", { exact: true }).first()).toBeVisible();
    await expectCloseInView(page, rounds, "Close");
    await evidence(page, `work-rounds-${size.width}`);
    await rounds.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
    await expect(rounds).toBeHidden();

    // Submit dialog (Cancel is its close action).
    await page.getByRole("button", { name: /^Finish & Submit/ }).click();
    const submit = page.getByRole("dialog", { name: "Submit case", exact: true });
    await expectCloseInView(page, submit, "Cancel");
    await expect(submit.locator(".modal-actions").getByRole("button", { name: "Submit case", exact: true })).toBeInViewport({ ratio: 1 });
    await evidence(page, `submit-${size.width}`);
    await submit.locator(".modal-actions").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(submit).toBeHidden();
  });
}

test("sidebar resize: pointer and keyboard, persistence across reload, reset, text pane unchanged at the default", async ({ page }) => {
  const s = await openT5(page);
  const handle = separator(page);
  await expect(handle).toHaveAttribute("aria-orientation", "vertical");
  await expect(handle).toHaveAttribute("aria-controls", "findings-column");
  await expect(handle).toHaveAttribute("aria-valuenow", "260");
  await expect(handle).toHaveAttribute("aria-valuemin", "220");
  // 1440 px: min(480, 35 vw = 504, 1440 − 380 − 420 = 640).
  await expect(handle).toHaveAttribute("aria-valuemax", "480");
  await expect(handle).toHaveAttribute("aria-valuetext", "260 pixels (default 260)");
  expect(await widthOf(sidebar(page))).toBe(260);

  // At the default width the separator does not move the text pane.
  const textLeft = () => page.locator(".center-pane").evaluate(element => element.getBoundingClientRect().left);
  const withSeparator = await textLeft();
  await page.addStyleTag({ content: ".sidebar-resizer { display: none !important; }" });
  expect(await textLeft()).toBe(withSeparator);
  await page.evaluate(() => document.querySelectorAll("style").forEach(style => { if (style.textContent?.includes(".sidebar-resizer { display: none !important; }")) style.remove(); }));
  await expect(handle).toBeVisible();

  // Keyboard: ±16, Shift ±64, Home/End, Enter resets (and removes the stored width).
  await handle.focus();
  const key = async (press: string, value: number) => {
    await page.keyboard.press(press);
    await expect(handle).toHaveAttribute("aria-valuenow", String(value));
  };
  await key("ArrowRight", 276);
  await key("Shift+ArrowRight", 340);
  await key("ArrowLeft", 324);
  await key("Shift+ArrowLeft", 260);
  await key("Home", 220);
  await key("End", 480);
  expect(await widthOf(sidebar(page))).toBe(480);
  await expect.poll(() => stored(page, s.username)).toBe("480");
  await key("Enter", 260);
  await expect.poll(() => stored(page, s.username)).toBeNull();

  // Pointer: drag by 100 px; the width is stored at drag end.
  const drag = async (dx: number, finish: (box: { x: number; y: number }) => Promise<void> = () => page.mouse.up()) => {
    const box = (await handle.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 200) };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx / 2, start.y, { steps: 3 });
    await page.mouse.move(start.x + dx, start.y, { steps: 3 });
    await finish(start);
  };
  await drag(100);
  await expect(handle).toHaveAttribute("aria-valuenow", "360");
  expect(await widthOf(sidebar(page))).toBe(360);
  expect(await stored(page, s.username)).toBe("360");
  await evidence(page, "sidebar-360");

  // Escape during a drag restores the width from the drag start.
  await drag(60, async () => { await page.keyboard.press("Escape"); await page.mouse.up(); });
  await expect(handle).toHaveAttribute("aria-valuenow", "360");

  // Persistence across reload.
  await page.reload();
  await expect(page.locator(".text-container")).toBeVisible();
  await expect(separator(page)).toHaveAttribute("aria-valuenow", "360");
  expect(await widthOf(sidebar(page))).toBe(360);

  // Double-click resets and removes the stored width.
  await separator(page).dblclick();
  await expect(separator(page)).toHaveAttribute("aria-valuenow", "260");
  expect(await stored(page, s.username)).toBeNull();
});

test("sidebar transitions at 1024 and 700 px; findings tab label", async ({ page }) => {
  const s = await openT5(page);
  const handle = separator(page);
  await handle.focus();
  await page.keyboard.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "480");
  await expect.poll(() => stored(page, s.username)).toBe("480");

  // Two columns (701–1024 px): default 220, maximum min(480, 35 vw); the stored width is clamped.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(handle).toHaveAttribute("aria-valuemax", "358");
  await expect(handle).toHaveAttribute("aria-valuenow", "358");
  await expect(handle).toHaveAttribute("aria-valuetext", "358 pixels (default 220)");
  expect(await widthOf(sidebar(page))).toBe(358);
  await evidence(page, "sidebar-1024");
  await handle.focus();
  await page.keyboard.press("Enter");
  await expect(handle).toHaveAttribute("aria-valuenow", "220");
  expect(await widthOf(sidebar(page))).toBe(220);

  // One pane at a time (≤700 px): no separator; the list tab names the open checks.
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(handle).toBeHidden();
  await expect(paneTab(page, /^Findings/)).toHaveText("Findings, 1 to check");
  await evidence(page, "sidebar-700");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("aria-valuenow", "260");
});

test("320 px reflow without horizontal scrolling in every pane", async ({ page }) => {
  // Phone height: the toolbar wraps to several lines at 320 px, so the list needs the height.
  await page.setViewportSize({ width: 320, height: 844 });
  await openT5(page);
  const overflow = () => page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  const panes: [RegExp, string][] = [[/^Findings/, "findings"], [/^Document$/, "document"], [/^Details$/, "details"]];
  for (const [tab, name] of panes) {
    await paneTab(page, tab).click();
    // In the list, select the carried finding so Details shows the carried section afterwards.
    if (name === "findings") await page.locator('.sidebar [data-list-key^="annotation:"]').filter({ hasText: "Seizure" }).click();
    const sizes = await overflow();
    expect(sizes.document, `pane ${name}`).toBeLessThanOrEqual(320);
    expect(sizes.body, `pane ${name}`).toBeLessThanOrEqual(320);
    await evidence(page, `reflow-320-${name}`);
  }
});

test("forced colours show the grip and the separator focus; focus rings keep 3:1 contrast", async ({ page }) => {
  await openT5(page);
  const handle = separator(page);
  const grip = handle.locator(".sidebar-resizer-grip");

  // Normal colours: the separator ring and the mention edge-handle ring against their backgrounds.
  await page.keyboard.press("Shift"); // keyboard modality, so programmatic focus matches :focus-visible
  await handle.focus();
  expect(await handle.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  const ring = await handle.evaluate(element => {
    const style = getComputedStyle(element);
    return { colour: style.outlineColor, style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring.style).toBe("solid");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  for (const behind of [sidebar(page), page.locator(".center-pane")]) {
    const background = await backgroundOf(behind);
    expect(contrast(ring.colour, background), `separator ring ${ring.colour} on ${background}`).toBeGreaterThanOrEqual(3);
  }
  const gripColour = await grip.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(contrast(gripColour, await backgroundOf(sidebar(page))), `grip ${gripColour}`).toBeGreaterThanOrEqual(3);

  await page.locator('.sidebar [data-list-key^="annotation:"]').filter({ hasText: "Hypotonia" }).click();
  const edge = page.locator(".text-container .resize-handle--end");
  await expect(edge).toHaveCount(1);
  await page.keyboard.press("Shift");
  await edge.focus();
  expect(await edge.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  const shadow = await edge.evaluate(element => getComputedStyle(element, "::before").boxShadow);
  const colours = shadow.match(/rgba?\([^)]*\)/g) ?? [];
  expect(colours.length, shadow).toBeGreaterThanOrEqual(1);
  // The outermost shadow is the focus ring; it sits on the text pane.
  const edgeRing = colours[colours.length - 1];
  const textBackground = await backgroundOf(page.locator(".text-container"));
  expect(contrast(edgeRing, textBackground), `edge ring ${edgeRing} on ${textBackground}`).toBeGreaterThanOrEqual(3);
  await evidence(page, "focus-rings");

  // Forced colours: the grip is drawn in CanvasText and the focus outline stays visible.
  await page.emulateMedia({ forcedColors: "active" });
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  const forced = await grip.evaluate(element => ({
    grip: getComputedStyle(element).backgroundColor,
    text: getComputedStyle(document.body).color,
  }));
  expect(forced.grip).toBe(forced.text);
  await page.keyboard.press("Shift");
  await handle.focus();
  const outline = await handle.evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), colour: style.outlineColor };
  });
  expect(outline.style).toBe("solid");
  expect(outline.width).toBeGreaterThan(0);
  expect(outline.colour).not.toBe(forced.grip);
  await evidence(page, "forced-colours");
});
