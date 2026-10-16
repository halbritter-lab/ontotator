import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { importPackage, openCase } from "./helpers";

/**
 * Design review of direction C (T6a): screenshots of the editor for human review
 * (not baselines; fonts render slightly differently per OS), plus the checks that
 * marks keep their meaning without colour, text contrast, text size and that no
 * request leaves the origin.
 */

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

const screenshotDir = () => resolve(test.info().config.rootDir, "../../build/design-screenshots");

/** Writes `build/design-screenshots/<width>x<height>/<name>.png` for every viewport. */
async function shoot(page: Page, name: string) {
  const original = page.viewportSize();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    // One pane at a time below 700 px: show the document.
    const documentTab = page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: "Document" });
    if (await documentTab.isVisible()) await documentTab.click();
    await page.evaluate(() => document.fonts.ready);
    await checkContrastAndTextSize(page);
    const dir = resolve(screenshotDir(), `${viewport.width}x${viewport.height}`);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `${name}.png`) });
  }
  if (original) await page.setViewportSize(original);
}

async function checkContrastAndTextSize(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  const violations = results.violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`),
  );
  expect(violations).toEqual([]);

  const tooSmall = await page.evaluate(() => {
    const found: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const ownText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      if (!ownText) continue;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width === 0 || box.height === 0 || style.visibility === "hidden") continue;
      if (parseFloat(style.fontSize) < 12) {
        found.push(`${element.tagName.toLowerCase()}.${element.className}: ${style.fontSize} "${(element.textContent ?? "").trim().slice(0, 40)}"`);
      }
    }
    return found;
  });
  expect(tooSmall).toEqual([]);
}

async function openReview(page: Page, query: string, projectKey: string, annotator: string) {
  await importPackage(page, query, projectKey, annotator);
  await openCase(page, { task: "review" });
}

const proposal = (page: Page, termId: string) =>
  page.locator(".sidebar-section").first().locator(".doc-item").filter({ hasText: termId });

/**
 * The design scenario with every mark state on screen: proposals (dashed), two own
 * copies (solid), one of them negated (hatch), references (dotted), an overlap
 * (thicker line) and a selected proposal (frame).
 */
async function openStates(page: Page, annotator: string) {
  await openReview(page, "?scenario=design_states", "pkg-design-states", annotator);
  await expect(page.locator(".text-container .run--target").first()).toBeVisible();

  // "Hearing impairment" is stated as absent in the text: copy the proposal and negate it.
  await proposal(page, "HP:0000365").click();
  await page.keyboard.press("3");
  const assertion = page.getByRole("group", { name: "Assertion" });
  const absent = assertion.getByRole("radio", { name: "Absent" });
  // A controlled radio: it shows as checked once the change is applied to the draft.
  await absent.click();
  await expect(absent).toBeChecked();
  await expect(page.locator(".text-container .run--negated")).toHaveText("hearing impairment");

  // A second own copy, not negated.
  await proposal(page, "HP:0001252").click();
  await page.keyboard.press("3");
  // The copy opens in the inspector once it is created; wait for that before selecting on.
  await expect(page.locator(".inspector-pane")).toContainText("Replacement for proposal: Hypotonia");
  await expect(page.locator(".text-container .run--own:not(.run--negated)")).toHaveText("generalized hypotonia");
  await expect(page.locator(".status-badge")).toHaveClass(/status-saved/);

  // Select a proposal from the text. (References cannot be picked from the text yet:
  // their mention ids contain a comma, which the span editor splits on.)
  // Click inside the first line box of the mark: a wrapped mark's centre can lie outside it.
  const mark = page.locator(".text-container .run--target").filter({ hasText: "status epilepticus" });
  const box = await mark.evaluate((node) => {
    const rect = node.getClientRects()[0];
    return { x: rect.left + Math.min(12, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await expect(page.locator(".text-container .run--hot")).toHaveCount(1);
  await expect(page.locator(".text-container .run--hot")).toHaveText("status epilepticus");
}

test.describe("Design direction C", () => {
  test("design: login and dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("form", { name: "Log in to Ontocurator" })).toBeVisible();
    await shoot(page, "login");
    await checkContrastAndTextSize(page);
    await importPackage(page, "", "browser-fixture", "design-dashboard");
    await expect(page.getByRole("table", { name: "My tasks" })).toBeVisible();
    await shoot(page, "dashboard-compact-table");
    await checkContrastAndTextSize(page);
  });

  test("design: editor in reading density", async ({ page }) => {
    await openReview(page, "?scenario=many_proposals", "pkg-many-proposals", "design-many");
    await shoot(page, "editor-review-many");

    await page.context().clearCookies();
    await openReview(page, "?scenario=design_states", "pkg-design-states", "design-reading");
    await expect(page.locator(".text-container .run--target").first()).toBeVisible();
    // Term labels resolve after the marks render; capture the settled sidebar.
    await expect(proposal(page, "HP:0001250")).toContainText("Seizure");
    await expect(page.locator(".sidebar")).toContainText("spinal muscular atrophy");
    await shoot(page, "editor-review");

    await page.context().clearCookies();
    await openStates(page, "design-states");
    await shoot(page, "editor-states");
  });

  test("design: marks keep their meaning under colour-vision deficiencies", async ({ page }) => {
    await openStates(page, "design-vision");
    const cdp = await page.context().newCDPSession(page);
    for (const type of ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"] as const) {
      await cdp.send("Emulation.setEmulatedVisionDeficiency", { type });
      await shoot(page, `editor-states-${type}`);
    }
    await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });

    // Hue ignored: every state differs from every other in line style, pattern or frame.
    const styles = await page.evaluate(() => {
      const signature = (selector: string) => {
        const node = document.querySelector(`.text-container ${selector}`);
        if (!node) return `missing ${selector}`;
        const style = getComputedStyle(node);
        return [style.borderBottomStyle, style.backgroundImage, style.boxShadow].join(" | ");
      };
      return {
        own: signature(".run--own:not(.run--negated):not(.run--hot)"),
        target: signature(".run--target:not(.run--negated):not(.run--hot)"),
        source: signature(".run--source:not(.run--negated):not(.run--hot)"),
        negated: signature(".run--negated:not(.run--hot)"),
        hot: signature(".run--hot"),
      };
    });
    for (const value of Object.values(styles)) expect(value).not.toMatch(/^missing/);
    expect(new Set(Object.values(styles)).size, JSON.stringify(styles, null, 2)).toBe(5);
  });

  test("design: WCAG AA contrast and text size on the editor", async ({ page }) => {
    await openStates(page, "design-contrast");
    await checkContrastAndTextSize(page);
  });

  test("design: no request leaves the origin", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/");
    await expect(page.getByRole("form", { name: "Log in to Ontocurator" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await openReview(page, "?scenario=design_states", "pkg-design-states", "design-origin");
    await page.evaluate(() => document.fonts.ready);
    expect(requests.length).toBeGreaterThan(0);
    // Inline data: and blob: URLs are not requests to anyone.
    const outside = requests.filter((url) => !url.startsWith(`${origin}/`) && !/^(data|blob):/.test(url));
    expect(outside).toEqual([]);
    // The fonts are served by the app itself.
    expect(requests.some((url) => url.startsWith(origin) && url.endsWith(".woff2"))).toBe(true);
  });
});
