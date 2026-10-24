import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Locators and checks of the documents overview specs (plan O10c): the one-line stage table,
 * its tabs, the navigation counter and the evidence screenshots. Each spec builds its own
 * scenario projects through overviewHelpers.ts.
 */

export const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Screenshots for human review only (never baselines): `build/documents-overview/evidence/`. */
export const evidenceDir = (): string => resolve(test.info().config.rootDir, "../../build/documents-overview/evidence");

export async function evidence(page: Page, name: string, part?: Locator): Promise<void> {
  mkdirSync(evidenceDir(), { recursive: true });
  const path = resolve(evidenceDir(), `${name}.png`);
  if (part) await part.screenshot({ path }); else await page.screenshot({ path, fullPage: true });
}

/** Open Documents of ``project`` (optionally with a route query such as "?segment=decision") and wait for the tabs. */
export async function openDocuments(page: Page, project: string, query = ""): Promise<void> {
  await page.goto(`/#/projects/${encodeURIComponent(project)}/documents${query}`);
  await documentsReady(page);
}

export const documentsTabs = (page: Page): Locator => page.getByRole("tablist", { name: "Documents views", exact: true });

export async function documentsReady(page: Page): Promise<void> {
  await expect(documentsTabs(page)).toBeVisible({ timeout: 30_000 });
}

/** One tab "{label}, {count}" (any count without ``count``). */
export function documentsTab(page: Page, label: string, count?: number): Locator {
  const name = count === undefined ? new RegExp(`^${esc(label)}, \\d+$`) : `${label}, ${count}`;
  return documentsTabs(page).getByRole("tab", { name, exact: count !== undefined });
}

/** The count of tab ``label``. */
export async function tabCount(page: Page, label: string): Promise<number> {
  const name = await documentsTab(page, label).getAttribute("aria-label");
  return Number(/, (\d+)$/.exec(name ?? "")?.[1] ?? Number.NaN);
}

export const documentsTable = (page: Page): Locator => page.getByRole("table", { name: "Documents", exact: true });

/** "{case} {language}": the row part of the text card's name and of the row's own names. */
export const rowName = (caseId: string, language: string): string => `${caseId} ${language}`;

/** A name "{prefix}{case}{sep}{language}" whatever the separator (" · " before U9, " " after). */
export const namePattern = (prefix: string, caseId: string, language: string): RegExp =>
  new RegExp(`^${esc(prefix)}${esc(caseId)}(?: · | )${esc(language)}$`);

/** The text name of a row: opens the text card ("Open text card, {case} {language}"). */
export const textName = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("button", { name: `Open text card, ${rowName(caseId, language)}`, exact: true });

/** The table row of one text, found by its text name. */
export const textRow = (page: Page, caseId: string, language: string): Locator =>
  documentsTable(page).locator("tr").filter({ has: textName(page, caseId, language) });

/** Columns after the row checkbox and the row header "Text". */
const COLUMN = { translation: 0, annotation: 1, finalization: 2, waiting: 3, next: 4, activity: 5 } as const;
export type Column = keyof typeof COLUMN;
export const rowCell = (row: Locator, column: Column): Locator => row.locator(":scope > td:not(.data-table-select-cell)").nth(COLUMN[column]);
export const rowHeader = (row: Locator): Locator => row.locator(':scope > th[scope="row"]');

/** A row's next-step button "{label}, {case} {language}" (Next step column or narrow card). */
export const rowAction = (page: Page, label: string, caseId: string, language: string): Locator =>
  page.getByRole("button", { name: namePattern(`${label}, `, caseId, language) });

/** The text card dialog "{case} {language}" (a full-width sheet below 700 px). */
export const textCard = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("dialog", { name: rowName(caseId, language), exact: true });

/** One stage cell: the card's short state and (in brackets, grey) who works on it; `who: ""` = none. */
export interface CellText {
  state: string | RegExp;
  who?: string | RegExp;
}

/** Assert a one-line stage cell through its `title` ("{state}" or "{state} ({who})"); without `who` any who passes. */
export async function expectStage(cell: Locator, expected: CellText): Promise<void> {
  const part = (value: string | RegExp) => (typeof value === "string" ? esc(value) : value.source);
  const who = expected.who === undefined ? String.raw`(?: \(.*\))?` : expected.who === "" ? "" : String.raw` \(${part(expected.who)}\)`;
  await expect(cell.locator(".stage-cell")).toHaveAttribute("title", new RegExp(`^${part(expected.state)}${who}$`));
}

/** Waiting on: "You", "—", or every listed person (display names, in any order). */
export async function expectWaiting(row: Locator, expected: "You" | "—" | readonly string[]): Promise<void> {
  const cell = rowCell(row, "waiting");
  if (typeof expected === "string") {
    await expect(cell).toHaveText(expected);
    return;
  }
  for (const person of expected) await expect(cell).toContainText(person);
}

/** Visible line "Needs your decision" edge of a row (class and hidden text). */
export async function expectEdge(page: Page, row: Locator, edge: boolean): Promise<void> {
  if (edge) {
    await expect(row).toHaveClass(/data-table-row--decision/);
    await expect(rowHeader(row).getByText("Needs your decision", { exact: true })).toHaveCount(1);
  } else {
    await expect(row).not.toHaveClass(/data-table-row--decision/);
    await expect(rowHeader(row).getByText("Needs your decision", { exact: true })).toHaveCount(0);
  }
  void page;
}

/** The NEW badge of a row ("New since your last visit"). */
export const newBadge = (row: Locator): Locator => row.getByText("New since your last visit", { exact: true });

/** The navigation link "Documents" of the project section: "Documents, n need your decision" when n > 0. */
export const navDocuments = (page: Page): Locator =>
  page.getByRole("region", { name: "Current project sections", exact: true }).getByRole("link", { name: /^Documents(, \d+ need your decision)?$/ });

/** The navigation counter equals the Needs your decision tab (spec "Navigation counter"). */
export async function expectCounterEqualsTab(page: Page): Promise<number> {
  const decisions = await tabCount(page, "Needs your decision");
  await expect(navDocuments(page)).toHaveAccessibleName(decisions > 0 ? `Documents, ${decisions} need your decision` : "Documents", { timeout: 15_000 });
  return decisions;
}

/** Axe violations inside ``include``, one line per node. */
export async function axeViolations(page: Page, include: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

/** The document's horizontal overflow in CSS px (0 = no horizontal scrolling). */
export const horizontalOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The slim case line of a case: its ID and, when texts are outside the plan, the "n not in plan" toggle. */
export const caseLine = (page: Page, caseId: string): Locator =>
  documentsTable(page).locator(".documents-group-line").filter({ has: page.locator(`.documents-id[title="${caseId}"]`) });

/** The case line's toggle "n not in plan": the texts outside the plan fold behind it. */
export const notInPlanToggle = (page: Page, caseId: string): Locator =>
  caseLine(page, caseId).getByRole("button", { name: /^\d+ not in plan$/ });
