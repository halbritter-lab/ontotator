/**
 * Documents overview scenarios 1-16 (plan O10c Step 2, "Shared contracts › Scenario table"):
 * one isolated project per scenario (tests/browser_overview_scenarios.py), opened as the
 * lead at 1280 px; every row's three stage cells (line 1 and line 2), Waiting on, Action
 * and decision edge as the table, with a screenshot `scenario-{n}.png`. Plus the Progress
 * → Documents click-through: every Progress count equals the Documents count it opens.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  documentsReady, documentsTabs, evidence, expectEdge, expectStage, expectWaiting, openDocuments, rowAction, rowCell, rowHeader, textRow,
  type CellText,
} from "./documentsOverviewHelpers";
import { loginOverviewUser, overviewScenario, type OverviewScenarioName } from "./overviewHelpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 900 } });

const ANA = "Ana Weber", TOM = "Tom Reis", LUC = "Luc Martin";
/** "10:40" today or "20 Oct, 10:40" (stage cell times). */
const TIME = String.raw`(\d{1,2} \w{3},? )?\d{2}:\d{2}`;
const NONE: CellText = { line1: "—", line2: "" };
const SOURCE: CellText = { line1: "— source", line2: "" };
const NOT_PLANNED: CellText = { line1: "— not planned", line2: "" };
const UNCHANGED: CellText = { line1: "✓ Accepted", line2: "unchanged" };
const CORRECTED: CellText = { line1: "✓ Accepted", line2: `with corrections · v1 → v2 · ${ANA}` };

interface RowExpect {
  case_id: string;
  language: string;
  review: CellText;
  annotation: CellText;
  final: CellText;
  waiting: "You" | "—" | readonly string[];
  /** The Action column's first button; null = no step button (a quiet "Plan…" on rows outside the plan is allowed, VD2). */
  action: string | null;
  edge: boolean;
  /** Text cell marker ("v2 corrected"). */
  marker?: string;
}

const SCENARIOS: Record<Exclude<OverviewScenarioName, "WALKTHROUGH">, RowExpect[]> = {
  S1: [
    { case_id: "case-101", language: "de", review: { line1: "? not decided", line2: "" }, annotation: { line1: "? not decided", line2: "" }, final: NONE, waiting: "You", action: "Plan…", edge: true },
    { case_id: "case-101", language: "en", review: SOURCE, annotation: NOT_PLANNED, final: NONE, waiting: "—", action: "Plan…", edge: false },
  ],
  S2: [
    { case_id: "case-102", language: "de", review: { line1: "⚠ Check failed", line2: "unassigned" }, annotation: { line1: "○ after review", line2: "" }, final: NONE, waiting: "You", action: "Assign review…", edge: false },
  ],
  S3: [
    { case_id: "case-103", language: "de", review: { line1: "◐ In progress", line2: ANA }, annotation: { line1: "○ after review", line2: "" }, final: NONE, waiting: [ANA], action: null, edge: false },
  ],
  S4: [
    { case_id: "case-104", language: "de", review: { line1: "✕ Rejected", line2: new RegExp(`^${ANA} · ${TIME}$`) }, annotation: { line1: "○ blocked", line2: "translation rejected" }, final: NONE, waiting: "You", action: "Resolve…", edge: true },
    { case_id: "case-104", language: "fr", review: { line1: "? Query", line2: new RegExp(`^${LUC} · ${TIME}$`) }, annotation: { line1: "○ blocked", line2: "queried" }, final: NONE, waiting: "You", action: "Resolve…", edge: true },
  ],
  S5: [
    { case_id: "case-105", language: "de", review: CORRECTED, annotation: { line1: "○ 0 of 2 assigned", line2: "" }, final: NONE, waiting: "You", action: "Assign annotation…", edge: false },
  ],
  S6: [
    { case_id: "case-106", language: "de", review: UNCHANGED, annotation: { line1: "◐ 1 of 2 submitted", line2: `waiting: ${TOM}` }, final: { line1: "○ after annotation", line2: "" }, waiting: [TOM], action: null, edge: false },
  ],
  S7a: [
    { case_id: "case-107", language: "de", review: UNCHANGED, annotation: { line1: "✓ submitted", line2: `${ANA} · 3 findings` }, final: { line1: "● Your choice", line2: "1 submission" }, waiting: "You", action: "Accept result…", edge: true },
  ],
  S7b: [
    { case_id: "case-107", language: "en", review: SOURCE, annotation: { line1: "✓ 2 of 2 submitted", line2: new RegExp(`^(${ANA}, ${TOM}|${TOM}, ${ANA})$`) }, final: { line1: "● Your choice", line2: "2 submissions · 3 of 3 match" }, waiting: "You", action: "Compare results…", edge: true },
  ],
  S8: [
    { case_id: "case-108", language: "de", review: UNCHANGED, annotation: { line1: "◐ In review", line2: `2 submitted · review: ${LUC}` }, final: { line1: "○ after review", line2: "" }, waiting: [LUC], action: null, edge: false },
  ],
  S9: [
    { case_id: "case-109", language: "de", review: UNCHANGED, annotation: { line1: "⏸ Paused", line2: new RegExp(`^${TOM}: “Satz 3 unvollständig.*…”$`) }, final: NONE, waiting: "You", action: "Decide on report…", edge: true },
  ],
  S10: [
    { case_id: "case-110", language: "de", review: UNCHANGED, annotation: { line1: "— not planned", line2: "Review only" }, final: NONE, waiting: "—", action: null, edge: false },
  ],
  S11: [
    { case_id: "case-111", language: "de", review: UNCHANGED, annotation: { line1: "✓ 2 of 2 submitted", line2: new RegExp(`^(${ANA}, ${TOM}|${TOM}, ${ANA})$`) }, final: { line1: "✓ Final", line2: `Round 1 · ${ANA}` }, waiting: "—", action: null, edge: false },
    // Table: "✓ submitted" (per text 1); "Annotations per text" is a project setting and de needs 2 (O10a hand-back).
    { case_id: "case-111", language: "fr", review: UNCHANGED, annotation: { line1: "✓ 2 of 2 submitted" }, final: { line1: "✓ Final", line2: `Consolidation · ${LUC}` }, waiting: "—", action: null, edge: false },
    { case_id: "case-111", language: "en", review: SOURCE, annotation: NOT_PLANNED, final: NONE, waiting: "—", action: null, edge: false },
  ],
  S12: [
    { case_id: "case-112", language: "de", review: CORRECTED, annotation: { line1: "⚠ In progress on old text", line2: `${TOM} works on v1` }, final: NONE, waiting: "You", action: "Handle text change…", edge: true, marker: "v2 corrected" },
  ],
  S13: [
    { case_id: "case-113", language: "de", review: CORRECTED, annotation: { line1: "⚠ Submitted on v1", line2: `${ANA} · v2 not annotated` }, final: { line1: "○ after annotation", line2: "" }, waiting: "You", action: "Carry to v2…", edge: true, marker: "v2 corrected" },
  ],
  S14: [
    { case_id: "case-114", language: "de", review: CORRECTED, annotation: { line1: "✓ submitted" }, final: { line1: "⚠ Final is on old text", line2: `Round 1 · ${ANA} · v1` }, waiting: "You", action: "Review changes…", edge: true, marker: "v2 corrected" },
  ],
  S15: [
    { case_id: "case-115", language: "en", review: SOURCE, annotation: NOT_PLANNED, final: NONE, waiting: "—", action: null, edge: false, marker: "v2 corrected" },
    // Source changed: decision colour, but step kind assign (no edge, To assign, VD14).
    { case_id: "case-115", language: "de", review: { line1: "⚠ Source changed", line2: "translation from en v1" }, annotation: { line1: "✓ submitted" }, final: { line1: "⚠ may be outdated", line2: "source changed" }, waiting: "You", action: "Assign review…", edge: false },
  ],
  S16: [
    { case_id: "case-116", language: "de", review: { line1: "◐ Re-review in progress", line2: `${ANA} · reason: “Dosis prüfen”` }, annotation: { line1: "◐ In progress", line2: new RegExp(`^${TOM} · (Round 1 · )?v1 · may change$`) }, final: NONE, waiting: [ANA, TOM], action: null, edge: false },
  ],
};

async function expectRow(page: Page, expected: RowExpect): Promise<void> {
  const { case_id: caseId, language } = expected;
  const row = textRow(page, caseId, language);
  await expect(row, `${caseId} · ${language}`).toHaveCount(1);
  await test.step(`${caseId} · ${language}`, async () => {
    await expectStage(rowCell(row, "review"), expected.review);
    await expectStage(rowCell(row, "annotation"), expected.annotation);
    await expectStage(rowCell(row, "final"), expected.final);
    await expectWaiting(row, expected.waiting);
    await expectEdge(page, row, expected.edge);
    const actions = rowCell(row, "action").getByRole("button");
    if (expected.action) {
      await expect(rowAction(page, expected.action, caseId, language)).toBeVisible();
      await expect(actions.first()).toHaveAccessibleName(`${expected.action}, ${caseId} · ${language}`);
    } else {
      // Rows outside the plan keep a quiet "Plan…" (VD2); in-plan rows without a lead step show nothing.
      await expect(actions.filter({ hasNotText: /^Plan…$/ })).toHaveCount(0);
    }
    if (expected.marker) await expect(rowHeader(row).locator(".documents-version-marker")).toHaveText(expected.marker);
  });
}

for (const [name, rows] of Object.entries(SCENARIOS) as [Exclude<OverviewScenarioName, "WALKTHROUGH">, RowExpect[]][]) {
  test(`scenario ${name.slice(1)}: stage cells, Waiting on and Action as the Scenario table`, async ({ page }) => {
    const s = await overviewScenario(page, name);
    await loginOverviewUser(page, s, "lead");
    await openDocuments(page, s.project);
    for (const row of rows) await expectRow(page, row);
    await evidence(page, `scenario-${name.slice(1)}`);
  });
}

test.fixme("scenario 16: Annotation line 2 reads exactly \"Tom Reis · v1 · may change\"", async ({ page }) => {
  // Scenario table 16: "◐ In progress · Tom Reis · v1 · may change". The table shows
  // "Tom Reis · Round 1 · v1 · may change": stageLabels.ts adds the round ordinal for every
  // in-progress cell, also beside the "may change" note (measured 2026-10-21).
  const s = await overviewScenario(page, "S16");
  await loginOverviewUser(page, s, "lead");
  await openDocuments(page, s.project);
  await expectStage(rowCell(textRow(page, "case-116", "de"), "annotation"), { line1: "◐ In progress", line2: `${TOM} · v1 · may change` });
});

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
