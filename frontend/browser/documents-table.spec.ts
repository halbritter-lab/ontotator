/**
 * Documents lead table: rendering of the scenarios S0 to S10 and S13
 * (plan Task 7.2; spec "Testing", "Table", "Expanded row").
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and
 * logs in as its lead. Person labels are the users' pseudonyms, read from the
 * project members (the fixture keys users by role name, not by pseudonym).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { documentsScenario, type DocumentsScenario } from "./documentsHelpers";
import { authenticatedRequest, loginExisting } from "./helpers";

type Member = components["schemas"]["Member"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

/** Cell positions of a language row; the row header ("Text · language") is not a cell. */
const COL = { select: 0, versions: 1, work: 2, final: 3, issues: 4, activity: 5 } as const;
/** "19 Oct, 15:01", optionally with seconds or a year. */
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}(?::\d{2})?`;

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactly = (pattern: string) => new RegExp(`^${pattern}$`);

/** Pseudonym (person label) per fixture role name. */
async function labelsOf(page: Page, s: DocumentsScenario): Promise<Record<string, string>> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/members`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const members = (await response.json()) as Member[];
  const byUsername = new Map(members.map(member => [member.username, member.pseudonym]));
  return Object.fromEntries(Object.entries(s.users).map(([name, username]) => [name, byUsername.get(username) ?? username]));
}

/** Build scenario ``name``, log in as its lead and open Documents (with an optional query). */
async function openScenario(page: Page, name: string, query = "") {
  const s = await documentsScenario(page, name);
  await loginExisting(page, s.users.lead);
  const labels = await labelsOf(page, s);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents${query}`);
  await expect(page.getByRole("navigation", { name: "Segments", exact: true })).toBeVisible();
  return { s, labels };
}

const table = (page: Page) => page.getByRole("table", { name: "Documents", exact: true });
const disclosure = (page: Page, caseId: string, language: string) =>
  page.getByRole("button", { name: `Show submissions, ${caseId} · ${language}`, exact: true });

/** The collapsed language row (not its expanded content row). */
function languageRow(page: Page, caseId: string, language: string): Locator {
  return table(page).getByRole("row").filter({ has: disclosure(page, caseId, language) });
}

function groupHeader(page: Page, name: string): { row: Locator; button: Locator } {
  const button = table(page).getByRole("button", { name, exact: true });
  return { row: table(page).getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) }), button };
}

const cell = (row: Locator, column: keyof typeof COL) => row.getByRole("cell").nth(COL[column]);

/** Expand a row and wait until its submissions have loaded. */
async function expand(page: Page, caseId: string, language: string): Promise<Locator> {
  const button = disclosure(page, caseId, language);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const region = page.getByRole("region", { name: `${caseId} · ${language}`, exact: true });
  await expect(region.getByRole("heading", { name: /^Submissions \(\d+\)$/, level: 3 })).toBeVisible();
  await expect(region.getByText("Loading submissions…")).toHaveCount(0);
  return region;
}

/** Language codes of a text's rows in table order. */
async function languagesInOrder(page: Page, caseId: string): Promise<string[]> {
  const names = await table(page).getByRole("button", { name: new RegExp(`^Show submissions, ${esc(caseId)} · `) }).evaluateAll(
    buttons => buttons.map(button => button.getAttribute("aria-label") ?? ""),
  );
  return names.map(name => name.split(" · ").pop() ?? "");
}

const submissionsTable = (region: Locator, caseId: string, language: string) =>
  region.getByRole("table", { name: `Submissions, ${caseId} · ${language}`, exact: true });

/** The submission row whose View link is named ``View {label}`` (label as a regex source). */
const submissionRow = (submissions: Locator, label: string) =>
  submissions.getByRole("row").filter({ has: submissions.page().getByRole("link", { name: exactly(`View ${label}`) }) });

test("S0 synthetic-accepted: corrected final waits for the carry-forward round; en has no final and is not counted", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S0");
  const caseId = "synthetic-accepted";
  const ann = esc(labels["ann-0004"]);

  const group = groupHeader(page, `${caseId}, 2 languages, final 1 of 2`);
  await expect(group.button).toHaveAttribute("aria-expanded", "true");
  await expect(group.row).toContainText("1 issue");
  await expect(group.row).toContainText("1 note");
  expect(await languagesInOrder(page, caseId)).toEqual(["en", "de"]);

  // en: native, unassigned, no final result and nothing counted.
  const en = languageRow(page, caseId, "en");
  await expect(cell(en, "versions")).toHaveText("v1 · Native");
  await expect(cell(en, "work")).toHaveText("Unassigned");
  await expect(cell(en, "final")).toHaveText("None");
  await expect(cell(en, "issues")).toHaveText("");
  await expect(page.getByRole("link", { name: "Needs your decision (1)", exact: true })).toBeVisible();

  // de: the correction v2 corrects the final result chosen on v1.
  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "select")).toHaveText("Choose in Text versions");
  await expect(cell(de, "versions")).toHaveText("v2 · Correction of v1 · Ready for review");
  await expect(cell(de, "final")).toHaveText(exactly(`Annotation · Round 1 · ${ann} · ${TIME} · v1`));
  await expect(cell(de, "issues").getByRole("img")).toHaveAccessibleName("1 issue: final result to confirm 1. 1 note: reviewer needed");
  // "Open" opens the version of the final result (v1), not the newest version.
  const openHref = await de.getByRole("link", { name: `Open ${caseId} · de`, exact: true }).getAttribute("href");
  expect(new URLSearchParams(decodeURIComponent(openHref ?? "").split("?")[1]).get("variant")).toBe(s.documents!.v1);

  const region = await expand(page, caseId, "de");
  await expect(region.getByRole("heading", { name: "Issues", level: 3 })).toBeVisible();
  await expect(region.getByText("v2 needs a translation reviewer.")).toBeVisible();
  await expect(region.getByText("v2 (Ready for review) corrects the text of the final result.", { exact: true })).toBeVisible();
  await expect(region.getByText(`Waiting: Round 1 (${labels["ann-0004"]}) is in progress. You can choose again once it is submitted.`, { exact: true })).toBeVisible();
  await expect(region.getByRole("button", { name: "Keep final result…", exact: true })).toBeVisible();
  await expect(region.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(region, caseId, "de");
  const final = submissionRow(submissions, `Annotation · Round 1 · ${ann} · de v1 · ${TIME}`);
  await expect(final.getByRole("cell").first()).toHaveText("Final");
  await expect(final.getByRole("button")).toHaveCount(0);
  const review = submissionRow(submissions, `Review · Round 1 · ${esc(labels["ann-0003"])} · de v1 · ${TIME}`);
  await expect(review.getByRole("cell").nth(2)).toHaveText("Review");
  await expect(review.getByRole("button", { name: "Replace…", exact: true })).toBeVisible();
  await expect(review.getByRole("link", { name: "Compare", exact: true })).toBeVisible();
  await expect(region.getByText(`Round 1 · ${labels["ann-0004"]} · in progress, not submitted yet`, { exact: true })).toBeVisible();

  // The decision category selects the de row only.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=confirm-final`);
  await expect(languageRow(page, caseId, "de")).toBeVisible();
  await expect(disclosure(page, caseId, "en")).toHaveCount(0);
});

test("S0 expanded table has no axe violations", async ({ page }) => {
  await openScenario(page, "S0", "?open=synthetic-accepted%3Ade");
  const region = page.getByRole("region", { name: "synthetic-accepted · de", exact: true });
  await expect(region.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const violations = results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
  expect(violations).toEqual([]);
});

test("S1 case-0042: two submissions and a final result, no issues", async ({ page }) => {
  const { labels } = await openScenario(page, "S1");
  const caseId = "case-0042";
  const [first, second] = [esc(labels["ann-0001"]), esc(labels["ann-0002"])];

  const group = groupHeader(page, `${caseId}, 1 language, final 1 of 1`);
  await expect(group.row).not.toContainText("issue");
  await expect(group.row).not.toContainText("note");
  await expect(page.getByRole("link", { name: "Needs your decision (0)", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "No final result (0)", exact: true })).toBeVisible();

  const en = languageRow(page, caseId, "en");
  await expect(cell(en, "select").getByRole("checkbox", { name: `Select ${caseId} · en`, exact: true })).toBeVisible();
  await expect(cell(en, "work")).toHaveText(`${labels["ann-0001"]} submitted; ${labels["ann-0002"]} submitted`);
  await expect(cell(en, "final")).toHaveText(exactly(`Annotation · Round 1 · ${first} · ${TIME}`));
  await expect(cell(en, "issues")).toHaveText("");

  const region = await expand(page, caseId, "en");
  await expect(region.getByRole("heading", { name: "Issues", level: 3 })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Keep final result…" })).toHaveCount(0);
  await expect(region.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(region, caseId, "en");
  await expect(submissionRow(submissions, `Annotation · Round 1 · ${first} · en v1 · ${TIME}`).getByRole("cell").first()).toHaveText("Final");
  const other = submissionRow(submissions, `Annotation · Round 1 · ${second} · en v1 · ${TIME}`);
  await expect(other.getByRole("cell").first()).toHaveText("");
  await expect(other.getByRole("button", { name: "Replace…", exact: true })).toBeVisible();
  // One version only: no Version column.
  await expect(submissions.getByRole("columnheader", { name: "Version" })).toHaveCount(0);
});

test("S2 case-0108: seven languages, final 4 of 7, de failed its automatic check", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S2");
  const caseId = "case-0108";

  const group = groupHeader(page, `${caseId}, 7 languages, final 4 of 7`);
  await expect(group.button).toHaveAttribute("aria-expanded", "true");
  await expect(group.row).toContainText("1 issue");
  // Source language first, then by language code.
  expect(await languagesInOrder(page, caseId)).toEqual(["en", "de", "es", "fr", "it", "nl", "pt"]);

  for (const language of ["en", "fr", "es", "it"]) {
    await expect(cell(languageRow(page, caseId, language), "final")).toHaveText(exactly(`Annotation · Round 1 · ${esc(labels["ann-0001"])} · ${TIME}`));
  }
  for (const language of ["de", "nl", "pt"]) await expect(cell(languageRow(page, caseId, language), "final")).toHaveText("None");

  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "versions")).toHaveText("v1 · Machine translation · Check failed");
  await expect(cell(de, "issues").getByRole("img")).toHaveAccessibleName("1 issue: translation check or review failed 1");
  await expect(cell(languageRow(page, caseId, "nl"), "issues")).toHaveText("");

  const region = await expand(page, caseId, "de");
  await expect(region.getByRole("heading", { name: "Issues", level: 3 })).toBeVisible();
  const issue = region.getByRole("listitem").filter({ hasText: "v1 failed the automatic translation check." });
  await expect(issue.getByRole("button", { name: "Text versions", exact: true })).toBeVisible();
  await expect(region.getByRole("heading", { name: "Submissions (0)", level: 3 })).toBeVisible();

  await expect(page.getByRole("link", { name: "Needs your decision (1)", exact: true })).toBeVisible();
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=translation`);
  await expect(languageRow(page, caseId, "de")).toBeVisible();
  await expect(disclosure(page, caseId, "fr")).toHaveCount(0);
});

test("S3 case-0211: final on v1 Round 2, corrections v2 and v3, waiting for the v3 review", async ({ page }) => {
  const { labels } = await openScenario(page, "S3");
  const caseId = "case-0211";
  const ann = esc(labels["ann-0001"]);

  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "versions")).toHaveText("v3 · Correction of v2 · Ready for review");
  await expect(cell(de, "final")).toHaveText(exactly(`Annotation · Round 2 · ${ann} · ${TIME} · v1`));
  await expect(cell(de, "issues").getByRole("img")).toHaveAccessibleName("2 issues: final result to confirm 2");
  await expect(groupHeader(page, `${caseId}, 2 languages, final 1 of 2`).row).toContainText("2 issues");

  const region = await expand(page, caseId, "de");
  await expect(region.getByText(/^v2 \(Accepted\) corrects the text of the final result\./)).toBeVisible();
  await expect(region.getByText("Keep v1, or choose a result on v2 once one exists (assign work in Text versions).", { exact: false })).toBeVisible();
  await expect(region.getByText("v3 (Ready for review) corrects the text of the final result.", { exact: true })).toBeVisible();
  await expect(region.getByText(`Waiting: translation review of v3 by ${labels.reviewer} is open. You can choose again once it is submitted.`, { exact: true })).toBeVisible();
  await expect(region.getByRole("button", { name: "Keep final result…", exact: true })).toBeVisible();

  const submissions = submissionsTable(region, caseId, "de");
  const round1 = submissionRow(submissions, `Annotation · Round 1 · ${ann} · de v1 · ${TIME}`);
  await expect(round1.getByRole("cell").nth(1)).toContainText("Round 1 · abandoned");
  const round2 = submissionRow(submissions, `Annotation · Round 2 · ${ann} · de v1 · ${TIME}`);
  await expect(round2.getByRole("cell").first()).toHaveText("Final");
  // Oldest first.
  const views = submissions.getByRole("link", { name: /^View / });
  await expect(views).toHaveCount(2);
  await expect(views.nth(0)).toHaveAccessibleName(/^View Annotation · Round 1 · /);
  await expect(views.nth(1)).toHaveAccessibleName(/^View Annotation · Round 2 · /);
});

test("S4 case-0305 fr: two independent translations, choose in Text versions", async ({ page }) => {
  const { labels } = await openScenario(page, "S4");
  const caseId = "case-0305";

  const fr = languageRow(page, caseId, "fr");
  await expect(cell(fr, "select")).toHaveText("Choose in Text versions");
  await expect(cell(fr, "select").getByRole("checkbox")).toHaveCount(0);
  await expect(cell(fr, "versions")).toHaveText("2 independent translations: Provider A m1, Provider B m1");
  await expect(cell(fr, "work")).toHaveText(`${labels["ann-0001"]} annotating (Round 1); ${labels["ann-0002"]} annotating (Round 1)`);
  await expect(cell(fr, "final")).toHaveText("None");
  const open = fr.getByRole("link", { name: `Open ${caseId} · fr`, exact: true });
  await expect(open).toHaveAccessibleDescription("Opens Provider B m1 v1, the most recent translation");

  const region = await expand(page, caseId, "fr");
  await expect(region.getByRole("heading", { name: "Submissions (0)", level: 3 })).toBeVisible();
  for (const name of [labels["ann-0001"], labels["ann-0002"]]) {
    await expect(region.getByText(`Round 1 · ${name} · in progress, not submitted yet`, { exact: true })).toBeVisible();
  }
  await expect(region.getByText("Text versions (2)", { exact: true })).toBeVisible();
});

test("S5 case-0377: the lead's consolidation is the final result, without a round in its label", async ({ page }) => {
  const { labels } = await openScenario(page, "S5");
  const caseId = "case-0377";
  const lead = esc(labels.lead);

  const en = languageRow(page, caseId, "en");
  await expect(cell(en, "final")).toHaveText(exactly(`Consolidation · ${lead} \\(you\\) · ${TIME}`));
  await expect(cell(en, "issues")).toHaveText("");

  const region = await expand(page, caseId, "en");
  await expect(region.getByRole("heading", { name: "Submissions (4)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(region, caseId, "en");
  const final = submissionRow(submissions, `Consolidation · ${lead} \\(you\\) · en v1 · ${TIME}`);
  await expect(final.getByRole("cell").first()).toHaveText("Final");
  await expect(final.getByRole("cell").nth(2)).toHaveText("Consolidation");
  await expect(final.getByRole("cell").nth(3)).toHaveText(`${labels.lead} (you)`);
  for (const name of ["ann-0001", "ann-0002", "ann-0003"]) {
    const input = submissionRow(submissions, `Annotation · Round 1 · ${esc(labels[name])} · en v1 · ${TIME}`);
    await expect(input.getByRole("cell").nth(2)).toHaveText("Annotation");
  }
});

test("S6 case-0390 de: open problem report with a paused task", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S6");
  const caseId = "case-0390";

  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "work")).toContainText(`${labels["ann-0001"]} annotating (Round 1)`);
  await expect(cell(de, "work")).toContainText("Paused");
  await expect(cell(de, "issues").getByRole("img")).toHaveAccessibleName("1 issue: problem report or paused task 1. 1 note: task paused");

  const region = await expand(page, caseId, "de");
  const reason = String(s.reason);
  const report = region.getByRole("listitem").filter({ hasText: reason.slice(0, 120) });
  await expect(report).toContainText(labels["ann-0001"]);
  await expect(report).toContainText("task paused");
  await expect(report.locator("time")).toHaveCount(1);
  await expect(report.getByRole("link", { name: "Open report", exact: true })).toHaveAttribute("href", new RegExp(`/problem-reports/${esc(String(s.report_id))}`));

  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=report-or-pause`);
  await expect(languageRow(page, caseId, "de")).toBeVisible();
  await expect(disclosure(page, caseId, "en")).toHaveCount(0);
});

test("S7 300 texts: 50 groups per page, page 1 of 6, only issue groups expanded", async ({ page }) => {
  await openScenario(page, "S7");
  const groups = table(page).getByRole("button", { name: /^case-\d{4}, \d languages?, final \d+ of \d+$/ });
  await expect(groups).toHaveCount(50);
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages).toContainText("Page 1 of 6");
  await expect(groups.first()).toHaveAccessibleName("case-0001, 1 language, final 0 of 1");
  await expect(groups.last()).toHaveAccessibleName("case-0050, 1 language, final 0 of 1");

  // case-0007 is the only issue group on page 1.
  const expanded = table(page).locator('button.documents-group-toggle[aria-expanded="true"]');
  await expect(expanded).toHaveCount(1);
  await expect(expanded).toHaveAccessibleName("case-0007, 2 languages, final 0 of 2");
  await expect(table(page).getByRole("button", { name: /^Show submissions, / })).toHaveCount(2);
  await expect(cell(languageRow(page, "case-0007", "de"), "issues").getByRole("img")).toHaveAccessibleName("1 issue: translation check or review failed 1");

  await pages.getByRole("link", { name: "Next", exact: true }).click();
  await expect(pages).toContainText("Page 2 of 6");
  await expect(groups.first()).toHaveAccessibleName("case-0051, 1 language, final 0 of 1");
  await expect(groups).toHaveCount(50);
  await expect(expanded).toHaveCount(0);
});

test("S8 synthetic-accepted at 390 px: cards instead of a table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { labels } = await openScenario(page, "S8");
  const caseId = "synthetic-accepted";

  await expect(page.getByRole("list", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(2);
  const de = page.getByRole("article", { name: `${caseId} · de`, exact: true });
  await expect(de.getByRole("heading", { name: `${caseId} · de`, level: 3 })).toBeVisible();
  await expect(de.getByRole("img")).toHaveAccessibleName("1 issue: final result to confirm 1. 1 note: reviewer needed");
  await expect(de).toContainText("v2 · Correction of v1 · Ready for review");
  await expect(de).toContainText(new RegExp(`Annotation · Round 1 · ${esc(labels["ann-0004"])} · ${TIME} · v1`));
  await expect(de.getByRole("link", { name: `Open ${caseId} · de`, exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: `${caseId} · en`, exact: true }).getByRole("checkbox", { name: `Select ${caseId} · en` })).toBeVisible();

  const toggle = de.getByRole("button", { name: `Show submissions, ${caseId} · de`, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(de.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  await expect(de.getByText("v2 (Ready for review) corrects the text of the final result.", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("S9 case-0420 fr: equal provider names get the external id", async ({ page }) => {
  const { s } = await openScenario(page, "S9");
  const caseId = "case-0420";
  const names = s.chain_names as { a: string; b: string };

  const fr = languageRow(page, caseId, "fr");
  await expect(cell(fr, "versions")).toHaveText(`2 independent translations: ${names.a}, ${names.b}`);
  await expect(cell(fr, "select")).toHaveText("Choose in Text versions");
  await expect(fr.getByRole("link", { name: `Open ${caseId} · fr`, exact: true })).toHaveAccessibleDescription(`Opens ${names.b} v1, the most recent translation`);
});

test("S10 case-0444 de: rejected and queried reviews are translation issues, never text corrections", async ({ page }) => {
  const { labels } = await openScenario(page, "S10");
  const caseId = "case-0444";

  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "versions")).toHaveText("3 independent translations: Provider A m1, Provider B m1, Provider C m1");
  await expect(cell(de, "final")).toHaveText(exactly(`Annotation · Round 1 · ${esc(labels["ann-0001"])} · ${TIME} · Provider A m1 v1`));
  await expect(cell(de, "issues").getByRole("img")).toHaveAccessibleName("3 issues: final result to confirm 1; translation check or review failed 2");

  const region = await expand(page, caseId, "de");
  for (const line of ["Provider B m1 v2 was rejected in review.", "Provider C m1 v2 was queried in review."]) {
    await expect(region.getByRole("listitem").filter({ hasText: line }).getByRole("button", { name: "Text versions", exact: true })).toBeVisible();
  }
  // Only the accepted child of accepted_corrected corrects the final result.
  await expect(region.getByText(/^Provider A m1 v5 \(Accepted\) corrects the text of the final result\./)).toBeVisible();
  await expect(region.getByText("Provider A m1 v2 was rejected in review. No action needed.", { exact: true })).toBeVisible();
  await expect(region.getByText("Provider A m1 v3 was queried in review. No action needed.", { exact: true })).toBeVisible();
  await expect(region.getByText(/Provider A m1 v[234] \([^)]*\) corrects the text/)).toHaveCount(0);
  await expect(region.getByText(/Provider [BC] m1 v\d \([^)]*\) corrects the text/)).toHaveCount(0);
});

test("S13 case-0713 en: consolidation and carry-forward kinds", async ({ page }) => {
  const { labels } = await openScenario(page, "S13");
  const caseId = "case-0713";
  const [first, second, lead] = [esc(labels["ann-0001"]), esc(labels["ann-0002"]), esc(labels.lead)];

  const en = languageRow(page, caseId, "en");
  await expect(cell(en, "versions")).toHaveText("v2 · Correction of v1");
  await expect(cell(en, "final")).toHaveText("None");
  await expect(cell(en, "issues").getByRole("img")).toHaveAccessibleName("1 issue: final result missing 1");

  const region = await expand(page, caseId, "en");
  await expect(region.getByRole("heading", { name: "Submissions (4)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(region, caseId, "en");
  // Submissions span v1 and v2: the Version column is shown.
  await expect(submissions.getByRole("columnheader", { name: "Version", exact: true })).toBeVisible();
  const kinds: [string, string, string][] = [
    [`Annotation · Round 1 · ${first} · en v1 · ${TIME}`, "Annotation", "v1"],
    [`Annotation · Round 1 · ${second} · en v1 · ${TIME}`, "Annotation", "v1"],
    [`Consolidation · ${lead} \\(you\\) · en v1 · ${TIME}`, "Consolidation", "v1"],
    [`Carry-forward · Round 1 · ${first} · en v2 · ${TIME}`, "Carry-forward", "v2"],
  ];
  for (const [label, kind, version] of kinds) {
    const row = submissionRow(submissions, label);
    await expect(row.getByRole("cell").nth(2)).toHaveText(kind);
    await expect(row.getByRole("cell").nth(3)).toHaveText(version);
    await expect(row.getByRole("button", { name: "Use as final…", exact: true })).toBeVisible();
  }
});
