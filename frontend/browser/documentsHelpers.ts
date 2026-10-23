import { expect, type Locator, type Page } from "@playwright/test";
import { cardPath, textCard } from "./proposalCheckHelpers";

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
 * Build a fresh project for Documents scenario ``name`` ("S0" to "S16") through
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

/** The tablist "Documents views"; visible once the page has loaded. */
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

/** A name "{prefix}{case}{sep}{language}{suffix}" whatever the separator (" · " before U9, " " after). */
export const textNamePattern = (prefix: string, caseId: string, language: string, suffix = ""): RegExp =>
  new RegExp(`^${esc(prefix)}${esc(caseId)}(?: · | )${esc(language)}${esc(suffix)}$`);

/** The text name of a row: opens the card, selection unchanged ("Open text card, {case} {language}"). */
export const textName = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("button", { name: `Open text card, ${caseId} ${language}`, exact: true });

/** The table row of one text, found by its text name. */
export const textRow = (page: Page, caseId: string, language: string): Locator =>
  documentsTable(page).getByRole("row").filter({ has: textName(page, caseId, language) });

/** The same row (T2's name). */
export const cardRow = textRow;

/** Cell positions of a text row (the row header "Text" is not a cell; cell 0 is the row checkbox). */
export const STAGE_COLUMNS = { select: 0, translation: 1, annotation: 2, finalization: 3, waiting: 4, next: 5, activity: 6 } as const;
export const rowCell = (row: Locator, column: keyof typeof STAGE_COLUMNS): Locator => row.getByRole("cell").nth(STAGE_COLUMNS[column]);

/** A row's next-step button "{label}, {case} {language}" (Next step column or narrow card). */
export const rowAction = (page: Page, label: string, caseId: string, language: string): Locator =>
  page.getByRole("button", { name: textNamePattern(`${label}, `, caseId, language) });

/** The row's "More" menu button ("More actions, {case} {language}"). */
export const moreMenu = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("button", { name: `More actions, ${caseId} ${language}`, exact: true });

/** The row checkbox "Select {case} {language}". */
export const rowBox = (page: Page, caseId: string, language: string): Locator =>
  page.getByRole("checkbox", { name: textNamePattern("Select ", caseId, language) });

/** The not-planned source folded into its case line: the button "source en (native), 1 translation" opens its card. */
export const foldedSource = (page: Page, caseId: string): Locator =>
  documentsTable(page).locator(".documents-group-label").filter({ has: page.locator(`.documents-id[title="${caseId}"]`) })
    .getByRole("button", { name: /^source \S+ \(native\), \d+ translations?$/ });

/** The case (group) checkbox "Select {case} ({n} texts)". */
export const caseBox = (page: Page, caseId: string, texts: number): Locator =>
  page.getByRole("checkbox", { name: `Select ${caseId} (${texts === 1 ? "1 text" : `${texts} texts`})`, exact: true });

/** The decision block of a text card (its Finalization part): the region "Final result". */
export const decisionBlock = (card: Locator): Locator => card.getByRole("region", { name: "Final result", exact: true });

/** Open a text's card on its Finalization part and return the decision block. */
export async function openDecisionBlock(page: Page, caseId: string, language: string): Promise<Locator> {
  const card = await openTextCard(page, caseId, language);
  await showSegment(card, "Finalization");
  return decisionBlock(card);
}

/** Open the card of a text on History and wait until its lines have loaded; returns the card. */
export async function openCardHistory(page: Page, caseId: string, language: string): Promise<Locator> {
  const card = await openTextCard(page, caseId, language);
  const history = card.getByRole("button", { name: /^History \(\d+\)$/ });
  await expect(history).toBeVisible();
  await history.click();
  await expect(card.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  return card;
}

/** History lines of an open card (newest first; each starts with its stage, e.g. "Annotation: …"). */
export const activityLines = (card: Locator): Locator => card.getByRole("list", { name: "Activity", exact: true }).getByRole("listitem");

/** Show the card's Translation part; returns its version items (``count`` is checked). */
export async function textVersionItems(card: Locator, count: number): Promise<Locator> {
  await showSegment(card, "Translation");
  const items = card.locator("ul.text-versions > li.text-version");
  await expect(items).toHaveCount(count);
  return items;
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

// --- Text card (U3) ------------------------------------------------------------------------------ //

export { cardPath, textCard } from "./proposalCheckHelpers";

/** The robot icon of a row while nobody is assigned: "{n} tool proposals available; the annotation starts from them". */
export const robotIcon = (row: Locator, count?: number): Locator =>
  row.getByRole("img", { name: count === undefined ? /^\d+ tool proposals available; the annotation starts from them$/ : `${count} tool proposals available; the annotation starts from them`, exact: count !== undefined });

/** A path segment of the card by its title ("Translation", "Annotation", "Finalization"); `aria-current="step"` when shown. */
export const cardSegment = (card: Locator, title: "Translation" | "Annotation" | "Finalization"): Locator =>
  cardPath(card).getByRole("button", { name: new RegExp(`^${title} `) });

/** Open the card of a text from its text name (selection unchanged) and wait for it. */
export async function openTextCard(page: Page, caseId: string, language: string): Promise<Locator> {
  const card = textCard(page, caseId, language);
  // A card may be on its way (VD17 moves it to the next decision): give it a moment before opening it by name.
  const open = await card.isVisible() || await card.waitFor({ timeout: 2_000 }).then(() => true, () => false);
  if (!open) await textName(page, caseId, language).click();
  await expect(card).toBeVisible();
  return card;
}

/** Show a segment of an open card and wait until it is the current one. */
export async function showSegment(card: Locator, title: "Translation" | "Annotation" | "Finalization"): Promise<void> {
  const segment = cardSegment(card, title);
  if ((await segment.getAttribute("aria-current")) !== "step") await segment.click();
  await expect(segment).toHaveAttribute("aria-current", "step");
}

/** ✕ on a person's chip in the card ("Remove {name}"). */
export const removeChipButton = (card: Locator, name: string): Locator => card.getByRole("button", { name: `Remove ${name}`, exact: true });
