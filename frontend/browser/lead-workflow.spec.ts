/**
 * Lead workflow in the browser (plan L10b; spec "Goals and targets", "Testing › Browser (Playwright)").
 *
 * Every test builds a fresh project through ``POST /__test_lead_workflow__`` (L10a) and logs in as
 * one of its people. Click counts start where the lead already is and count activations
 * (clicks and key presses that activate something), not typing, pasting or scrolling.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  documentsReady, documentsTab, moreMarker, notInPlanSwitch, openDecisionBlock, rowBox, openFilters, openTextCard, rowAction, rowCell, textCard, textName, textNamePattern,
  textRow, textVersionItems,
} from "./documentsHelpers";
import { authenticatedRequest, openTasksHome, TEST_PASSWORD } from "./helpers";
import { leadScenario, pasteCaseIds, type LeadPerson, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

/** "20 Oct, 17:18", optionally with seconds or a year. */
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}(?::\d{2})?`;
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The separator of joined copy: " · " before U9 removes it (F11). */
const SEP = String.raw`\W+`;

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/lead-workflow/evidence");
async function evidence(page: Page, name: string, part?: Locator) {
  mkdirSync(evidenceDir(), { recursive: true });
  const path = resolve(evidenceDir(), `${name}.png`);
  if (part) await part.screenshot({ path }); else await page.screenshot({ path, fullPage: true });
}

/** Counts activations: every click or key press made through it adds one. */
function counter(page: Page) {
  let total = 0;
  return {
    get total() { return total; },
    async click(target: Locator) { await target.click(); total += 1; },
    async dblclick(target: Locator) { await target.dblclick(); total += 1; },
    async check(target: Locator) { await target.check(); total += 1; },
    async press(key: string) { await page.keyboard.press(key); total += 1; },
  };
}

/** "Ana Weber (ann-0006)": display name and pseudonym, as tables and lists show people. */
const person = (s: LeadScenario, name: LeadPerson) => `${s.display_names[name]} (${s.pseudonyms[name]})`;

/**
 * Log in through the login form; the shell then shows the display name. Without `remember` the
 * login starts on My tasks (TASKS_HOME); with it, at "#/" after seeding the last-used project, so
 * the landing (F8) opens that project.
 */
async function login(page: Page, s: LeadScenario, name: LeadPerson, remember?: string) {
  if (remember === undefined) await openTasksHome(page);
  else await page.goto("/");
  if (remember !== undefined) await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [`ontotator.lastProject.v1:${s.users[name]}`, remember]);
  const form = page.getByRole("form", { name: "Log in to Ontotator" });
  await form.getByLabel("Username", { exact: true }).fill(s.users[name]);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(s.display_names[name]);
}

/** Log in as the lead, who used the project last: the landing opens its Documents (F8). */
async function loginLead(page: Page, s: LeadScenario) {
  await login(page, s, "lead", s.project);
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await documentsReady(page);
}

const bar = (page: Page) => page.getByRole("region", { name: "Selection", exact: true });
const toast = (page: Page) => page.locator(".ui-toast");
const live = (page: Page) => page.locator(".documents-page > p[role=\"status\"]");
/** The table row of one text (case · language). */
const row = textRow;
/** The text card on Text details, where the plan chips of a row live (VD2, U3). */
async function openPlan(page: Page, caseId: string, language: string): Promise<Locator> {
  const card = await openTextCard(page, caseId, language);
  await card.getByRole("button", { name: "Details", exact: true }).click();
  return card;
}
/** A plan chip in the card's Text details ("Translation review, {case} {language}", "Annotate, …"). */
const chip = (page: Page, flag: "Translation review" | "Annotate", caseId: string, language: string) =>
  page.getByRole("button", { name: textNamePattern(`${flag}, `, caseId, language) });
/** The bulk "Plan…" dialog "Work plan · {n} cases". */
const planDialog = (page: Page, count: number) => page.getByRole("dialog", { name: new RegExp(`^Work plan${SEP}${count} cases$`) });
/** One language of the bulk plan dialog (its heading "{language} In selection: {n}"). */
const planLanguage = (dialog: Locator, language: string) => dialog.getByRole("region", { name: new RegExp(`^${esc(language)} In selection`) });
/** The toast of a bulk plan save: "{n} texts changed." (planReport). */
const PLAN_SAVED = /^\d+ texts? changed\.$/;
/** "n texts in m cases selected" of the selection bar (VD4: the selection is a set of texts). */
const selected = (texts: number, cases: number) => `${texts} ${texts === 1 ? "text" : "texts"} in ${cases} ${cases === 1 ? "case" : "cases"} selected`;

/** Open "Upload texts…" and check the bundle; the preview with its "Work plan" step is shown. */
async function uploadPreview(page: Page, s: LeadScenario): Promise<Locator> {
  await page.getByRole("button", { name: "Upload texts…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload texts" });
  await dialog.locator("input[type=file]").setInputFiles(s.bundle_path!);
  await dialog.getByRole("button", { name: "Check", exact: true }).click();
  const plan = dialog.getByRole("region", { name: "Work plan" });
  await expect(plan.getByRole("heading", { name: "Work plan", level: 3 })).toBeVisible({ timeout: 60_000 });
  return dialog;
}

/** Wait for the import to finish: the upload dialog closes itself and Documents reports the result. */
async function finishImport(page: Page, dialog: Locator, documents: number) {
  await expect(dialog).toHaveCount(0, { timeout: 90_000 });
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(`Imported ${documents} documents and 0 proposals.`);
}

/** Select by case IDs…, paste the list, Select {n}: 2 activations. */
async function selectByIds(page: Page, clicks: ReturnType<typeof counter>, ids: readonly string[]) {
  await clicks.click(page.getByRole("button", { name: "Select by case IDs…", exact: true }));
  await pasteCaseIds(page, ids);
  await expect(page.getByRole("dialog").getByText(new RegExp(`^${ids.length} found${SEP}0 unknown$`))).toBeVisible();
  await clicks.click(page.getByRole("dialog").getByRole("button", { name: `Select ${ids.length}`, exact: true }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // "Select by case IDs…" selects every text of the found cases (VD4).
  await expect(bar(page)).toContainText(` in ${ids.length} cases selected`);
}

/** Plan…, Translation review On, Annotate from scratch, Save: 4 activations (U5: radio groups per language). */
async function planReviewAndAnnotate(page: Page, clicks: ReturnType<typeof counter>, language: string, count: number) {
  await clicks.click(bar(page).getByRole("button", { name: "Plan…", exact: true }));
  const dialog = planDialog(page, count);
  const steps = planLanguage(dialog, language);
  await clicks.check(steps.getByRole("group", { name: "Translation review", exact: true }).getByRole("radio", { name: "On", exact: true }));
  await clicks.check(steps.getByRole("group", { name: "Annotation", exact: true }).getByRole("radio", { name: "Annotate from scratch", exact: true }));
  await expect(dialog.locator(".work-plan-summary")).toHaveText(/^Will change: \d+ texts?\./);
  await clicks.click(dialog.getByRole("button", { name: `Save for ${count} cases`, exact: true }));
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(PLAN_SAVED);
  await expect(toast(page).getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  // The selection stays, so the next click can be "Assign review…".
  await expect(bar(page)).toContainText(` in ${count} cases selected`);
}

test("D15: import, plan de, assign de, plan fr, assign fr", async ({ page }) => {
  const s = await leadScenario(page, "D15");
  const de = s.case_ids.de!;
  const fr = s.case_ids.fr!;
  expect(de).toHaveLength(20);
  expect(fr).toHaveLength(30);
  await loginLead(page, s);
  const clicks = counter(page);

  // 1. Import 50 cases with "Nothing planned": the preview's Work plan step has every chip off (1; total 1).
  // Opening the upload, choosing the file and "Check" are the upload itself; the count starts at the preview.
  const upload = await uploadPreview(page, s);
  const plan = upload.getByRole("region", { name: "Work plan" });
  for (const label of [/^Sources \(50\)$/, /^de\W+MT \(50\)$/, /^fr\W+MT \(50\)$/, /^es\W+MT \(50\)$/]) await expect(plan.getByRole("rowheader", { name: label })).toBeVisible();
  const chips = plan.getByRole("button", { pressed: false });
  await expect(chips).toHaveCount(7);
  await expect(plan.getByRole("button", { pressed: true })).toHaveCount(0);
  await clicks.click(upload.getByRole("button", { name: "Import 50 cases", exact: true }));
  expect(clicks.total).toBe(1);
  // Not counted: the upload dialog stays open with the import result and is closed here.
  await finishImport(page, upload, 200);
  // "Nothing planned": every translation is undecided (VD3): a normal row with "? not decided" and "Plan…", counted as a
  // decision (V10). The en sources are never undecided: not planned, no row (the "+1" of the case's rows), no decision.
  await expect(documentsTab(page, "All", 200)).toBeVisible();
  await expect(documentsTab(page, "Needs your decision", 150)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select all 200 filtered texts", exact: true })).toBeVisible();
  for (const language of ["de", "es", "fr"]) {
    await expect(rowCell(row(page, "case-0101", language), "translation"), language).toContainText("not decided");
    await expect(rowAction(page, "Plan…", "case-0101", language)).toBeVisible();
  }
  await expect(moreMarker(page, "case-0101")).toHaveText("+1");
  await expect(textName(page, "case-0101", "en")).toHaveCount(0);

  // 2. Plan the 20 de cases from pasted IDs: Select by case IDs…, Select 20, Plan…, Review, Annotate, Save (6 + paste; total 7).
  await selectByIds(page, clicks, de);
  await planReviewAndAnnotate(page, clicks, "de", 20);
  expect(clicks.total).toBe(7);
  // de is planned: review first, then annotate; the other texts of the case stay undecided.
  await expect(rowCell(row(page, de[0], "de"), "translation")).toContainText("Unassigned");
  await expect(rowCell(row(page, de[0], "de"), "annotation")).toContainText("after translation review");
  await expect(rowAction(page, "Assign review…", de[0], "de")).toBeVisible();
  await expect(rowCell(row(page, de[0], "fr"), "translation")).toContainText("not decided");
  await expect(documentsTab(page, "To assign", 20)).toBeVisible();

  // 3. Assign the 20 de reviews to one person from the kept selection: Assign review…, Ana Weber, Assign 20 (3; total 10).
  await clicks.click(bar(page).getByRole("button", { name: "Assign review…", exact: true }));
  let dialog = page.getByRole("dialog", { name: new RegExp(`^Assign${SEP}20 cases$`) });
  await expect(dialog.getByText(new RegExp(`^Translation review${SEP}de${SEP}20 versions$`))).toBeVisible();
  await expect(dialog.getByText("from the plan", { exact: true })).toBeVisible();
  // Nobody is preselected (D10).
  await expect(dialog.getByRole("table", { name: "Members" }).getByRole("radio", { checked: true })).toHaveCount(0);
  await clicks.click(dialog.getByRole("radio", { name: person(s, "ana"), exact: true }));
  await expect(dialog.getByRole("status", { name: "Summary" })).toHaveText("Ana Weber gets 20 translation reviews (de). Open tasks: 0 → 20.");
  await clicks.click(dialog.getByRole("button", { name: "Assign 20", exact: true }));
  // The annotation of these texts is the next step (#218): Close leaves it for later (1; total 11).
  await expect(dialog.getByText("Next: annotation (de). Close when you are done.", { exact: false })).toBeVisible();
  await clicks.click(dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }));
  expect(clicks.total).toBe(11);
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toContainText("20 translation reviews assigned to Ana Weber. Left unassigned: annotation of");
  // The selection is cleared after a successful assign.
  await expect(bar(page)).toHaveCount(0);
  for (const caseId of [de[0], de[19]]) {
    await expect(rowCell(row(page, caseId, "de"), "translation")).toContainText(`in review (${s.display_names.ana})`);
    await expect(rowCell(row(page, caseId, "de"), "waiting")).toContainText(person(s, "ana"));
  }
  await expect(documentsTab(page, "In progress", 20)).toBeVisible();
  await evidence(page, "d15-de-assigned");

  // 4. Plan the 30 fr cases the same way (6 + paste; total 17).
  await selectByIds(page, clicks, fr);
  await planReviewAndAnnotate(page, clicks, "fr", 30);
  expect(clicks.total).toBe(17);

  // 5. Assign the 30 fr reviews to Ben: Assign review…, Ben, Assign 30, Close (4; total 21). Splitting is "Distribute evenly…".
  await clicks.click(bar(page).getByRole("button", { name: "Assign review…", exact: true }));
  dialog = page.getByRole("dialog", { name: new RegExp(`^Assign${SEP}30 cases$`) });
  await expect(dialog.getByText(new RegExp(`^Translation review${SEP}fr${SEP}30 versions$`))).toBeVisible();
  await clicks.click(dialog.getByRole("radio", { name: person(s, "ben"), exact: true }));
  await expect(dialog.getByRole("status", { name: "Summary" })).toHaveText("Ben Roth gets 30 translation reviews (fr). Open tasks: 0 → 30.");
  await evidence(page, "d15-fr-assigned", dialog);
  await clicks.click(dialog.getByRole("button", { name: "Assign 30", exact: true }));
  await clicks.click(dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }));
  expect(clicks.total).toBe(21);
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toContainText("30 translation reviews assigned to Ben Roth. Left unassigned: annotation of");
  await expect(bar(page)).toHaveCount(0);
  await expect(rowCell(row(page, "case-0121", "fr"), "waiting")).toContainText(person(s, "ben"));
  await expect(rowCell(row(page, "case-0150", "fr"), "waiting")).toContainText(person(s, "ben"));
  await expect(documentsTab(page, "In progress", 50)).toBeVisible();
  await expect(documentsTab(page, "To assign", 0)).toBeVisible();
});

test("ANNOTATION_BATCH: later annotation batch via To assign (5 clicks) while 6 wait for review", async ({ page }) => {
  const s = await leadScenario(page, "ANNOTATION_BATCH");
  await loginLead(page, s);
  await expect(documentsTab(page, "To assign", 14)).toBeVisible();
  await expect(documentsTab(page, "In progress", 6)).toBeVisible();

  // With all 20 cases selected, the 6 still in review can be assigned ahead: their tasks wait for it (issue 213).
  await page.getByRole("checkbox", { name: /^Select all \d+ filtered texts$/ }).click();
  await bar(page).getByRole("button", { name: "Assign annotation…", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: new RegExp(`^Assign${SEP}20 cases$`) });
  await expect(dialog.getByText(new RegExp(`^Annotation${SEP}de${SEP}20 versions$`))).toBeVisible();
  await expect(dialog.getByRole("status", { name: "Summary" })).toContainText("6 texts still in translation review: their tasks open once the review is accepted");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await bar(page).getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(bar(page)).toHaveCount(0);

  // "To assign", header checkbox, Assign annotation…, annotator, Assign 14 (5).
  const clicks = counter(page);
  await clicks.click(documentsTab(page, "To assign", 14));
  await clicks.click(page.getByRole("checkbox", { name: "Select all 14 filtered texts", exact: true }));
  await expect(bar(page)).toContainText(new RegExp(`${selected(14, 14)}${SEP}next step: Assign annotation \\(de\\)`));
  await clicks.click(bar(page).getByRole("button", { name: "Assign annotation…", exact: true }));
  dialog = page.getByRole("dialog", { name: new RegExp(`^Assign${SEP}14 cases$`) });
  await expect(dialog.getByText(new RegExp(`^Annotation${SEP}de${SEP}14 versions$`))).toBeVisible();
  await clicks.click(dialog.getByRole("checkbox", { name: person(s, "annotator"), exact: true }));
  await expect(dialog.getByRole("status", { name: "Summary" })).toHaveText("Cy Annotator gets 14 annotations (de). Open tasks: 0 → 14.");
  await clicks.click(dialog.getByRole("button", { name: "Assign 14", exact: true }));
  expect(clicks.total).toBe(5);
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText("14 annotations assigned to Cy Annotator");
  await expect(documentsTab(page, "To assign", 0)).toBeVisible();
  await expect(documentsTab(page, "In progress", 20)).toBeVisible();

  // The 6 cases in review wait for it: under All, the Translation review facet "In progress" (replaces the Next step
  // filter "Waiting for translation review") shows exactly them.
  await documentsTab(page, "All").click();
  const filters = await openFilters(page);
  await filters.getByRole("group", { name: "Translation review", exact: true }).getByRole("checkbox", { name: "In progress, 6 texts", exact: true }).check();
  await expect(live(page)).toHaveText("6 texts shown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Text case-\d{4} de$/ })).toHaveCount(6);
  for (const caseId of s.in_review!) {
    await expect(rowCell(row(page, caseId, "de"), "translation")).toContainText(`in review (${s.display_names.ana})`);
    await expect(rowCell(row(page, caseId, "de"), "annotation")).toContainText("after translation review");
    await expect(rowCell(row(page, caseId, "de"), "waiting")).toContainText(person(s, "ana"));
  }
});

test("DEFAULT_IMPORT: import with 0 extra clicks", async ({ page }) => {
  const s = await leadScenario(page, "DEFAULT_IMPORT");
  await loginLead(page, s);
  const upload = await uploadPreview(page, s);
  const plan = upload.getByRole("region", { name: "Work plan" });
  // "Review and annotate all translations": both chips on for every translation; the source (with translations) off.
  for (const language of ["de", "fr"]) {
    await expect(plan.getByRole("button", { name: `Translation review, ${language}`, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(plan.getByRole("button", { name: `Annotate, ${language}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  const clicks = counter(page);
  await clicks.click(upload.getByRole("button", { name: "Import 3 cases", exact: true }));
  expect(clicks.total).toBe(1);
  await finishImport(page, upload, 9);
  for (const caseId of s.case_ids.de!) {
    for (const language of ["de", "fr"]) {
      await expect(rowCell(row(page, caseId, language), "translation")).toContainText("Unassigned");
      await expect(rowCell(row(page, caseId, language), "annotation")).toContainText("after translation review");
      await expect(rowAction(page, "Assign review…", caseId, language)).toBeVisible();
    }
  }
  // The chips live in the text card's Text details (VD2): both on.
  const first = s.case_ids.de![0];
  await openPlan(page, first, "de");
  await expect(chip(page, "Translation review", first, "de")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "Annotate", first, "de")).toHaveAttribute("aria-pressed", "true");
  await expect(documentsTab(page, "To assign", 6)).toBeVisible();
});

test("ROWS: one chip click with Undo", async ({ page }) => {
  const s = await leadScenario(page, "ROWS");
  await loginLead(page, s);

  // Translation review off on a fr row with review only (the fixture's "chip" case). Its chips sit in the text card's
  // Text details (VD2, U3): the text name, Text details, then one chip click with the Undo toast.
  const caseId = s.cases!.chip;
  const review = () => chip(page, "Translation review", caseId, "fr");
  // The lead lands on "Needs your decision" (VD7); the in-plan fr rows are listed under All.
  await documentsTab(page, "All").click();
  await expect(documentsTab(page, "All")).toHaveAttribute("aria-selected", "true");
  const clicks = counter(page);
  await clicks.dblclick(textName(page, caseId, "fr"));
  await clicks.click(textCard(page, caseId, "fr").getByRole("button", { name: "Details", exact: true }));
  await expect(review()).toHaveAttribute("aria-pressed", "true");
  await clicks.click(review());
  expect(clicks.total).toBe(3);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(`fr of ${caseId}: Translation review off`);
  // Out of plan: the row leaves the list while "Show texts not in plan" is off (the card stays open on it).
  const collapsed = row(page, caseId, "fr");
  await expect(collapsed).toHaveCount(0);

  // Undo restores the previous state.
  await toast(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(live(page)).toHaveText("Plan change undone.");
  await expect(review()).toHaveAttribute("aria-pressed", "true");
  await expect(collapsed).not.toHaveClass(/documents-row--not-in-plan/);
  await expect(collapsed).toHaveCount(1);
  await expect(toast(page)).toHaveCount(0);

  // Ctrl+Z works while the toast is visible, also with a row checkbox focused (the checkbox does not toggle).
  await review().click();
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(`fr of ${caseId}: Translation review off`);
  await expect(collapsed).toHaveCount(0);
  // The card is modal: close it so a row checkbox can take focus.
  await textCard(page, caseId, "fr").getByRole("button", { name: "Close", exact: true }).click();
  // Focus a row checkbox (fr of this case is hidden now, so use another case).
  const box = rowBox(page, s.cases!.acceptance, "fr");
  await box.focus();
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Plan change undone.");
  await expect(box).not.toBeChecked();
  await openPlan(page, caseId, "fr");
  await expect(review()).toHaveAttribute("aria-pressed", "true");
  await textCard(page, caseId, "fr").getByRole("button", { name: "Close", exact: true }).click();

  // Review off on a review + annotate row with the rule on (the fixture's "acceptance" case) needs the acceptance instead.
  const both = s.cases!.acceptance;
  await openPlan(page, both, "fr");
  await chip(page, "Translation review", both, "fr").click();
  const offer = page.getByRole("group", { name: "Annotate without review" });
  await expect(offer.getByText("This translation was reviewed outside Ontotator — accept it as it is", { exact: true })).toBeVisible();
  await expect(offer.getByRole("textbox", { name: "Reason (required)" })).toBeVisible();
  await expect(offer.getByRole("button", { name: "Accept and annotate", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(toast(page)).toHaveCount(0);
  await offer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(chip(page, "Translation review", both, "fr")).toHaveAttribute("aria-pressed", "true");
});

test("FR_OFF: turning fr off names persons and withdraws tasks", async ({ page }) => {
  const s = await leadScenario(page, "FR_OFF");
  await loginLead(page, s);
  await page.getByRole("checkbox", { name: /^Select all \d+ filtered texts$/ }).click();
  await bar(page).getByRole("button", { name: "Plan…", exact: true }).click();
  const dialog = planDialog(page, 10);
  // Both steps of fr off (U5: radio groups per language).
  const fr = planLanguage(dialog, "fr");
  await fr.getByRole("group", { name: "Translation review", exact: true }).getByRole("radio", { name: "Off", exact: true }).check();
  await fr.getByRole("group", { name: "Annotation", exact: true }).getByRole("radio", { name: "Off (not annotated)", exact: true }).check();
  await expect(dialog.locator(".work-plan-summary")).toHaveText(/^Will change: \d+ texts?\./);
  const save = dialog.getByRole("button", { name: "Save for 10 cases", exact: true });
  await save.click();

  // The confirmation inside the dialog names the persons and the final result.
  await expect(dialog.getByText("fr has work in 3 of these cases.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: "open translation reviews" }))
    .toHaveText(new RegExp(`^2 open translation reviews will be withdrawn \\(${esc(person(s, "ana"))}${SEP}${esc(person(s, "ben"))}\\)\\.$`));
  await expect(dialog.getByRole("listitem").filter({ hasText: "final result" }))
    .toHaveText(new RegExp(`^1 final result \\(${esc(s.final_case!)}${SEP}fr\\) stays in history but is no longer exported\\.$`));
  await expect(dialog.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  // The checkbox is required: Save stays focusable but unavailable.
  await expect(save).toHaveAttribute("aria-disabled", "true");
  // Playwright treats aria-disabled as disabled; activating it anyway changes nothing.
  await save.click({ force: true });
  await expect(dialog.getByText("fr has work in 3 of these cases.", { exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "I understand — withdraw the open tasks", exact: true }).check();
  await expect(save).not.toHaveAttribute("aria-disabled", "true");
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(PLAN_SAVED);
  await expect(toast(page).locator(".ui-toast-note")).toHaveText("Undo restores the plan, not withdrawn tasks.");

  // The open reviews are withdrawn.
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/assignments`);
  expect(response.ok()).toBeTruthy();
  const assignments = (await response.json()) as { document_id: string; task: string; status: string; revoked_at: string | null }[];
  const open = assignments.filter(item => item.revoked_at === null && item.status !== "submitted");
  expect(open, JSON.stringify(open)).toEqual([]);
  // fr is out of plan: hidden by default; with "Show texts not in plan" muted rows under All (VD1).
  await documentsTab(page, "All").click();
  await notInPlanSwitch(page).check();
  for (const caseId of Object.values(s.open_reviews!)) {
    await expect(row(page, caseId, "fr")).toHaveClass(/documents-row--not-in-plan/);
    await expect(rowCell(row(page, caseId, "fr"), "translation")).toContainText("not reviewed, optional");
  }

  // Export lists the final as "Not planned, not exported" (information).
  await page.getByRole("link", { name: "Export", exact: true }).click();
  await expect(page.getByText(/^Not planned, not exported/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(new RegExp(`${esc(s.final_case!)}${SEP}fr`)).first()).toBeVisible();
  await expect(page.getByRole("rowgroup", { name: "Not planned, not exported" })).toContainText("Not planned, not exported (1)");
});

test("ACCEPTANCE: annotate without review", async ({ page }) => {
  const s = await leadScenario(page, "ACCEPTANCE");
  await loginLead(page, s);
  await page.getByRole("checkbox", { name: "Select all 30 filtered texts", exact: true }).click();
  await bar(page).getByRole("button", { name: "Plan…", exact: true }).click();
  const dialog = planDialog(page, 30);
  await planLanguage(dialog, "fr").getByRole("group", { name: "Annotation", exact: true }).getByRole("radio", { name: "Annotate from scratch", exact: true }).check();
  const block = dialog.getByRole("group", { name: "Acceptance, fr" });
  await expect(block.getByText("fr: 12 of 30 translations are not marked as reviewed in the package. Annotation needs an accepted translation.", { exact: true })).toBeVisible();
  await expect(block.getByText("18 already marked as reviewed in the package metadata need nothing.", { exact: true })).toBeVisible();
  await expect(block.getByText("The acceptance is recorded with your name, the reason and the time.", { exact: true })).toBeVisible();
  const save = dialog.getByRole("button", { name: "Save for 30 cases", exact: true });
  await expect(save).toHaveAttribute("aria-disabled", "true");

  // Checkbox + reason make Save available.
  await block.getByRole("checkbox", { name: "These translations were reviewed outside Ontotator — accept them as they are", exact: true }).check();
  await expect(save).toHaveAttribute("aria-disabled", "true");
  const reason = "Reviewed by the partner clinic.";
  await dialog.getByLabel(/^Reason/).fill(reason);
  await expect(save).not.toHaveAttribute("aria-disabled", "true");
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(PLAN_SAVED);

  // The card's version list labels both acceptances.
  const accepted = s.not_marked!.at(-1)!;
  const marked = s.marked![0];
  const versions = async (caseId: string) => {
    const card = await openTextCard(page, caseId, "fr");
    return (await textVersionItems(card, 1)).first();
  };
  const lead = await versions(accepted);
  await expect(lead).toContainText(new RegExp(`Accepted: reviewed outside Ontotator${SEP}Project Lead \\(${esc(s.pseudonyms.lead)}, you\\)${SEP}${TIME}${SEP}${esc(reason)}`));
  await textCard(page, accepted, "fr").getByRole("button", { name: "Close", exact: true }).click();
  const pkg = await versions(marked);
  await expect(pkg).toContainText(/Accepted: marked as reviewed in the package\W+R\. Roe, 1 Oct/);
  await evidence(page, "acceptance-text-versions", textCard(page, marked, "fr"));
});

test("ROWS: row actions within three clicks", async ({ page }) => {
  const s = await leadScenario(page, "ROWS");
  await loginLead(page, s);
  const cases = s.cases!;

  // Accept result… with one submission (was "Choose final…", V6, X14, D2): the text card and "Accept result" (saves at
  // once; "Change final…" changes it later): 2.
  let clicks = counter(page);
  await clicks.click(rowAction(page, "Accept result…", cases.choose_final, "de"));
  const accept = await openDecisionBlock(page, cases.choose_final, "de");
  await expect(accept.getByText(/^Accept .+ as the result\?$/)).toBeVisible();
  await clicks.click(accept.getByRole("button", { name: "Accept result", exact: true }));
  expect(clicks.total).toBe(2);
  // VD17: the card moves to the next final decision of the list and names the saved one.
  const card = page.locator('.text-card[role="dialog"]');
  const next = card.getByRole("region", { name: "Final result", exact: true });
  await expect(next.locator(".final-panel-success")).toContainText(new RegExp(`Final result saved for ${esc(cases.choose_final)}${SEP}de\\.`));
  await card.locator("[data-dialog-close]").click();
  await expect(card).toHaveCount(0);
  await expect(rowCell(row(page, cases.choose_final, "de"), "finalization")).toContainText("accepted");

  // Resolve…: the three options exactly, inline under the row (Change 13); discarding takes 3 (+ typing the reason).
  clicks = counter(page);
  await clicks.click(rowAction(page, "Resolve…", cases.rejected, "de"));
  const resolve = page.getByRole("group", { name: textNamePattern("Resolve rejected translation, ", cases.rejected, "de") });
  await expect(resolve.getByRole("heading", { name: textNamePattern("Resolve rejected translation, ", cases.rejected, "de") })).toBeFocused();
  await expect(resolve.getByRole("button")).toHaveText(["Assign a new review…", "Correct the translation…", "Discard the de translation…", "Cancel"]);
  await clicks.click(resolve.getByRole("button", { name: "Discard the de translation…", exact: true }));
  const discard = page.getByRole("group", { name: `Discard the de translation of ${cases.rejected}`, exact: true });
  await discard.getByRole("textbox", { name: "Reason (required)" }).fill("The translation used the wrong source.");
  await clicks.click(discard.getByRole("button", { name: "Discard", exact: true }));
  expect(clicks.total).toBe(3);
  await expect(live(page)).toHaveText(`The de translation of ${cases.rejected} was discarded.`);

  // Decide on report…: lands on Decide with focus: 3 (+ typing the outcome).
  clicks = counter(page);
  await clicks.click(rowAction(page, "Decide on report…", cases.report, "de"));
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decide", level: 2 })).toBeFocused();
  await clicks.click(page.getByRole("button", { name: "Close, keep paused…", exact: true }));
  const close = page.getByRole("group", { name: "Close report", exact: true });
  await close.getByRole("textbox", { name: /^Outcome for / }).fill("The second episode is in the source; the translation is fine.");
  await clicks.click(close.getByRole("button", { name: "Close report", exact: true }));
  expect(clicks.total).toBe(3);
  await expect(page.locator(".lead-state")).toContainText(/Report\s*Closed/);
  await page.getByRole("link", { name: "Back to Documents" }).first().click();
  await documentsReady(page);

  // Review changes… (PLAN_RESTORED): the card with "Keep final on v1": 2 (the checkbox confirmation is gone).
  clicks = counter(page);
  await clicks.click(rowAction(page, "Review changes…", cases.review_changes, "de"));
  const review = await openDecisionBlock(page, cases.review_changes, "de");
  await expect(review.getByRole("button", { name: "Keep final on v1", exact: true })).toBeVisible();
  await evidence(page, "row-review-changes", review);
  await clicks.click(review.getByRole("button", { name: "Keep final on v1", exact: true }));
  expect(clicks.total).toBe(2);
  await expect(review.locator(".final-panel-success")).toContainText(new RegExp(`Final result saved for ${esc(cases.review_changes)}${SEP}de\\.`));
  await textCard(page, cases.review_changes, "de").getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(rowCell(row(page, cases.review_changes, "de"), "finalization")).toContainText("accepted");
});

test("annotator sees only pseudonyms", async ({ page }) => {
  const s = await leadScenario(page, "ROWS");
  await login(page, s, "annotator");
  // The login helper starts on My tasks.
  await expect(page.getByRole("heading", { name: "My tasks", level: 1 })).toBeVisible();
  const others = (["lead", "ana", "ben"] as const).map(name => s.display_names[name]);
  const noOthers = async (where: string) => {
    await expect(page.locator("body")).not.toContainText(new RegExp(others.map(esc).join("|")), { timeout: 1_000 });
    expect(where).toBeTruthy();
  };
  await expect(page.getByRole("cell", { name: textNamePattern("", s.cases!.report, "de") })).toBeVisible();
  await noOthers("My tasks");
  await page.getByRole("link", { name: /^View paused task/ }).or(page.getByRole("button", { name: /^View paused task/ })).first().click();
  await expect(page.getByTestId("annotator-identity")).toHaveText(`as ${person(s, "annotator")}`);
  await expect(page.getByText("The German text drops the second seizure episode", { exact: false }).first()).toBeVisible();
  await noOthers("paused task screen");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "My tasks", level: 1 })).toBeVisible();
  const submitted = page.getByRole("row").filter({ hasText: new RegExp(`${esc(s.cases!.choose_final)}${SEP}de`) });
  await submitted.getByRole("link", { name: /^View/ }).or(submitted.getByRole("button", { name: /^View/ })).first().click();
  await expect(page.getByTestId("annotator-identity")).toHaveText(`as ${person(s, "annotator")}`);
  await noOthers("submitted task screen");
});

/** One lead ("Dana Lead") of two fresh projects, with every role there and no tasks. */
async function twoProjectLead(page: Page) {
  const a = await leadScenario(page, "DEFAULT_IMPORT");
  const b = await leadScenario(page, "DEFAULT_IMPORT");
  const username = `lead-d7-${a.project.slice(-8)}`;
  const query = new URLSearchParams({ username, pseudonym: username, display_name: "Dana Lead", projects: `${a.project},${b.project}`, assign: "none" });
  const created = await page.request.post(`/__test_user__?${query.toString()}`);
  expect(created.ok(), await created.text()).toBeTruthy();
  /** Log in at "#/" (the landing applies); `remember` seeds the last-used project first. */
  const loginDana = async (remember?: string) => {
    await page.goto("/");
    if (remember !== undefined) await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [`ontotator.lastProject.v1:${username}`, remember]);
    const form = page.getByRole("form", { name: "Log in to Ontotator" });
    await form.getByLabel("Username", { exact: true }).fill(username);
    await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await form.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByTestId("current-user")).toContainText("Dana Lead");
  };
  return { a: a.project, b: b.project, username, loginDana };
}

test("lead lands on the last-used project, else on Projects (F8, D4)", async ({ page }) => {
  const { a, b, loginDana } = await twoProjectLead(page);
  await loginDana();
  // Nothing remembered yet: the Projects page lists both projects.
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "Projects" });
  for (const key of [a, b]) await expect(table.getByRole("row").filter({ hasText: key })).toHaveCount(1);

  // Open b's Documents, log out and in again: the last-used project.
  await page.goto(`/#/projects/${encodeURIComponent(b)}/documents`);
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("form", { name: "Log in to Ontotator" })).toBeVisible();
  await loginDana();
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(b)}/documents`));
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  // Opening the app at "#/" also lands there (replace navigation).
  await page.goto("about:blank");
  await page.goto("/#/");
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(b)}/documents`));
});

test("a login with an inaccessible remembered project lands on Projects", async ({ page }) => {
  const { loginDana } = await twoProjectLead(page);
  await loginDana("no-such-project");
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
});

test("demo-lead switches project via the sidebar in two clicks", async ({ page }) => {
  const { a, b, loginDana } = await twoProjectLead(page);
  await loginDana(a);
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(a)}/documents`));
  const clicks = counter(page);
  const nav = page.getByRole("navigation", { name: "Sections" });
  const switcher = nav.locator(".project-switcher");
  await expect(switcher).toHaveAccessibleName(/^Project: .+, switch project$/);
  await clicks.click(switcher);
  const dialog = page.getByRole("dialog", { name: "Switch project" });
  await expect(dialog.getByRole("combobox", { name: "Find project" })).toBeFocused();
  await clicks.click(dialog.getByRole("option").filter({ hasText: b }).getByRole("link"));
  expect(clicks.total).toBe(2);
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(b)}/documents`));
  await expect(dialog).toBeHidden();
});

test("demo-lead switches project by keyboard: Alt+P, type, Enter", async ({ page }) => {
  const { a, b, loginDana } = await twoProjectLead(page);
  await loginDana(a);
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(a)}/documents`));
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await page.keyboard.press("Alt+KeyP");
  const field = page.getByRole("dialog", { name: "Switch project" }).getByRole("combobox", { name: "Find project" });
  await expect(field).toBeFocused();
  await page.keyboard.type(b);
  await expect(page.getByRole("listbox", { name: "Projects" }).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(b)}/documents`));
});

test("below 700 px the switcher opens as a sheet and the Projects page shows cards", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 900 });
  const { a, b, loginDana } = await twoProjectLead(page);
  await loginDana(a);
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(a)}/documents`));
  await page.locator(".project-switcher").click();
  const sheet = page.getByRole("dialog", { name: "Switch project" });
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(sheet).toHaveClass(/ui-popover-sheet/);
  const field = sheet.getByRole("combobox", { name: "Find project" });
  await expect(field).toBeFocused();
  await page.keyboard.type(b);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(b)}/documents`));

  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  const card = page.locator(".projects-table tbody tr").first();
  await expect(card).toHaveCSS("display", "grid");
  await expect(page.locator(".projects-table thead")).toHaveCSS("position", "absolute");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await axeViolations(page, ".projects-page"), "Projects page cards").toEqual([]);
});

async function axeViolations(page: Page, include: string, disabled: string[] = []): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).disableRules(disabled).analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

test("lead corrects a rejected translation and annotation becomes assignable", async ({ page }) => {
  const s = await leadScenario(page, "REJECTED_TRANSLATION_FOR_LEAD");
  const caseId = s.cases!.rejected;
  await loginLead(page, s);

  // Resolve… opens the options inline under the row (Change 13); their heading takes focus (F5).
  await rowAction(page, "Resolve…", caseId, "de").click();
  const area = page.locator(".documents-row-notice-slot");
  const resolve = area.getByRole("group", { name: textNamePattern("Resolve rejected translation, ", caseId, "de") });
  await expect(resolve.getByRole("heading", { name: textNamePattern("Resolve rejected translation, ", caseId, "de") })).toBeFocused();
  await expect(resolve.getByRole("button")).toHaveText(["Assign a new review…", "Correct the translation…", "Discard the de translation…", "Cancel"]);

  // Correct the translation…: the panel explains the outcome; its heading takes focus.
  await resolve.getByRole("button", { name: "Correct the translation…", exact: true }).click();
  const panel = area.getByRole("group", { name: textNamePattern("Correct the translation, ", caseId, "de") });
  await expect(panel.getByRole("heading", { name: textNamePattern("Correct the translation, ", caseId, "de") })).toBeFocused();
  await expect(panel).toContainText("You review v1 yourself and submit it as Accepted with corrections. The corrected text becomes v2 and counts as accepted.");
  // No language confirmation: the lead reads de and has a qualification.
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  // The inline panel's h3 follows the hidden h2 "Texts" (heading order checked too).
  expect(await axeViolations(page, ".documents-resolve"), "Correct the translation panel").toEqual([]);
  await evidence(page, "lead-correction-panel", panel);

  // Open translation review: the ordinary review screen of v1, in lead-correction mode.
  await panel.getByRole("button", { name: "Open translation review", exact: true }).click();
  await expect(page).toHaveURL(/#\/tasks\/\d+$/);
  const text = page.getByRole("textbox", { name: "Translation (de)", exact: true });
  await expect(text).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("You are correcting this translation as project lead.", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("radio", { name: "Accepted with corrections", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: /Report a text problem/ })).toHaveCount(0);
  const before = await text.inputValue();
  const corrected = `${before} The second seizure episode is included.`;
  await text.fill(corrected);
  const review = page.getByRole("region", { name: "Translation review", exact: true });
  await expect(review.locator(".translation-save-status")).toHaveText("Saved");

  // Submit review…, confirm: the corrected text becomes v2 (accepted).
  await page.getByRole("button", { name: "Submit review…", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Submit this review?", exact: true });
  await confirm.getByRole("button", { name: "Submit review", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("A corrected version v2 was created.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next task|^Back to My tasks/ })).toHaveCount(0);
  await evidence(page, "lead-correction-submitted");

  // Back to Documents: the row's next step is Assign annotation (rule on, the translation is accepted).
  await page.getByRole("link", { name: "Back to Documents", exact: true }).click();
  await documentsReady(page);
  await expect(rowCell(row(page, caseId, "de"), "translation")).toContainText("accepted");
  await expect(rowAction(page, "Assign annotation…", caseId, "de")).toBeVisible();
  await expect(rowAction(page, "Resolve…", caseId, "de")).toHaveCount(0);
});

test("every Progress count opens Documents with the same number of rows", async ({ page }) => {
  const s = await leadScenario(page, "ROWS");
  await loginLead(page, s);
  const progressUrl = `/#/projects/${encodeURIComponent(s.project)}/progress`;
  await page.goto(progressUrl);
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  const counts = page.locator(".progress-counts a");
  await expect(counts.first()).toBeVisible();
  const links = await counts.evaluateAll(anchors => anchors.map(anchor => ({
    label: anchor.getAttribute("aria-label") ?? "",
    href: anchor.getAttribute("href") ?? "",
  })));
  expect(links.length).toBeGreaterThanOrEqual(12);
  const checked: string[] = [];
  for (const [index, link] of links.entries()) {
    const match = /^(.*): (\d+)$/.exec(link.label);
    expect(match, link.label).not.toBeNull();
    const [, label, count] = match!;
    // Click the count on the Progress page (the same link, found again after each return).
    await page.locator(".progress-counts a").nth(index).click();
    await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
    expect(page.url().endsWith(link.href), `${label}: ${page.url()}`).toBeTruthy();
    await expect(page.locator("table.documents-skeleton")).toHaveCount(0, { timeout: 30_000 });
    await documentsReady(page);
    // Texts in view: the text names plus the not-planned sources folded into their case lines.
    const shown = page.getByRole("button", { name: /^Text case-\d{4} [a-z]{2}$|^source [a-z]{2} \(native\), \d+ translations?$/ });
    if (Number(count) === 0) {
      await expect(page.getByText(/^(No texts match these filters\.|Nothing needs your decision|Nothing to assign|Nothing in progress|Nothing done yet|No texts yet)$/).first(), label).toBeVisible();
    }
    await expect(shown, `${label} (${link.href})`).toHaveCount(Number(count));
    checked.push(`${label}: ${count}`);
    await page.goto(progressUrl);
    await expect(page.locator(".progress-counts a").first()).toBeVisible();
  }
  // The fixture has work in every card, so most counts are non-zero.
  expect(checked.filter(entry => !entry.endsWith(": 0")).length, checked.join("\n")).toBeGreaterThanOrEqual(6);
});

test("problem report shows Name (ann-…) to the lead", async ({ page }) => {
  const s = await leadScenario(page, "ROWS");
  await loginLead(page, s);
  await rowAction(page, "Decide on report…", s.cases!.report, "de").click();
  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  const reporter = person(s, "annotator");
  await expect(page.getByRole("region", { name: "History", exact: true })).toContainText(`${reporter} reported the problem.`);
  await page.getByRole("button", { name: "Close, keep paused…", exact: true }).click();
  const close = page.getByRole("group", { name: "Close report", exact: true });
  await expect(close.getByRole("textbox", { name: new RegExp(`^Outcome for ${esc(reporter)}`) })).toBeVisible();
  await expect(close).toContainText(`${reporter} sees this in the report.`);
});
