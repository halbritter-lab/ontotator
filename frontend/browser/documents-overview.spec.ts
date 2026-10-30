/**
 * Documents overview scenarios 1-16 (plan O10c Step 2, "Shared contracts › Scenario table"):
 * one isolated project per scenario (tests/browser_overview_scenarios.py), opened as the
 * lead at 1280 px; every row's three one-line stage cells (the text card's short state and who,
 * spec 2026-10-23 §2b), Waiting on, Next step and decision edge as the table, with a screenshot
 * `scenario-{n}.png`. A not-planned source is folded into its case line. Plus the Progress
 * → Documents click-through: every Progress count equals the Documents count it opens.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  documentsReady, documentsTable, documentsTabs, evidence, expectEdge, expectStage, expectWaiting, namePattern, moreMarker, openDocuments, rowAction, rowCell, rowHeader,
  textRow, type CellText,
} from "./documentsOverviewHelpers";
import { loginOverviewUser, overviewScenario, type OverviewScenarioName } from "./overviewHelpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 900 } });

const ANA = "Ana Weber", TOM = "Tom Reis", LUC = "Luc Martin";
const WAITING: CellText = { state: "waiting", who: "" };
/** One annotation submitted, another still open: the lead may accept now (issue 123). */
const CAN_ACCEPT: CellText = { state: "can be accepted", who: "" };
const SOURCE: CellText = { state: "source text", who: "" };
const ACCEPTED: CellText = { state: "accepted", who: "" };
const NOT_PLANNED: CellText = { state: "not planned", who: "" };
const AFTER_REVIEW: CellText = { state: "after translation review", who: "" };
/** "{n} of {m} submitted" without who (submitted annotation; the count follows the per-text setting). */
const SUBMITTED: CellText = { state: /\d+ of \d+ submitted/, who: "" };
const ACCEPTED_ON = /accepted( \d{1,2} [A-Z][a-z]{2})?/;

interface RowExpect {
  case_id: string;
  language: string;
  translation: CellText;
  annotation: CellText;
  finalization: CellText;
  waiting: "You" | "—" | readonly string[];
  /** The Next step column's first button; null = none. */
  action: string | null;
  edge: boolean;
  /** Text cell marker ("v2 corrected"). */
  marker?: string;
}

/** A not-planned text shown only as the "+n" marker of its case's rows. */
interface FoldedExpect {
  case_id: string;
  folded: string | RegExp;
}

const SCENARIOS: Record<Exclude<OverviewScenarioName, "WALKTHROUGH">, (RowExpect | FoldedExpect)[]> = {
  S1: [
    { case_id: "case-101", language: "de", translation: { state: "not decided", who: "" }, annotation: { state: /Unassigned|\d+ annotators? · max \d+|\d+ · full/, who: "" }, finalization: WAITING, waiting: "You", action: "Plan…", edge: true },
    { case_id: "case-101", folded: "+1" },
  ],
  S2: [
    { case_id: "case-102", language: "de", translation: { state: "Check failed", who: "" }, annotation: AFTER_REVIEW, finalization: WAITING, waiting: "You", action: "Assign review…", edge: false },
  ],
  S3: [
    { case_id: "case-103", language: "de", translation: { state: `in review (${ANA})`, who: "" }, annotation: AFTER_REVIEW, finalization: WAITING, waiting: [ANA], action: null, edge: false },
  ],
  S4: [
    { case_id: "case-104", language: "de", translation: { state: "Rejected", who: "" }, annotation: AFTER_REVIEW, finalization: WAITING, waiting: "You", action: "Resolve…", edge: true },
    { case_id: "case-104", language: "fr", translation: { state: "Query", who: "" }, annotation: AFTER_REVIEW, finalization: WAITING, waiting: "You", action: "Resolve…", edge: true },
  ],
  S5: [
    { case_id: "case-105", language: "de", translation: ACCEPTED, annotation: { state: "Unassigned", who: "" }, finalization: WAITING, waiting: "You", action: "Assign annotation…", edge: false },
  ],
  S6: [
    { case_id: "case-106", language: "de", translation: ACCEPTED, annotation: { state: "1 of 2 submitted", who: TOM }, finalization: CAN_ACCEPT, waiting: [TOM], action: null, edge: false },
  ],
  S7a: [
    { case_id: "case-107", language: "de", translation: ACCEPTED, annotation: SUBMITTED, finalization: { state: "Your choice", who: "" }, waiting: "You", action: "Accept result…", edge: true },
  ],
  S7b: [
    { case_id: "case-107", language: "en", translation: SOURCE, annotation: { state: "2 of 2 submitted", who: "" }, finalization: { state: "ready to compare", who: "" }, waiting: "You", action: "Accept result…", edge: true },
  ],
  // D1: Luc's open annotation review became a consolidation (tests/browser_overview_scenarios.py build_s8).
  S8: [
    { case_id: "case-108", language: "de", translation: ACCEPTED, annotation: { state: /\d+ of 2 submitted/, who: "" }, finalization: { state: /consolidating( \(\d+ of \d+ groups open\))?/, who: "" }, waiting: [LUC], action: null, edge: false },
  ],
  S9: [
    { case_id: "case-109", language: "de", translation: ACCEPTED, annotation: { state: /\d+ of \d+ submitted/, who: TOM }, finalization: WAITING, waiting: "You", action: "Decide on report…", edge: true },
  ],
  S10: [
    { case_id: "case-110", language: "de", translation: ACCEPTED, annotation: NOT_PLANNED, finalization: WAITING, waiting: "—", action: null, edge: false },
  ],
  S11: [
    { case_id: "case-111", language: "de", translation: ACCEPTED, annotation: { state: "2 of 2 submitted", who: "" }, finalization: { state: ACCEPTED_ON, who: "" }, waiting: "—", action: null, edge: false },
    { case_id: "case-111", language: "fr", translation: ACCEPTED, annotation: { state: "2 of 2 submitted", who: "" }, finalization: { state: ACCEPTED_ON, who: "" }, waiting: "—", action: null, edge: false },
    { case_id: "case-111", folded: /^\+\d+$/ },
  ],
  S12: [
    { case_id: "case-112", language: "de", translation: ACCEPTED, annotation: { state: "In progress on old text", who: "" }, finalization: WAITING, waiting: "You", action: "Handle text change…", edge: true, marker: "v2 corrected" },
  ],
  S13: [
    { case_id: "case-113", language: "de", translation: ACCEPTED, annotation: { state: "Submitted on v1", who: "" }, finalization: WAITING, waiting: "You", action: "Carry to v2…", edge: true, marker: "v2 corrected" },
  ],
  S14: [
    { case_id: "case-114", language: "de", translation: ACCEPTED, annotation: SUBMITTED, finalization: { state: "Final is on old text", who: "" }, waiting: "You", action: "Review changes…", edge: true, marker: "v2 corrected" },
  ],
  S15: [
    { case_id: "case-115", folded: "+1" },
    // Source changed: decision colour, but step kind assign (no edge, To assign, VD14).
    { case_id: "case-115", language: "de", translation: { state: "Source changed", who: "" }, annotation: SUBMITTED, finalization: { state: "may be outdated", who: "" }, waiting: "You", action: "Assign review…", edge: false },
  ],
  S16: [
    { case_id: "case-116", language: "de", translation: { state: `in review (${ANA})`, who: "" }, annotation: { state: /\d+ of \d+ submitted/, who: TOM }, finalization: WAITING, waiting: [ANA, TOM], action: null, edge: false },
  ],
};

async function expectRow(page: Page, expected: RowExpect | FoldedExpect): Promise<void> {
  if ("folded" in expected) {
    await expect(moreMarker(page, expected.case_id), `${expected.case_id} not in plan`).toHaveText(expected.folded);
    return;
  }
  const { case_id: caseId, language } = expected;
  const row = textRow(page, caseId, language);
  await expect(row, `${caseId} ${language}`).toHaveCount(1);
  await test.step(`${caseId} ${language}`, async () => {
    // U-4: a project without any translation shows no Translation column.
    if (await documentsTable(page).getByRole("columnheader", { name: "Translation", exact: true }).count()) await expectStage(rowCell(row, "translation"), expected.translation);
    else await expect(rowCell(row, "translation")).toHaveCount(0);
    await expectStage(rowCell(row, "annotation"), expected.annotation);
    await expectStage(rowCell(row, "finalization"), expected.finalization);
    await expectWaiting(row, expected.waiting);
    await expectEdge(page, row, expected.edge);
    const actions = rowCell(row, "next").getByRole("button");
    if (expected.action) {
      await expect(rowAction(page, expected.action, caseId, language)).toBeVisible();
      await expect(actions.first()).toHaveAccessibleName(namePattern(`${expected.action}, `, caseId, language));
    } else {
      await expect(actions).toHaveCount(0);
    }
    if (expected.marker) await expect(rowHeader(row).locator(".documents-version-marker")).toHaveText(expected.marker);
  });
}

for (const [name, rows] of Object.entries(SCENARIOS) as [Exclude<OverviewScenarioName, "WALKTHROUGH">, (RowExpect | FoldedExpect)[]][]) {
  test(`scenario ${name.slice(1)}: stage cells, Waiting on and Next step as the Scenario table`, async ({ page }) => {
    const s = await overviewScenario(page, name);
    await loginOverviewUser(page, s, "lead");
    await openDocuments(page, s.project);
    for (const row of rows) await expectRow(page, row);
    await evidence(page, `scenario-${name.slice(1)}`);
  });
}

const progressLinks = (page: Page) => page.locator(".progress-page a[href*='/documents']");

/** Open Progress of ``project`` and wait for its counts. */
async function openProgress(page: Page, project: string): Promise<void> {
  await page.goto(`/#/projects/${encodeURIComponent(project)}/progress`);
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  // The loading skeleton has a pipeline too: wait for the first count link.
  await expect(progressLinks(page).first()).toBeVisible({ timeout: 30_000 });
}

/** The count of a Progress link: "{label}: {n}" (stage counts) or "{n} need your decision" / "{n} to assign" (lede). */
function linkCount(name: string): number {
  return Number(/: (\d+)$/.exec(name)?.[1] ?? /^(\d+) /.exec(name)?.[1] ?? Number.NaN);
}

/** The count Documents shows for the opened link: "{k} of {n}" with filters, else the active tab's count. */
async function documentsCount(page: Page): Promise<number> {
  const filtered = page.locator(".documents-filter-count");
  if (await filtered.count()) return Number(/^(\d+) of \d+$/.exec((await filtered.textContent())?.trim() ?? "")?.[1]);
  const active = documentsTabs(page).getByRole("tab", { selected: true });
  return Number(/, (\d+)$/.exec((await active.getAttribute("aria-label")) ?? "")?.[1]);
}

test("Progress → Documents click-through with equal counts", async ({ page }) => {
  test.setTimeout(480_000);
  let checked = 0;
  for (const name of ["S4", "S11", "S15"] as const) {
    const s = await overviewScenario(page, name);
    await page.context().clearCookies();
    await loginOverviewUser(page, s, "lead");
    await openProgress(page, s.project);
    const total = await progressLinks(page).count();
    expect(total, `${name}: Progress links into Documents`).toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) {
      await openProgress(page, s.project);
      const link = progressLinks(page).nth(index);
      const label = ((await link.getAttribute("aria-label")) ?? (await link.textContent()) ?? "").trim();
      const count = linkCount(label);
      if (!Number.isFinite(count)) continue;
      await test.step(`${name}: ${label}`, async () => {
        await link.click();
        await documentsReady(page);
        await expect.poll(() => documentsCount(page), { message: `${name}: ${label}` }).toBe(count);
        checked += 1;
      });
    }
    if (name === "S11") await evidence(page, "progress-click-through");
  }
  expect(checked).toBeGreaterThan(5);
});
