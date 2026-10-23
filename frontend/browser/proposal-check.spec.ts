/**
 * Annotation from tool proposals end to end (plan T2): the lead assigns two annotations from proposals in the text
 * card, both annotators decide the proposals with J/K and 1–4, the lead compares, consolidates and accepts; an
 * annotator working from scratch never sees the proposals. Scenarios: tests/browser_proposal_check_scenarios.py.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cardRow, cardSegment, documentsReady, openTextCard, robotIcon, showSegment, textCard } from "./documentsHelpers";
import { openCase, submitCase } from "./helpers";
import { loginScenarioUser, proposalCheckScenario, type ProposalCheckPerson, type ProposalCheckScenario } from "./proposalCheckHelpers";

test.setTimeout(300_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

const CASE = "EN100024";
const SCRATCH = "EN100031";

async function openDocuments(page: Page, s: ProposalCheckScenario): Promise<void> {
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
}

/** Switch the browser session to another scenario person. */
async function switchTo(page: Page, s: ProposalCheckScenario, person: ProposalCheckPerson): Promise<void> {
  await page.context().clearCookies();
  await loginScenarioUser(page, s, person);
}

/** "+ Person" in the card's Annotation part: choose ``name`` in the assign dialog and assign. */
async function assignPerson(page: Page, card: Locator, name: string): Promise<void> {
  await showSegment(card, "Annotation");
  await card.getByRole("button", { name: "+ Person", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Assign / });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("table", { name: "Members" }).getByLabel(new RegExp(`^${name}`)).check();
  const saved = page.waitForResponse(r => r.request().method() === "POST" && /\/assignments/.test(r.url()));
  await dialog.getByRole("button", { name: /^Assign( \d+)?$/ }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByText(name, { exact: false }).first()).toBeVisible();
}

const targets = (page: Page) => page.locator('.sidebar [data-list-key^="target:"]');

/** Walk the proposals with J and decide each with its key ("1" confirm, "2" reject, "3" edit & replace). */
async function decideProposals(page: Page, keys: readonly ("1" | "2" | "3")[], words: readonly string[]): Promise<void> {
  await expect(targets(page)).toHaveCount(keys.length);
  for (const [index, key] of keys.entries()) {
    await page.locator("body").press("j");
    await expect(targets(page).nth(index)).toHaveClass(/\bselected\b/);
    if (index === 1) {
      // K walks back, J forward again.
      await page.keyboard.press("k");
      await expect(targets(page).nth(0)).toHaveClass(/\bselected\b/);
      await page.keyboard.press("j");
      await expect(targets(page).nth(1)).toHaveClass(/\bselected\b/);
    }
    await page.keyboard.press(key);
    if (key === "3") {
      // Edit & Replace opens an editable copy; it counts as a correction once it differs (p3 says "absent").
      const changed = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON()?.payload?.command === "set_axes");
      await page.locator('[data-axis-field="assertion"] input[type="radio"][value="present"]').check();
      expect((await changed).ok()).toBeTruthy();
    }
    await expect(targets(page).nth(index)).toContainText(words[index]);
  }
}

/** Resolve every open group: keep where nothing conflicts, else take a whole finding. */
async function consolidateAll(page: Page): Promise<void> {
  const submit = page.locator(".cons-submit").getByRole("button", { name: "Submit consolidation", exact: true });
  const groups = page.locator(".cons-group");
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    const group = groups.nth(index);
    if (!(await group.locator(".cons-group-state").count())) continue;
    const toggle = group.locator(".cons-group-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const take = group.getByRole("button", { name: /^Take \S+'s finding$/ });
    const keep = group.getByRole("button", { name: /^Keep/ });
    await expect(take.or(keep).first()).toBeVisible();
    await (await keep.count() ? keep : take).first().click();
    // Saved: the group's line reads "decided: …".
    await expect(group.locator(".cons-group-done")).toBeVisible();
  }
  await expect(submit).not.toHaveAttribute("aria-disabled", "true");
  await submit.click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  const ack = dialog.getByRole("checkbox", { name: "I checked these values" });
  const done = page.getByText("Consolidation submitted. Accept the result in Documents.", { exact: true });
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  // Confirmed proposals leave default axis values: the server asks for an acknowledgement first.
  await expect(ack).toBeVisible();
  await ack.check();
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(done).toBeVisible();
}

test("the lead assigns two annotations from proposals, both work with J/K and 1–4, compare, consolidate and accept", async ({ page }) => {
  const s = await proposalCheckScenario(page, "FRESH");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s);
  const row = cardRow(page, CASE, "en");
  await expect(robotIcon(row, 3)).toBeVisible();

  // A row click selects the text and opens its card on Annotation.
  await row.getByRole("cell").nth(1).click();
  let card = textCard(page, CASE, "en");
  await expect(card).toBeVisible();
  await expect(cardSegment(card, "Annotation")).toHaveAttribute("aria-current", "step");
  await expect(cardSegment(card, "Annotation")).toContainText("3 proposals");
  await expect(card.getByText("Annotation, from proposals", { exact: true })).toBeVisible();
  await assignPerson(page, card, s.display_names.tom);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(robotIcon(row)).toHaveCount(0);

  // Tom: My tasks names the mode and the date; the editor works through the three proposals.
  await switchTo(page, s, "tom");
  const task = page.getByRole("row").filter({ hasText: CASE });
  await expect(task).toContainText("Annotation, from proposals");
  await expect(task).toContainText("assigned today");
  await openCase(page, { task: "annotate", projectKey: s.project, documentId: s.cases[CASE] });
  await expect(page.getByTitle("You see the tool's proposals, never other people's work.", { exact: true })).toHaveText("Annotate from proposals");
  // p1 confirmed, p2 rejected, p3 corrected through Edit & Replace (key 3), as in the editor's change flow.
  await decideProposals(page, ["1", "2", "3"], ["Confirmed", "Rejected", "Replaced"]);
  await submitCase(page);

  // The lead assigns Mia the same way; she confirms every proposal.
  await switchTo(page, s, "lead");
  await openDocuments(page, s);
  card = await openTextCard(page, CASE, "en");
  await assignPerson(page, card, s.display_names.mia);
  await switchTo(page, s, "mia");
  await openCase(page, { task: "annotate", projectKey: s.project, documentId: s.cases[CASE] });
  await expect(page.getByTitle("You see the tool's proposals, never other people's work.", { exact: true })).toHaveText("Annotate from proposals");
  await decideProposals(page, ["1", "1", "1"], ["Confirmed", "Confirmed", "Confirmed"]);
  await submitCase(page);

  // Lead: compare, consolidate (self), accept.
  await switchTo(page, s, "lead");
  await openDocuments(page, s);
  // "Compare results…" is the row's next step; it opens the card on Finalization with the comparison.
  await cardRow(page, CASE, "en").getByRole("button", { name: `Compare results…, ${CASE} en`, exact: true }).click();
  card = textCard(page, CASE, "en");
  await expect(cardSegment(card, "Finalization")).toHaveAttribute("aria-current", "step");
  await expect(cardSegment(card, "Finalization")).toContainText("ready to compare");
  await card.getByRole("button", { name: "Consolidate…", exact: true }).click();
  const launcher = card.getByRole("region", { name: "Consolidate submitted results", exact: true });
  await launcher.getByLabel("Consolidation reviewer", { exact: true }).selectOption(s.users.lead);
  const started = page.waitForResponse(r => r.request().method() === "POST" && /\/projects\/[^/]+\/consolidations$/.test(r.url()));
  await launcher.getByRole("button", { name: "Start consolidation", exact: true }).click();
  const { round } = await (await started).json() as { round: { assignment_id: number } };
  await page.goto(`/#/tasks/${round.assignment_id}`);
  await expect(page.getByRole("heading", { level: 1, name: /^Consolidate EN100024 en v1$/ })).toBeVisible({ timeout: 30_000 });
  await consolidateAll(page);

  await openDocuments(page, s);
  card = await openTextCard(page, CASE, "en");
  await showSegment(card, "Finalization");
  const accepted = page.waitForResponse(r => r.request().method() === "PUT" && /\/final-selections$/.test(new URL(r.url()).pathname));
  await card.getByRole("button", { name: "Accept result…", exact: true }).click();
  await expect(card.getByRole("heading", { name: "Accept result?", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Accept result", exact: true }).click();
  expect((await accepted).ok()).toBeTruthy();
  await expect(cardSegment(card, "Finalization")).toContainText(/accepted \d{1,2} [A-Z][a-z]{2}/);
});

test("an annotator working from scratch never sees proposals", async ({ page }) => {
  const s = await proposalCheckScenario(page, "FRESH");
  await loginScenarioUser(page, s, "lead");
  await openDocuments(page, s);
  const card = await openTextCard(page, SCRATCH, "en");
  await expect(card.getByText("Annotation, from scratch", { exact: true })).toBeVisible();
  await assignPerson(page, card, s.display_names.ali);

  await switchTo(page, s, "ali");
  await openCase(page, { task: "annotate", projectKey: s.project, documentId: s.cases[SCRATCH] });
  await expect(page.getByTitle("You see neither the tool's proposals nor other people's work.", { exact: true })).toHaveText("Annotate from scratch");
  // The sidebar has loaded (its findings header) before the absence check.
  await expect(page.locator(".sidebar").getByText(/^Findings \(\d+\)$/)).toBeVisible();
  await expect(targets(page)).toHaveCount(0);

  // The text view greys the proposals with the reason.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/cases/${SCRATCH}?variant=${encodeURIComponent(s.cases[SCRATCH])}`);
  const show = page.getByRole("combobox", { name: "Show", exact: true });
  await expect(show).toBeVisible({ timeout: 30_000 });
  const proposals = show.locator("option", { hasText: "Tool proposals (3)" });
  await expect(proposals).toBeDisabled();
  await expect(proposals).toContainText("Hidden while you annotate from scratch");
});
