/**
 * Lead workflow in the browser (plan L10b; spec "Goals and targets", "Testing › Browser (Playwright)").
 *
 * Every test builds a fresh project through ``POST /__test_lead_workflow__`` (L10a) and logs in as
 * one of its people. Click counts start where the lead already is and count activations
 * (clicks and key presses that activate something), not typing, pasting or scrolling.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticatedRequest, TEST_PASSWORD } from "./helpers";
import { leadScenario, pasteCaseIds, type LeadPerson, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

/** "20 Oct, 17:18", optionally with seconds or a year. */
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}(?::\d{2})?`;
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    async check(target: Locator) { await target.check(); total += 1; },
    async press(key: string) { await page.keyboard.press(key); total += 1; },
  };
}

/** "Ana Weber (ann-0006)": display name and pseudonym, as tables and lists show people. */
const person = (s: LeadScenario, name: LeadPerson) => `${s.display_names[name]} (${s.pseudonyms[name]})`;

/** Log in through the login form; the shell then shows the display name. */
async function login(page: Page, s: LeadScenario, name: LeadPerson) {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username", { exact: true }).fill(s.users[name]);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(s.display_names[name]);
}

/** Log in as the lead; D7: the lead lands on Documents of the project. */
async function loginLead(page: Page, s: LeadScenario) {
  await login(page, s, "lead");
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(s.project)}/documents`));
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Segments" })).toBeVisible();
}

const bar = (page: Page) => page.getByRole("region", { name: "Selection", exact: true });
const toast = (page: Page) => page.locator(".ui-toast");
const live = (page: Page) => page.locator(".documents-page > p[role=\"status\"]");
const segment = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Segments" }).getByRole("link", { name });
const disclosure = (page: Page, caseId: string, language: string) =>
  page.getByRole("button", { name: `Show details, ${caseId} · ${language}`, exact: true });
/** The table row of one language version. */
const row = (page: Page, caseId: string, language: string) =>
  page.getByRole("row").filter({ has: disclosure(page, caseId, language) });
const chip = (page: Page, flag: "Review" | "Annotate", caseId: string, language: string) =>
  page.getByRole("button", { name: `${flag}, ${caseId} · ${language}`, exact: true });
const caseBox = (page: Page, caseId: string, languages: number) =>
  page.getByRole("checkbox", { name: `Select ${caseId} (${languages} languages)`, exact: true });

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
  await expect(page.getByRole("dialog").getByText(`${ids.length} found · 0 unknown`, { exact: true })).toBeVisible();
  await clicks.click(page.getByRole("dialog").getByRole("button", { name: `Select ${ids.length}`, exact: true }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(bar(page).getByText(`${ids.length} cases selected`, { exact: true })).toBeVisible();
}

/** Plan…, Review on, Annotate on, Save: 4 activations. */
async function planReviewAndAnnotate(page: Page, clicks: ReturnType<typeof counter>, language: string, count: number) {
  await clicks.click(bar(page).getByRole("button", { name: "Plan…", exact: true }));
  const dialog = page.getByRole("dialog", { name: `Work plan · ${count} cases` });
  await clicks.click(dialog.getByRole("button", { name: `Review, ${language}, keep`, exact: true }));
  await clicks.click(dialog.getByRole("button", { name: `Annotate, ${language}, keep`, exact: true }));
  await expect(dialog.getByText(`${language} in ${count} cases → review, then annotate after the review is accepted. Nothing else changes. ${count} translation reviews and ${count} annotations become "to assign".`)).toBeVisible();
  await clicks.click(dialog.getByRole("button", { name: `Save for ${count} cases`, exact: true }));
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(`Plan saved for ${count} cases · ${language}: review + annotate`);
  await expect(toast(page).getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  // The selection stays, so the next click can be "Assign…".
  await expect(bar(page).getByText(`${count} cases selected`, { exact: true })).toBeVisible();
  await expect(bar(page)).toContainText(`next step: Assign translation review (${language})`);
}

test("D15: import, plan de, assign de, plan fr, split fr", async ({ page }) => {
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
  for (const label of ["Sources (50)", "de · MT (50)", "fr · MT (50)", "es · MT (50)"]) await expect(plan.getByRole("rowheader", { name: label })).toBeVisible();
  const chips = plan.getByRole("button", { pressed: false });
  await expect(chips).toHaveCount(7);
  await expect(plan.getByRole("button", { pressed: true })).toHaveCount(0);
  await clicks.click(upload.getByRole("button", { name: "Import 50 cases", exact: true }));
  expect(clicks.total).toBe(1);
  // Not counted: the upload dialog stays open with the import result and is closed here.
  await finishImport(page, upload, 200);
  await expect(segment(page, /^All \(0\)$/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select all 50 filtered cases", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show en, de, es, fr not in plan, case-0101", exact: true })).toBeVisible();

  // 2. Plan the 20 de cases from pasted IDs: Select by case IDs…, Select 20, Plan…, Review, Annotate, Save (6 + paste; total 7).
  await selectByIds(page, clicks, de);
  await planReviewAndAnnotate(page, clicks, "de", 20);
  expect(clicks.total).toBe(7);
  await expect(chip(page, "Review", de[0], "de")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "Annotate", de[0], "de")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: `Show en, es, fr not in plan, ${de[0]}`, exact: true })).toBeVisible();
  await expect(segment(page, /^To assign \(20\)$/)).toBeVisible();

  // 3. Assign the 20 de reviews to one person from the kept selection: Assign…, Ana Weber, Assign 20 (3; total 10).
  await clicks.click(bar(page).getByRole("button", { name: "Assign…", exact: true }));
  let dialog = page.getByRole("dialog", { name: "Assign · 20 cases" });
  await expect(dialog.getByText("Translation review · de · 20 versions", { exact: true })).toBeVisible();
  await expect(dialog.getByText("from the plan", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "One person", exact: true })).toBeChecked();
  // Nobody is preselected (D10).
  await expect(dialog.getByRole("table", { name: "Members" }).getByRole("radio", { checked: true })).toHaveCount(0);
  await clicks.click(dialog.getByRole("radio", { name: person(s, "ana"), exact: true }));
  await expect(dialog.getByRole("status", { name: "Summary" })).toHaveText("Ana Weber gets 20 translation reviews (de). Open tasks: 0 → 20.");
  await clicks.click(dialog.getByRole("button", { name: "Assign 20", exact: true }));
  expect(clicks.total).toBe(10);
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText("20 translation reviews assigned to Ana Weber");
  // The selection is cleared after a successful assign.
  await expect(bar(page)).toHaveCount(0);
  for (const caseId of [de[0], de[19]]) {
    await expect(row(page, caseId, "de")).toContainText("Translation review in progress");
    await expect(row(page, caseId, "de").getByRole("cell", { name: person(s, "ana"), exact: true })).toBeVisible();
  }
  await expect(segment(page, /^In progress \(20\)$/)).toBeVisible();
  await evidence(page, "d15-de-assigned");

  // 4. Plan the 30 fr cases the same way (6 + paste; total 16).
  await selectByIds(page, clicks, fr);
  await planReviewAndAnnotate(page, clicks, "fr", 30);
  expect(clicks.total).toBe(16);

  // 5. Split the 30 fr reviews between two: Assign…, Split evenly, Ana, Ben, Assign 30 (5; total 21).
  await clicks.click(bar(page).getByRole("button", { name: "Assign…", exact: true }));
  dialog = page.getByRole("dialog", { name: "Assign · 30 cases" });
  await expect(dialog.getByText("Translation review · fr · 30 versions", { exact: true })).toBeVisible();
  await clicks.click(dialog.getByRole("radio", { name: "Split evenly", exact: true }));
  await clicks.click(dialog.getByRole("checkbox", { name: person(s, "ana"), exact: true }));
  await clicks.click(dialog.getByRole("checkbox", { name: person(s, "ben"), exact: true }));
  // Contiguous blocks in list order; Ben (no open tasks) sorts before Ana (20 open tasks).
  await expect(dialog.getByRole("status", { name: "Summary" })).toHaveText(`Cases in list order: ${fr[0]}…0135 → Ben, case-0136…0150 → Ana.`);
  await expect(dialog.getByRole("columnheader", { name: "Gets", exact: true })).toBeVisible();
  await evidence(page, "d15-fr-split", dialog);
  await clicks.click(dialog.getByRole("button", { name: "Assign 30", exact: true }));
  expect(clicks.total).toBe(21);
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText("30 translation reviews split between Ben Roth (15) and Ana Weber (15)");
  await expect(bar(page)).toHaveCount(0);
  await expect(row(page, "case-0121", "fr").getByRole("cell", { name: person(s, "ben"), exact: true })).toBeVisible();
  await expect(row(page, "case-0150", "fr").getByRole("cell", { name: person(s, "ana"), exact: true })).toBeVisible();
  await expect(segment(page, /^In progress \(50\)$/)).toBeVisible();
  await expect(segment(page, /^To assign \(0\)$/)).toBeVisible();
});

test("ANNOTATION_BATCH: later annotation batch via To assign (5 clicks) while 6 wait for review", async ({ page }) => {
  const s = await leadScenario(page, "ANNOTATION_BATCH");
  await loginLead(page, s);
  await expect(segment(page, /^To assign \(14\)$/)).toBeVisible();
  await expect(segment(page, /^In progress \(6\)$/)).toBeVisible();

  // With all 20 cases selected, the 6 still in review are skipped and named.
  await page.getByRole("checkbox", { name: "Select all 20 filtered cases", exact: true }).click();
  await bar(page).getByRole("button", { name: "Assign…", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Assign · 20 cases" });
  await expect(dialog.getByText("Annotation · de · 14 versions", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("status", { name: "Summary" })).toContainText("6 still in translation review: waiting for review, they join the next batch");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await bar(page).getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(bar(page)).toHaveCount(0);

  // "To assign", header checkbox, Assign…, annotator, Assign 14 (5).
  const clicks = counter(page);
  await clicks.click(segment(page, /^To assign \(14\)$/));
  await clicks.click(page.getByRole("checkbox", { name: "Select all 14 filtered cases", exact: true }));
  await expect(bar(page)).toContainText("14 cases selected · next step: Assign annotation (de)");
  await clicks.click(bar(page).getByRole("button", { name: "Assign…", exact: true }));
  dialog = page.getByRole("dialog", { name: "Assign · 14 cases" });
  await expect(dialog.getByText("Annotation · de · 14 versions", { exact: true })).toBeVisible();
  await clicks.click(dialog.getByRole("radio", { name: person(s, "annotator"), exact: true }));
  await expect(dialog.getByRole("status", { name: "Summary" })).toHaveText("Cy Annotator gets 14 annotations (de). Open tasks: 0 → 14.");
  await clicks.click(dialog.getByRole("button", { name: "Assign 14", exact: true }));
  expect(clicks.total).toBe(5);
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText("14 annotations assigned to Cy Annotator");
  await expect(segment(page, /^To assign \(0\)$/)).toBeVisible();
  await expect(segment(page, /^In progress \(20\)$/)).toBeVisible();

  // The 6 cases in review wait for it: under All, the Next step filter "Waiting for translation review" shows exactly them.
  await segment(page, /^All \(20\)$/).click();
  await page.getByLabel("Next step", { exact: true }).selectOption({ label: "Waiting for translation review" });
  await expect(live(page)).toHaveText("6 texts shown");
  await expect(page.getByRole("button", { name: /^Show details, case-\d{4} · de$/ })).toHaveCount(6);
  for (const caseId of s.in_review!) {
    await expect(row(page, caseId, "de")).toContainText("Translation review in progress");
    await expect(row(page, caseId, "de").getByRole("cell", { name: person(s, "ana"), exact: true })).toBeVisible();
  }
});

test("DEFAULT_IMPORT: import with 0 extra clicks", async ({ page }) => {
  const s = await leadScenario(page, "DEFAULT_IMPORT");
  await loginLead(page, s);
  const upload = await uploadPreview(page, s);
  const plan = upload.getByRole("region", { name: "Work plan" });
  // "Review and annotate all translations": both chips on for every translation; the source (with translations) off.
  for (const language of ["de", "fr"]) {
    await expect(plan.getByRole("button", { name: `Review, ${language}`, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(plan.getByRole("button", { name: `Annotate, ${language}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  const clicks = counter(page);
  await clicks.click(upload.getByRole("button", { name: "Import 3 cases", exact: true }));
  expect(clicks.total).toBe(1);
  await finishImport(page, upload, 9);
  for (const caseId of s.case_ids.de!) {
    for (const language of ["de", "fr"]) {
      await expect(chip(page, "Review", caseId, language)).toHaveAttribute("aria-pressed", "true");
      await expect(chip(page, "Annotate", caseId, language)).toHaveAttribute("aria-pressed", "true");
      await expect(row(page, caseId, language)).toContainText("Assign translation review");
    }
  }
  await expect(segment(page, /^To assign \(6\)$/)).toBeVisible();
});

test("ROWS: one chip click with Undo", async ({ page }) => {
  const s = await leadScenario(page, "ROWS");
  await loginLead(page, s);

  // Review off on a fr row with Review only (the fixture's "chip" case): 1 click, Undo toast.
  const caseId = s.cases!.chip;
  const review = () => chip(page, "Review", caseId, "fr");
  const collapsed = page.getByRole("button", { name: `Show en, de, fr not in plan, ${caseId}`, exact: true });
  await expect(review()).toHaveAttribute("aria-pressed", "true");
  const clicks = counter(page);
  await clicks.click(review());
  expect(clicks.total).toBe(1);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(`fr of ${caseId}: Review off`);
  await expect(collapsed).toBeVisible();

  // Undo restores the previous state.
  await toast(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(live(page)).toHaveText("Plan change undone.");
  await expect(review()).toHaveAttribute("aria-pressed", "true");
  await expect(toast(page)).toHaveCount(0);

  // Ctrl+Z works while the toast is visible, also with a case checkbox focused (the checkbox does not toggle).
  await review().click();
  await expect(toast(page).locator(".ui-toast-message")).toHaveText(`fr of ${caseId}: Review off`);
  await expect(collapsed).toBeVisible();
  const box = caseBox(page, caseId, 3);
  await box.focus();
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Plan change undone.");
  await expect(review()).toHaveAttribute("aria-pressed", "true");
  await expect(box).not.toBeChecked();

  // Review off on a review + annotate row with the rule on (the fixture's "acceptance" case) needs the acceptance instead.
  const both = s.cases!.acceptance;
  await chip(page, "Review", both, "fr").click();
  const offer = page.getByRole("group", { name: "Annotate without review" });
  await expect(offer.getByText("This translation was reviewed outside Ontocurator — accept it as it is", { exact: true })).toBeVisible();
  await expect(offer.getByRole("textbox", { name: "Reason (required)" })).toBeVisible();
  await expect(offer.getByRole("button", { name: "Accept and annotate", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(toast(page)).toHaveCount(0);
  await offer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(chip(page, "Review", both, "fr")).toHaveAttribute("aria-pressed", "true");
});

test("FR_OFF: turning fr off names persons and withdraws tasks", async ({ page }) => {
  const s = await leadScenario(page, "FR_OFF");
  await loginLead(page, s);
  await page.getByRole("checkbox", { name: "Select all 10 filtered cases", exact: true }).click();
  await bar(page).getByRole("button", { name: "Plan…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Work plan · 10 cases" });
  // keep → on → off for both cells.
  for (const flag of ["Review", "Annotate"]) {
    await dialog.getByRole("button", { name: `${flag}, fr, keep`, exact: true }).click();
    await dialog.getByRole("button", { name: `${flag}, fr, on`, exact: true }).click();
    await expect(dialog.getByRole("button", { name: `${flag}, fr, off`, exact: true })).toBeVisible();
  }
  await expect(dialog.getByText("fr in 10 cases → not in plan. Nothing else changes.")).toBeVisible();
  const save = dialog.getByRole("button", { name: "Save for 10 cases", exact: true });
  await save.click();

  // The confirmation inside the dialog names the persons and the final result.
  await expect(dialog.getByText("fr has work in 3 of these cases.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: "open translation reviews" }))
    .toHaveText(`2 open translation reviews will be withdrawn (${person(s, "ana")} · ${person(s, "ben")}).`);
  await expect(dialog.getByRole("listitem").filter({ hasText: "final result" }))
    .toHaveText(`1 final result (${s.final_case} · fr) stays in history but is no longer exported.`);
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
  await expect(toast(page).locator(".ui-toast-message")).toHaveText("Plan saved for 10 cases · fr: review off, annotate off");
  await expect(toast(page).locator(".ui-toast-note")).toHaveText("Undo restores the plan, not withdrawn tasks.");

  // The open reviews are withdrawn.
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/assignments`);
  expect(response.ok()).toBeTruthy();
  const assignments = (await response.json()) as { document_id: string; task: string; status: string; revoked_at: string | null }[];
  const open = assignments.filter(item => item.revoked_at === null && item.status !== "submitted");
  expect(open, JSON.stringify(open)).toEqual([]);
  for (const caseId of Object.values(s.open_reviews!)) {
    await expect(page.getByRole("button", { name: `Show en, fr not in plan, ${caseId}`, exact: true })).toBeVisible();
  }

  // Export lists the final as "Not in plan, not exported" (information).
  await page.getByRole("link", { name: "Export", exact: true }).click();
  await expect(page.getByText(/^Not in plan, not exported/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`${s.final_case} · fr`, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/1 not in plan/)).toBeVisible();
});

test("ACCEPTANCE: annotate without review", async ({ page }) => {
  const s = await leadScenario(page, "ACCEPTANCE");
  await loginLead(page, s);
  await page.getByRole("checkbox", { name: "Select all 30 filtered cases", exact: true }).click();
  await bar(page).getByRole("button", { name: "Plan…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Work plan · 30 cases" });
  await dialog.getByRole("button", { name: "Annotate, fr, keep", exact: true }).click();
  const block = dialog.getByRole("group", { name: "Acceptance, fr" });
  await expect(block.getByText("fr: 12 of 30 translations are not marked as reviewed in the package. Annotation needs an accepted translation.", { exact: true })).toBeVisible();
  await expect(block.getByText("18 already marked as reviewed in the package metadata need nothing.", { exact: true })).toBeVisible();
  await expect(block.getByText("The acceptance is recorded with your name, the reason and the time.", { exact: true })).toBeVisible();
  const save = dialog.getByRole("button", { name: "Save for 30 cases", exact: true });
  await expect(save).toHaveAttribute("aria-disabled", "true");

  // Checkbox + reason make Save available.
  await block.getByRole("checkbox", { name: "These translations were reviewed outside Ontocurator — accept them as they are", exact: true }).check();
  await expect(save).toHaveAttribute("aria-disabled", "true");
  const reason = "Reviewed by the partner clinic.";
  await dialog.getByLabel(/^Reason/).fill(reason);
  await expect(save).not.toHaveAttribute("aria-disabled", "true");
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page).locator(".ui-toast-message")).toHaveText("Plan saved for 30 cases · fr: annotate");

  // Text versions labels both acceptances.
  const accepted = s.not_marked!.at(-1)!;
  const marked = s.marked![0];
  const versions = async (caseId: string) => {
    await disclosure(page, caseId, "fr").click();
    const area = page.getByRole("region", { name: `${caseId} · fr`, exact: true });
    await area.locator("summary", { hasText: /^Text versions \(1\)$/ }).click();
    return area.locator("details", { has: page.locator("summary", { hasText: /^Text versions \(1\)$/ }) });
  };
  const lead = (await versions(accepted));
  await expect(lead).toContainText(new RegExp(`Accepted: reviewed outside Ontocurator · Project Lead \\(${esc(s.pseudonyms.lead)}, you\\) · ${TIME} · ${esc(reason)}`));
  const pkg = await versions(marked);
  await expect(pkg).toContainText("Accepted: marked as reviewed in the package · R. Roe, 1 Oct");
  await evidence(page, "acceptance-text-versions", page.getByRole("region", { name: `${accepted} · fr`, exact: true }));
});

test("ROWS: row actions within three clicks", async ({ page }) => {
  const s = await leadScenario(page, "ROWS");
  await loginLead(page, s);
  const cases = s.cases!;

  // Choose final… with one submission: 2.
  let clicks = counter(page);
  await clicks.click(page.getByRole("button", { name: `Choose final…, ${cases.choose_final} · de`, exact: true }));
  const use = page.getByRole("group", { name: "Use as final result", exact: true });
  await expect(use.getByRole("heading", { name: "Use as final result" })).toBeFocused();
  await clicks.click(use.getByRole("button", { name: "Use as final", exact: true }));
  expect(clicks.total).toBe(2);
  await expect(live(page)).toContainText("is now the final result.");
  await expect(row(page, cases.choose_final, "de")).toContainText("Done");

  // Resolve…: the three options exactly; discarding takes 3 (+ typing the reason).
  clicks = counter(page);
  await clicks.click(page.getByRole("button", { name: `Resolve…, ${cases.rejected} · de`, exact: true }));
  const resolve = page.getByRole("group", { name: `Resolve rejected translation, ${cases.rejected} · de`, exact: true });
  await expect(resolve.getByRole("heading", { name: `Resolve rejected translation, ${cases.rejected} · de` })).toBeFocused();
  await expect(resolve.getByRole("button")).toHaveText(["Assign a new review…", "Correct the translation…", "Discard the de translation…", "Cancel"]);
  await clicks.click(resolve.getByRole("button", { name: "Discard the de translation…", exact: true }));
  const discard = page.getByRole("group", { name: `Discard the de translation of ${cases.rejected}`, exact: true });
  await discard.getByRole("textbox", { name: "Reason (required)" }).fill("The translation used the wrong source.");
  await clicks.click(discard.getByRole("button", { name: "Discard", exact: true }));
  expect(clicks.total).toBe(3);
  await expect(live(page)).toHaveText(`The de translation of ${cases.rejected} was discarded.`);

  // Decide on report…: lands on Decide with focus: 3 (+ typing the outcome).
  clicks = counter(page);
  await clicks.click(page.getByRole("button", { name: `Decide on report…, ${cases.report} · de`, exact: true }));
  await expect(page.getByRole("heading", { name: "Problem report", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decide", level: 2 })).toBeFocused();
  await clicks.click(page.getByRole("button", { name: "Close report (pauses stay)", exact: true }));
  const close = page.getByRole("group", { name: "Close report", exact: true });
  await close.getByRole("textbox", { name: /^Outcome for / }).fill("The second episode is in the source; the translation is fine.");
  await clicks.click(close.getByRole("button", { name: "Close report", exact: true }));
  expect(clicks.total).toBe(3);
  await expect(page.getByRole("region", { name: "Current state" })).toContainText(/Report\s*Closed/);
  await page.getByRole("link", { name: "Back to Documents" }).first().click();
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();

  // Review changes… (PLAN_RESTORED): expands the row and opens the Keep confirmation: 3.
  clicks = counter(page);
  await clicks.click(page.getByRole("button", { name: `Review changes…, ${cases.review_changes} · de`, exact: true }));
  await expect(page.getByRole("region", { name: `${cases.review_changes} · de`, exact: true })).toBeVisible();
  await evidence(page, "row-review-changes", page.getByRole("region", { name: `${cases.review_changes} · de`, exact: true }));
  const keep = page.getByRole("group", { name: "Keep final result", exact: true });
  await expect(keep.getByRole("heading", { name: "Keep final result" })).toBeFocused();
  await clicks.check(keep.getByRole("checkbox", { name: "I reviewed these changes and keep this exact result", exact: true }));
  await clicks.click(keep.getByRole("button", { name: "Keep as final", exact: true }));
  expect(clicks.total).toBe(3);
  await expect(row(page, cases.review_changes, "de")).toContainText("Done");
});

test("annotator sees only pseudonyms", async ({ page }) => {
  const s = await leadScenario(page, "ROWS");
  await login(page, s, "annotator");
  // Users who lead no project land on My tasks.
  await expect(page.getByRole("heading", { name: "My tasks", level: 1 })).toBeVisible();
  const others = (["lead", "ana", "ben"] as const).map(name => s.display_names[name]);
  const noOthers = async (where: string) => {
    await expect(page.locator("body")).not.toContainText(new RegExp(others.map(esc).join("|")), { timeout: 1_000 });
    expect(where).toBeTruthy();
  };
  await expect(page.getByRole("cell", { name: `${s.cases!.report} · de`, exact: true })).toBeVisible();
  await noOthers("My tasks");
  await page.getByRole("link", { name: /^View paused task/ }).or(page.getByRole("button", { name: /^View paused task/ })).first().click();
  await expect(page.getByTestId("annotator-identity")).toHaveText(`as ${person(s, "annotator")}`);
  await expect(page.getByText("The German text drops the second seizure episode", { exact: false }).first()).toBeVisible();
  await noOthers("paused task screen");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "My tasks", level: 1 })).toBeVisible();
  await page.getByRole("row").filter({ hasText: `${s.cases!.choose_final} · de` }).getByRole("link", { name: /^View/ })
    .or(page.getByRole("row").filter({ hasText: `${s.cases!.choose_final} · de` }).getByRole("button", { name: /^View/ })).first().click();
  await expect(page.getByTestId("annotator-identity")).toHaveText(`as ${person(s, "annotator")}`);
  await noOthers("submitted task screen");
});

test("lead lands on Documents of the last project (D7)", async ({ page }) => {
  const a = await leadScenario(page, "DEFAULT_IMPORT");
  const b = await leadScenario(page, "DEFAULT_IMPORT");
  // One lead of both projects (every role there, no tasks).
  const username = `lead-d7-${a.project.slice(-8)}`;
  const query = new URLSearchParams({ username, pseudonym: username, display_name: "Dana Lead", projects: `${a.project},${b.project}`, assign: "none" });
  const created = await page.request.post(`/__test_user__?${query.toString()}`);
  expect(created.ok(), await created.text()).toBeTruthy();
  const loginDana = async () => {
    await page.goto("/");
    const form = page.getByRole("form", { name: "Log in to Ontocurator" });
    await form.getByLabel("Username", { exact: true }).fill(username);
    await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await form.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByTestId("current-user")).toContainText("Dana Lead");
  };
  await loginDana();
  // First login: Documents of a led project.
  await expect(page).toHaveURL(new RegExp(`#/projects/(${esc(a.project)}|${esc(b.project)})/documents`));
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  const first = page.url().includes(a.project) ? a.project : b.project;
  const other = first === a.project ? b.project : a.project;

  // Open the other project's Documents, log out and in again: the last project.
  await page.goto(`/#/projects/${encodeURIComponent(other)}/documents`);
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("form", { name: "Log in to Ontocurator" })).toBeVisible();
  await loginDana();
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(other)}/documents`));
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  // Opening the app at "#/" also lands there (replace navigation); within a session "My tasks" stays reachable.
  await page.goto("about:blank");
  await page.goto("/#/");
  await expect(page).toHaveURL(new RegExp(`#/projects/${esc(other)}/documents`));
});
