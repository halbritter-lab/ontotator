/**
 * Documents lead table: keyboard, screen reader semantics, deep links, layout,
 * forced colours and reduced motion on the documents overview (spec "Accessibility",
 * "Table", "Tabs", "Final-result panel", "Narrow viewports", "Route query"): tabs with counts,
 * search and filter popover, slim group rows with the case checkbox, one row per text with its
 * checkbox, its text name "Details, …" and stage cells that open the row panel (acceptance fixes
 * WP-A: a non-modal aside, nothing inert), the panel's decision block, cards below 700 px.
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and logs
 * in as its lead. Narrow cards and forced colours get their polish in O9; the checks
 * here keep the invariants (reflow, target size, visible focus) without layout details.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  decisionBlock, detailsButton, documentsReady, documentsScenario, documentsTab, documentsTable, filterChip,
  openFilters, openRowPanel, rowAction, rowPanel, textRow, type DocumentsScenario,
} from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

const S0_CASE = "synthetic-accepted";
/** Text of the S0 group row label. */
const S0_GROUP = `${S0_CASE} · en source + 1 translation`;

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/documents-overview/evidence/o10b");
async function evidence(page: Page, name: string, part?: Locator) {
  mkdirSync(evidenceDir(), { recursive: true });
  const path = resolve(evidenceDir(), `${name}.png`);
  if (part) await part.screenshot({ path }); else await page.screenshot({ path, fullPage: true });
}

const documentsUrl = (s: DocumentsScenario, query = "") => `/#/projects/${encodeURIComponent(s.project)}/documents${query}`;

/** Build scenario ``name``, log in as its lead and open Documents (with an optional query). */
async function openScenario(page: Page, name: string, query = "") {
  const s = await documentsScenario(page, name);
  await loginExisting(page, s.users.lead);
  await openDocuments(page, s, query);
  return { s };
}

async function openDocuments(page: Page, s: DocumentsScenario, query = "") {
  await page.goto(documentsUrl(s, query));
  await documentsReady(page);
}

/** The Documents query of the current URL as sorted ``name=value`` pairs (order-independent). */
function documentsQueryOf(url: string): string[] {
  const hash = new URL(url).hash;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return [...new URLSearchParams(query).entries()].map(([name, value]) => `${name}=${value}`).sort();
}

/** The page's polite live region (outside the table). */
const live = (page: Page) => page.locator('.documents-page > p[role="status"]');
const rowHeaderId = (caseId: string, language: string) => `#documents-row-${encodeURIComponent(caseId)}-${encodeURIComponent(language)}-header`;

/** A short description of the focused element: its accessible name, else its label or text. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return "body";
    const label = element.getAttribute("aria-label")
      ?? ((element as HTMLInputElement).labels?.[0]?.textContent ?? "").trim()
      ?? "";
    return `${element.tagName.toLowerCase()}:${label || (element.textContent ?? "").trim().slice(0, 80)}`;
  });
}

/** A Tab stop: an exact "tag:name" or a pattern (stage cell names carry their status word). */
type Stop = string | RegExp;
const stopIndex = (stops: readonly string[], stop: Stop) => stops.findIndex(entry => (typeof stop === "string" ? entry === stop : stop.test(entry)));

/** Tab ``count`` times from the "Documents" heading and record every focus stop. */
async function tabStops(page: Page, count: number): Promise<string[]> {
  await page.getByRole("heading", { name: "Documents", level: 1 }).focus();
  const stops: string[] = [];
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Tab");
    stops.push(await focused(page));
  }
  return stops;
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include("main").analyze();
  return results.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
}

// --- Keyboard, screen reader semantics, live announcements, deep links ---------------------- //

test("Tab-only order: tabs, search, Filter, selection tools, then the case and each row's controls", async ({ page }) => {
  await openScenario(page, "S0");
  await expect(detailsButton(page, S0_CASE, "de")).toBeVisible();

  const stops = await tabStops(page, 40);
  const stage = (title: string, language: string) => new RegExp(`^button:${title}: .+\\. Show history, ${S0_CASE} · ${language}$`);
  const expected: Stop[] = [
    "button:Upload texts…",
    // Only the selected tab is a Tab stop (arrows move between tabs).
    "a:All, 2",
    "input:Case ID or text",
    "button:Filter",
    "input:Select the filtered case",
    "button:Select by case IDs…",
    `input:Select ${S0_CASE} (2 texts)`,
    `input:Select ${S0_CASE} · en`,
    `button:Details, ${S0_CASE} · en`,
    `a:Open in editor, ${S0_CASE} · en`,
    stage("Review", "en"),
    stage("Annotation", "en"),
    `button:Assign annotation…, ${S0_CASE} · en`,
    `input:Select ${S0_CASE} · de`,
    `button:Details, ${S0_CASE} · de`,
    `a:Open in editor, ${S0_CASE} · de`,
    stage("Review", "de"),
    stage("Annotation", "de"),
    stage("Final", "de"),
    `button:Review changes…, ${S0_CASE} · de`,
    `button:+1 more action, ${S0_CASE} · de`,
  ];
  const positions = expected.map(stop => stopIndex(stops, stop));
  expect(positions.filter(position => position < 0).length, `Tab stops: ${stops.join(" | ")}`).toBe(0);
  // Every control is a stop of its own, in document order; nothing is skipped (no roving tabindex in the table).
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  const tableStart = expected.indexOf(`input:Select ${S0_CASE} (2 texts)`);
  const fromCase = positions[tableStart];
  const tableStops = stops.slice(fromCase, fromCase + 32).filter(entry => !/^button:Final: .+ · en$/.test(entry));
  expect(expected.slice(tableStart).map(stop => stopIndex(tableStops, stop))).toEqual(expected.slice(tableStart).map((_, index) => index));
  // The other tabs are not Tab stops.
  expect(stops).not.toContain("a:Needs your decision, 1");

  // Plain arrow keys do not move focus inside the table (Tab and Shift+Tab only; no ↑/↓ row keys, U11).
  const enOpen = page.getByRole("link", { name: `Open in editor, ${S0_CASE} · en`, exact: true });
  await enOpen.focus();
  for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
    await page.keyboard.press(key);
    await expect(enOpen).toBeFocused();
  }
  await page.keyboard.press("Shift+Tab");
  await expect(detailsButton(page, S0_CASE, "en")).toBeFocused();

  // No element of the table takes itself out of the Tab order.
  const removed = await documentsTable(page).locator("a[href], button, input, select").evaluateAll(elements =>
    elements.filter(element => (element as HTMLElement).tabIndex < 0).map(element => element.outerHTML.slice(0, 80)));
  expect(removed).toEqual([]);

  // Enter on the text name opens the row panel with focus on its heading; Escape inside returns focus; Space opens it too.
  const enDetails = detailsButton(page, S0_CASE, "en");
  await enDetails.focus();
  await page.keyboard.press("Enter");
  await expect(rowPanel(page, S0_CASE, "en").getByRole("heading", { level: 2 })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(rowPanel(page, S0_CASE, "en")).toHaveCount(0);
  await expect(enDetails).toBeFocused();
  await page.keyboard.press("Space");
  await expect(rowPanel(page, S0_CASE, "en")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(enDetails).toBeFocused();

  // Arrows move between the tabs; Enter selects.
  const all = documentsTab(page, "All", 2);
  await all.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(documentsTab(page, "Done", 0)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(documentsTab(page, "Needs your decision", 1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(documentsTab(page, "Needs your decision", 1)).toHaveAttribute("aria-selected", "true");
});

test("Screen reader semantics: tabs and tabpanel, group and row headers, Open names, panel table", async ({ page }) => {
  const { s } = await openScenario(page, "S0");

  // Tabs: All is selected without a segment (VD7); the table sits in the tabpanel labelled by it.
  await expect(documentsTab(page, "All", 2)).toHaveAttribute("aria-selected", "true");
  for (const [label, count] of [["Needs your decision", 1], ["To assign", 1], ["In progress", 0], ["Done", 0]] as const) {
    await expect(documentsTab(page, label, count)).toHaveAttribute("aria-selected", "false");
  }
  await expect(page.getByRole("tabpanel", { name: "All, 2" })).toContainText(S0_CASE);

  // Group row: a label in <th scope="rowgroup" colspan>, the case checkbox in the first column, one <tbody> per case.
  const groupHeader = await page.locator(".documents-group-label").first().evaluate(label => {
    const cell = label.closest("th");
    const row = cell?.closest("tr");
    return {
      scope: cell?.getAttribute("scope"), colspan: Number(cell?.getAttribute("colspan") ?? 1),
      rowgroup: cell?.closest("tbody") != null, text: label.textContent,
      checkbox: row?.querySelector('td input[type="checkbox"]')?.getAttribute("aria-label") ?? null,
      button: label.closest("button") != null,
    };
  });
  expect(groupHeader).toEqual({ scope: "rowgroup", colspan: 7, rowgroup: true, text: S0_GROUP, checkbox: `Select ${S0_CASE} (2 texts)`, button: false });

  // Row headers: <th scope="row"> with the text name "Details, {text} · {language}" and "Open" ("Open in editor, …").
  for (const language of ["en", "de"]) {
    const header = page.getByRole("rowheader").filter({ has: page.locator(rowHeaderId(S0_CASE, language)) });
    await expect(header).toHaveCount(1);
    await expect(header.getByRole("link", { name: `Open in editor, ${S0_CASE} · ${language}`, exact: true })).toHaveText("Open");
    await expect(header.getByRole("button", { name: `Details, ${S0_CASE} · ${language}`, exact: true })).toHaveText(`${S0_CASE} · ${language}`);
  }
  // The stage columns replace the stage blocks: column headers name them.
  for (const name of ["Text", "Review", "Annotation", "Final", "Waiting on", "Last activity"]) {
    await expect(documentsTable(page).getByRole("columnheader", { name, exact: true })).toHaveCount(1);
  }
  // A decision row carries the hidden "Needs your decision" in its row header.
  await expect(textRow(page, S0_CASE, "de").getByRole("rowheader")).toContainText("Needs your decision");
  await expect(textRow(page, S0_CASE, "en").getByRole("rowheader")).not.toContainText("Needs your decision");

  // The row panel: a labelled non-modal aside (no dialog role, nothing inert) with its h2, tabs and the decision block.
  await openRowPanel(page, S0_CASE, "de");
  await rowPanel(page, S0_CASE, "de").getByRole("button", { name: "Close", exact: true }).click();
  await rowAction(page, "Review changes…", S0_CASE, "de").click();
  const panel = rowPanel(page, S0_CASE, "de");
  await expect(panel).not.toHaveAttribute("aria-modal", /.*/);
  await expect(page.locator("[inert]")).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: `${S0_CASE} · de v2`, level: 2 })).toBeFocused();
  await expect(panel.getByRole("tablist", { name: `Details of ${S0_CASE} · de` })).toBeVisible();
  await expect(decisionBlock(page, S0_CASE, "de").getByRole("heading", { name: "Final result", level: 3 })).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(rowAction(page, "Review changes…", S0_CASE, "de")).toBeFocused();

  // The decision tab and a category link (FD11, a chip) select the decision tab.
  await openDocuments(page, s, "?segment=decision");
  await expect(documentsTab(page, "Needs your decision", 1)).toHaveAttribute("aria-selected", "true");
  await expect(documentsTab(page, "All", 2)).toHaveAttribute("aria-selected", "false");
  await openDocuments(page, s, "?decision=confirm-final");
  await expect(filterChip(page, "Final result to confirm")).toBeVisible();
  await expect(documentsTab(page, "Needs your decision", 1)).toHaveAttribute("aria-selected", "true");
});

test("Live announcements: texts shown on filter and tab changes; panel Saving…, conflict and success", async ({ page }) => {
  await openScenario(page, "S0");

  // Facet change: "{k} texts shown".
  const filters = await openFilters(page);
  await filters.getByRole("checkbox", { name: /^de, 1 text$/ }).check();
  await expect(live(page)).toHaveText("1 text shown");
  await expect(detailsButton(page, S0_CASE, "en")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await documentsTab(page, "Needs your decision", 1).click();
  await expect(documentsTab(page, "Needs your decision", 1)).toHaveAttribute("aria-selected", "true");
  await documentsTab(page, "All", 2).click();
  await filterChip(page, "Language: de").click();
  await expect(detailsButton(page, S0_CASE, "en")).toBeVisible();

  // Conflict: the server refuses a stale revision; the outcome renders inside the decision block.
  await rowAction(page, "Review changes…", S0_CASE, "de").click();
  const panel = decisionBlock(page, S0_CASE, "de");
  const keep = panel.getByRole("button", { name: "Keep final on v1", exact: true });
  await expect(keep).toBeVisible();
  const selections = "**/api/v1/projects/*/final-selections";
  await page.route(selections, async route => {
    if (route.request().method() !== "PUT") return route.continue();
    const body = JSON.parse(route.request().postData() ?? "{}") as { expected_revision: number };
    await route.continue({ postData: JSON.stringify({ ...body, expected_revision: body.expected_revision + 100 }) });
  });
  await keep.click();
  await expect(panel.getByRole("alert")).toContainText("This final result changed.");
  await page.unroute(selections);
  await panel.getByRole("button", { name: "Review again", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);

  // Saving: the request is held; the other choice is unavailable (aria-disabled), never natively disabled.
  let release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  await page.route(selections, async route => {
    if (route.request().method() === "PUT") await held;
    await route.continue();
  });
  await keep.focus();
  await page.keyboard.press("Enter");
  const carry = panel.getByRole("button", { name: /^Carry to v2…$/ });
  if (await carry.count()) await expect(carry).toHaveAttribute("aria-disabled", "true");
  expect(await keep.evaluate(button => (button as HTMLButtonElement).disabled)).toBe(false);
  release();
  await expect(panel.locator(':scope > p[role="status"]')).toHaveText(/^Final result saved\./);
  await expect(panel.locator(".final-panel-success")).toContainText(`Final result saved for ${S0_CASE} · de.`);
  await page.unroute(selections);
});

test("Deep links: case, language, decision, final, legacy open; pinned row; unknown case", async ({ page }) => {
  const { s } = await openScenario(page, "S0");

  // case + language: its text name has focus; a deep link opens no panel.
  await openDocuments(page, s, `?case=${S0_CASE}&language=de`);
  await expect(page.locator(rowHeaderId(S0_CASE, "de"))).toBeFocused();
  await expect(page.getByRole("complementary")).toHaveCount(0);

  // case alone: the group label has focus.
  await page.goto("about:blank");
  await openDocuments(page, s, `?case=${S0_CASE}`);
  await expect(page.locator(`#documents-group-${encodeURIComponent(S0_CASE)}-toggle`)).toBeFocused();

  // A named row that no longer matches the decision stays visible with a notice.
  await page.goto("about:blank");
  await openDocuments(page, s, `?decision=confirm-final&case=${S0_CASE}&language=en`);
  await expect(detailsButton(page, S0_CASE, "en")).toBeVisible();
  await expect(page.getByText("This no longer needs your decision.", { exact: true })).toBeVisible();

  // decision alone: only matching rows.
  await page.goto("about:blank");
  await openDocuments(page, s, "?decision=confirm-final");
  await expect(detailsButton(page, S0_CASE, "de")).toBeVisible();
  await expect(detailsButton(page, S0_CASE, "en")).toHaveCount(0);
  await expect(page.getByText("This no longer needs your decision.")).toHaveCount(0);

  // final=none (an FD11 link parameter): a chip; only the row without a final result.
  await page.goto("about:blank");
  await openDocuments(page, s, "?final=none");
  await expect(filterChip(page, "Final result: None")).toBeVisible();
  await expect(detailsButton(page, S0_CASE, "en")).toBeVisible();
  await expect(detailsButton(page, S0_CASE, "de")).toHaveCount(0);

  // language: the facet, shown as a chip and checked in the popover.
  await page.goto("about:blank");
  await openDocuments(page, s, "?language=de");
  await expect(filterChip(page, "Language: de")).toBeVisible();
  await expect(detailsButton(page, S0_CASE, "de")).toBeVisible();
  await expect(detailsButton(page, S0_CASE, "en")).toHaveCount(0);
  await expect((await openFilters(page)).getByRole("checkbox", { name: /^de, / })).toBeChecked();
  await page.keyboard.press("Escape");

  // Legacy open= (repeated): the first row opens in the row panel; Close uses replace navigation and drops it.
  await page.goto("about:blank");
  await openDocuments(page, s, `?open=${encodeURIComponent(`${S0_CASE}:en`)}&open=${encodeURIComponent(`${S0_CASE}:de`)}`);
  await expect(rowPanel(page, S0_CASE, "en")).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(1);
  await rowPanel(page, S0_CASE, "en").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  expect(documentsQueryOf(page.url())).toEqual([]);

  // Unknown case: EmptyState with "Show all texts".
  await page.goto("about:blank");
  await openDocuments(page, s, "?case=no-such-text");
  await expect(page.getByText("Text no-such-text not found", { exact: true })).toBeVisible();
  await expect(documentsTable(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Show all texts", exact: true }).click();
  await expect(detailsButton(page, S0_CASE, "en")).toBeVisible();
  expect(documentsQueryOf(page.url())).toEqual([]);
});

test("Deep link page: S15 page 2 of 2", async ({ page }) => {
  await openScenario(page, "S15", "?page=2");
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages).toContainText("Page 2 of 2");
  const groups = documentsTable(page).locator(".documents-group-label");
  await expect(groups).toHaveCount(5);
  await expect(groups.first()).toHaveText(/^case-0051 · /);
  // "Next" at the end stays focusable as an aria-disabled link.
  await expect(pages.getByRole("link", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true");
});

test("Back from the report page and from the case viewer restores the Documents query", async ({ page }) => {
  const caseId = "case-0390";
  const { s } = await openScenario(page, "S6", `?decision=report-or-pause&panel=${encodeURIComponent(`${caseId}:de`)}&panel_stage=annotation`);
  const area = await openRowPanel(page, caseId, "de");
  const query = documentsQueryOf(page.url());
  expect(query).toEqual(["decision=report-or-pause", `panel=${caseId}:de`, "panel_stage=annotation"]);

  // Report page and back.
  await area.getByRole("link", { name: "Open report", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Problem report", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Back to Documents" }).first().click();
  await documentsReady(page);
  expect(documentsQueryOf(page.url())).toEqual(query);
  await expect(rowPanel(page, caseId, "de").getByRole("button", { name: "Remove filter Annotation", exact: true })).toBeVisible();
  await expect(documentsTab(page, "Needs your decision")).toHaveAttribute("aria-selected", "true");

  // Case viewer and back.
  await page.getByRole("link", { name: `Open in editor, ${caseId} · de`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Text: ${caseId}`, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Back to Documents", exact: true }).click();
  await documentsReady(page);
  expect(documentsQueryOf(page.url())).toEqual(query);
  await expect(rowPanel(page, caseId, "de").getByRole("button", { name: "Remove filter Annotation", exact: true })).toBeVisible();

  // Browser history back from the case viewer restores it too.
  await page.getByRole("link", { name: `Open in editor, ${caseId} · de`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Text: ${caseId}`, level: 1 })).toBeVisible();
  await page.goBack();
  await documentsReady(page);
  expect(documentsQueryOf(page.url())).toEqual(query);
  expect(s.project).toBeTruthy();
});

test("axe: default view, decision tab, filter popover, expanded row, open panel, 390 px cards", async ({ page }) => {
  const { s } = await openScenario(page, "S0");
  await expect(detailsButton(page, S0_CASE, "de")).toBeVisible();
  expect(await axeViolations(page), "default view").toEqual([]);

  await openDocuments(page, s, "?segment=decision");
  await expect(documentsTab(page, "Needs your decision", 1)).toHaveAttribute("aria-selected", "true");
  await expect(detailsButton(page, S0_CASE, "de")).toBeVisible();
  expect(await axeViolations(page), "decision tab").toEqual([]);

  await openDocuments(page, s);
  await openFilters(page);
  expect(await axeViolations(page), "filter popover").toEqual([]);
  await page.keyboard.press("Escape");

  await openRowPanel(page, S0_CASE, "de");
  expect(await axeViolations(page), "page with the row panel open").toEqual([]);
  // The panel lies over the right part of the table: close it before the row action.
  await rowPanel(page, S0_CASE, "de").getByRole("button", { name: "Close", exact: true }).click();
  await rowAction(page, "Review changes…", S0_CASE, "de").click();
  await expect(decisionBlock(page, S0_CASE, "de").getByRole("button", { name: "Keep final on v1", exact: true })).toBeVisible();
  const panel = await new AxeBuilder({ page }).include(".row-panel").analyze();
  expect(panel.violations.flatMap(v => v.nodes.map(n => `${v.id} ${n.target.join(" ")}`)), "row panel").toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("about:blank");
  await openDocuments(page, s);
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(await axeViolations(page), "390 px cards").toEqual([]);
});

// --- Layout, forced colours, reduced motion (narrow cards and forced colours get their polish in O9) --- //

test("320 CSS px: no horizontal scroll; case title, card heading, stages, row action and Open stay in view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { s } = await openScenario(page, "S0");
  await expect(page.getByRole("article")).toHaveCount(2);

  const inView = async (fact: Locator, state: string) => {
    await expect(fact).toBeVisible();
    const box = (await fact.boundingBox())!;
    expect(box.x, state).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, state).toBeLessThanOrEqual(320);
  };
  const checkReflow = async (state: string) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth), state).toBeLessThanOrEqual(320);
    await inView(page.getByRole("checkbox", { name: `Select ${S0_CASE} (2 texts)`, exact: true }), `${state} case checkbox`);
    await inView(page.getByRole("heading", { name: S0_GROUP, level: 3 }), `${state} case title`);
    for (const language of ["en", "de"]) {
      const card = page.getByRole("article", { name: `${S0_CASE} · ${language}`, exact: true });
      const facts = [
        card.getByRole("heading", { name: `${S0_CASE} · ${language}`, level: 4 }),
        card.locator(".document-card-stage").first(),
        card.locator(".documents-action").first(),
        card.getByRole("link", { name: `Open in editor, ${S0_CASE} · ${language}`, exact: true }),
        card.getByRole("button", { name: `Details, ${S0_CASE} · ${language}`, exact: true }),
      ];
      for (const fact of facts) await inView(fact, `${state} ${language}`);
    }
  };
  await checkReflow("collapsed");
  await evidence(page, "320-collapsed");

  // The row panel is a full-screen sheet below 700 px: no horizontal scroll, its controls in view; Back returns.
  await page.getByRole("article", { name: `${S0_CASE} · de`, exact: true }).getByRole("button", { name: `Details, ${S0_CASE} · de`, exact: true }).click();
  const sheet = rowPanel(page, S0_CASE, "de");
  await expect(sheet.getByRole("tablist")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const control of [sheet.getByRole("button", { name: "Back", exact: true }), sheet.getByRole("tab", { name: "Activity", exact: true })]) await inView(control, "sheet");
  await evidence(page, "320-sheet");
  await sheet.getByRole("button", { name: "Back", exact: true }).click();
  await checkReflow("after the sheet");
  expect(s.project).toBeTruthy();
});

test("390 px cards: every interactive target is at least 24 by 24 px, or meets a listed WCAG 2.5.8 exception", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScenario(page, "S0");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article", { name: `${S0_CASE} · de`, exact: true }).getByRole("button", { name: `Details, ${S0_CASE} · de`, exact: true })).toBeVisible();

  const report = await page.evaluate(() => {
    const MIN = 24;
    const selector = 'a[href], a[role="link"], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
    const describe = (element: Element) => {
      const name = element.getAttribute("aria-label") ?? ((element as HTMLInputElement).labels?.[0]?.textContent ?? "") ?? "";
      return `${element.tagName.toLowerCase()} "${(name || element.textContent || "").trim().slice(0, 60)}"`;
    };
    // checkVisibility() also excludes the content of closed <details> (content-visibility: hidden).
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
    };
    const cards = Array.from(document.querySelectorAll("li.document-case-card"));
    const targets = cards.flatMap(card => Array.from(card.querySelectorAll(selector))).filter(visible);
    const everyTarget = Array.from(document.querySelectorAll(selector)).filter(visible);
    /** A link inside a sentence of running text: inline display, and its block has other text. */
    const inlineInSentence = (element: Element) => {
      if (element.tagName !== "A" || getComputedStyle(element).display !== "inline") return false;
      let block = element.parentElement;
      while (block && getComputedStyle(block).display.startsWith("inline")) block = block.parentElement;
      const own = (element.textContent ?? "").trim();
      const all = (block?.textContent ?? "").trim();
      return all.length > own.length;
    };
    const centre = (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    const distance = (point: { x: number; y: number }, box: DOMRect) => {
      const dx = Math.max(box.left - point.x, 0, point.x - box.right);
      const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
      return Math.hypot(dx, dy);
    };
    const small = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.width < MIN || box.height < MIN;
    };
    const undersized = everyTarget.filter(small);
    /** The first target that breaks the WCAG 2.5.8 spacing exception, or null when the target is spaced. */
    const crowdedBy = (element: Element): string | null => {
      const point = centre(element.getBoundingClientRect());
      for (const other of everyTarget) {
        if (other === element || other.contains(element) || element.contains(other)) continue;
        if (distance(point, other.getBoundingClientRect()) < MIN / 2) return describe(other);
      }
      for (const other of undersized) {
        if (other === element || other.contains(element) || element.contains(other)) continue;
        const otherPoint = centre(other.getBoundingClientRect());
        if (Math.hypot(point.x - otherPoint.x, point.y - otherPoint.y) < MIN) return `circle of ${describe(other)}`;
      }
      return null;
    };
    const failures: string[] = [];
    const exceptions: string[] = [];
    for (const element of targets) {
      if (!small(element)) continue;
      const box = element.getBoundingClientRect();
      const size = `${Math.round(box.width)}x${Math.round(box.height)}`;
      const crowded = crowdedBy(element);
      if (crowded === null) exceptions.push(`spacing: ${describe(element)} ${size}`);
      else if (inlineInSentence(element)) exceptions.push(`inline: ${describe(element)} ${size}`);
      else failures.push(`${describe(element)} ${size}, too close to ${crowded}`);
    }
    return { count: targets.length, failures, exceptions };
  });
  test.info().annotations.push({ type: "WCAG 2.5.8 exceptions", description: report.exceptions.join("; ") || "none" });
  await evidence(page, "390-targets");
  expect(report.count).toBeGreaterThan(8);
  expect(report.failures).toEqual([]);
  // Every exemption is one of the two listed kinds (the exact list follows the O9 card layout).
  for (const exception of report.exceptions) expect(exception).toMatch(/^(spacing|inline): /);
});

test("Forced colours: decision edge, focus outline, selected tab", async ({ page }) => {
  await openScenario(page, "S0");
  await page.emulateMedia({ forcedColors: "active" });
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);

  // The decision row keeps its edge class (its forced-colours rendering is O9's).
  await expect(textRow(page, S0_CASE, "de")).toHaveClass(/data-table-row--decision/);

  // Keyboard focus is outlined on every stop from the heading into the table.
  await page.getByRole("heading", { name: "Documents", level: 1 }).focus();
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return { element: `${element.tagName.toLowerCase()} ${element.getAttribute("aria-label") ?? (element.textContent ?? "").trim().slice(0, 40)}`, style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style, outline.element).not.toBe("none");
    expect(outline.width, outline.element).toBeGreaterThan(0);
  }

  // The selected tab differs from the others without colour alone.
  const tabs = await page.getByRole("tab").evaluateAll(links => links.map(link => ({
    selected: link.getAttribute("aria-selected"), colour: getComputedStyle(link).borderBottomColor, width: parseFloat(getComputedStyle(link).borderBottomWidth),
  })));
  await evidence(page, "forced-colours");
  const active = tabs.find(item => item.selected === "true")!;
  const inactive = tabs.filter(item => item.selected !== "true");
  expect(inactive.every(item => item.width !== active.width || item.colour !== active.colour), JSON.stringify(tabs)).toBe(true);
});

test("Reduced motion: the row panel fades in only without reduced motion and never animates its width", async ({ page }) => {
  await openScenario(page, "S0");
  await detailsButton(page, S0_CASE, "de").click();
  const panel = page.locator(".row-panel");
  await expect(panel).toHaveCSS("animation-name", "row-panel-in");
  await expect(panel).toHaveCSS("animation-duration", "0.15s");
  expect(await panel.evaluate(element => getComputedStyle(element).transitionProperty)).not.toContain("width");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await detailsButton(page, S0_CASE, "de").click();
  await expect(panel).toHaveCSS("animation-name", "none");
});
