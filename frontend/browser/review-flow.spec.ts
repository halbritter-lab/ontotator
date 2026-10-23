/**
 * Translation review flow in a real browser (review-and-annotation plan V1; spec "Acceptance" 1–7,
 * A.2, A.6, A.9, A.10): layout geometry at 1440×900, 800×900 and 390×844, the check band, the
 * decision form, decision keys, Next task after submit, My tasks flag, accessibility.
 *
 * Every test builds a fresh ``REVIEW_FLOW`` project (V0, ``POST /__test_review_flow__``) and logs in
 * as its reviewer Ana, who owns the translation reviews of ``failed-translation`` (one failed check)
 * and ``second-translation`` (all checks passed), in this order.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginScenarioUser, reviewFlowScenario, type ReviewFlowScenario } from "./reviewFlowHelpers";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

const WIDE = { width: 1440, height: 900 };
const MEDIUM = { width: 800, height: 900 };
const NARROW = { width: 390, height: 844 };

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/review-annotation/evidence");
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `review-flow-${name}.png`), fullPage: false });
}

const screenRoot = (page: Page) => page.getByRole("region", { name: "Translation review", exact: true });
const target = (page: Page) => page.getByRole("textbox", { name: "Translation (de)", exact: true });
const sourceBox = (page: Page) => page.getByRole("region", { name: "Source (en)", exact: true });
const editorBox = (page: Page) => page.locator(".translation-editor");
const submitButton = (page: Page) => page.getByRole("button", { name: "Submit review…", exact: true });
const radio = (page: Page, name: string) => page.getByRole("radio", { name, exact: true });
const checks = (page: Page) => page.getByRole("region", { name: "Automatic translation checks", exact: true });
const detailsToggle = (page: Page) => checks(page).locator(".translation-checks-toggle");
const pinnedBar = (page: Page) => page.getByRole("region", { name: "Decision and submit", exact: true });
const saveStatus = (page: Page) => page.locator(".translation-save-status");
const confirmDialog = (page: Page) => page.getByRole("dialog", { name: "Submit this review?", exact: true });

/** Fresh REVIEW_FLOW project, Ana logged in at ``size``. */
async function start(page: Page, size = WIDE): Promise<ReviewFlowScenario> {
  await page.setViewportSize(size);
  const s = await reviewFlowScenario(page, "REVIEW_FLOW");
  await loginScenarioUser(page, s, "ana");
  return s;
}

/** Open one of Ana's reviews by its address and wait for the texts and fonts. */
async function openReview(page: Page, s: ReviewFlowScenario, name: "failed-translation" | "second-translation" = "failed-translation") {
  await page.goto(`/#/tasks/${s.assignments[name]}`);
  await expect(target(page)).toHaveValue(s.texts[name]);
  await page.evaluate(() => document.fonts.ready);
}

/** Lines of text the box shows without scrolling: content height over the computed line height. */
async function visibleLines(box: Locator, lineSource?: Locator): Promise<number> {
  const lineHeight = await (lineSource ?? box).evaluate(element => parseFloat(getComputedStyle(element).lineHeight));
  return box.evaluate((element, lineHeight) => {
    const style = getComputedStyle(element);
    return (element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / lineHeight;
  }, lineHeight);
}

/** Keep the focus out of every text field, as a reviewer does after reading. */
async function expectFocusOutsideTextFields(page: Page) {
  expect(await page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement && active.type === "text" || (active as HTMLElement | null)?.isContentEditable === true;
  })).toBe(false);
}

/** Live regions (aria-live or role=status/alert) whose text contains ``text``, outermost only. */
async function liveRegionsContaining(page: Page, text: string): Promise<number> {
  return page.evaluate(text => {
    const live = [...document.querySelectorAll<HTMLElement>("[aria-live]:not([aria-live=off]), [role=status], [role=alert]")]
      .filter(element => element.textContent?.includes(text));
    return live.filter(element => !live.some(other => other !== element && other.contains(element))).length;
  }, text);
}

/**
 * Press ``1`` outside the text, wait for the saved draft, open the confirmation with Ctrl+Enter and
 * confirm with a click (the keyboard-only confirmation is asserted in its own test).
 */
async function acceptUnchanged(page: Page) {
  await expectFocusOutsideTextFields(page);
  await page.keyboard.press("1");
  await expect(radio(page, "Accepted unchanged")).toBeChecked();
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Control+Enter");
  await expect(confirmDialog(page)).toBeVisible();
  await confirmDialog(page).getByRole("button", { name: "Submit review", exact: true }).click();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(page.getByText("Review submitted", { exact: true })).toBeVisible();
}

test("My tasks flags the failed-translation row", async ({ page }) => {
  const s = await start(page);
  await page.goto("/#/");
  const rows = page.getByTestId("task-row");
  const failed = rows.filter({ has: page.locator(`a[href="#/tasks/${s.assignments["failed-translation"]}"]`) });
  const second = rows.filter({ has: page.locator(`a[href="#/tasks/${s.assignments["second-translation"]}"]`) });
  await expect(failed).toContainText(/failed-translation\W+de/);
  const flag = failed.locator(".task-check-flag");
  await expect(flag).toHaveText("1 automatic check failed");
  await expect(flag.locator("svg")).toBeVisible();
  await expect(failed).toHaveAttribute("aria-label", /, 1 automatic check failed$/);
  await expect(second.locator(".task-check-flag")).toHaveCount(0);
  await expect(second).not.toContainText("automatic check");
  await evidence(page, "my-tasks-flag");
});

test("1440×900: both texts show at least 15 lines and the rail shows four decisions and Submit", async ({ page }) => {
  const s = await start(page);
  await openReview(page, s);
  for (const [name, box, lines] of [["source", sourceBox(page), sourceBox(page)], ["translation", editorBox(page), target(page)]] as const) {
    const rect = (await box.boundingBox())!;
    expect(rect.y, `${name} top`).toBeLessThan(WIDE.height);
    expect(rect.y + rect.height, `${name} bottom`).toBeLessThanOrEqual(WIDE.height + 0.5);
    const count = await visibleLines(box, lines);
    test.info().annotations.push({ type: "lines", description: `${name}: ${count.toFixed(1)} lines in ${Math.round(rect.height)} px` });
    expect(count, `${name} visible lines`).toBeGreaterThanOrEqual(15);
  }
  for (const name of ["Accepted unchanged", "Accepted with corrections", "Query", "Rejected"]) await expect(radio(page, name)).toBeInViewport({ ratio: 1 });
  await expect(submitButton(page)).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => [document.documentElement.scrollTop, document.querySelector(".translation-review")!.scrollTop])).toEqual([0, 0]);
  const crumb = page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]');
  await expect(crumb).toHaveText(/^failed-translation\W+Translation review \(de\)$/);
  await expect(crumb).toHaveAttribute("title", `Assignment ${s.assignments["failed-translation"]}`);
  await expect(page.getByRole("link", { name: "Back to my tasks", exact: true })).toHaveCount(0);
  // Coupling is offered beside the editable translation too, unchecked by default.
  await expect(page.getByRole("checkbox", { name: "Couple scrolling", exact: true })).not.toBeChecked();
  await expect(page.getByText("Coupled scrolling is available in read-only views.")).toHaveCount(0);
  // The rail's Submit is unavailable with its reason next to it; activating it moves focus to the reason.
  await expect(submitButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(submitButton(page)).toHaveAttribute("aria-describedby", "review-submit-reason");
  await expect(page.locator("#review-submit-reason")).toHaveText("Choose a decision to submit.");
  // aria-disabled keeps it focusable: Enter on it (Playwright's click() waits for "enabled") moves focus to the reason.
  await submitButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#review-submit-reason")).toBeFocused();
  await expect(confirmDialog(page)).toHaveCount(0);
  await evidence(page, "1440x900");
});

test("check band: one line, Details collapsed, expands and moves the texts", async ({ page }) => {
  const s = await start(page);
  await openReview(page, s);
  await expect(checks(page).locator(".translation-checks-line")).toHaveText("1 automatic check failed: Units added in translation");
  const band = (await checks(page).locator(".translation-checks-band").boundingBox())!;
  expect(band.height).toBeLessThanOrEqual(48);
  await expect(detailsToggle(page)).toHaveText("Details");
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
  const details = page.locator(`[id="${await detailsToggle(page).getAttribute("aria-controls")}"]`);
  await expect(details).toBeHidden();
  const before = (await sourceBox(page).boundingBox())!.y;
  await detailsToggle(page).click();
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(detailsToggle(page)).toHaveText("Hide details");
  await expect(details).toBeVisible();
  await expect(details.getByRole("heading", { name: "Units added in translation", exact: true })).toBeVisible();
  await expect(details).toContainText("You can say in the rationale");
  await expect(details).toContainText("It does not point to a text location; compare the texts yourself.");
  expect((await sourceBox(page).boundingBox())!.y).toBeGreaterThan(before);
  await evidence(page, "1440x900-details-open");
  await page.reload();
  await expect(target(page)).toHaveValue(s.texts["failed-translation"]);
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(details).toBeHidden();
});

test("800×900: texts side by side and Submit always visible", async ({ page }) => {
  const s = await start(page, MEDIUM);
  await openReview(page, s);
  const source = (await sourceBox(page).boundingBox())!, editor = (await editorBox(page).boundingBox())!;
  expect(Math.abs(source.y - editor.y)).toBeLessThanOrEqual(1);
  expect(editor.x).toBeGreaterThan(source.x + source.width);
  await expect(submitButton(page)).toBeInViewport({ ratio: 1 });
  await expect(pinnedBar(page)).toContainText("Decision: Not chosen");
  // The measured bands and bar (ResizeObserver, not the 13rem estimate) size the texts so they end above the bar.
  const measured = await screenRoot(page).evaluate(root => {
    const box = root.querySelector<HTMLElement>(".translation-editor")!.getBoundingClientRect();
    const bar = root.querySelector<HTMLElement>(".translation-pinned-bar")!.getBoundingClientRect();
    return {
      bands: root.style.getPropertyValue("--review-bands"), bar: root.style.getPropertyValue("--review-bar"),
      barHeight: bar.height, barTop: bar.top, boxBottom: box.bottom, boxHeight: box.height, viewport: window.innerHeight,
    };
  });
  test.info().annotations.push({ type: "measured", description: JSON.stringify(measured) });
  expect(measured.bands).toMatch(/^\d+px$/);
  expect(measured.bar).toMatch(/^\d+px$/);
  expect(Math.abs(parseInt(measured.bar) - measured.barHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(measured.boxHeight - Math.max(288, measured.viewport - parseInt(measured.bands) - parseInt(measured.bar)))).toBeLessThanOrEqual(1);
  expect(measured.boxBottom).toBeLessThanOrEqual(measured.barTop + 1);
  const lines = await visibleLines(editorBox(page), target(page));
  test.info().annotations.push({ type: "lines", description: `translation at 800×900: ${lines.toFixed(1)} lines` });
  await evidence(page, "800x900");
  // Unavailable Submit in the pinned bar: aria-disabled, its reason described and reachable.
  await expect(submitButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(submitButton(page)).toHaveAttribute("aria-describedby", "review-submit-reason");
  await expect(pinnedBar(page).locator("#review-submit-reason")).toHaveText("Choose a decision to submit.");
  await submitButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#review-submit-reason")).toBeFocused();
  await pinnedBar(page).getByRole("button", { name: "Change ↓", exact: true }).click();
  await expect(page.locator("[data-decision-legend]")).toBeFocused();
  await expect(page.locator("[data-decision-legend]")).toHaveText("Decision");
  await expect(page.locator("[data-decision-legend]")).toBeInViewport();
  await screenRoot(page).evaluate(root => { root.scrollTop = root.scrollHeight; });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(submitButton(page)).toBeInViewport({ ratio: 1 });
  await evidence(page, "800x900-end");
  // At most the known double announcement below 1100 px: the form's issue list and the bar's reason line.
  await page.keyboard.press("3");
  await expect(radio(page, "Query")).toBeChecked();
  await expect(pinnedBar(page)).toContainText("Decision: Query");
  const announcements = await liveRegionsContaining(page, "A clinical change needs a category.");
  test.info().annotations.push({ type: "live regions with the first issue (800 px)", description: String(announcements) });
  expect(announcements).toBeLessThanOrEqual(2);
});

test("390×844: texts stack and the pinned bar keeps Submit reachable", async ({ page }) => {
  const s = await start(page, NARROW);
  await openReview(page, s);
  const source = (await sourceBox(page).boundingBox())!, editor = (await editorBox(page).boundingBox())!;
  expect(editor.y).toBeGreaterThanOrEqual(source.y + source.height);
  expect(Math.abs(editor.x - source.x)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth <= window.innerWidth,
    screen: document.querySelector(".translation-review")!.scrollWidth <= document.querySelector<HTMLElement>(".translation-review")!.clientWidth,
  }))).toEqual({ page: true, screen: true });
  await expect(submitButton(page)).toBeInViewport({ ratio: 1 });
  await evidence(page, "390x844");
  await screenRoot(page).evaluate(root => { root.scrollTop = root.scrollHeight; });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(submitButton(page)).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await evidence(page, "390x844-end");
});

test("the built stylesheet keeps the vh fallback before each dvh height", async ({ page }) => {
  await page.goto("/");
  const css = (await page.evaluate(async () => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(link => link.href);
    return Promise.all(links.map(async href => (await fetch(href)).text()));
  })).join("\n");
  expect(css).toMatch(/height:\s*calc\(100vh - var\(--review-bands,\s*13rem\) - var\(--review-bar,\s*60px\)\);\s*height:\s*calc\(100dvh - var\(--review-bands,\s*13rem\) - var\(--review-bar,\s*60px\)\)/);
  expect(css).toMatch(/max-height:\s*50vh;\s*max-height:\s*50dvh/);
});

test("keyboard only: 1, Ctrl+Enter, Enter, Enter opens the next task", async ({ page }) => {
  const s = await start(page);
  await openReview(page, s);
  await expectFocusOutsideTextFields(page);
  await page.keyboard.press("1");
  await expect(radio(page, "Accepted unchanged")).toBeChecked();
  const rationale = page.getByRole("textbox", { name: "Rationale", exact: true });
  await expect(rationale).toBeVisible();
  await expect(rationale).toHaveAccessibleDescription(/Optional\. Say why the flagged difference is correct\./);
  await expect(saveStatus(page)).toHaveText("Saved");
  await page.keyboard.press("Control+Enter");
  await expect(confirmDialog(page)).toBeVisible();
  // Spec A.5: focus starts on "Submit review", so Ctrl+Enter, Enter submits.
  await expect(confirmDialog(page).getByRole("button", { name: "Submit review", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(page.getByText("Review submitted", { exact: true })).toBeVisible();
  const next = page.getByRole("button", { name: "Next task: second-translation (de)", exact: true });
  await expect(next).toBeFocused();
  await expect(page.locator(".translation-next-task [role=status]")).toHaveText("1 more open task in this project.");
  await expect(page.locator(".translation-next-task").getByRole("link", { name: "Back to my tasks", exact: true })).toBeVisible();
  await evidence(page, "1440x900-next-task");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignments["second-translation"]}$`));
  await expect(target(page)).toHaveValue(s.texts["second-translation"]);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText(/^second-translation\W+Translation review \(de\)$/);
  // Four activations: 1, Ctrl+Enter, Enter, Enter (spec A.10).
});

test("editing selects Accepted with corrections and undoing reverts it", async ({ page }) => {
  const s = await start(page);
  await openReview(page, s);
  const note = page.locator(".review-auto-note");
  await target(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("x");
  await expect(radio(page, "Accepted with corrections")).toBeChecked();
  await expect(note).toHaveText("Selected because you edited the translation. You can choose another decision.");
  await expect(note).toHaveAttribute("role", "status");
  expect(await liveRegionsContaining(page, "Selected because you edited the translation.")).toBe(1);
  await evidence(page, "1440x900-auto-selected");
  await page.keyboard.press("Backspace");
  await expect(target(page)).toHaveValue(s.texts["failed-translation"]);
  for (const name of ["Accepted unchanged", "Accepted with corrections", "Query", "Rejected"]) await expect(radio(page, name)).not.toBeChecked();
  await expect(note).toHaveText("Your edits are undone, so the decision is back to not chosen.");
  await expect(page.locator("#review-submit-reason")).toHaveText("Choose a decision to submit.");
});

test("Query never asks for the clinical checkbox", async ({ page }) => {
  const s = await start(page);
  await openReview(page, s);
  await expectFocusOutsideTextFields(page);
  await page.keyboard.press("3");
  await expect(radio(page, "Query")).toBeChecked();
  await expect(page.getByText("Clinically relevant change: yes, always for a query.", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Clinically relevant change", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Clinical change categories", exact: true })).toBeVisible();
  const rationale = page.getByRole("textbox", { name: "Rationale", exact: true });
  await expect(rationale).toBeVisible();
  await expect(rationale).toHaveAccessibleDescription(/Required for a clinically relevant change\./);
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(page.locator("body")).not.toContainText("A query or rejection needs a clinical change.");
  // At 1440 px the issues are listed once, in the rail footer, and announced once.
  await expect(page.getByRole("list", { name: "Review issues", exact: true })).toHaveCount(1);
  expect(await liveRegionsContaining(page, "A clinical change needs a category.")).toBe(1);
  await page.keyboard.press("4");
  await expect(radio(page, "Rejected")).toBeChecked();
  await expect(page.getByText("Clinically relevant change: yes, always for a rejection.", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("A query or rejection needs a clinical change.");
  await evidence(page, "1440x900-rejected");
});

test("last task: Back to my tasks is primary", async ({ page }) => {
  const s = await start(page);
  await openReview(page, s);
  await acceptUnchanged(page);
  const first = page.locator(".translation-next-task");
  await expect(first.getByRole("status")).toHaveText("1 more open task in this project.");
  await expect(first.getByRole("button", { name: /^Next task: / })).toBeFocused();
  // Spec A.5: "Next task: {external_id} ({language})"; soft, so the last-task checks below still run.
  await expect.soft(first.getByRole("button", { name: /^Next task: / })).toHaveText("Next task: second-translation (de)");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignments["second-translation"]}$`));
  await expect(target(page)).toHaveValue(s.texts["second-translation"]);
  await expect(checks(page).locator(".translation-checks-line")).toHaveText("All 2 automatic checks passed.");
  await acceptUnchanged(page);
  const next = page.locator(".translation-next-task");
  await expect(next.getByRole("status")).toHaveText("No more open tasks in this project.");
  await expect(next.getByRole("button", { name: /^Next task/ })).toHaveCount(0);
  const back = next.getByRole("button", { name: "Back to my tasks", exact: true });
  await expect(back).toHaveClass(/btn-primary/);
  await evidence(page, "1440x900-last-task");
  await back.click();
  await expect(page.getByRole("heading", { name: "My tasks", exact: true })).toBeVisible();
});

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(".translation-review").analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

test("axe has no violations on the review at 1440 and 800 px, with Details open and in the pinned bar", async ({ page }) => {
  const s = await start(page);
  await openReview(page, s);
  expect(await axeViolations(page)).toEqual([]);
  await detailsToggle(page).click();
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize(MEDIUM);
  await expect(pinnedBar(page)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press("3");
  await expect(radio(page, "Query")).toBeChecked();
  await expect(pinnedBar(page)).toContainText("Decision: Query");
  expect(await axeViolations(page)).toEqual([]);
});

test("forced colours keep the band icon, the selected decision and the pinned bar border", async ({ page }) => {
  const s = await start(page);
  await page.emulateMedia({ forcedColors: "active" });
  await openReview(page, s);
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  const icon = checks(page).locator(".translation-checks-line svg");
  await expect(icon).toBeVisible();
  const iconStyle = await icon.evaluate(element => ({ color: getComputedStyle(element).color, visibility: getComputedStyle(element).visibility, width: element.getBoundingClientRect().width }));
  expect(iconStyle.width).toBeGreaterThan(0);
  expect(iconStyle.visibility).toBe("visible");
  expect(iconStyle.color).not.toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("1");
  const selected = radio(page, "Accepted unchanged");
  await expect(selected).toBeChecked();
  // The selection is the native radio mark (not a fill or shadow, which forced colours drop) inside a visible border.
  const selectedStyle = await selected.evaluate(input => ({
    appearance: getComputedStyle(input).appearance,
    border: getComputedStyle(input.closest(".review-decision")!).borderTopStyle,
    width: parseFloat(getComputedStyle(input.closest(".review-decision")!).borderTopWidth),
  }));
  expect(selectedStyle.appearance).not.toBe("none");
  expect(selectedStyle.border).toBe("solid");
  expect(selectedStyle.width).toBeGreaterThanOrEqual(1);
  await evidence(page, "1440x900-forced-colors");
  await page.setViewportSize(MEDIUM);
  const bar = await pinnedBar(page).evaluate(element => ({ style: getComputedStyle(element).borderTopStyle, width: parseFloat(getComputedStyle(element).borderTopWidth) }));
  expect(bar.style).toBe("solid");
  expect(bar.width).toBeGreaterThanOrEqual(1);
  await evidence(page, "800x900-forced-colors");
});

test("reduced motion: the Details chevron does not animate", async ({ page }) => {
  const s = await start(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReview(page, s);
  const chevron = detailsToggle(page).locator(".translation-checks-chevron");
  await expect(chevron).toHaveCSS("transition-duration", "0s");
  await detailsToggle(page).click();
  await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(chevron).toHaveCSS("transition-duration", "0s");
  expect(await chevron.evaluate(element => element.getAnimations().length)).toBe(0);
});
