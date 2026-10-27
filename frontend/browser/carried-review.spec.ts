import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginExisting, selectText, submitCase } from "./helpers";

/**
 * Carried-finding review in the editor (editor spec "Testing", plan F10): the T5 data shape
 * (spanless carried "Seizure" plus one added finding), a needs-review input on a corrected
 * text, Work rounds and My submissions across three rounds, a keyboard-only pass and axe.
 * Data: ``POST /__test_carry_forward__`` (tests/browser_carry_fixture.py).
 */

type CarryScenarioName = "t5" | "corrected" | "rounds3";
interface CarryScenario {
  project: string;
  case_id: string;
  language: string;
  /** Text versions v1 (and v2 for ``corrected``). */
  documents: string[];
  assignment_id: number;
  username: string;
  /** Person label of the annotator (unique per server; never hard-code "ann-0004"). */
  labels: { annotator: string };
  text: string;
  submissions: Record<string, string>;
  rounds: Record<string, string>;
  /** ``t5`` only. */
  note?: string;
  added_annotation_id?: string;
  /** ``corrected`` only. */
  review_reason?: string;
  recreate_span?: { start: number; end: number };
}

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 900 } });

const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/phase0-ux/evidence/e-f10");
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `${name}.png`), fullPage: true });
}

async function carryScenario(page: Page, name: CarryScenarioName): Promise<CarryScenario> {
  const response = await page.request.post("/__test_carry_forward__", { params: { scenario: name }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as CarryScenario;
}

async function openTask(page: Page, name: CarryScenarioName): Promise<CarryScenario> {
  const s = await carryScenario(page, name);
  await loginExisting(page, s.username);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.locator(".text-container")).toBeVisible();
  return s;
}

/** Finding rows (annotations) and placeholder rows (inputs without a finding) of the findings list. */
const findingRow = (page: Page, term: string) => page.locator('.sidebar [data-list-key^="annotation:"]').filter({ hasText: term });
const placeholderRow = (page: Page) => page.locator('.sidebar [data-list-key^="input:"]');
const progress = (page: Page) => page.locator(".carried-progress__status");
const carriedSection = (page: Page) => page.getByRole("region", { name: "Carried finding", exact: true });
const submitButton = (page: Page) => page.getByRole("button", { name: /^Finish & submit/ });
const noteField = (page: Page) => page.locator('.inspector-pane textarea[id^="annotation-note-"]');

/** Specific exception sentences per stored review reason (`editor/carried/instructions.ts`). */
const REASON_SENTENCES: Record<string, string> = {
  ambiguous_evidence: "Its text appears more than once in this text, so it could not be placed automatically.",
  changed_segment: "Its text was changed by the correction, so it could not be placed automatically.",
  changed_cue: "Its text was changed by the correction, so it could not be placed automatically.",
};

async function setNote(page: Page, value: string) {
  const field = noteField(page);
  await field.fill(value);
  await field.blur();
  await expect(page.locator(".status-badge")).toHaveText(/Saved/);
}

test("T5: check, edit after check, dismiss and undo, delete, link, Go to and submit", async ({ page }) => {
  const s = await openTask(page, "t5");
  const seizure = findingRow(page, "Seizure");
  const hypotonia = findingRow(page, "Hypotonia");
  const placeholder = placeholderRow(page);

  // The toolbar counts the open check before the submit dialog was ever opened.
  await expect(submitButton(page)).toHaveText("Finish & submit (1 open)");
  await expect(page.getByRole("button", { name: "Next open item", exact: true })).toBeVisible();
  await expect(page.getByText(/^Round 2\W+continued from Round 1$/)).toBeVisible();
  await expect(page.getByText(/^Findings \(2\)$/)).toBeVisible();
  await expect(progress(page)).toHaveText("0 of 1 checked");
  await expect(seizure).toContainText("Check needed");
  await expect(seizure).toContainText("Carried from Round 1");
  await expect(seizure).toContainText("No text span. Check that it still applies to this text.");
  await expect(hypotonia).not.toContainText("Check needed");
  // Carried rows lead the findings list (spec section 1).
  await expect(page.locator(".sidebar ul.doc-list [data-list-key]").first()).toContainText("Seizure");

  // Check: badge, progress, collapsed section with focus.
  await seizure.click();
  const section = carriedSection(page);
  await expect(section).toContainText(/Carried from Round 1 \(submitted \d{1,2} \w{3}, \d{2}:\d{2}\)/);
  await expect(section).toContainText("None. This finding had no text span in Round 1 either.");
  await expect(section).toContainText("Carried unchanged. Carrying does not confirm values.");
  await expect(section).toContainText(s.note!);
  await expect(section).toContainText("Any later change to this finding needs a new check.");
  await section.getByRole("button", { name: "Mark as checked", exact: true }).click();
  await expect(progress(page)).toHaveText("All carried findings checked");
  await expect(seizure).toContainText("Checked");
  await expect(seizure).not.toContainText("Check needed");
  await expect(section.locator("[data-carried-collapsed]")).toBeFocused();
  await expect(section).toContainText(/Checked\W+Carried from Round 1 \(submitted /);
  await expect(submitButton(page)).toHaveText("Finish & submit text");
  await expect(page.getByRole("button", { name: "Next open item", exact: true })).toHaveCount(0);

  // Edit after the check: "Check needed" plus "Changed after your check".
  const edited = "Reported by the parents; confirmed by the neurologist.";
  await setNote(page, edited);
  await expect(seizure).toContainText("Check needed");
  await expect(seizure).toContainText("Changed after your check");
  await expect(seizure).toContainText("Changed after your check. Check it again.");
  await expect(section).toContainText("You changed this finding after checking it. Check it again.");
  await expect(progress(page)).toHaveText("0 of 1 checked");
  await expect(submitButton(page)).toHaveText("Finish & submit (1 open)");

  // "Does not apply…" with a reason removes the carried finding: a dismissed placeholder row.
  const reason = "Not part of this report after the correction.";
  await section.getByRole("button", { name: "Does not apply…", exact: true }).click();
  await section.getByRole("textbox", { name: /Why does this finding not apply to this text\?/ }).fill(reason);
  await section.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(seizure).toHaveCount(0);
  await expect(placeholder).toHaveCount(1);
  await expect(placeholder).toContainText(`Dismissed: ${reason}`);
  await expect(placeholder).toHaveAttribute("aria-pressed", "true");
  await expect(placeholder).toHaveAccessibleName("Seizure, carried, not on this text, dismissed");
  await expect(progress(page)).toHaveText("All carried findings checked");
  const undo = carriedSection(page).getByRole("button", { name: "Undo dismissal", exact: true });
  await expect(undo).toBeFocused();
  await expect(carriedSection(page)).toContainText(`Dismissal reason: ${reason}`);
  await evidence(page, "t5-dismissed");

  // Undo restores the carried finding as it was at the dismissal (edited note), "Check needed".
  await undo.click();
  await expect(seizure).toHaveCount(1);
  await expect(placeholder).toHaveCount(0);
  await expect(seizure).toContainText("Check needed");
  await expect(seizure).toHaveAttribute("aria-pressed", "true");
  await expect(noteField(page)).toHaveValue(edited);
  await expect(carriedSection(page).getByRole("button", { name: "Mark as checked", exact: true })).toBeFocused();
  await expect(progress(page)).toHaveText("0 of 1 checked");

  // The submit dialog lists the open check with its own "Go to", which focuses "Mark as checked".
  await submitButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Submit text" });
  await expect(dialog).toContainText("1 carried finding still needs a check");
  await expect(dialog.locator("[data-open-item]")).toHaveCount(1);
  await expect(dialog.locator("[data-open-item]")).toContainText("Seizure");
  const submit = dialog.getByRole("button", { name: "Submit text", exact: true });
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await expect(submit).toHaveAccessibleDescription("Check 1 carried finding before submitting.");
  await dialog.getByRole("button", { name: "Go to Seizure", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(seizure).toHaveAttribute("aria-pressed", "true");
  await expect(carriedSection(page).getByRole("button", { name: "Mark as checked", exact: true })).toBeFocused();

  // Delete: the carried delete confirmation, then the placeholder with "Dismiss with reason…" focused.
  await page.getByRole("button", { name: "Delete finding", exact: true }).click();
  const confirm = page.getByRole("group", { name: "Confirm deletion" });
  await expect(confirm).toContainText("This is a carried finding. After deleting it, you must link another finding or dismiss it with a reason.");
  await confirm.getByRole("button", { name: "Yes, delete", exact: true }).click();
  await expect(seizure).toHaveCount(0);
  await expect(placeholder).toHaveAccessibleName("Seizure, carried, not on this text, check needed");
  await expect(placeholder).toHaveAttribute("aria-pressed", "true");
  await expect(placeholder).toContainText("Not on this text");
  await expect(placeholder).toContainText("You deleted the carried finding. Link another finding or dismiss it.");
  const exception = carriedSection(page);
  await expect(exception).toContainText("You deleted the carried finding in this round.");
  await expect(exception).toContainText("No text span");
  const dismiss = exception.getByRole("button", { name: "Dismiss with reason…", exact: true });
  await expect(dismiss).toBeFocused();

  // Dismiss needs a reason; then undo restores nothing (the finding was deleted, not dismissed).
  await dismiss.click();
  const confirmDismiss = exception.getByRole("button", { name: "Dismiss", exact: true });
  // Without a reason the button stays focusable but unavailable; activating it names the reason.
  await expect(confirmDismiss).toHaveAttribute("aria-disabled", "true");
  await confirmDismiss.focus();
  await page.keyboard.press("Enter");
  await expect(exception).toContainText("Give a reason to dismiss this finding.");
  await exception.getByRole("textbox", { name: /Why does this finding not apply to this text\?/ }).fill("Duplicate of another finding.");
  await confirmDismiss.click();
  await expect(placeholder).toContainText("Dismissed: Duplicate of another finding.");
  await exception.getByRole("button", { name: "Undo dismissal", exact: true }).click();
  await expect(placeholder).toHaveAccessibleName("Seizure, carried, not on this text, check needed");
  await expect(seizure).toHaveCount(0);
  await expect(progress(page)).toHaveText("0 of 1 checked");

  // Link via the chooser (radio group, Hypotonia is the only finding of this type).
  const linkTrigger = exception.getByRole("button", { name: "Link to an existing finding…", exact: true });
  await linkTrigger.click();
  const chooser = exception.getByRole("group", { name: "Link to an existing finding", exact: true });
  await expect(chooser.getByRole("radio")).toHaveCount(1);
  const option = chooser.getByRole("radio", { name: /^Hypotonia\W+“Hypotonie”$/ });
  await expect(option).toBeChecked();
  await expect(option).toBeFocused();
  await exception.getByRole("button", { name: "Link and mark as checked", exact: true }).click();
  await expect(progress(page)).toHaveText("All carried findings checked");
  await expect(hypotonia).toContainText("Checked");
  await expect(hypotonia).toContainText("Linked to carried Seizure (Round 1)");
  await expect(submitButton(page)).toHaveText("Finish & submit text");
  await evidence(page, "t5-linked");

  // Submit succeeds once every carried finding is checked.
  await submitCase(page);
});

test("corrected text: placeholder with the specific reason; Mark in text, save, Mark as checked", async ({ page }) => {
  const s = await openTask(page, "corrected");
  const placeholder = placeholderRow(page);
  await expect(placeholder).toHaveAccessibleName("Seizure, carried, not on this text, check needed");
  await expect(placeholder).toContainText("Not on this text");
  await expect(placeholder).toContainText("Could not be placed on this text. Mark it again, link it or dismiss it.");
  await expect(progress(page)).toHaveText("0 of 1 checked");
  await placeholder.click();
  const exception = carriedSection(page);
  const sentence = REASON_SENTENCES[s.review_reason!];
  expect(sentence, `Known sentence for review reason ${s.review_reason}`).toBeTruthy();
  await expect(exception).toContainText(sentence);
  await expect(exception).toContainText("“Krampfanfälle”");
  // Actions in spec order: Mark in text, Link to an existing finding…, Dismiss with reason….
  await expect(exception.locator(".carried-actions").getByRole("button")).toHaveText(["Mark in text", "Link to an existing finding…", "Dismiss with reason…"]);
  await evidence(page, "corrected-placeholder");

  await exception.getByRole("button", { name: "Mark in text", exact: true }).click();
  await expect(page.getByText("Select supporting text to re-create Seizure.")).toBeVisible();
  await selectText(page, s.recreate_span!.start, s.recreate_span!.end);
  await page.getByRole("button", { name: "Save re-created finding", exact: true }).click();
  const recreated = findingRow(page, "Seizure");
  await expect(recreated).toHaveCount(1);
  // Saving links the new finding only; it still needs an explicit check.
  await expect(recreated).toContainText("Check needed");
  await expect(progress(page)).toHaveText("0 of 1 checked");
  // The saved finding is selected; its carried section offers the check.
  await expect(recreated).toHaveAttribute("aria-pressed", "true");
  await expect(recreated).toContainText("Linked to carried Seizure (Round 1)");
  await expect(placeholder).toContainText("Linked to Seizure");
  await carriedSection(page).getByRole("button", { name: "Mark as checked", exact: true }).click();
  await expect(progress(page)).toHaveText("All carried findings checked");
  await expect(recreated).toContainText("Checked");
});

test("rounds3: Work rounds table, the still-open reason and My submissions across rounds", async ({ page }) => {
  const s = await openTask(page, "rounds3");
  await expect(page.getByText(/^Round 3\W+continued from Round 2$/)).toBeVisible();

  await page.getByRole("button", { name: "Work rounds", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`^Work rounds\\W+${s.documents[0]}\\W+de$`) });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Each round keeps its starting point and its submissions. Starting a round does not change the final result.");
  const table = dialog.getByRole("table", { name: "Rounds" });
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  const cells = (row: Locator) => row.locator("th, td");
  const time = /\d{1,2} \w{3}, \d{2}:\d{2}/;
  // Round state and submission are separate facts, side by side in one row.
  await expect(cells(rows.nth(0)).nth(0)).toContainText("Round 1");
  await expect(cells(rows.nth(0)).nth(1)).toHaveText("Replaced by Round 2");
  await expect(cells(rows.nth(0)).nth(2)).toHaveText(new RegExp(`^Submitted ${time.source}$`));
  await expect(cells(rows.nth(0)).nth(3)).toHaveText("None");
  await expect(cells(rows.nth(1)).nth(0)).toContainText("Round 2");
  await expect(cells(rows.nth(1)).nth(0)).toContainText("from Round 1 submission");
  await expect(cells(rows.nth(1)).nth(1)).toHaveText("Replaced by Round 3");
  await expect(cells(rows.nth(1)).nth(2)).toHaveText(new RegExp(`^Submitted ${time.source}$`));
  await expect(cells(rows.nth(1)).nth(3)).toHaveText("1 finding");
  await expect(cells(rows.nth(2)).nth(0)).toContainText("Round 3");
  await expect(cells(rows.nth(2)).nth(0)).toContainText("You are here");
  await expect(rows.nth(2).locator('[aria-current="true"]')).toHaveText("You are here");
  await expect(cells(rows.nth(2)).nth(1)).toHaveText("Open");
  await expect(cells(rows.nth(2)).nth(2)).toHaveText("Not submitted yet");
  await expect(rows.nth(2).getByRole("button")).toHaveCount(0);
  await expect(rows.nth(0).getByRole("button", { name: "Open Round 1", exact: true })).toBeVisible();
  // No raw states or IDs outside Technical details.
  await expect(table).not.toContainText(/superseded|editable|carry-forward|round-/i);
  await expect(dialog).toContainText("You can continue from a submission once Round 3 is submitted. Round 3 is still open.");
  await expect(dialog.getByRole("radiogroup")).toHaveCount(0);
  await evidence(page, "rounds3-work-rounds");
  await dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();

  // My submissions: both submitted rounds, oldest first, and the open round.
  const mine = page.getByRole("region", { name: "My submissions", exact: true });
  const items = mine.locator("li");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText(new RegExp(`^Round 1\\W+${time.source}\\W+1 finding`));
  await expect(items.nth(1)).toContainText(new RegExp(`^Round 2\\W+${time.source}\\W+1 finding`));
  await expect(items.nth(2)).toHaveText(/^Round 3\W+not submitted yet$/);
  await items.nth(0).getByRole("button", { name: /^View Round 1\W/ }).click();
  const history = page.getByRole("dialog", { name: "Historical submission", exact: true });
  await expect(history).toBeVisible();
  await expect(history.getByRole("heading", { level: 2 })).toHaveText(new RegExp(`^Round 1\\W+${time.source}$`));
  await expect(history).toContainText("Seizure");
  await history.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(history).toBeHidden();
});

test("keyboard only: N selects, Go to focuses Mark as checked, C checks; axe has no violations", async ({ page }) => {
  await openTask(page, "t5");
  const seizure = findingRow(page, "Seizure");
  await page.locator(".text-container").focus();
  await page.keyboard.press("n");
  await expect(seizure).toHaveAttribute("aria-pressed", "true");
  const section = carriedSection(page);
  await expect(section.getByRole("button", { name: "Mark as checked", exact: true })).toBeVisible();

  // Axe (WCAG 2.x A/AA) on the editor with the carried section open, and the carried section with every rule.
  const describe = (results: Awaited<ReturnType<AxeBuilder["analyze"]>>) =>
    results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
  const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
  expect(describe(await new AxeBuilder({ page }).include("main").withTags(wcag).analyze())).toEqual([]);
  expect(describe(await new AxeBuilder({ page }).include(".carried-section").analyze())).toEqual([]);

  // Toolbar submit → dialog → "Go to Seizure", by keyboard.
  await submitButton(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Submit text" });
  await expect(dialog).toBeVisible();
  const goTo = dialog.getByRole("button", { name: "Go to Seizure", exact: true });
  for (let step = 0; step < 15 && !(await goTo.evaluate(element => element === document.activeElement)); step++) await page.keyboard.press("Tab");
  await expect(goTo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(section.getByRole("button", { name: "Mark as checked", exact: true })).toBeFocused();

  // C marks the selected carried finding as checked; focus moves to the collapsed line.
  await page.keyboard.press("c");
  await expect(progress(page)).toHaveText("All carried findings checked");
  await expect(section.locator("[data-carried-collapsed]")).toBeFocused();
  await expect(seizure).toContainText("Checked");
  // Nothing is left to check: N does not move the selection.
  await page.keyboard.press("n");
  await expect(seizure).toHaveAttribute("aria-pressed", "true");
});
