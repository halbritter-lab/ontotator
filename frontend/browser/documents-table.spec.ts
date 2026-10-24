/**
 * Documents lead table: rendering of the scenarios S0 to S10 and S13 on the one-line stage table of the
 * documents overview (spec "Table", "Stage cells", V1 to V6; spec 2026-10-23 §2b one-line rows) and the
 * text card (U3): one slim case line per case, one row per text with eight columns (checkbox, Text,
 * Translation, Annotation, Finalization, Waiting on, Next step, Last activity), the modal text card
 * (path, decision block, History, Text details) without any layout shift of the table.
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and logs in as its lead.
 * Stage cells name people by display name; Waiting on uses "Display name (pseudonym)" (D1).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import {
  activityLines, documentsReady, documentsScenario, documentsTab, documentsTable, filterChip, openCardHistory, openDecisionBlock,
  openFilters, openTextCard, rowAction, rowBox, rowCell, showSegment, textCard, textName, textNamePattern, textRow, textVersionItems,
  type DocumentsScenario,
} from "./documentsHelpers";
import { authenticatedRequest, loginExisting } from "./helpers";

type Member = components["schemas"]["Member"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface People {
  /** Display name per fixture role name (stage cells). */
  names: Record<string, string>;
  /** "Display name (pseudonym)" per fixture role name (Waiting on, history). */
  labels: Record<string, string>;
}

/** Display names and person labels per fixture role name, read from the project members. */
async function peopleOf(page: Page, s: DocumentsScenario): Promise<People> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/members`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const members = (await response.json()) as Member[];
  const byUsername = new Map(members.map(member => [member.username, member]));
  const names: Record<string, string> = {};
  const labels: Record<string, string> = {};
  for (const [name, username] of Object.entries(s.users)) {
    const member = byUsername.get(username);
    names[name] = member?.display_name || username;
    labels[name] = member ? `${member.display_name} (${member.pseudonym})` : username;
  }
  return { names, labels };
}

/** Build scenario ``name``, log in as its lead and open Documents (with an optional query). */
async function openScenario(page: Page, name: string, query = "") {
  const s = await documentsScenario(page, name);
  await loginExisting(page, s.users.lead);
  const people = await peopleOf(page, s);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents${query}`);
  await documentsReady(page);
  return { s, ...people };
}

/** The case IDs of the table's rows in order, each once (the flat list has no case lines). */
const casesInOrder = (page: Page): Promise<string[]> =>
  documentsTable(page).locator("th[scope=row] .documents-row-case .documents-id").evaluateAll(ids => [...new Set(ids.map(id => id.getAttribute("title") ?? ""))]);

/** Language codes of a case's rows in table order (from the text names "Open text card, {case} {language}"). */
async function languagesInOrder(page: Page, caseId: string): Promise<string[]> {
  const names = await documentsTable(page).getByRole("button", { name: new RegExp(`^Open text card, ${esc(caseId)} `) }).evaluateAll(
    buttons => buttons.map(button => button.getAttribute("aria-label") ?? ""),
  );
  return names.map(name => name.split(" ").pop() ?? "");
}

/** The card's "Open result" opens this document id (its `variant` route parameter). */
async function resultVariant(card: Locator): Promise<string | null> {
  await showSegment(card, "Finalization");
  const href = await card.getByRole("link", { name: "Open result", exact: true }).getAttribute("href");
  return new URLSearchParams(decodeURIComponent(href ?? "").split("?")[1]).get("variant");
}

/** Every row of the project has a decision edge class or not. */
const hasDecisionEdge = async (row: Locator) => (await row.getAttribute("class"))?.includes("data-table-row--decision") ?? false;

/** Close the open text card with its ✕. */
async function closeCard(card: Locator): Promise<void> {
  await card.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card).toHaveCount(0);
}

test("S0 synthetic-accepted: the final is on old text after v2 corrected it; en has nothing to decide", async ({ page }) => {
  const { s, names } = await openScenario(page, "S0");
  const caseId = "synthetic-accepted";
  const ann = esc(names["ann-0004"]);

  // Flat list: no case line, the case ID in each Text cell (the en source is planned, so it has its own row); one decision (de) in the tab.
  await expect(documentsTable(page).locator("th[scope=rowgroup]")).toHaveCount(0);
  await expect(textRow(page, caseId, "en").getByRole("rowheader")).toContainText(caseId);
  await expect(rowBox(page, caseId, "en")).toBeVisible();
  expect(await languagesInOrder(page, caseId)).toEqual(["en", "de"]);
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();

  // en: the source, annotation unassigned, finalization waiting and nothing to decide.
  const en = textRow(page, caseId, "en");
  await expect(rowCell(en, "translation")).toContainText("source text");
  await expect(rowCell(en, "annotation")).toContainText(/Unassigned|\d+ of \d+ assigned/);
  await expect(rowCell(en, "finalization")).toContainText("waiting");
  await expect(rowCell(en, "next").getByRole("button")).toHaveAccessibleName(textNamePattern("Assign annotation…, ", caseId, "en"));
  expect(await hasDecisionEdge(en)).toBe(false);
  const enCard = await openTextCard(page, caseId, "en");
  await expect(await textVersionItems(enCard, 1)).toHaveText([/^v1\s*Native/]);
  await closeCard(enCard);

  // de: v2 corrects the text of the final result chosen on v1: "Final is on old text", Review changes…, decision edge.
  const de = textRow(page, caseId, "de");
  expect(await hasDecisionEdge(de)).toBe(true);
  await expect(de.getByRole("rowheader")).toContainText("v2 corrected");
  await expect(rowCell(de, "finalization")).toContainText("Final is on old text");
  await expect(rowCell(de, "annotation")).toContainText(new RegExp(`\\d+ of \\d+ submitted \\(${ann}\\)`));
  await expect(rowCell(de, "waiting")).toHaveText("You");
  await expect(rowCell(de, "next").getByRole("button").first()).toHaveAccessibleName(textNamePattern("Review changes…, ", caseId, "de"));

  // The decision lives in the card's Finalization part (V6): the text change and "Keep final on v1".
  await rowAction(page, "Review changes…", caseId, "de").click();
  const card = textCard(page, caseId, "de");
  const block = await openDecisionBlock(page, caseId, "de");
  await expect(block).toBeVisible();
  await expect(block.getByText("The text changed from v1 to v2 after this final was chosen.", { exact: true })).toBeVisible();
  await expect(block.getByRole("button", { name: "Keep final on v1", exact: true })).toBeVisible();
  // "Open result" opens the version of the final result (v1), not the newest version.
  expect(await resultVariant(card)).toBe(s.documents!.v1);
  await closeCard(card);

  const history = await openCardHistory(page, caseId, "de");
  await expect(activityLines(history).filter({ hasText: /^Finalization: chosen/ })).toHaveCount(1);
  await history.getByRole("button", { name: "Back", exact: true }).click();
  await expect(await textVersionItems(history, 2)).toHaveText([/^v1\s*Machine translation/, /^v2\s*Correction of v1\s*Ready for review/]);
  await closeCard(history);

  // The decision category link selects the de row only.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=confirm-final`);
  await documentsReady(page);
  await expect(textRow(page, caseId, "de")).toBeVisible();
  await expect(textName(page, caseId, "en")).toHaveCount(0);
});

test("S0 with the text card open (legacy open= link) has no axe violations", async ({ page }) => {
  await openScenario(page, "S0", "?open=synthetic-accepted%3Ade");
  const card = textCard(page, "synthetic-accepted", "de");
  await expect(card).toBeVisible();
  await expect(card.getByRole("navigation", { name: "Text path", exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).include("main").include(".text-card").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const violations = results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
  expect(violations).toEqual([]);
});

test("S1 case-0042: two submissions and a final result, nothing to do", async ({ page }) => {
  const { s } = await openScenario(page, "S1");
  const caseId = "case-0042";

  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
  await expect(documentsTab(page, "Done", 1)).toBeVisible();
  await expect(rowBox(page, caseId, "en")).toBeVisible();

  const en = textRow(page, caseId, "en");
  await expect(rowCell(en, "annotation")).toContainText("2 of 2 submitted");
  await expect(rowCell(en, "finalization")).toContainText(/accepted \d{1,2} [A-Z][a-z]{2}/);
  await expect(rowCell(en, "waiting")).toHaveText("—");
  await expect(rowCell(en, "next")).toHaveText("");
  expect(await hasDecisionEdge(en)).toBe(false);

  // History: both submissions and the final choice (the Submissions table is in the decision block, V6).
  const card = await openCardHistory(page, caseId, "en");
  await expect(activityLines(card).filter({ hasText: /^Annotation: .*Round 1/ })).toHaveCount(2);
  await expect(activityLines(card).filter({ hasText: /^Finalization: chosen/ })).toHaveCount(1);
  await closeCard(card);

  // "Final result: none" (FD11 link parameter, a chip): nothing matches.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?final=none`);
  await documentsReady(page);
  await expect(filterChip(page, "Final result: None")).toBeVisible();
  await expect(textName(page, caseId, "en")).toHaveCount(0);
  await expect(page.getByText("No texts match these filters.", { exact: true })).toBeVisible();
});

test("S2 case-0108: seven languages, final 4 of 7, de failed its automatic check", async ({ page }) => {
  await openScenario(page, "S2");
  const caseId = "case-0108";

  await expect(textRow(page, caseId, "en").locator(".documents-row-case")).toHaveText(caseId);
  // A failed check without a reviewer is "To assign", not a decision (D4).
  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
  await expect(documentsTab(page, "To assign", 6)).toBeVisible();
  // Source language first, then by language code.
  expect(await languagesInOrder(page, caseId)).toEqual(["en", "de", "es", "fr", "it", "nl", "pt"]);

  // Final 4 of 7: en, es, fr and it have a final result (accepted); de, nl and pt wait.
  for (const language of ["en", "es", "fr", "it"]) {
    await expect(rowCell(textRow(page, caseId, language), "finalization"), language).toContainText(/accepted/);
  }
  for (const language of ["de", "nl", "pt"]) await expect(rowCell(textRow(page, caseId, language), "finalization"), language).toContainText("waiting");

  const de = textRow(page, caseId, "de");
  await expect(rowCell(de, "translation")).toContainText("Check failed");
  await expect(rowCell(de, "next").getByRole("button").first()).toHaveAccessibleName(textNamePattern("Assign review…, ", caseId, "de"));
  expect(await hasDecisionEdge(de)).toBe(false);
  await expect(rowCell(textRow(page, caseId, "nl"), "translation")).not.toContainText("Check failed");
  await expect(rowCell(textRow(page, caseId, "nl"), "translation")).toContainText("Unassigned");

  const card = await openTextCard(page, caseId, "de");
  await expect(await textVersionItems(card, 1)).toHaveText([/^v1\s*Machine translation\s*Check failed/]);
  await closeCard(card);

  // Facet "No final yet" (replaces the filter "Final result: none") lists exactly the three rows without a final result.
  const filters = await openFilters(page);
  await filters.getByRole("checkbox", { name: "No final yet, 3 texts", exact: true }).check();
  await expect(filterChip(page, "Final: No final yet")).toBeVisible();
  await expect.poll(() => languagesInOrder(page, caseId)).toEqual(["de", "nl", "pt"]);
  // Facet "Check failed" (replaces the translation status filter): the de row only.
  await filters.getByRole("checkbox", { name: "No final yet, 3 texts", exact: true }).uncheck();
  await filters.getByRole("checkbox", { name: "Check failed, 1 text", exact: true }).check();
  await expect.poll(() => languagesInOrder(page, caseId)).toEqual(["de"]);
});

test("S3 case-0211: final on v1 Round 2, corrections v2 and v3, waiting for the v3 review", async ({ page }) => {
  const { s, names } = await openScenario(page, "S3");
  const caseId = "case-0211";

  const de = textRow(page, caseId, "de");
  await expect(de.getByRole("rowheader")).toContainText("v3 corrected");
  await expect(rowCell(de, "translation")).toContainText(`in review (${names.reviewer})`);
  await expect(rowCell(de, "finalization")).toContainText("Final is on old text");
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();

  // The card names the text change and the open v3 review; the lead can keep v1.
  await rowAction(page, "Review changes…", caseId, "de").click();
  const card = textCard(page, caseId, "de");
  const block = await openDecisionBlock(page, caseId, "de");
  await expect(block.getByText(/^The text changed from v1 to v\d after this final was chosen\.$/)).toBeVisible();
  await expect(block).toContainText(`translation review of v3 by ${names.reviewer}`);
  await expect(block.getByRole("button", { name: "Keep final on v1", exact: true })).toBeVisible();
  // The final result is on v1: "Open result" opens v1.
  expect(await resultVariant(card)).toBe(s.documents!.v1);

  await expect(await textVersionItems(card, 3)).toHaveText([/^v1\s*Machine translation/, /^v2\s*Correction of v1\s*Accepted/, /^v3\s*Correction of v2\s*Ready for review/]);
});

test("S4 case-0305 fr: two independent translations, each annotated in its own round", async ({ page }) => {
  const { names } = await openScenario(page, "S4");
  const caseId = "case-0305";

  // Selection is per text (VD4): one checkbox per row, no case checkbox.
  await expect(page.getByRole("checkbox", { name: new RegExp(`^Select ${esc(caseId)} \\(`) })).toHaveCount(0);
  await expect(rowBox(page, caseId, "fr")).toBeVisible();
  const fr = textRow(page, caseId, "fr");
  await expect(fr.getByRole("rowheader")).toContainText("2 translations");
  await expect(rowCell(fr, "annotation")).toContainText(new RegExp(`submitted \\(${esc(names["ann-0001"])}, ${esc(names["ann-0002"])}\\)`));
  await expect(rowCell(fr, "finalization")).toContainText("waiting");

  const card = await openCardHistory(page, caseId, "fr");
  await expect(activityLines(card).filter({ hasText: /^Annotation: .*Round 1/ })).toHaveCount(2);
  await card.getByRole("button", { name: "Back", exact: true }).click();
  await expect(await textVersionItems(card, 2)).toHaveText([/^Provider A m1 v1\s*Machine translation/, /^Provider B m1 v1\s*Machine translation/]);
});

test("S5 case-0377: the lead's consolidation is the final result, without a round in its label", async ({ page }) => {
  await openScenario(page, "S5");
  const caseId = "case-0377";

  const en = textRow(page, caseId, "en");
  await expect(rowCell(en, "finalization")).toContainText(/accepted/);
  await expect(documentsTab(page, "Done", 1)).toBeVisible();
  expect(await hasDecisionEdge(en)).toBe(false);

  // No round in a consolidation's history line.
  const card = await openCardHistory(page, caseId, "en");
  await expect(activityLines(card).filter({ hasText: /^Annotation Consolidation: / })).toHaveCount(1);
  await expect(activityLines(card).filter({ hasText: /^Annotation Consolidation: .*Round/ })).toHaveCount(0);
  await expect(activityLines(card).filter({ hasText: /^Annotation: .*Round 1/ })).toHaveCount(3);
});

test("S6 case-0390 de: open problem report with a paused task", async ({ page }) => {
  const { s, names } = await openScenario(page, "S6");
  const caseId = "case-0390";
  const reason = String(s.reason);

  const de = textRow(page, caseId, "de");
  expect(await hasDecisionEdge(de)).toBe(true);
  // One line: the pause glyph, the card's state and who is paused; the full text (with the reason) is in the title.
  await expect(rowCell(de, "annotation")).toContainText("⏸");
  await expect(rowCell(de, "annotation")).toContainText(`(${names["ann-0001"]})`);
  await expect(rowCell(de, "next").getByRole("button").first()).toHaveAccessibleName(textNamePattern("Decide on report…, ", caseId, "de"));
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();
  void reason;

  const card = await openCardHistory(page, caseId, "de");
  const paused = activityLines(card).filter({ hasText: /^Annotation Task paused/ });
  await expect(paused.getByRole("link", { name: "Open report", exact: true })).toHaveAttribute("href", new RegExp(`/problem-reports/${esc(String(s.report_id))}`));
  await card.getByRole("button", { name: "Back", exact: true }).click();
  await expect(card.locator(".text-card-banner")).toHaveText("1 open problem report, Open");
  await card.getByRole("button", { name: "Details", exact: true }).click();
  const report = card.locator("section", { has: page.getByRole("heading", { name: "Problem reports (1)" }) }).getByRole("listitem");
  await expect(report).toContainText("Report: Open");
  await expect(report).toContainText("Paused tasks: 1");
  await expect(report.locator("time")).toHaveCount(1);
  await card.getByRole("button", { name: "Back", exact: true }).click();
  await closeCard(card);

  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=report-or-pause`);
  await documentsReady(page);
  await expect(textRow(page, caseId, "de")).toBeVisible();
  await expect(textName(page, caseId, "en")).toHaveCount(0);
});

test("S7 300 texts: 50 cases per page, page 1 of 6, a flat list", async ({ page }) => {
  await openScenario(page, "S7");
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages).toContainText("Page 1 of 6");
  const first = await casesInOrder(page);
  expect(first).toHaveLength(50);
  expect([first[0], first[49]]).toEqual(["case-0001", "case-0050"]);

  // VD5 / M1: no case lines; every text row in plan of the page is shown.
  await expect(documentsTable(page).locator("th[scope=rowgroup]")).toHaveCount(0);
  await expect(textName(page, "case-0007", "de")).toBeVisible();
  await expect(rowCell(textRow(page, "case-0007", "de"), "translation")).toContainText("Check failed");
  const rowsOnPage = await documentsTable(page).getByRole("button", { name: /^Open text card, / }).count();
  expect(rowsOnPage).toBeGreaterThanOrEqual(50);

  await pages.getByRole("link", { name: "Next", exact: true }).click();
  await expect(pages).toContainText("Page 2 of 6");
  await expect.poll(async () => { const second = await casesInOrder(page); return [second.length, second[0]]; }).toEqual([50, "case-0051"]);
});

test("S8 synthetic-accepted at 390 px: cards instead of a table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { names } = await openScenario(page, "S8");
  const caseId = "synthetic-accepted";
  const sep = "(?: · | |, )";

  await expect(page.getByRole("list", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(2);
  // The case card header: case checkbox and case title.
  const caseCard = page.getByRole("list", { name: "Documents", exact: true }).getByRole("listitem").first();
  await expect(caseCard.getByRole("checkbox", { name: `Select ${caseId} (2 texts)`, exact: true })).toBeVisible();
  await expect(caseCard.getByRole("heading", { name: new RegExp(`^${caseId}${sep}en source \\+ 1 translation$`), level: 3 })).toBeVisible();

  const de = page.getByRole("article", { name: textNamePattern("", caseId, "de") });
  await expect(de.getByRole("heading", { name: textNamePattern("", caseId, "de"), level: 4 })).toBeVisible();
  // The decision edge marks the card that needs the lead (V3).
  await expect(de).toHaveClass(/document-card--decision/);
  await expect(de).toContainText("Final is on old text");
  await expect(de).toContainText(names["ann-0004"]);
  await expect(de).toContainText("Waiting on: You");
  await expect(de.getByRole("button", { name: textNamePattern("Review changes…, ", caseId, "de") })).toBeVisible();
  await expect(de.getByRole("link", { name: textNamePattern("Open in editor, ", caseId, "de") })).toBeVisible();

  // "Details" opens the text card as a full-width sheet (X19); ✕ closes it.
  await de.getByRole("button", { name: textNamePattern("Details, ", caseId, "de") }).click();
  const sheet = textCard(page, caseId, "de");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("navigation", { name: "Text path", exact: true })).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
  await closeCard(sheet);
  await expect(page.getByRole("table")).toHaveCount(0);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("S9 case-0420 fr: equal provider names get the external id", async ({ page }) => {
  const { s } = await openScenario(page, "S9");
  const caseId = "case-0420";
  const names = s.chain_names as { a: string; b: string };

  const card = await openTextCard(page, caseId, "fr");
  await expect(await textVersionItems(card, 2)).toHaveText([new RegExp(`^${esc(names.a)} v1`), new RegExp(`^${esc(names.b)} v1`)]);
});

test("S10 case-0444 de: rejected and queried reviews are translation issues, never text corrections", async ({ page }) => {
  await openScenario(page, "S10");
  const caseId = "case-0444";

  const de = textRow(page, caseId, "de");
  await expect(de.getByRole("rowheader")).toContainText("3 translations");
  await expect(rowCell(de, "translation")).toContainText("Rejected");
  await expect(rowCell(de, "finalization")).toContainText("Final is on old text");
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();

  // Only the accepted child of accepted_corrected corrects the final result; rejected and queried versions do not.
  await rowAction(page, "Review changes…", caseId, "de").click();
  const card = textCard(page, caseId, "de");
  const block = await openDecisionBlock(page, caseId, "de");
  await expect(block.getByText(/^The text changed from Provider A m1 v1 to Provider A m1 v5 after this final was chosen\.$/)).toBeVisible();
  await expect(block.getByText(/Provider [BC] m1 v\d .*corrects the text/)).toHaveCount(0);

  const versions = await textVersionItems(card, 9);
  await expect(versions.filter({ hasText: /^Provider B m1 v2/ })).toContainText("Rejected");
  await expect(versions.filter({ hasText: /^Provider C m1 v2/ })).toContainText("Queried");
});

test("S13 case-0713 en: consolidation and carry-forward kinds, the final is the lead's choice", async ({ page }) => {
  await openScenario(page, "S13");
  const caseId = "case-0713";

  const en = textRow(page, caseId, "en");
  await expect(en.getByRole("rowheader")).toContainText("v2 corrected");
  await expect(rowCell(en, "annotation")).toContainText("Submitted on v1");
  await expect(rowCell(en, "finalization")).toContainText(/ready to compare|Your choice/);
  await expect(rowCell(en, "next").getByRole("button").first()).toHaveAccessibleName(textNamePattern("Carry to v2…, ", caseId, "en"));
  // "Choose final…" became "Accept result…" / "Compare results…" (V6, X14), in the text card (one button per row).
  await expect(rowCell(en, "next").getByRole("button")).toHaveCount(1);
  const card = textCard(page, caseId, "en");
  const block = await openDecisionBlock(page, caseId, "en");
  await expect(block).toBeVisible();
  await expect(block.getByRole("button", { name: /^(Accept result…|Use as final)$/ }).first()).toBeVisible();

  // History: the two annotations, the consolidation and the carry-forward on v2.
  await card.getByRole("button", { name: /^History \(\d+\)$/ }).click();
  await expect(activityLines(card).filter({ hasText: /^Annotation Consolidation: / })).toHaveCount(1);
  await expect(activityLines(card).filter({ hasText: /^Annotation: .*v2/ })).toHaveCount(1);
  await expect(activityLines(card).filter({ hasText: /^Annotation: .*v1/ })).toHaveCount(2);
  await card.getByRole("button", { name: "Back", exact: true }).click();
  await expect(await textVersionItems(card, 2)).toHaveText([/^v1\s*Native/, /^v2\s*Correction of v1/]);
});

test("text card: row click only opens, the bar comes with two checked texts, J / K walk the rows, no layout shift", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openScenario(page, "S7");
  const table = documentsTable(page);
  const first = textRow(page, "case-0001", "en");
  const selectionBar = page.getByRole("region", { name: "Selection" });
  await expect(selectionBar).toHaveCount(0);
  const before = await first.boundingBox();
  const tableBefore = await table.boundingBox();

  // The text name opens the card; the selection stays as it is.
  await textName(page, "case-0001", "en").click();
  const card = textCard(page, "case-0001", "en");
  await expect(card).toBeVisible();
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(rowBox(page, "case-0001", "en")).not.toBeChecked();
  // Escape closes the card and returns focus to the text name.
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(textName(page, "case-0001", "en")).toBeFocused();

  // A click on the row's own area opens its card and marks the row current; it never checks the text.
  await rowCell(first, "waiting").click();
  await expect(card).toBeVisible();
  await expect(first).toHaveClass(/documents-row--active/);
  await closeCard(card);
  await expect(rowBox(page, "case-0001", "en")).not.toBeChecked();
  // Selection only via the checkboxes; one text brings no bar.
  await rowBox(page, "case-0001", "en").check();
  await expect(selectionBar).toHaveCount(0);

  // A second text: the floating bar arrives at the viewport bottom and moves nothing.
  const second = textRow(page, "case-0002", "en");
  await rowBox(page, "case-0002", "en").check();
  await expect(selectionBar).toBeVisible();
  await expect(selectionBar.locator(".selection-bar-step")).toContainText("next step: Assign annotation (en)");
  expect(await selectionBar.evaluate(element => getComputedStyle(element).position)).toBe("fixed");
  const barBox = (await selectionBar.boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(900);
  expect(barBox.y + barBox.height).toBeGreaterThan(900 - 40);
  expect(await first.boundingBox()).toEqual(before);
  expect(await table.boundingBox()).toEqual(tableBefore);

  // A click on a checked row opens its card and keeps it checked; unchecking it lets the bar leave.
  await rowCell(second, "waiting").click();
  await closeCard(textCard(page, "case-0002", "en"));
  await expect(rowBox(page, "case-0002", "en")).toBeChecked();
  await rowBox(page, "case-0002", "en").uncheck();
  await expect(selectionBar).toHaveCount(0);

  // J / K walk the table order inside the card; the case lines are skipped (case-0007 also has de).
  await textName(page, "case-0001", "en").click();
  const order = ["case-0002 en", "case-0003 en", "case-0004 en", "case-0005 en", "case-0006 en", "case-0007 en", "case-0007 de", "case-0008 en", "case-0009 en"];
  const open = page.getByRole("dialog");
  for (const name of order) {
    await page.keyboard.press("j");
    await expect(open).toHaveAttribute("aria-label", name);
  }
  await page.keyboard.press("k");
  await expect(open).toHaveAttribute("aria-label", "case-0008 en");

  // Escape closes; after J / K focus returns to the row now shown (not the first opener); the table has not moved.
  await page.keyboard.press("Escape");
  await expect(open).toHaveCount(0);
  await expect(textName(page, "case-0008", "en")).toBeFocused();
  // Focus may scroll the page to case-0008: the row keeps its place inside the table and its size.
  const [rowNow, tableNow] = [await first.boundingBox(), await table.boundingBox()];
  expect({ x: rowNow!.x - tableNow!.x, y: rowNow!.y - tableNow!.y, width: rowNow!.width, height: rowNow!.height })
    .toEqual({ x: before!.x - tableBefore!.x, y: before!.y - tableBefore!.y, width: before!.width, height: before!.height });
});
