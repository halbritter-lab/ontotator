/**
 * Documents lead table: rendering of the scenarios S0 to S10 and S13 on the stage-column
 * table of the documents overview (spec "Table", "Stage cells", "Expansion (▸)", V1 to V6):
 * one slim group row per case, one row per text with eight columns (checkbox · Text · Review ·
 * Annotation · Final · Waiting on · Action · Last activity), the slim expansion (History, Plan,
 * Text versions, Problem reports, Technical details) and the final-result side panel.
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and logs in as its lead.
 * Stage cells name people by display name; Waiting on uses "Display name (pseudonym)" (D1).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import {
  caseBox, documentsReady, documentsScenario, documentsTab, documentsTable, expandHistory, filterChip, finalPanel, historyToggle,
  openFilters, rowAction, rowBox, rowCell, textRow, textVersionItems, type DocumentsScenario,
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

/** The slim group label of a case: "{case} · en source + n translations". */
const groupLabel = (page: Page, caseId: string) =>
  documentsTable(page).locator(".documents-group-label").filter({ has: page.locator(`.documents-id[title="${caseId}"]`) });

/** Language codes of a case's rows in table order. */
async function languagesInOrder(page: Page, caseId: string): Promise<string[]> {
  const names = await documentsTable(page).getByRole("button", { name: new RegExp(`^Show history, ${esc(caseId)} · `) }).evaluateAll(
    buttons => buttons.map(button => button.getAttribute("aria-label") ?? ""),
  );
  return names.map(name => name.split(" · ").pop() ?? "");
}

/** "Open" opens this document id (its `variant` route parameter). */
async function openVariant(row: Locator, name: string): Promise<string | null> {
  const href = await row.getByRole("link", { name: `Open ${name}`, exact: true }).getAttribute("href");
  return new URLSearchParams(decodeURIComponent(href ?? "").split("?")[1]).get("variant");
}

/** Every row of the project has a decision edge class or not. */
const hasDecisionEdge = async (row: Locator) => (await row.getAttribute("class"))?.includes("data-table-row--decision") ?? false;

test("S0 synthetic-accepted: the final is on old text after v2 corrected it; en has nothing to decide", async ({ page }) => {
  const { s, names } = await openScenario(page, "S0");
  const caseId = "synthetic-accepted";
  const ann = esc(names["ann-0004"]);

  // The slim group row: case name and "· en source + 1 translation"; one decision (de) in the tab, en is not counted.
  await expect(groupLabel(page, caseId)).toHaveText(`${caseId} · en source + 1 translation`);
  await expect(caseBox(page, caseId, 2)).toBeVisible();
  expect(await languagesInOrder(page, caseId)).toEqual(["en", "de"]);
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();

  // en: the source, annotation unassigned, no final and nothing to decide.
  const en = textRow(page, caseId, "en");
  await expect(rowCell(en, "review")).toHaveText(/source/);
  await expect(rowCell(en, "annotation")).toHaveText(/Unassigned/);
  await expect(rowCell(en, "final")).toHaveText("—");
  await expect(rowCell(en, "action").getByRole("button")).toHaveAccessibleName(`Assign annotation…, ${caseId} · en`);
  expect(await hasDecisionEdge(en)).toBe(false);
  const enArea = await expandHistory(page, caseId, "en");
  await expect(await textVersionItems(enArea, 1)).toHaveText([/^v1\s*Native/]);

  // de: v2 corrects the text of the final result chosen on v1: "Final is on old text", Review changes…, decision edge.
  const de = textRow(page, caseId, "de");
  expect(await hasDecisionEdge(de)).toBe(true);
  await expect(de.getByRole("rowheader")).toContainText("v2 corrected");
  await expect(rowCell(de, "final")).toHaveText(new RegExp(`Final is on old text\\s*Round 1 · ${ann} · v1`));
  await expect(rowCell(de, "annotation")).toHaveText(new RegExp(`In progress\\s*${ann} · Round 1`));
  await expect(rowCell(de, "waiting")).toHaveText("You");
  await expect(rowCell(de, "action").getByRole("button").first()).toHaveAccessibleName(`Review changes…, ${caseId} · de`);
  // "Open" opens the version of the final result (v1), not the newest version.
  expect(await openVariant(de, `${caseId} · de`)).toBe(s.documents!.v1);

  // The decision lives in the side panel (V6): the text change, the waiting round and "Keep final on v1".
  await rowAction(page, "Review changes…", caseId, "de").click();
  const panel = finalPanel(page, caseId, "de");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("The text changed from v1 to v2 after this final was chosen.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Keep final on v1", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toHaveCount(0);

  const area = await expandHistory(page, caseId, "de");
  await expect(area.getByRole("listitem").filter({ hasText: /^Final: chosen/ })).toHaveCount(1);
  await expect(await textVersionItems(area, 2)).toHaveText([/^v1\s*Machine translation/, /^v2\s*Correction of v1\s*Ready for review/]);

  // The decision category link selects the de row only.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=confirm-final`);
  await documentsReady(page);
  await expect(textRow(page, caseId, "de")).toBeVisible();
  await expect(historyToggle(page, caseId, "en")).toHaveCount(0);
});

test("S0 expanded table has no axe violations", async ({ page }) => {
  await openScenario(page, "S0", "?open=synthetic-accepted%3Ade");
  const area = page.getByRole("region", { name: "History, synthetic-accepted · de", exact: true });
  await expect(area.getByRole("heading", { name: "History", level: 3 })).toBeVisible();
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const violations = results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
  expect(violations).toEqual([]);
});

test("S1 case-0042: two submissions and a final result, nothing to do", async ({ page }) => {
  const { s, names } = await openScenario(page, "S1");
  const caseId = "case-0042";
  const [first, second] = [esc(names["ann-0001"]), esc(names["ann-0002"])];

  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
  await expect(documentsTab(page, "Done", 1)).toBeVisible();
  await expect(caseBox(page, caseId, 1)).toBeVisible();

  const en = textRow(page, caseId, "en");
  await expect(rowCell(en, "annotation")).toHaveText(new RegExp(`submitted\\s*${first}, ${second}`));
  await expect(rowCell(en, "final")).toHaveText(new RegExp(`Final\\s*Round 1 · ${first}$`));
  await expect(rowCell(en, "waiting")).toHaveText("—");
  await expect(rowCell(en, "action")).toHaveText("");
  expect(await hasDecisionEdge(en)).toBe(false);

  // History: both submissions and the final choice (the Submissions table moved to the panel, V6).
  const area = await expandHistory(page, caseId, "en");
  await expect(area.getByRole("listitem").filter({ hasText: /^Annotation: .* · Round 1 · / })).toHaveCount(2);
  await expect(area.getByRole("listitem").filter({ hasText: /^Final: chosen/ })).toHaveCount(1);

  // "Final result: none" (FD11 link parameter, a chip): nothing matches.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?final=none`);
  await documentsReady(page);
  await expect(filterChip(page, "Final result: None")).toBeVisible();
  await expect(historyToggle(page, caseId, "en")).toHaveCount(0);
  await expect(page.getByText("No texts match these filters.", { exact: true })).toBeVisible();
});

test("S2 case-0108: seven languages, final 4 of 7, de failed its automatic check", async ({ page }) => {
  const { names } = await openScenario(page, "S2");
  const caseId = "case-0108";
  const ann = esc(names["ann-0001"]);

  await expect(groupLabel(page, caseId)).toHaveText(`${caseId} · en source + 6 translations`);
  // A failed check without a reviewer is "To assign", not a decision (D4).
  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
  await expect(documentsTab(page, "To assign", 6)).toBeVisible();
  // Source language first, then by language code.
  expect(await languagesInOrder(page, caseId)).toEqual(["en", "de", "es", "fr", "it", "nl", "pt"]);

  // Final 4 of 7: en, es, fr and it have a final result; de, nl and pt none.
  for (const language of ["en", "es", "fr", "it"]) {
    await expect(rowCell(textRow(page, caseId, language), "final"), language).toHaveText(new RegExp(`Final\\s*Round 1 · ${ann}$`));
  }
  for (const language of ["de", "nl", "pt"]) await expect(rowCell(textRow(page, caseId, language), "final"), language).toHaveText("—");

  const de = textRow(page, caseId, "de");
  await expect(rowCell(de, "review")).toHaveText(/Check failed\s*unassigned/);
  await expect(rowCell(de, "action").getByRole("button").first()).toHaveAccessibleName(`Assign review…, ${caseId} · de`);
  expect(await hasDecisionEdge(de)).toBe(false);
  await expect(rowCell(textRow(page, caseId, "nl"), "review")).not.toContainText("Check failed");
  await expect(rowCell(textRow(page, caseId, "nl"), "review")).toHaveText(/Unassigned\s*v1 machine translation/);

  const area = await expandHistory(page, caseId, "de");
  await expect(await textVersionItems(area, 1)).toHaveText([/^v1\s*Machine translation\s*Check failed/]);

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
  const ann = esc(names["ann-0001"]);

  const de = textRow(page, caseId, "de");
  await expect(de.getByRole("rowheader")).toContainText("v3 corrected");
  await expect(rowCell(de, "review")).toHaveText(new RegExp(`Re-review in progress\\s*${esc(names.reviewer)} · correction`));
  await expect(rowCell(de, "final")).toHaveText(new RegExp(`Final is on old text\\s*Round 2 · ${ann} · v1`));
  // The final result is on v1: "Open" opens v1.
  expect(await openVariant(de, `${caseId} · de`)).toBe(s.documents!.v1);
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();

  // The panel names the text change and the open v3 review; the lead can keep v1.
  await rowAction(page, "Review changes…", caseId, "de").click();
  const panel = finalPanel(page, caseId, "de");
  await expect(panel.getByText(/^The text changed from v1 to v\d after this final was chosen\.$/)).toBeVisible();
  await expect(panel).toContainText(`translation review of v3 by ${names.reviewer}`);
  await expect(panel.getByRole("button", { name: "Keep final on v1", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  const area = await expandHistory(page, caseId, "de");
  await expect(await textVersionItems(area, 3)).toHaveText([/^v1\s*Machine translation/, /^v2\s*Correction of v1\s*Accepted/, /^v3\s*Correction of v2\s*Ready for review/]);
});

test("S4 case-0305 fr: two independent translations, each annotated in its own round", async ({ page }) => {
  const { names } = await openScenario(page, "S4");
  const caseId = "case-0305";

  // Selection is per text (VD4): case checkbox and one checkbox per row.
  await expect(caseBox(page, caseId, 2)).toBeVisible();
  await expect(rowBox(page, caseId, "fr")).toBeVisible();
  const fr = textRow(page, caseId, "fr");
  await expect(fr.getByRole("rowheader")).toContainText("2 translations");
  await expect(fr.getByRole("link", { name: `Open ${caseId} · fr`, exact: true })).toHaveAccessibleDescription("Opens Provider B m1 v1, the most recent translation");
  await expect(rowCell(fr, "annotation")).toHaveText(new RegExp(`In progress\\s*${esc(names["ann-0001"])}, ${esc(names["ann-0002"])} · Round 1`));
  await expect(rowCell(fr, "final")).toHaveText("—");

  const area = await expandHistory(page, caseId, "fr");
  await expect(area.getByRole("listitem").filter({ hasText: /^Annotation: .* · Round 1 · / })).toHaveCount(2);
  await expect(await textVersionItems(area, 2)).toHaveText([/^Provider A m1 v1\s*Machine translation/, /^Provider B m1 v1\s*Machine translation/]);
});

test("S5 case-0377: the lead's consolidation is the final result, without a round in its label", async ({ page }) => {
  const { names } = await openScenario(page, "S5");
  const caseId = "case-0377";

  const en = textRow(page, caseId, "en");
  // No round in a consolidation's label.
  await expect(rowCell(en, "final")).toHaveText(new RegExp(`Final\\s*Consolidation · ${esc(names.lead)}$`));
  await expect(documentsTab(page, "Done", 1)).toBeVisible();
  expect(await hasDecisionEdge(en)).toBe(false);

  const area = await expandHistory(page, caseId, "en");
  await expect(area.getByRole("listitem").filter({ hasText: /^Consolidation: / })).toHaveCount(1);
  await expect(area.getByRole("listitem").filter({ hasText: /^Annotation: .* · Round 1 · / })).toHaveCount(3);
});

test("S6 case-0390 de: open problem report with a paused task", async ({ page }) => {
  const { s, names } = await openScenario(page, "S6");
  const caseId = "case-0390";
  const reason = String(s.reason);

  const de = textRow(page, caseId, "de");
  expect(await hasDecisionEdge(de)).toBe(true);
  await expect(rowCell(de, "annotation")).toContainText("Paused");
  await expect(rowCell(de, "annotation")).toContainText(`${names["ann-0001"]}: “${reason.slice(0, 60)}`);
  await expect(rowCell(de, "action").getByRole("button").first()).toHaveAccessibleName(`Decide on report…, ${caseId} · de`);
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();

  const area = await expandHistory(page, caseId, "de");
  const paused = area.getByRole("listitem").filter({ hasText: /^Task paused/ });
  await expect(paused.getByRole("link", { name: "Open report", exact: true })).toHaveAttribute("href", new RegExp(`/problem-reports/${esc(String(s.report_id))}`));
  await area.locator("summary", { hasText: /^Problem reports \(1\)$/ }).click();
  const report = area.locator("details", { has: page.locator("summary", { hasText: /^Problem reports/ }) }).getByRole("listitem");
  await expect(report).toContainText("Report: Open");
  await expect(report).toContainText("Paused tasks: 1");
  await expect(report.locator("time")).toHaveCount(1);

  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=report-or-pause`);
  await documentsReady(page);
  await expect(textRow(page, caseId, "de")).toBeVisible();
  await expect(historyToggle(page, caseId, "en")).toHaveCount(0);
});

test("S7 300 texts: 50 groups per page, page 1 of 6, groups never collapse", async ({ page }) => {
  await openScenario(page, "S7");
  const groups = documentsTable(page).locator(".documents-group-label");
  await expect(groups).toHaveCount(50);
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages).toContainText("Page 1 of 6");
  await expect(groups.first()).toHaveText("case-0001 · en source");
  await expect(groups.last()).toHaveText("case-0050 · en source");

  // VD5: the group row is a label, not a disclosure; every text row of the page is shown.
  await expect(documentsTable(page).locator("button.documents-group-toggle")).toHaveCount(0);
  await expect(historyToggle(page, "case-0007", "de")).toBeVisible();
  await expect(rowCell(textRow(page, "case-0007", "de"), "review")).toContainText("Check failed");
  const rowsOnPage = await documentsTable(page).getByRole("button", { name: /^Show history, / }).count();
  expect(rowsOnPage).toBeGreaterThanOrEqual(50);

  await pages.getByRole("link", { name: "Next", exact: true }).click();
  await expect(pages).toContainText("Page 2 of 6");
  await expect(groups.first()).toHaveText("case-0051 · en source");
  await expect(groups).toHaveCount(50);
});

test("S8 synthetic-accepted at 390 px: cards instead of a table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { names } = await openScenario(page, "S8");
  const caseId = "synthetic-accepted";

  await expect(page.getByRole("list", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(2);
  // The case card header: case checkbox and case title.
  const caseCard = page.getByRole("list", { name: "Documents", exact: true }).getByRole("listitem").first();
  await expect(caseCard.getByRole("checkbox", { name: `Select ${caseId} (2 texts)`, exact: true })).toBeVisible();
  await expect(caseCard.getByRole("heading", { name: `${caseId} · en source + 1 translation`, level: 3 })).toBeVisible();

  const de = page.getByRole("article", { name: `${caseId} · de`, exact: true });
  await expect(de.getByRole("heading", { name: `${caseId} · de`, level: 4 })).toBeVisible();
  // The decision edge marks the card that needs the lead (V3).
  await expect(de).toHaveClass(/document-card--decision/);
  await expect(de).toContainText("Final is on old text");
  await expect(de).toContainText(`Round 1 · ${names["ann-0004"]} · v1`);
  await expect(de).toContainText("Waiting on: You");
  await expect(de.getByRole("button", { name: `Review changes…, ${caseId} · de`, exact: true })).toBeVisible();
  await expect(de.getByRole("link", { name: `Open ${caseId} · de`, exact: true })).toBeVisible();

  const toggle = de.getByRole("button", { name: "History", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const area = page.getByRole("region", { name: `History, ${caseId} · de`, exact: true });
  await expect(area.getByRole("heading", { name: "History", level: 5 })).toBeVisible();
  await expect(area.locator("summary", { hasText: /^Text versions \(2\)$/ })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("S9 case-0420 fr: equal provider names get the external id", async ({ page }) => {
  const { s } = await openScenario(page, "S9");
  const caseId = "case-0420";
  const names = s.chain_names as { a: string; b: string };

  const fr = textRow(page, caseId, "fr");
  await expect(fr.getByRole("link", { name: `Open ${caseId} · fr`, exact: true })).toHaveAccessibleDescription(`Opens ${names.b} v1, the most recent translation`);
  const area = await expandHistory(page, caseId, "fr");
  await expect(await textVersionItems(area, 2)).toHaveText([new RegExp(`^${esc(names.a)} v1`), new RegExp(`^${esc(names.b)} v1`)]);
});

test("S10 case-0444 de: rejected and queried reviews are translation issues, never text corrections", async ({ page }) => {
  const { names } = await openScenario(page, "S10");
  const caseId = "case-0444";

  const de = textRow(page, caseId, "de");
  await expect(de.getByRole("rowheader")).toContainText("3 translations");
  await expect(rowCell(de, "review")).toHaveText(/Rejected/);
  await expect(rowCell(de, "final")).toHaveText(new RegExp(`Final is on old text\\s*Round 1 · ${esc(names["ann-0001"])} · v1`));
  await expect(documentsTab(page, "Needs your decision", 1)).toBeVisible();

  // Only the accepted child of accepted_corrected corrects the final result; rejected and queried versions do not.
  await rowAction(page, "Review changes…", caseId, "de").click();
  const panel = finalPanel(page, caseId, "de");
  await expect(panel.getByText(/^The text changed from Provider A m1 v1 to Provider A m1 v5 after this final was chosen\.$/)).toBeVisible();
  await expect(panel.getByText(/Provider [BC] m1 v\d .*corrects the text/)).toHaveCount(0);
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  const area = await expandHistory(page, caseId, "de");
  await expect(area.locator("summary", { hasText: /^Text versions \(9\)$/ })).toBeVisible();
  const versions = await textVersionItems(area, 9);
  await expect(versions.filter({ hasText: /^Provider B m1 v2/ })).toContainText("Rejected");
  await expect(versions.filter({ hasText: /^Provider C m1 v2/ })).toContainText("Queried");
});

test("S13 case-0713 en: consolidation and carry-forward kinds, the final is the lead's choice", async ({ page }) => {
  const { names } = await openScenario(page, "S13");
  const caseId = "case-0713";

  const en = textRow(page, caseId, "en");
  await expect(en.getByRole("rowheader")).toContainText("v2 corrected");
  await expect(rowCell(en, "annotation")).toHaveText(new RegExp(`Submitted on v1\\s*${esc(names["ann-0002"])} · v2 not annotated`));
  await expect(rowCell(en, "final")).toHaveText(/Your choice/);
  await expect(rowCell(en, "action").getByRole("button").first()).toHaveAccessibleName(`Carry to v2…, ${caseId} · en`);
  // "Choose final…" became "Accept result…" / "Compare results…" (V6), here behind "+1".
  await page.getByRole("button", { name: `+1 more action, ${caseId} · en`, exact: true }).click();
  await page.getByRole("menuitem", { name: /^(Accept|Compare) results?…$/ }).click();
  const panel = finalPanel(page, caseId, "en");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /^(Accept as final|Use as final)$/ }).first()).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  // History: the two annotations, the consolidation and the carry-forward on v2.
  const area = await expandHistory(page, caseId, "en");
  await expect(area.getByRole("listitem").filter({ hasText: /^Consolidation: / })).toHaveCount(1);
  await expect(area.getByRole("listitem").filter({ hasText: /^Annotation: .* · v2 · / })).toHaveCount(1);
  await expect(area.getByRole("listitem").filter({ hasText: /^Annotation: .* · v1 · / })).toHaveCount(2);
  await expect(await textVersionItems(area, 2)).toHaveText([/^v1\s*Native/, /^v2\s*Correction of v1/]);
});
