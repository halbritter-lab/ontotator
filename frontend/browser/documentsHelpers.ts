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

/** The ▸ disclosure of a text row: "Show history, {case} · {language}". */
export const historyToggle = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("button", { name: `Show history, ${caseId} · ${language}`, exact: true });

/** The table row of one text (case · language), not its expansion row. */
export const textRow = (page: Page, caseId: string, language: string): Locator =>
  documentsTable(page).getByRole("row").filter({ has: historyToggle(page, caseId, language) });

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

/** The expansion region "History, {case} · {language}". */
export const historyRegion = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("region", { name: `History, ${caseId} · ${language}`, exact: true });

/** Expand a row (if collapsed) and wait until its history has loaded. */
export async function expandHistory(page: Page, caseId: string, language: string): Promise<Locator> {
  const button = historyToggle(page, caseId, language);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const area = historyRegion(page, caseId, language);
  await expect(area.getByRole("heading", { name: "History", level: 3 })).toBeVisible();
  await expect(area.getByText("Loading history…")).toHaveCount(0);
  return area;
}

/** Open "Text versions (n)" of an expanded row; returns its version items. */
export async function textVersionItems(area: Locator, count: number): Promise<Locator> {
  const name = new RegExp(`^Text versions \\(${count}\\)$`);
  const details = area.locator("details", { has: area.page().locator("summary", { hasText: name }) });
  if ((await details.getAttribute("open")) === null) await area.locator("summary", { hasText: name }).click();
  return details.locator("li.text-version");
}

/** The final-result side panel "Final result · {case} · {language}". */
export const finalPanel = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("dialog", { name: `Final result · ${caseId} · ${language}`, exact: true });

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
