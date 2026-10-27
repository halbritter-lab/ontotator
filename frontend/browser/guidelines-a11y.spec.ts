/**
 * Project guidelines: layout, keyboard and accessibility (plan "Project guidelines" G6b; spec
 * "UI: annotators and reviewers", "Testing > Browser (Playwright)").
 *
 * Every test builds its own ``PUBLISHED`` project through ``POST /__test_guidelines__``: v1 published
 * by the lead ("First version"), not yet seen by Ana, who owns the en annotate task ``annotate-1``.
 * The drawer is a non-modal ``<aside>`` from 1280 px, a modal ``lg`` Dialog from 700 px and a
 * full-height sheet below.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { selectText } from "./helpers";
import { guidelineScenario, loginGuidelineUser, type GuidelineScenario } from "./guidelineHelpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const V1_TEXT = "Annotate every phenotype the text states about the patient.";

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/project-guidelines/evidence");
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `guidelines-a11y-${name}.png`), fullPage: false });
}

const entry = (page: Page) => page.getByRole("button", { name: /^Guidelines v1, open the project guidelines/ });
const aside = (page: Page) => page.getByRole("complementary", { name: "Guidelines v1", exact: true });
const modal = (page: Page) => page.getByRole("dialog", { name: "Guidelines v1", exact: true });
const scrollWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

/** Fresh PUBLISHED project; Ana logged in at ``size`` on her first annotate task. */
async function anaOnTask(page: Page, size: { width: number; height: number }): Promise<GuidelineScenario> {
  await page.setViewportSize(size);
  const s = await guidelineScenario(page, "PUBLISHED");
  await loginGuidelineUser(page, s, "ana");
  await page.goto(`/#/tasks/${s.assignments["annotate-1"]}`);
  await expect(page.locator(".text-container")).toBeVisible();
  await expect(entry(page)).toBeVisible();
  return s;
}

/** Press Tab until ``target`` has focus (at most ``limit`` times). */
async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  const stops: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(element => element === document.activeElement)) return;
    stops.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return element ? `${element.tagName.toLowerCase()}:${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}` : "none";
    }));
  }
  throw new Error(`Tab never reached the target. Stops: ${stops.join(" | ")}`);
}

async function axeViolations(page: Page, include: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

test("drawer at 1280 px is non-modal and the editor stays operable", async ({ page }) => {
  await anaOnTask(page, { width: 1280, height: 800 });
  await entry(page).click();
  const panel = aside(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Guidelines v1", level: 2 })).toBeFocused();
  await expect(panel.getByText(V1_TEXT)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  // min(24rem, 30vw) on the right, below the AppShell header.
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(Math.min(384, 1280 * 0.3) + 1);
  expect(Math.round(box.x + box.width)).toBe(1280);
  const header = (await page.locator(".shell-header").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  // The page narrows beside the drawer: the clinical text is not covered.
  const text = (await page.locator(".text-container").first().boundingBox())!;
  expect(text.x + text.width).toBeLessThanOrEqual(box.x + 1);
  expect(text.width).toBeGreaterThan(180);
  await evidence(page, "1280-drawer");

  // Keys typed inside the drawer do not reach the editor's shortcuts; outside they do.
  await page.keyboard.press("d");
  await expect(panel).toBeVisible();

  // The editor behind stays operable: select text, search a term, add a finding.
  await selectText(page, 0, 11);
  await page.getByLabel("Search term", { exact: true }).fill("Hypotonia");
  await expect(page.locator(".candidate-card").filter({ hasText: "HP:0001252" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Search term", { exact: true }).press("Enter");
  await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
  await expect(panel).toBeVisible();
  await evidence(page, "1280-drawer-editor-used");

  await panel.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(panel).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
});

test("900 px uses a dialog", async ({ page }) => {
  await anaOnTask(page, { width: 900, height: 800 });
  await entry(page).click();
  const dialog = modal(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveClass(/ui-dialog--lg/);
  await expect(aside(page)).toHaveCount(0);
  await expect(dialog.locator(".ui-drawer-heading-target")).toBeFocused();
  await expect(dialog.getByText(V1_TEXT)).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThan(900);
  expect(box.height).toBeLessThan(800);
  await evidence(page, "900-dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
});

test("390 px uses a sheet", async ({ page }) => {
  await anaOnTask(page, { width: 390, height: 844 });
  await entry(page).click();
  const sheet = modal(page);
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".ui-drawer-sheet")).toHaveCount(1);
  await expect(sheet.locator(".ui-drawer-heading-target")).toBeFocused();
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(389);
  expect(box.y).toBeLessThanOrEqual(1);
  expect(box.height).toBeGreaterThanOrEqual(843);
  const close = sheet.getByRole("button", { name: "Close", exact: true }).last();
  await expect(close).toBeInViewport({ ratio: 1 });
  await expect(sheet.getByRole("link", { name: "All versions", exact: true })).toBeInViewport({ ratio: 1 });
  await evidence(page, "390-sheet");
  await close.click();
  await expect(sheet).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
});

test("320 px reflow without horizontal scrolling", async ({ page }) => {
  await anaOnTask(page, { width: 320, height: 720 });
  expect(await scrollWidth(page), "task page").toBeLessThanOrEqual(320);
  // The notice wraps inside the page.
  const notice = page.getByText("This project has guidelines (v1)", { exact: true });
  await expect(notice).toBeVisible();
  expect((await notice.boundingBox())!.x + (await notice.boundingBox())!.width).toBeLessThanOrEqual(320);
  await entry(page).click();
  const sheet = modal(page);
  await expect(sheet.getByText(V1_TEXT)).toBeVisible();
  expect(await scrollWidth(page), "sheet open").toBeLessThanOrEqual(320);
  const overflow = await sheet.evaluate(element => {
    const body = element.querySelector(".ui-dialog-body") as HTMLElement;
    return { body: body.scrollWidth - body.clientWidth, right: element.getBoundingClientRect().right };
  });
  expect(overflow.body, "sheet body horizontal overflow").toBeLessThanOrEqual(0);
  expect(overflow.right).toBeLessThanOrEqual(320);
  // A wide table scrolls inside its own container, not the page.
  const table = sheet.getByRole("region", { name: "Table", exact: true });
  await table.scrollIntoViewIfNeeded();
  expect((await table.boundingBox())!.x + (await table.boundingBox())!.width).toBeLessThanOrEqual(320);
  await evidence(page, "320-sheet");
});

test("keyboard-only path: Tab to Guidelines, Enter, Escape returns focus", async ({ page }) => {
  await anaOnTask(page, { width: 1280, height: 800 });
  await page.locator("body").focus();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, entry(page));
  await page.keyboard.press("Enter");
  const panel = aside(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Guidelines v1", level: 2 })).toBeFocused();
  // Tab moves on into the drawer's content and footer.
  await tabTo(page, panel.getByRole("link", { name: "All versions", exact: true }), 20);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(entry(page)).toBeFocused();
  // The notice's "Read guidelines v1" opens the same drawer with Enter.
  await tabTo(page, page.getByRole("button", { name: "Read guidelines v1", exact: true }), 80);
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("heading", { name: "Guidelines v1", level: 2 })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("axe has no violations on the drawer, Settings › Guidelines and the withdraw dialog", async ({ page }) => {
  const s = await anaOnTask(page, { width: 1280, height: 800 });
  await entry(page).click();
  await expect(aside(page).getByText(V1_TEXT)).toBeVisible();
  await evidence(page, "axe-drawer");
  // Soft, so Settings and the withdraw dialog are still checked when the drawer fails.
  expect.soft(await axeViolations(page, ".ui-drawer"), "drawer").toEqual([]);

  const lead = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 800 } });
  try {
    const leadPage = await lead.newPage();
    await loginGuidelineUser(leadPage, s, "lead");
    await leadPage.goto(`/#/projects/${encodeURIComponent(s.project)}/settings/guideline`);
    await expect(leadPage.getByRole("heading", { name: "In force Guidelines v1", level: 2, exact: true })).toBeVisible();
    await expect(leadPage.getByRole("table", { name: "Guideline versions" })).toBeVisible();
    expect(await axeViolations(leadPage, "main"), "Settings › Guidelines").toEqual([]);
    // With the publish form open, a chosen file and its preview.
    await leadPage.getByRole("button", { name: "Publish a new version", exact: true }).click();
    await leadPage.getByLabel("Guideline file (.md or .txt, up to 256 KB)", { exact: true }).setInputFiles(s.files["v2.md"]);
    await expect(leadPage.getByRole("button", { name: "Publish as v2", exact: true })).toBeVisible();
    expect(await axeViolations(leadPage, "main"), "Settings › Guidelines with preview").toEqual([]);
    await evidence(leadPage, "axe-settings");

    await leadPage.locator(".guidelines-current-actions").getByRole("button", { name: "More actions, v1", exact: true }).click();
    await leadPage.getByRole("menuitem", { name: "Withdraw v1…", exact: true }).click();
    const dialog = leadPage.getByRole("dialog", { name: "Withdraw v1?", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("No guideline is in force until you publish a new version.");
    expect(await axeViolations(leadPage, '[role="dialog"]'), "withdraw dialog").toEqual([]);
    await evidence(leadPage, "axe-withdraw-dialog");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await lead.close();
  }
});

test("forced colours keep the New badge and the notice visible", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await anaOnTask(page, { width: 1280, height: 800 });
  const badge = entry(page).locator(".task-guidelines-badge");
  await expect(badge).toHaveText("New");
  await expect(badge).toBeVisible();
  await expect(entry(page)).toHaveAccessibleName("Guidelines v1, open the project guidelines, updated");
  const title = page.getByText("This project has guidelines (v1)", { exact: true });
  await expect(title).toBeVisible();
  await expect(page.getByRole("button", { name: "Read guidelines v1", exact: true })).toBeVisible();
  // Text keeps a system colour distinct from its background; the notice keeps a visible edge.
  for (const [name, locator] of [["badge", badge], ["notice title", title]] as const) {
    const colours = await locator.evaluate(element => {
      let background = "rgba(0, 0, 0, 0)";
      for (let node: Element | null = element; node && /rgba\(0, 0, 0, 0\)|transparent/.test(background); node = node.parentElement) {
        background = getComputedStyle(node).backgroundColor;
      }
      return { color: getComputedStyle(element).color, background, hidden: getComputedStyle(element).visibility };
    });
    expect(colours.hidden, name).toBe("visible");
    expect(colours.color, name).not.toBe(colours.background);
  }
  const edge = await title.evaluate(element => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.borderTopStyle !== "none" && parseFloat(style.borderTopWidth) > 0) return true;
      if (style.borderLeftStyle !== "none" && parseFloat(style.borderLeftWidth) > 0) return true;
      if (node.matches(".notice")) break;
    }
    return false;
  });
  expect(edge, "notice keeps a border in forced colours").toBe(true);
  await evidence(page, "forced-colours");
});
