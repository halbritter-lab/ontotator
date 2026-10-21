import { expect, type Locator, type Page } from "@playwright/test";

/** A Documents row of a scenario: one text and language. */
export interface ScenarioRow {
  case_id: string;
  language: string;
}

/** What ``POST /__test_documents__`` returns (tests/browser_documents_scenarios.py). */
export interface DocumentsScenario {
  project: string;
  /** Usernames by role name; every scenario has ``lead``. */
  users: Record<string, string> & { lead: string };
  rows: ScenarioRow[];
  case_id?: string;
  documents?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Build a fresh project for Documents scenario ``name`` ("S0" to "S15") through
 * the test-only route of the browser server and return its identities.
 */
export async function documentsScenario(page: Page, name: string): Promise<DocumentsScenario> {
  const response = await page.request.post("/__test_documents__", {
    params: { scenario: name },
    timeout: 120_000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as DocumentsScenario;
}

// --- Locators of the Documents overview (stage-column table, documents overview spec) ---------- //

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The tablist "Needs your decision · To assign · In progress · Done · All"; visible once the page has loaded. */
export const documentsTabs = (page: Page): Locator => page.getByRole("tablist", { name: "Documents views", exact: true });

/** Wait until Documents shows its tabs (the page has loaded its first rows page). */
export async function documentsReady(page: Page): Promise<void> {
  await expect(documentsTabs(page)).toBeVisible({ timeout: 30_000 });
}

/** One tab: with ``count`` the exact name "{label}, {count}", else any count. */
export function documentsTab(page: Page, label: string, count?: number): Locator {
  const name = count === undefined ? new RegExp(`^${esc(label)}, \\d+$`) : `${label}, ${count}`;
  return documentsTabs(page).getByRole("tab", { name, exact: count !== undefined });
}

export const documentsTable = (page: Page): Locator => page.getByRole("table", { name: "Documents", exact: true });

/** The text name of a row, the row panel's entry: "Details, {case} · {language}" (a card's "Details" below 700 px). */
export const detailsButton = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("button", { name: `Details, ${caseId} · ${language}`, exact: true });

/** The table row of one text (case · language). */
export const textRow = (page: Page, caseId: string, language: string): Locator =>
  documentsTable(page).getByRole("row").filter({ has: detailsButton(page, caseId, language) });

/** Cell positions of a text row (the row header "Text" is not a cell; cell 0 is the row checkbox). */
export const STAGE_COLUMNS = { select: 0, review: 1, annotation: 2, final: 3, waiting: 4, action: 5, activity: 6 } as const;
export const rowCell = (row: Locator, column: keyof typeof STAGE_COLUMNS): Locator => row.getByRole("cell").nth(STAGE_COLUMNS[column]);

/** A row action button "{label}, {case} · {language}" (Action column or narrow card). */
export const rowAction = (page: Page, label: string, caseId: string, language: string): Locator =>
  page.getByRole("button", { name: `${label}, ${caseId} · ${language}`, exact: true });

/** The row checkbox "Select {case} · {language}". */
export const rowBox = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("checkbox", { name: `Select ${caseId} · ${language}`, exact: true });

/** The case (group) checkbox "Select {case} ({n} texts)". */
export const caseBox = (page: Page, caseId: string, texts: number): Locator =>
  page.getByRole("checkbox", { name: `Select ${caseId} (${texts === 1 ? "1 text" : `${texts} texts`})`, exact: true });

/**
 * The row panel "Details, {case} · {language}": the non-modal aside from 700 px, the full-screen sheet
 * (a dialog) below. Its decision block is the region "Final result".
 */
export const rowPanel = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole(page.viewportSize() && page.viewportSize()!.width < 700 ? "dialog" : "complementary", { name: `Details, ${caseId} · ${language}`, exact: true });

/** The decision block of the row panel (the former final-result panel). */
export const decisionBlock = (page: Page, caseId: string, language: string): Locator =>
  rowPanel(page, caseId, language).getByRole("region", { name: "Final result", exact: true });

/** Open the row panel of a row from its text name (unfiltered) on Activity and wait until its activity has loaded. */
export async function openRowPanel(page: Page, caseId: string, language: string): Promise<Locator> {
  const panel = rowPanel(page, caseId, language);
  if (!(await panel.isVisible())) await detailsButton(page, caseId, language).click();
  await expect(panel).toBeVisible();
  const activity = panel.getByRole("tab", { name: "Activity", exact: true });
  if ((await activity.getAttribute("aria-selected")) !== "true") await activity.click();
  await expect(panel.getByText(`Loading ${caseId} · ${language}…`, { exact: true })).toHaveCount(0);
  return panel;
}

/** Activity lines of an open row panel (newest first; each starts with its stage, e.g. "Annotation: …"). */
export const activityLines = (panel: Locator): Locator => panel.getByRole("list", { name: "Activity", exact: true }).getByRole("listitem");

/** Switch the row panel to "Versions (n)"; returns its version items. */
export async function textVersionItems(panel: Locator, count: number): Promise<Locator> {
  await panel.getByRole("tab", { name: `Versions (${count})`, exact: true }).click();
  return panel.getByRole("tabpanel").locator("li.text-version");
}

/** The "Filter" button (its name gains ", n active" with active filters). */
export const filterButton = (page: Page): Locator =>
  page.getByRole("group", { name: "Document filters", exact: true }).getByRole("button", { name: /^Filter(, \d+ active)?$/ });

/** Open the filter popover (non-modal dialog "Filter"). */
export async function openFilters(page: Page): Promise<Locator> {
  const popover = page.getByRole("dialog", { name: "Filter", exact: true });
  if (!(await popover.isVisible())) await filterButton(page).click();
  await expect(popover).toBeVisible();
  return popover;
}

/** A removable filter chip "Remove filter {label}". */
export const filterChip = (page: Page, label: string): Locator =>
  page.getByRole("button", { name: `Remove filter ${label}`, exact: true });

/** The page's polite live region (outside the table). */
export const documentsLive = (page: Page): Locator => page.locator('.documents-page > p[role="status"]');
