/**
 * Documents lead table: rendering of the scenarios S0 to S10 and S13
 * (plan Task 7.2; spec "Testing", "Table", "Expanded row"), mapped to the lead-workflow
 * layout (lead-workflow spec "Screens › Documents"): six columns (Text · language, Plan,
 * Next step, Owner, Action, Last activity); version, work, final result and issues live in
 * the expanded row (stage blocks, Submissions, More › Text versions).
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and
 * logs in as its lead. Person labels are "Display name (pseudonym)" (D1), read from
 * the project members (the fixture keys users by role name, not by pseudonym).
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
const COL = { plan: 0, step: 1, owner: 2, action: 3, activity: 4 } as const;
/** "19 Oct, 15:01", optionally with seconds or a year. */
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}(?::\d{2})?`;

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactly = (pattern: string) => new RegExp(`^${pattern}$`);

/** Person label "Display name (pseudonym)" per fixture role name; the lead's own reads "(pseudonym, you)". */
async function labelsOf(page: Page, s: DocumentsScenario): Promise<Record<string, string>> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/members`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const members = (await response.json()) as Member[];
  const byUsername = new Map(members.map(member => [member.username, member]));
  return Object.fromEntries(Object.entries(s.users).map(([name, username]) => {
    const member = byUsername.get(username);
    if (!member) return [name, username];
    return [name, `${member.display_name} (${member.pseudonym}${username === s.users.lead ? ", you" : ""})`];
  }));
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
const segment = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Segments", exact: true }).getByRole("link", { name });
const disclosure = (page: Page, caseId: string, language: string) =>
  page.getByRole("button", { name: `Show details, ${caseId} · ${language}`, exact: true });

/** The collapsed language row (not its expanded content row). */
function languageRow(page: Page, caseId: string, language: string): Locator {
  return table(page).getByRole("row").filter({ has: disclosure(page, caseId, language) });
}

/** Case header: disclosure named "{case} · en source + n translations" and its header row. */
function caseHeader(page: Page, name: string): { row: Locator; button: Locator } {
  const button = table(page).getByRole("button", { name, exact: true });
  return { row: table(page).getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) }), button };
}

const cell = (row: Locator, column: keyof typeof COL) => row.getByRole("cell").nth(COL[column]);
const region = (page: Page, caseId: string, language: string) => page.getByRole("region", { name: `${caseId} · ${language}`, exact: true });
const stage = (area: Locator, name: "Translation review" | "Annotation" | "Final result") => area.getByRole("group", { name, exact: true });

/** Expand a row and wait until its content (and its submissions, if any) has loaded. */
async function expand(page: Page, caseId: string, language: string): Promise<Locator> {
  const button = disclosure(page, caseId, language);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const area = region(page, caseId, language);
  await expect(area.getByRole("heading", { name: "More", level: 3 })).toBeVisible();
  await expect(area.getByText("Loading submissions…")).toHaveCount(0);
  return area;
}

/** Open More › "Text versions (n)" of an expanded row; returns its text version items. */
async function textVersions(area: Locator, count: number): Promise<Locator> {
  const name = new RegExp(`^Text versions \\(${count}\\)$`);
  await area.locator("summary", { hasText: name }).click();
  return area.locator("details", { has: area.page().locator("summary", { hasText: name }) }).locator("li.text-version");
}

/** Language codes of a text's rows in table order. */
async function languagesInOrder(page: Page, caseId: string): Promise<string[]> {
  const names = await table(page).getByRole("button", { name: new RegExp(`^Show details, ${esc(caseId)} · `) }).evaluateAll(
    buttons => buttons.map(button => button.getAttribute("aria-label") ?? ""),
  );
  return names.map(name => name.split(" · ").pop() ?? "");
}

const submissionsTable = (area: Locator, caseId: string, language: string) =>
  area.getByRole("table", { name: `Submissions, ${caseId} · ${language}`, exact: true });

/** The submission row whose View link is named ``View {label}`` (label as a regex source). */
const submissionRow = (submissions: Locator, label: string) =>
  submissions.getByRole("row").filter({ has: submissions.page().getByRole("link", { name: exactly(`View ${label}`) }) });

test("S0 synthetic-accepted: corrected final waits for the carry-forward round; en has no final and is not counted", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S0");
  const caseId = "synthetic-accepted";
  const ann = esc(labels["ann-0004"]);

  // One decision in the case (de); en is not counted.
  const header = caseHeader(page, `${caseId} · en source + 1 translation`);
  await expect(header.button).toHaveAttribute("aria-expanded", "true");
  await expect(header.row).toContainText("1 decision");
  expect(await languagesInOrder(page, caseId)).toEqual(["en", "de"]);
  await expect(segment(page, /^Needs your decision \(1\)$/)).toBeVisible();

  // en: native source, annotation not assigned, no final result and nothing to decide.
  const en = languageRow(page, caseId, "en");
  await expect(cell(en, "plan").getByRole("button")).toHaveText(["Annotate"]);
  await expect(cell(en, "step")).toContainText("Assign annotation");
  await expect(cell(en, "step")).toContainText("Source text · ready to annotate");
  await expect(cell(en, "step")).not.toContainText("Your decision");
  const enArea = await expand(page, caseId, "en");
  await expect(stage(enArea, "Annotation")).toContainText("Not assigned yet");
  await expect(stage(enArea, "Final result")).toContainText("No final result yet.");
  await expect(enArea.getByRole("heading", { name: /^Submissions/ })).toHaveCount(0);
  await expect(await textVersions(enArea, 1)).toHaveText([/^v1\s*Native/]);

  // de: the correction v2 corrects the final result chosen on v1: Confirm final result, your decision.
  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "step")).toContainText("Confirm final result");
  await expect(cell(de, "step")).toContainText("Your decision");
  await expect(cell(de, "step")).toContainText(`Final: Annotation · Round 1 · ${labels["ann-0004"]}`);
  await expect(cell(de, "owner")).toHaveText("You");
  await expect(cell(de, "action").getByRole("button")).toHaveAccessibleName(`Review changes…, ${caseId} · de`);
  // "Open" opens the version of the final result (v1), not the newest version.
  const openHref = await de.getByRole("link", { name: `Open ${caseId} · de`, exact: true }).getAttribute("href");
  expect(new URLSearchParams(decodeURIComponent(openHref ?? "").split("?")[1]).get("variant")).toBe(s.documents!.v1);

  const area = await expand(page, caseId, "de");
  // The reviewer note sits in the Translation review block (lead-workflow spec, change 6).
  await expect(stage(area, "Translation review").getByText("v2 needs a translation reviewer.", { exact: true })).toBeVisible();
  await expect(stage(area, "Final result")).toContainText(new RegExp(`Annotation · Round 1 · ${ann} · chosen ${TIME}`));
  await expect(stage(area, "Final result")).toContainText("Your decision");
  await expect(area.getByText("v2 (Ready for review) corrects the text of the final result.", { exact: true })).toBeVisible();
  await expect(area.getByText(`Waiting: Round 1 · ${labels["ann-0004"]} is in progress. You can choose again once it is submitted.`, { exact: true })).toBeVisible();
  await expect(area.getByRole("button", { name: "Keep final result…", exact: true })).toBeVisible();
  await expect(area.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(area, caseId, "de");
  const final = submissionRow(submissions, `Annotation · Round 1 · ${ann} · de v1 · ${TIME}`);
  await expect(final.getByRole("cell").first()).toHaveText("Final");
  await expect(final.getByRole("button")).toHaveCount(0);
  const review = submissionRow(submissions, `Review · Round 1 · ${esc(labels["ann-0003"])} · de v1 · ${TIME}`);
  await expect(review.getByRole("cell").nth(2)).toHaveText("Review");
  await expect(review.getByRole("button", { name: "Replace…", exact: true })).toBeVisible();
  await expect(review.getByRole("link", { name: "Compare", exact: true })).toBeVisible();
  await expect(area.getByText(`Round 1 · ${labels["ann-0004"]} · in progress, not submitted yet`, { exact: true })).toBeVisible();
  const versions = await textVersions(area, 2);
  await expect(versions).toHaveText([/^v1\s*Machine translation/, /^v2\s*Correction of v1\s*Ready for review/]);

  // The decision category selects the de row only.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=confirm-final`);
  await expect(languageRow(page, caseId, "de")).toBeVisible();
  await expect(disclosure(page, caseId, "en")).toHaveCount(0);
});

test("S0 expanded table has no axe violations", async ({ page }) => {
  await openScenario(page, "S0", "?open=synthetic-accepted%3Ade");
  const area = page.getByRole("region", { name: "synthetic-accepted · de", exact: true });
  await expect(area.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const violations = results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
  expect(violations).toEqual([]);
});

test("S1 case-0042: two submissions and a final result, no issues", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S1");
  const caseId = "case-0042";
  const [first, second] = [esc(labels["ann-0001"]), esc(labels["ann-0002"])];

  const header = caseHeader(page, `${caseId} · en source`);
  await expect(header.row).not.toContainText("decision");
  await expect(segment(page, /^Needs your decision \(0\)$/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Select ${caseId} (1 language)`, exact: true })).toBeVisible();

  const en = languageRow(page, caseId, "en");
  await expect(cell(en, "step")).toContainText("Done");
  await expect(cell(en, "step")).toContainText(`Final: Annotation · Round 1 · ${labels["ann-0001"]}`);
  await expect(cell(en, "owner")).toHaveText("—");
  await expect(cell(en, "action")).toHaveText("");

  const area = await expand(page, caseId, "en");
  await expect(stage(area, "Annotation").getByRole("list", { name: "Annotators" }).getByRole("listitem"))
    .toHaveText([new RegExp(`^${first} · Annotation · Submitted ${TIME}$`), new RegExp(`^${second} · Annotation · Submitted ${TIME}$`)]);
  await expect(stage(area, "Final result")).toContainText(new RegExp(`Annotation · Round 1 · ${first} · chosen ${TIME}`));
  await expect(area.getByRole("heading", { name: "Issues", level: 3 })).toHaveCount(0);
  await expect(area.getByRole("button", { name: "Keep final result…" })).toHaveCount(0);
  await expect(area.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(area, caseId, "en");
  await expect(submissionRow(submissions, `Annotation · Round 1 · ${first} · en v1 · ${TIME}`).getByRole("cell").first()).toHaveText("Final");
  const other = submissionRow(submissions, `Annotation · Round 1 · ${second} · en v1 · ${TIME}`);
  await expect(other.getByRole("cell").first()).toHaveText("");
  await expect(other.getByRole("button", { name: "Replace…", exact: true })).toBeVisible();
  // One version only: no Version column.
  await expect(submissions.getByRole("columnheader", { name: "Version" })).toHaveCount(0);

  // "No final result" moved from the bar to the filter "Final result: none" (lead-workflow spec, D21): nothing matches.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?final=none`);
  await expect(page.getByLabel("Final result", { exact: true })).toHaveValue("none");
  await expect(disclosure(page, caseId, "en")).toHaveCount(0);
});

test("S2 case-0108: seven languages, final 4 of 7, de failed its automatic check", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S2");
  const caseId = "case-0108";

  const header = caseHeader(page, `${caseId} · en source + 6 translations`);
  await expect(header.button).toHaveAttribute("aria-expanded", "true");
  // A failed check without a reviewer is "To assign", not a decision (D4).
  await expect(header.row).not.toContainText("decision");
  await expect(segment(page, /^Needs your decision \(0\)$/)).toBeVisible();
  await expect(segment(page, /^To assign \(6\)$/)).toBeVisible();
  // Source language first, then by language code.
  expect(await languagesInOrder(page, caseId)).toEqual(["en", "de", "es", "fr", "it", "nl", "pt"]);

  // Final 4 of 7: en, es, fr and it have a final result; de, nl and pt none.
  for (const language of ["en", "es", "fr", "it"]) {
    const area = await expand(page, caseId, language);
    await expect(stage(area, "Final result"), language).toContainText(new RegExp(`Annotation · Round 1 · ${esc(labels["ann-0001"])} · chosen ${TIME}`));
  }
  for (const language of ["de", "nl", "pt"]) {
    const area = await expand(page, caseId, language);
    await expect(stage(area, "Final result").getByText("No final result yet.", { exact: true }), language).toBeVisible();
  }

  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "step")).toContainText("Assign translation review");
  await expect(cell(de, "step")).toContainText("Check failed");
  await expect(cell(de, "step")).toContainText("v1 machine translation · check failed");
  await expect(cell(de, "action").getByRole("button")).toHaveAccessibleName(`Assign translation review…, ${caseId} · de`);
  await expect(cell(languageRow(page, caseId, "nl"), "step")).not.toContainText("Check failed");

  const area = region(page, caseId, "de");
  const translation = stage(area, "Translation review");
  await expect(translation.getByText("v1 failed the automatic translation check.", { exact: true })).toBeVisible();
  await expect(translation.getByRole("button", { name: "Text versions (1)", exact: true })).toBeVisible();
  // Submissions only when there is one or a final result (lead-workflow spec, expanded row).
  await expect(area.getByRole("heading", { name: /^Submissions/ })).toHaveCount(0);
  await expect(await textVersions(area, 1)).toHaveText([/^v1\s*Machine translation\s*Check failed/]);

  // "Final result: none" lists exactly the three rows without a final result.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?final=none`);
  await expect(page.getByLabel("Final result", { exact: true })).toHaveValue("none");
  await expect.poll(() => languagesInOrder(page, caseId)).toEqual(["de", "nl", "pt"]);
  // The failed check: the translation status filter selects the de row only.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?translation_status=automatic_check_failed`);
  await expect(languageRow(page, caseId, "de")).toBeVisible();
  await expect(disclosure(page, caseId, "fr")).toHaveCount(0);
});

test("S3 case-0211: final on v1 Round 2, corrections v2 and v3, waiting for the v3 review", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S3");
  const caseId = "case-0211";
  const ann = esc(labels["ann-0001"]);

  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "step")).toContainText("Confirm final result");
  await expect(cell(de, "step")).toContainText(`Final: Annotation · Round 2 · ${labels["ann-0001"]}`);
  // The final result is on v1: "Open" opens v1.
  const openHref = await de.getByRole("link", { name: `Open ${caseId} · de`, exact: true }).getAttribute("href");
  expect(new URLSearchParams(decodeURIComponent(openHref ?? "").split("?")[1]).get("variant")).toBe(s.documents!.v1);
  await expect(caseHeader(page, `${caseId} · en source + 1 translation`).row).toContainText("1 decision");

  const area = await expand(page, caseId, "de");
  await expect(stage(area, "Translation review").getByRole("list").first()).toContainText("v3 · Ready for review");
  await expect(area.getByText(/^v2 \(Accepted\) corrects the text of the final result\./)).toBeVisible();
  await expect(area.getByText("Keep v1, or choose a result on v2 once one exists (assign work in Text versions).", { exact: false })).toBeVisible();
  await expect(area.getByText("v3 (Ready for review) corrects the text of the final result.", { exact: true })).toBeVisible();
  await expect(area.getByText(`Waiting: translation review of v3 by ${labels.reviewer} is open. You can choose again once it is submitted.`, { exact: true })).toBeVisible();
  await expect(area.getByRole("button", { name: "Keep final result…", exact: true })).toBeVisible();

  const submissions = submissionsTable(area, caseId, "de");
  const round1 = submissionRow(submissions, `Annotation · Round 1 · ${ann} · de v1 · ${TIME}`);
  await expect(round1.getByRole("cell").nth(1)).toContainText("Round 1 · abandoned");
  const round2 = submissionRow(submissions, `Annotation · Round 2 · ${ann} · de v1 · ${TIME}`);
  await expect(round2.getByRole("cell").first()).toHaveText("Final");
  // Oldest first.
  const views = submissions.getByRole("link", { name: /^View / });
  await expect(views).toHaveCount(2);
  await expect(views.nth(0)).toHaveAccessibleName(/^View Annotation · Round 1 · /);
  await expect(views.nth(1)).toHaveAccessibleName(/^View Annotation · Round 2 · /);
  await expect(await textVersions(area, 3)).toHaveText([/^v1\s*Machine translation/, /^v2\s*Correction of v1\s*Accepted/, /^v3\s*Correction of v2\s*Ready for review/]);
});

test("S4 case-0305 fr: two independent translations, each annotated in its own round", async ({ page }) => {
  const { labels } = await openScenario(page, "S4");
  const caseId = "case-0305";

  // "Choose in Text versions" and per-row checkboxes are gone: selection is per case (lead-workflow spec, change 9 / D17).
  await expect(page.getByRole("checkbox", { name: `Select ${caseId} (2 languages)`, exact: true })).toBeVisible();
  const fr = languageRow(page, caseId, "fr");
  await expect(fr.getByRole("checkbox")).toHaveCount(0);
  const open = fr.getByRole("link", { name: `Open ${caseId} · fr`, exact: true });
  await expect(open).toHaveAccessibleDescription("Opens Provider B m1 v1, the most recent translation");

  const area = await expand(page, caseId, "fr");
  await expect(stage(area, "Translation review").getByRole("list").first().getByRole("listitem"))
    .toHaveText(["Provider A m1 v1 · Ready for review", "Provider B m1 v1 · Ready for review"]);
  await expect(stage(area, "Annotation").getByRole("list", { name: "Annotators" }).getByRole("listitem")).toHaveText([
    `${labels["ann-0001"]} · Annotation · Open · Round 1 · Provider A m1 v1`,
    `${labels["ann-0002"]} · Annotation · Open · Round 1 · Provider B m1 v1`,
  ]);
  await expect(stage(area, "Final result").getByText("No final result yet.", { exact: true })).toBeVisible();
  // No submissions and no final result: no Submissions section.
  await expect(area.getByRole("heading", { name: /^Submissions/ })).toHaveCount(0);
  await expect(await textVersions(area, 2)).toHaveText([/^Provider A m1 v1\s*Machine translation/, /^Provider B m1 v1\s*Machine translation/]);
});

test("S5 case-0377: the lead's consolidation is the final result, without a round in its label", async ({ page }) => {
  const { labels } = await openScenario(page, "S5");
  const caseId = "case-0377";
  const lead = esc(labels.lead);

  const en = languageRow(page, caseId, "en");
  await expect(cell(en, "step")).toContainText("Done");
  // No round in a consolidation's label.
  await expect(cell(en, "step")).toHaveText(new RegExp(`Final: Consolidation · ${lead}$`));
  await expect(caseHeader(page, `${caseId} · en source`).row).not.toContainText("decision");

  const area = await expand(page, caseId, "en");
  await expect(stage(area, "Final result")).toContainText(new RegExp(`Consolidation · ${lead} · chosen ${TIME}`));
  await expect(area.getByRole("heading", { name: "Submissions (4)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(area, caseId, "en");
  const final = submissionRow(submissions, `Consolidation · ${lead} · en v1 · ${TIME}`);
  await expect(final.getByRole("cell").first()).toHaveText("Final");
  await expect(final.getByRole("cell").nth(2)).toHaveText("Consolidation");
  await expect(final.getByRole("cell").nth(3)).toHaveText(labels.lead);
  for (const name of ["ann-0001", "ann-0002", "ann-0003"]) {
    const input = submissionRow(submissions, `Annotation · Round 1 · ${esc(labels[name])} · en v1 · ${TIME}`);
    await expect(input.getByRole("cell").nth(2)).toHaveText("Annotation");
  }
});

test("S6 case-0390 de: open problem report with a paused task", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S6");
  const caseId = "case-0390";
  const reason = String(s.reason);

  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "step")).toContainText("Decide on problem report");
  await expect(cell(de, "step")).toContainText("Your decision");
  await expect(cell(de, "step")).toContainText(`“${reason.slice(0, 60)}`);
  await expect(cell(de, "step")).toContainText(`” · ${labels["ann-0001"]} · task paused`);
  await expect(cell(de, "action").getByRole("button")).toHaveAccessibleName(`Decide on report…, ${caseId} · de`);
  await expect(caseHeader(page, `${caseId} · en source + 1 translation`).row).toContainText("1 decision");

  const area = await expand(page, caseId, "de");
  const annotators = stage(area, "Annotation").getByRole("list", { name: "Annotators" });
  await expect(annotators).toContainText(`${labels["ann-0001"]} · Annotation · Open · Round 1`);
  await expect(annotators).toContainText("Paused");
  await expect(area.getByRole("heading", { name: "Issues", level: 3 })).toBeVisible();
  const pseudonym = labels["ann-0001"].replace(/^.* \((.+)\)$/, "$1");
  const report = area.getByRole("listitem").filter({ hasText: reason.slice(0, 120) });
  await expect(report).toContainText(pseudonym);
  await expect(report).toContainText("task paused");
  await expect(report.locator("time")).toHaveCount(1);
  await expect(report.getByRole("link", { name: "Open report", exact: true })).toHaveAttribute("href", new RegExp(`/problem-reports/${esc(String(s.report_id))}`));
  await expect(area.locator("summary", { hasText: /^Problem reports \(1\)$/ })).toBeVisible();

  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?decision=report-or-pause`);
  await expect(languageRow(page, caseId, "de")).toBeVisible();
  await expect(disclosure(page, caseId, "en")).toHaveCount(0);
});

test("S7 300 texts: 50 groups per page, page 1 of 6, only decision groups expanded", async ({ page }) => {
  await openScenario(page, "S7");
  const groups = table(page).getByRole("button", { name: /^case-\d{4} · en source( \+ \d translations?)?$/ });
  await expect(groups).toHaveCount(50);
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages).toContainText("Page 1 of 6");
  await expect(groups.first()).toHaveAccessibleName("case-0001 · en source");
  await expect(groups.last()).toHaveAccessibleName("case-0050 · en source");

  // More than 50 cases: groups start collapsed unless a row needs a decision. case-0007's failed check is
  // "To assign" (D4), so no group on page 1 starts expanded.
  const expanded = table(page).locator('button.documents-group-toggle[aria-expanded="true"]');
  await expect(expanded).toHaveCount(0);
  await expect(table(page).getByRole("button", { name: /^Show details, / })).toHaveCount(0);
  const issueGroup = table(page).getByRole("button", { name: "case-0007 · en source + 1 translation", exact: true });
  await issueGroup.click();
  await expect(issueGroup).toHaveAttribute("aria-expanded", "true");
  await expect(table(page).getByRole("button", { name: /^Show details, / })).toHaveCount(2);
  await expect(cell(languageRow(page, "case-0007", "de"), "step")).toContainText("Check failed");

  await pages.getByRole("link", { name: "Next", exact: true }).click();
  await expect(pages).toContainText("Page 2 of 6");
  await expect(groups.first()).toHaveAccessibleName("case-0051 · en source");
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
  // The case card header: case checkbox, case title and the decision badge.
  const caseCard = page.getByRole("list", { name: "Documents", exact: true }).getByRole("listitem").first();
  await expect(caseCard.getByRole("checkbox", { name: `Select ${caseId} (2 languages)`, exact: true })).toBeVisible();
  await expect(caseCard.getByRole("heading", { name: `${caseId} · en source + 1 translation`, level: 2 })).toBeVisible();
  await expect(caseCard).toContainText("1 decision");

  const de = page.getByRole("article", { name: `${caseId} · de`, exact: true });
  await expect(de.getByRole("heading", { name: `${caseId} · de`, level: 3 })).toBeVisible();
  await expect(de).toContainText("Confirm final result");
  await expect(de).toContainText("Your decision");
  await expect(de).toContainText(`Final: Annotation · Round 1 · ${labels["ann-0004"]}`);
  await expect(de).toContainText("Owner: You");
  await expect(de.getByRole("button", { name: `Review changes…, ${caseId} · de`, exact: true })).toBeVisible();
  await expect(de.getByRole("link", { name: `Open ${caseId} · de`, exact: true })).toBeVisible();

  const toggle = de.getByRole("button", { name: `Show details, ${caseId} · de`, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(de.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  await expect(de.getByText("v2 (Ready for review) corrects the text of the final result.", { exact: true })).toBeVisible();
  await expect(de.getByRole("list", { name: `Submissions, ${caseId} · de`, exact: true }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("table")).toHaveCount(0);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("S9 case-0420 fr: equal provider names get the external id", async ({ page }) => {
  const { s } = await openScenario(page, "S9");
  const caseId = "case-0420";
  const names = s.chain_names as { a: string; b: string };

  const fr = languageRow(page, caseId, "fr");
  await expect(fr.getByRole("link", { name: `Open ${caseId} · fr`, exact: true })).toHaveAccessibleDescription(`Opens ${names.b} v1, the most recent translation`);
  const area = await expand(page, caseId, "fr");
  await expect(stage(area, "Translation review").getByRole("list").first().getByRole("listitem"))
    .toHaveText([`${names.a} v1 · Ready for review`, `${names.b} v1 · Ready for review`]);
  await expect(await textVersions(area, 2)).toHaveText([new RegExp(`^${esc(names.a)} v1`), new RegExp(`^${esc(names.b)} v1`)]);
});

test("S10 case-0444 de: rejected and queried reviews are translation issues, never text corrections", async ({ page }) => {
  const { labels } = await openScenario(page, "S10");
  const caseId = "case-0444";

  const de = languageRow(page, caseId, "de");
  await expect(cell(de, "step")).toContainText("Confirm final result");
  await expect(cell(de, "step")).toContainText(`Final: Annotation · Round 1 · ${labels["ann-0001"]}`);
  await expect(caseHeader(page, `${caseId} · en source + 1 translation`).row).toContainText("1 decision");

  const area = await expand(page, caseId, "de");
  // Three independent translations; the final result is on Provider A m1 v1.
  await expect(stage(area, "Translation review").getByRole("list").first().getByRole("listitem"))
    .toHaveText(["Provider A m1 v5 · Accepted", "Provider B m1 v2 · Rejected in review", "Provider C m1 v2 · Queried"]);
  const final = submissionRow(submissionsTable(area, caseId, "de"), `Annotation · Round 1 · ${esc(labels["ann-0001"])} · de Provider A m1 v1 · ${TIME}`);
  await expect(final.getByRole("cell").first()).toHaveText("Final");
  // Rejected and queried roots are translation lines in the Translation review block (lead-workflow spec, change 6).
  const translation = stage(area, "Translation review");
  for (const line of ["Provider B m1 v2 was rejected in review.", "Provider C m1 v2 was queried in review."]) {
    await expect(translation.getByRole("listitem").filter({ hasText: line })).toHaveCount(1);
  }
  await expect(translation.getByRole("button", { name: "Text versions (9)", exact: true })).toBeVisible();
  // Only the accepted child of accepted_corrected corrects the final result.
  await expect(area.getByText(/^Provider A m1 v5 \(Accepted\) corrects the text of the final result\./)).toBeVisible();
  await expect(area.getByText("Provider A m1 v2 was rejected in review. No action needed.", { exact: true })).toBeVisible();
  await expect(area.getByText("Provider A m1 v3 was queried in review. No action needed.", { exact: true })).toBeVisible();
  await expect(area.getByText(/Provider A m1 v[234] \([^)]*\) corrects the text/)).toHaveCount(0);
  await expect(area.getByText(/Provider [BC] m1 v\d \([^)]*\) corrects the text/)).toHaveCount(0);
});

test("S13 case-0713 en: consolidation and carry-forward kinds", async ({ page }) => {
  const { labels } = await openScenario(page, "S13");
  const caseId = "case-0713";
  const [first, second, lead] = [esc(labels["ann-0001"]), esc(labels["ann-0002"]), esc(labels.lead)];

  const en = languageRow(page, caseId, "en");
  await expect(cell(en, "step")).toContainText("Choose final result");
  await expect(cell(en, "step")).toContainText("Your decision");
  await expect(cell(en, "action").getByRole("button")).toHaveAccessibleName(`Choose final…, ${caseId} · en`);

  const area = await expand(page, caseId, "en");
  // No final result and all work submitted: the missing-final line sits in the Final result block.
  await expect(stage(area, "Final result").getByText("No final result yet, and all work is submitted.", { exact: true })).toBeVisible();
  await expect(area.getByRole("heading", { name: "Submissions (4)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(area, caseId, "en");
  // Submissions span v1 and v2: the Version column is shown.
  await expect(submissions.getByRole("columnheader", { name: "Version", exact: true })).toBeVisible();
  const kinds: [string, string, string][] = [
    [`Annotation · Round 1 · ${first} · en v1 · ${TIME}`, "Annotation", "v1"],
    [`Annotation · Round 1 · ${second} · en v1 · ${TIME}`, "Annotation", "v1"],
    [`Consolidation · ${lead} · en v1 · ${TIME}`, "Consolidation", "v1"],
    [`Carry-forward · Round 1 · ${first} · en v2 · ${TIME}`, "Carry-forward", "v2"],
  ];
  for (const [label, kind, version] of kinds) {
    const row = submissionRow(submissions, label);
    await expect(row.getByRole("cell").nth(2)).toHaveText(kind);
    await expect(row.getByRole("cell").nth(3)).toHaveText(version);
    await expect(row.getByRole("button", { name: "Use as final…", exact: true })).toBeVisible();
  }
  await expect(await textVersions(area, 2)).toHaveText([/^v1\s*Native/, /^v2\s*Correction of v1/]);
});
