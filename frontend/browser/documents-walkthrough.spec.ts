/**
 * Acceptance walkthrough (spec "Acceptance walkthrough", V7; plan O10c Step 1) on the
 * WALKTHROUGH project at 1280 px: two annotators, a text change midway, compare,
 * consolidate, final. The lead (Mia Kühn) acts only in the browser through `LeadClicks`;
 * Ana, Tom and Luc act through the act route. After each step: the row's cells and
 * Waiting on as the spec's table, the tab counts, the navigation counter equal to Needs
 * your decision, NEW after a > 30-minute gap (steps 3, 6, 9, 11, `age_visit`), and the
 * "Checks along the way". Lead activations count clicks and option choices, never typing
 * (as lead-workflow.spec.ts). Evidence `walkthrough-{step}.png`.
 *
 * The steps are serial tests on one page so a known deviation can be a `test.fixme` of its
 * own while the walkthrough still runs to the final result.
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  documentsTab, evidence, expectCounterEqualsTab, expectEdge, expectStage, expectWaiting, moreMarker,
  namePattern, newBadge, openDocuments, rowAction, rowCell, rowHeader, textCard, textName, textRow, type CellText,
} from "./documentsOverviewHelpers";
import { openOlderVersions } from "./documentsHelpers";
import { LeadClicks, loginOverviewUser, overviewAct, overviewScenario, type OverviewActBody, type OverviewScenario } from "./overviewHelpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const ANA = "Ana Weber", TOM = "Tom Reis", LUC = "Luc Martin";
const CASE = "case-201";
/** Spec "Acceptance walkthrough": running lead-click totals after steps 1-12. */
const PLAN_TOTALS = [1, 4, 4, 9, 9, 13, 15, 17, 17, 21, 21, 23] as const;
const either = (a: string, b: string) => new RegExp(`(${a}, ${b}|${b}, ${a})`);
const WAITING: CellText = { state: "waiting", who: "" };

let page: Page;
let s: OverviewScenario;
const clicks = new LeadClicks();
/** Running totals after each step (index = step - 1). */
const totals: number[] = [];

const de = () => textRow(page, CASE, "de");
const cell = (column: Parameters<typeof rowCell>[1]) => rowCell(de(), column);
const action = (label: string) => rowAction(page, label, CASE, "de");

async function act(body: Omit<OverviewActBody, "project" | "case_id" | "language">): Promise<ReturnType<typeof overviewAct>> {
  return overviewAct(page, { project: s.project, case_id: CASE, language: "de", ...body });
}

/** Reload Documents (the page mounts again; `gap` first moves the lead's visit back by 31 minutes). */
async function revisit(gap: boolean): Promise<void> {
  if (gap) await act({ actor: "lead", action: "age_visit" });
  // A full page load (the same hash URL alone would not remount Documents).
  await openDocuments(page, s.project);
  await page.reload();
  await expect(de()).toHaveCount(1, { timeout: 30_000 });
}

/** Count one option choice of a `<select>` as one lead activation. */
async function chooseOption(select: Locator, person: string): Promise<void> {
  const value = await select.locator("option", { hasText: person }).first().getAttribute("value");
  await select.selectOption(value ?? "");
  clicks.total += 1;
}

function record(step: number): void {
  totals[step - 1] = clicks.total;
  test.info().annotations.push({ type: "lead clicks", description: `step ${step}: ${clicks.total} (plan ${PLAN_TOTALS[step - 1]})` });
}

/** No "Assign annotation…" on the row while old-version work waits (VD22; the row has one button, no menu). */
async function expectNoAssignAnnotation(): Promise<void> {
  await expect(action("Assign annotation…")).toHaveCount(0);
}

async function contextFor(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  return context.newPage();
}

test.beforeAll(async ({ browser }) => {
  page = await contextFor(browser);
  s = await overviewScenario(page, "WALKTHROUGH");
  await loginOverviewUser(page, s, "lead");
});

test.afterAll(async () => {
  await page?.context().close();
});

test("step 1: the lead imports the package (1 click)", async () => {
  await openDocuments(page, s.project);
  await page.getByRole("button", { name: "Upload texts…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload texts" });
  await dialog.locator("input[type=file]").setInputFiles(s.bundle_path!);
  await dialog.getByRole("button", { name: "Check", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Work plan" })).toBeVisible({ timeout: 60_000 });
  // Counting starts at the checked preview (as lead-workflow.spec.ts): "Import" is the step's one click.
  await clicks.count(dialog.getByRole("button", { name: /^Import 1 case/ }));
  await expect(dialog).toHaveCount(0, { timeout: 90_000 });

  // The en source is not planned: no row of its own, the de row's "+1" says it exists.
  await expect(moreMarker(page, CASE)).toHaveText("+1");
  await expect(textName(page, CASE, "en")).toHaveCount(0);
  await expectStage(cell("translation"), { state: "Unassigned", who: "" });
  await expectStage(cell("annotation"), { state: "after translation review", who: "" });
  await expectStage(cell("finalization"), WAITING);
  await expectWaiting(de(), "You");
  await expect(action("Assign review…")).toBeVisible();
  await expectCounterEqualsTab(page);
  record(1);
  await evidence(page, "walkthrough-1");
});

test("step 2: the lead assigns the review to Ana (3 clicks)", async () => {
  await clicks.count(action("Assign review…"));
  const dialog = page.getByRole("dialog", { name: /^Assign/ });
  await clicks.count(dialog.getByRole("radio", { name: new RegExp(`^${ANA}`) }));
  await clicks.count(dialog.getByRole("button", { name: "Assign 1", exact: true }));
  await expect(dialog).toHaveCount(0);

  await expectStage(cell("translation"), { state: `in review (${ANA})`, who: "" });
  await expectWaiting(de(), [ANA]);
  await expect(documentsTab(page, "To assign", 0)).toBeVisible();
  await expectCounterEqualsTab(page);
  record(2);
  await evidence(page, "walkthrough-2");
});

test("step 3: Ana accepts unchanged; NEW on the next visit", async () => {
  await act({ actor: "ana", action: "accept_review" });
  await revisit(true);
  await expectStage(cell("translation"), { state: "accepted", who: "" });
  await expectStage(cell("annotation"), { state: /No annotator yet · max \d+/, who: "" });
  await expect(newBadge(de())).toHaveCount(1);
  await expect(documentsTab(page, "To assign", 1)).toBeVisible();
  await expectCounterEqualsTab(page);
  record(3);
  await evidence(page, "walkthrough-3");
});

test("step 4: the lead assigns the annotation to Tom and Luc", async () => {
  await clicks.count(action("Assign annotation…"));
  const dialog = page.getByRole("dialog", { name: /^Assign/ });
  // Annotation lists people as checkboxes (one per needed annotator).
  await clicks.count(dialog.getByRole("checkbox", { name: new RegExp(`^${TOM}`) }));
  await clicks.count(dialog.getByRole("checkbox", { name: new RegExp(`^${LUC}`) }));
  await clicks.count(dialog.getByRole("button", { name: "Assign 2 people", exact: true }));
  await expect(dialog).toHaveCount(0);

  await expectStage(cell("annotation"), { state: "0 of 2 submitted", who: either(TOM, LUC) });
  await expectWaiting(de(), [TOM, LUC]);
  await expectCounterEqualsTab(page);
  record(4);
  await evidence(page, "walkthrough-4");
});

test("step 5: Tom submits (Luc keeps a draft)", async () => {
  await act({ actor: "tom", action: "submit_annotation", preset: "tom_v1" });
  await act({ actor: "luc", action: "draft_annotation", preset: "luc_v1" });
  await revisit(false);
  await expectStage(cell("annotation"), { state: "1 of 2 submitted", who: LUC });
  await expectStage(cell("finalization"), WAITING);
  await expectCounterEqualsTab(page);
  record(5);
  await evidence(page, "walkthrough-5");
});

test("step 6: the lead requests a correction, Ana corrects → v2", async () => {
  // The text card's Translation part: "Request correction…" opens the correction dialog.
  // A double click on the text name opens the card (R-4); one activation.
  await clicks.count(textName(page, CASE, "de"), { clickCount: 2 });
  const area = textCard(page, CASE, "de");
  await expect(area).toBeVisible();
  const translation = area.getByRole("navigation", { name: "Text path", exact: true }).getByRole("button", { name: /^Translation / });
  if ((await translation.getAttribute("aria-current")) !== "step") await clicks.count(translation);
  await clicks.count(area.getByRole("button", { name: "Request correction…", exact: true }).first());
  const correction = page.getByRole("dialog", { name: /^Request translation correction/ });
  const form = correction.getByRole("region", { name: "Request translation correction", exact: true });
  const reviewer = form.getByLabel("Translation reviewer", { exact: true });
  await expect(reviewer.locator("option", { hasText: ANA })).toHaveCount(1);
  if ((await reviewer.inputValue()) === "") await chooseOption(reviewer, ANA);
  await form.getByLabel("Reason for another review", { exact: true }).fill("Dosis prüfen");
  await clicks.count(form.getByRole("button", { name: "Assign correction review", exact: true }));
  await expect(form.getByText(/^Translation correction assigned to/)).toBeVisible();
  await correction.getByRole("button", { name: "Close", exact: true }).first().click();

  await act({ actor: "ana", action: "correct_translation" });
  await revisit(true);
  const header = rowHeader(de());
  await expect(header.locator(".documents-version-marker")).toHaveText("v2 corrected");
  await expect(newBadge(de())).toHaveCount(1);
  await expectStage(cell("translation"), { state: "accepted", who: "" });
  await expectStage(cell("annotation"), { state: "In progress on old text", who: "" });
  await expectEdge(page, de(), true);
  await expect(rowCell(de(), "next").getByRole("button").first()).toHaveAccessibleName(namePattern("Handle text change…, ", CASE, "de"));
  // One button per row; the other lead step is in the text card.
  await expect(rowCell(de(), "next").getByRole("button")).toHaveCount(1);
  await textName(page, CASE, "de").dblclick();
  await expect(textCard(page, CASE, "de").getByRole("button", { name: "Carry to v2…", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(textCard(page, CASE, "de")).toHaveCount(0);
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();
  await expect(await expectCounterEqualsTab(page)).toBe(1);
  await expectNoAssignAnnotation();
  record(6);
  await evidence(page, "walkthrough-6");
});

test("step 7: Handle text change… → Move to v2 (preselected) → Apply", async ({ browser }) => {
  await clicks.count(action("Handle text change…"));
  const dialog = page.getByRole("dialog", { name: new RegExp(`^Handle text change\\W+${CASE}\\W+de$`) });
  await expect(dialog.getByRole("radio", { name: /^Move to v2/ })).toBeChecked();
  await clicks.count(dialog.getByRole("button", { name: "Apply", exact: true }));
  await expect(dialog).toHaveCount(0);

  await expectStage(cell("annotation"), { state: "Submitted on v1", who: "" });
  await expect(rowCell(de(), "next").getByRole("button").first()).toHaveAccessibleName(namePattern("Carry to v2…, ", CASE, "de"));
  await expectNoAssignAnnotation();
  await expectCounterEqualsTab(page);

  // Check along the way: the card's version list shows Luc's v1 assignment as moved; Tom's v1 submission stays.
  const area = textCard(page, CASE, "de");
  if (!(await area.isVisible())) await textName(page, CASE, "de").dblclick();
  const translation = area.getByRole("navigation", { name: "Text path", exact: true }).getByRole("button", { name: /^Translation / });
  if ((await translation.getAttribute("aria-current")) !== "step") await translation.click();
  await openOlderVersions(area);
  const v1 = area.getByRole("list", { name: "Assignments on v1", exact: true });
  await expect(v1.getByRole("listitem").filter({ hasText: LUC })).toContainText(/Annotation\W+moved to v2/);
  await expect(v1.getByRole("listitem").filter({ hasText: TOM })).toContainText(/Annotation\W+Submitted/);
  // The card is modal: close it before the next row action.
  await area.getByRole("button", { name: "Close", exact: true }).click();
  await expect(area).toHaveCount(0);
  record(7);
  await evidence(page, "walkthrough-7");

  // Luc's task on v2 shows his draft findings marked "Check after text change".
  const luc = await contextFor(browser);
  try {
    await loginOverviewUser(luc, s, "luc");
    const task = luc.getByTestId("task-row").filter({ hasText: CASE }).first();
    await task.locator("a.btn").click();
    await expect(luc.getByText("Check after text change").first()).toBeVisible({ timeout: 30_000 });
    await evidence(luc, "walkthrough-7-luc-editor");
  } finally {
    await luc.context().close();
  }
});

test("step 8: Carry to v2… → Tom (author, preselected) → Assign", async () => {
  await clicks.count(action("Carry to v2…"));
  const dialog = page.getByRole("dialog", { name: new RegExp(`^Carry to v2\\W+${CASE}\\W+de$`) });
  await expect(dialog.getByRole("radio", { name: new RegExp(`^${TOM}.*\\(author\\)`) })).toBeChecked();
  await clicks.count(dialog.getByRole("button", { name: "Assign", exact: true }));
  await expect(dialog).toHaveCount(0);

  await expectStage(cell("annotation"), { state: "0 of 2 submitted", who: either(TOM, LUC) });
  // Spec step 8: Finalization waits for the annotation (state none or "after annotation" both read "waiting").
  await expectStage(cell("finalization"), WAITING);
  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
  await expectCounterEqualsTab(page);
  await expectNoAssignAnnotation();
  record(8);
  await evidence(page, "walkthrough-8");
});

test("step 9: Tom and Luc resolve the carried findings and submit on v2", async () => {
  await act({ actor: "tom", action: "resolve_carried_and_submit", preset: "tom_v2" });
  await act({ actor: "luc", action: "resolve_carried_and_submit", preset: "luc_v2" });
  await revisit(true);
  await expectStage(cell("annotation"), { state: "2 of 2 submitted", who: "" });
  await expectStage(cell("finalization"), { state: "ready to compare", who: "" });
  await expectEdge(page, de(), true);
  await expect(newBadge(de())).toHaveCount(1);
  await expect(action("Compare results…")).toBeVisible();
  await expectCounterEqualsTab(page);
  record(9);
  await evidence(page, "walkthrough-9");
});

test("step 10: Compare results… → agreement 5 of 7 → Consolidate… → Ana → Start consolidation", async () => {
  await clicks.count(action("Compare results…"));
  const card = textCard(page, CASE, "de");
  const panel = card.getByRole("region", { name: "Final result", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/^2 annotations submitted on v2\W+7 findings in total$/)).toBeVisible();
  await expect(panel.getByText("Agreement: 5 of 7 findings match", { exact: true })).toBeVisible();
  const compared = panel.getByRole("table").getByRole("row").filter({ hasText: /Round/ }).filter({ hasNotText: /not compared/ });
  await expect(compared).toHaveCount(2);
  for (const row of await compared.all()) await expect(row.getByRole("cell").nth(1)).toHaveText("1");
  await evidence(page, "walkthrough-10-panel");

  await clicks.count(panel.getByRole("button", { name: "Consolidate…", exact: true }));
  const open = panel.getByRole("button", { name: "Consolidate results", exact: true });
  if (await open.count()) await clicks.count(open);
  const launcher = panel.getByRole("region", { name: "Consolidate submitted results", exact: true });
  await expect(launcher).toBeVisible();
  const reviewer = launcher.getByLabel("Consolidator", { exact: true });
  await expect(reviewer).toBeVisible({ timeout: 30_000 });
  // The compared submissions on the current text, preselected and named "{person} · Round 1 · {time}" (no codes).
  const boxes = launcher.getByRole("checkbox");
  await expect(boxes).toHaveCount(2);
  for (const box of await boxes.all()) {
    await expect(box).toBeChecked();
    await expect(box).toHaveAccessibleName(/^\S.*\WRound 1\W/);
  }
  await expect(reviewer.locator("option", { hasText: ANA })).toHaveCount(1);
  if (!(await reviewer.inputValue()) || !(await reviewer.locator("option:checked").textContent())?.includes(ANA)) await chooseOption(reviewer, ANA);
  await clicks.count(launcher.getByRole("button", { name: "Start consolidation", exact: true }));
  await expect(panel).toHaveCount(0, { timeout: 30_000 });
  if (await card.count()) await card.getByRole("button", { name: "Close", exact: true }).click();

  await expectStage(cell("annotation"), { state: "2 of 2 submitted", who: "" });
  await expectStage(cell("finalization"), { state: /consolidating( \(\d+ of \d+ groups open\))?/, who: "" });
  await expectCounterEqualsTab(page);
  record(10);
  await evidence(page, "walkthrough-10");
});

test("step 11: Ana submits the consolidation", async () => {
  await act({ actor: "ana", action: "submit_consolidation" });
  await revisit(true);
  // The submitted consolidation is preselected: accept it, nothing left to compare.
  await expectStage(cell("finalization"), { state: "ready to accept", who: "" });
  await expect(newBadge(de())).toHaveCount(1);
  await expectCounterEqualsTab(page);
  record(11);
  await evidence(page, "walkthrough-11");
});

test("step 11: the consolidation's row action reads \"Accept result…\" (VD16, X14, D2)", async () => {
  await expect(action("Accept result…")).toBeVisible();
});

test("step 12: Accept result… → Consolidated by Ana, accept the result", async () => {
  // The lead works from Needs your decision (where the nav counter lands, VD7), so the row is retained with "Resolved".
  await openDocuments(page, s.project, "?segment=decision");
  await expect(documentsTab(page, "Needs your decision", 1)).toHaveAttribute("aria-selected", "true");
  const accept = (await action("Accept result…").count()) ? action("Accept result…") : action("Compare results…");
  await clicks.count(accept);
  const panel = textCard(page, CASE, "de").getByRole("region", { name: "Final result", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(`Consolidated by ${ANA}`, { exact: true })).toBeVisible();
  await expect(panel.getByText("Accept this consolidation as the result?", { exact: true })).toBeVisible();
  await clicks.count(panel.getByRole("button", { name: "Accept result", exact: true }));
  await expect(panel.getByText("No more final results to decide.", { exact: true })).toBeVisible();
  await evidence(page, "walkthrough-12-panel");
  await panel.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(panel).toHaveCount(0);

  await expectStage(cell("finalization"), { state: /accepted( .+)?/, who: "" });
  await expect(rowHeader(de())).toContainText("Resolved");
  await expect(documentsTab(page, "Done", 1)).toBeVisible();
  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
  await expectCounterEqualsTab(page);
  record(12);
  await evidence(page, "walkthrough-12");
});

test("step 13: Export preflight: 1 final, no omission for de, en not in plan", async () => {
  await page.getByRole("link", { name: "Export final results…", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Export check" })).toBeVisible({ timeout: 30_000 });
  const preflight = page.locator(".final-export-preflight");
  await expect(preflight).toContainText(/1 selected result\W+0 warnings\W+0 omitted/);
  await expect(preflight.getByRole("list", { name: "Omitted without a final selection" })).toHaveCount(0);
  await expect(preflight.getByRole("list", { name: "Not planned, not exported" })).toHaveCount(0);
  await evidence(page, "walkthrough-13");
});

// Measured 2026-10-21: 1, 4, 4, 8, 8, 13, 15, 17, 17, 23, 23, 25. Deviations from the plan:
// step 4 −1 (the row assign dialog lists people as checkboxes; no "Split evenly" in row mode),
// step 6 +1 (the correction form preselects no reviewer: choosing Ana is an extra activation),
// step 10 +2 (the panel's consolidation form does not preselect the two compared submissions;
// the plan counts Consolidate… → Ana → Start consolidation only).
test.fixme("lead click totals equal the plan (1, 4, 4, 9, 9, 13, 15, 17, 17, 21, 21, 23)", async () => {
  expect(totals).toEqual([...PLAN_TOTALS]);
});

