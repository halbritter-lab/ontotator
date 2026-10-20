/**
 * Documents lead table: keyboard, screen reader semantics, deep links, layout,
 * forced colours and reduced motion (plan Tasks 7.4 and 7.5; spec "Testing",
 * "Structure and semantics", "Narrow viewports", "Route query", "Design system changes").
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and logs
 * in as its lead. Person labels are the users' pseudonyms, read from the project
 * members (the fixture keys users by role name, not by pseudonym).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { documentsScenario, type DocumentsScenario } from "./documentsHelpers";
import { authenticatedRequest, loginExisting } from "./helpers";

type Member = components["schemas"]["Member"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

/** "19 Oct, 15:01", optionally with seconds or a year. */
const TIME = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, \d{2}:\d{2}(?::\d{2})?`;
const S0_CASE = "synthetic-accepted";
const CONFLICT_TEXT = "The final result or its warnings changed since you opened this. Nothing was saved. Review the current state.";

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/phase0-ux/evidence/d-p6");
async function evidence(page: Page, name: string, part?: Locator) {
  mkdirSync(evidenceDir(), { recursive: true });
  const path = resolve(evidenceDir(), `${name}.png`);
  if (part) await part.screenshot({ path }); else await page.screenshot({ path, fullPage: true });
}

/** Pseudonym (person label) per fixture role name. */
async function labelsOf(page: Page, s: DocumentsScenario): Promise<Record<string, string>> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/members`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const members = (await response.json()) as Member[];
  const byUsername = new Map(members.map(member => [member.username, member.pseudonym]));
  return Object.fromEntries(Object.entries(s.users).map(([name, username]) => [name, byUsername.get(username) ?? username]));
}

const documentsUrl = (s: DocumentsScenario, query = "") => `/#/projects/${encodeURIComponent(s.project)}/documents${query}`;

/** Build scenario ``name``, log in as its lead and open Documents (with an optional query). */
async function openScenario(page: Page, name: string, query = "") {
  const s = await documentsScenario(page, name);
  await loginExisting(page, s.users.lead);
  const labels = await labelsOf(page, s);
  await openDocuments(page, s, query);
  return { s, labels };
}

async function openDocuments(page: Page, s: DocumentsScenario, query = "") {
  await page.goto(documentsUrl(s, query));
  await expect(page.getByRole("navigation", { name: "Segments", exact: true })).toBeVisible();
}

/** The Documents query of the current URL as sorted ``name=value`` pairs (order-independent). */
function documentsQueryOf(url: string): string[] {
  const hash = new URL(url).hash;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return [...new URLSearchParams(query).entries()].map(([name, value]) => `${name}=${value}`).sort();
}

const table = (page: Page) => page.getByRole("table", { name: "Documents", exact: true });
const disclosure = (page: Page, caseId: string, language: string) =>
  page.getByRole("button", { name: `Show submissions, ${caseId} · ${language}`, exact: true });
const region = (page: Page, caseId: string, language: string) => page.getByRole("region", { name: `${caseId} · ${language}`, exact: true });
/** The page's polite live region (outside the table). */
const live = (page: Page) => page.locator('.documents-page > p[role="status"]');
const segment = (page: Page, name: string | RegExp) =>
  page.getByRole("navigation", { name: "Decision filter" }).getByRole("link", { name, exact: typeof name === "string" });
const confirmGroup = (page: Page, title: string) => page.getByRole("group", { name: title, exact: true });

/** Expand a row (if collapsed) and wait until its submissions have loaded. */
async function expand(page: Page, caseId: string, language: string): Promise<Locator> {
  const button = disclosure(page, caseId, language);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const area = region(page, caseId, language);
  await expect(area.getByRole("heading", { name: /^Submissions \(\d+\)$/, level: 3 })).toBeVisible();
  await expect(area.getByText("Loading submissions…")).toHaveCount(0);
  return area;
}

const submissionsTable = (area: Locator, caseId: string, language: string) =>
  area.getByRole("table", { name: `Submissions, ${caseId} · ${language}`, exact: true });
/** The submission row whose View link is named ``View {label}`` (label as a regex source). */
const submissionRow = (submissions: Locator, label: string) =>
  submissions.getByRole("row").filter({ has: submissions.page().getByRole("link", { name: new RegExp(`^View ${label}$`) }) });

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

// --- Task 7.4: keyboard, screen reader semantics, live announcements, deep links ---------------- //

test("Tab-only order: filters, bar segments, group header, then Select, row disclosure and Open per row", async ({ page }) => {
  await openScenario(page, "S0");
  await expect(disclosure(page, S0_CASE, "de")).toBeVisible();

  const stops = await tabStops(page, 40);
  const expected = [
    "select:Language",
    "select:Status",
    "input:ID",
    "summary:More filters",
    "a:All",
    "a:Needs your decision (1)",
    "a:No final result (1)",
    `button:${S0_CASE}, 2 languages, final 1 of 2`,
    `input:Select ${S0_CASE} · en`,
    `button:Show submissions, ${S0_CASE} · en`,
    `a:Open ${S0_CASE} · en`,
    `button:Show submissions, ${S0_CASE} · de`,
    `a:Open ${S0_CASE} · de`,
  ];
  const positions = expected.map(stop => stops.indexOf(stop));
  expect(positions.filter(position => position < 0).length, `Tab stops: ${stops.join(" | ")}`).toBe(0);
  // Every control is a stop of its own, in document order; nothing is skipped (no roving tabindex).
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  const fromGroup = positions[7];
  expect(stops.slice(fromGroup, fromGroup + 6)).toEqual(expected.slice(7));

  // Arrow keys do not move focus inside the table (Tab and Shift+Tab only).
  const enDisclosure = disclosure(page, S0_CASE, "en");
  await enDisclosure.focus();
  for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
    await page.keyboard.press(key);
    await expect(enDisclosure).toBeFocused();
  }
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("checkbox", { name: `Select ${S0_CASE} · en`, exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: `${S0_CASE}, 2 languages, final 1 of 2`, exact: true })).toBeFocused();

  // No element of the table takes itself out of the Tab order.
  const removed = await table(page).locator("a[href], button, input, select").evaluateAll(elements =>
    elements.filter(element => (element as HTMLElement).tabIndex < 0).map(element => element.outerHTML.slice(0, 80)));
  expect(removed).toEqual([]);

  // Enter and Space on the row disclosure toggle it.
  await enDisclosure.focus();
  await page.keyboard.press("Enter");
  await expect(enDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(enDisclosure).toBeFocused();
  await page.keyboard.press("Space");
  await expect(enDisclosure).toHaveAttribute("aria-expanded", "false");
});

test("Screen reader semantics: bar heading and aria-current, group and row headers, Open and View names", async ({ page }) => {
  const { s, labels } = await openScenario(page, "S0");
  const ann = esc(labels["ann-0004"]);

  // Bar: h2 and the active segment.
  await expect(page.getByRole("navigation", { name: "Segments", exact: true })).toBeVisible();
  await expect(segment(page, "All")).toHaveAttribute("aria-current", "page");
  await expect(segment(page, "Needs your decision (1)")).not.toHaveAttribute("aria-current", /.+/);
  await expect(segment(page, "No final result (1)")).not.toHaveAttribute("aria-current", /.+/);

  // Group header: a disclosure inside <th scope="rowgroup" colspan>, controlling its language rows.
  const group = page.getByRole("button", { name: `${S0_CASE}, 2 languages, final 1 of 2`, exact: true });
  await expect(group).toHaveAttribute("aria-expanded", "true");
  const groupHeader = await group.evaluate(button => {
    const cell = button.closest("th");
    const controls = (button.getAttribute("aria-controls") ?? "").split(" ").filter(Boolean);
    return {
      scope: cell?.getAttribute("scope"), colspan: Number(cell?.getAttribute("colspan") ?? 1),
      controlled: controls.map(id => document.getElementById(id)?.tagName.toLowerCase() ?? "missing"),
      rowgroup: cell?.closest("tbody") != null,
    };
  });
  expect(groupHeader).toEqual({ scope: "rowgroup", colspan: 7, controlled: ["tr", "tr"], rowgroup: true });
  await expect(page.getByRole("rowgroup").filter({ has: group })).toHaveCount(1);

  // Row headers: disclosure in <th scope="row"> named "Show submissions, {text} · {language}"; "Open {text} · {language}".
  for (const language of ["en", "de"]) {
    const button = disclosure(page, S0_CASE, language);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    expect(await button.evaluate(element => element.closest("th")?.getAttribute("scope"))).toBe("row");
    await expect(page.getByRole("rowheader").filter({ has: button })).toHaveCount(1);
    await expect(page.getByRole("link", { name: `Open ${S0_CASE} · ${language}`, exact: true })).toHaveText("Open");
  }

  // Expanded row: <tr><td colspan> with a labelled region and <h3> sections; View links name the submission.
  const area = await expand(page, S0_CASE, "de");
  const de = disclosure(page, S0_CASE, "de");
  const controlled = await de.evaluate(button => {
    const target = document.getElementById(button.getAttribute("aria-controls") ?? "");
    const section = target?.querySelector('section[role="region"]');
    return {
      cell: target?.closest("td")?.colSpan ?? 0,
      region: section != null,
      labelledBy: section?.getAttribute("aria-labelledby") ? document.getElementById(section.getAttribute("aria-labelledby")!)?.textContent : null,
    };
  });
  expect(controlled.region).toBe(true);
  expect(controlled.cell).toBeGreaterThan(1);
  expect(controlled.labelledBy).toBeTruthy();
  await expect(area.getByRole("heading", { name: "Issues", level: 3 })).toBeVisible();
  await expect(area.getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  const submissions = submissionsTable(area, S0_CASE, "de");
  await expect(submissions.getByRole("link", { name: new RegExp(`^View Annotation · Round 1 · ${ann} · de v1 · ${TIME}$`) })).toHaveText("Round 1");
  await expect(submissions.getByRole("link", { name: new RegExp(`^View Review · Round 1 · ${esc(labels["ann-0003"])} · de v1 · ${TIME}$`) })).toHaveText("Round 1");

  // The decision segment and a category link carry aria-current.
  await openDocuments(page, s, "?decision=all");
  await expect(segment(page, "Needs your decision (1)")).toHaveAttribute("aria-current", "page");
  await expect(segment(page, "All")).not.toHaveAttribute("aria-current", /.+/);
  const categories = page.getByRole("navigation", { name: "Decision categories" });
  await categories.getByRole("link", { name: /^Final result to confirm \(1\)$/ }).click();
  await expect(categories.getByRole("link", { name: /^Final result to confirm \(1\)$/ })).toHaveAttribute("aria-current", "page");
  await expect(segment(page, "Needs your decision (1)")).toHaveAttribute("aria-current", "true");
});

test("Live announcements: texts shown, previous confirmation closed, Saving…, success and conflict", async ({ page }) => {
  const { labels } = await openScenario(page, "S0");

  // Filter change: "{k} texts shown".
  await page.getByLabel("Language", { exact: true }).selectOption("de");
  await expect(live(page)).toHaveText("1 text shown");
  await expect(disclosure(page, S0_CASE, "en")).toHaveCount(0);
  await segment(page, "Needs your decision (1)").click();
  await expect(segment(page, "Needs your decision (1)")).toHaveAttribute("aria-current", "page");
  await expect(live(page)).toHaveText("1 text shown");
  await segment(page, "All").click();
  await page.getByLabel("Language", { exact: true }).selectOption("");
  await expect(disclosure(page, S0_CASE, "en")).toBeVisible();

  // Opening a second confirmation closes the first and says so.
  const area = await expand(page, S0_CASE, "de");
  await area.getByRole("button", { name: "Keep final result…", exact: true }).click();
  await expect(confirmGroup(page, "Keep final result")).toBeVisible();
  const submissions = submissionsTable(area, S0_CASE, "de");
  const review = submissionRow(submissions, `Review · Round 1 · ${esc(labels["ann-0003"])} · de v1 · ${TIME}`);
  await review.getByRole("button", { name: "Replace…", exact: true }).click();
  await expect(live(page)).toHaveText("Previous confirmation closed.");
  await expect(confirmGroup(page, "Keep final result")).toHaveCount(0);
  const replace = confirmGroup(page, "Replace final result");
  await expect(replace.getByRole("heading", { name: "Replace final result" })).toBeFocused();

  // Saving: the request is held; the focused button stays focused with aria-disabled and "Saving…" is announced.
  let release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  const selections = "**/api/v1/projects/*/final-selections";
  await page.route(selections, async route => {
    if (route.request().method() === "PUT") await held;
    await route.continue();
  });
  const confirm = replace.getByRole("button", { name: "Replace", exact: true });
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(replace.locator('[role="status"]')).toHaveText("Saving…");
  await expect(confirm).toBeFocused();
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  // Never natively disabled (Playwright's toBeDisabled also counts aria-disabled).
  expect(await confirm.evaluate(button => (button as HTMLButtonElement).disabled)).toBe(false);
  release();
  await expect(live(page)).toHaveText(new RegExp(`^Review · Round 1 · ${esc(labels["ann-0003"])} · de v1 · ${TIME} is now the final result\\.`));
  await page.unroute(selections);

  // Conflict: the server refuses a stale revision; the outcome renders inside the confirmation.
  const original = submissionRow(submissions, `Annotation · Round 1 · ${esc(labels["ann-0004"])} · de v1 · ${TIME}`);
  await original.getByRole("button", { name: "Replace…", exact: true }).click();
  const back = confirmGroup(page, "Replace final result");
  await expect(back).toBeVisible();
  await page.route(selections, async route => {
    if (route.request().method() !== "PUT") return route.continue();
    const body = JSON.parse(route.request().postData() ?? "{}") as { expected_revision: number };
    await route.continue({ postData: JSON.stringify({ ...body, expected_revision: body.expected_revision + 100 }) });
  });
  await back.getByRole("button", { name: "Replace", exact: true }).click();
  const notice = back.getByRole("alert");
  await expect(notice).toContainText(CONFLICT_TEXT);
  await expect(notice).toBeFocused();
  await expect(back.getByRole("button", { name: "Review again", exact: true })).toBeVisible();
  await page.unroute(selections);
});

test("Deep links: case, language, decision, final, repeated open; pinned row; unknown case", async ({ page }) => {
  const { s } = await openScenario(page, "S0");

  // case + language: the row opens and its row header has focus.
  await openDocuments(page, s, `?case=${S0_CASE}&language=de`);
  await expect(disclosure(page, S0_CASE, "de")).toHaveAttribute("aria-expanded", "true");
  await expect(disclosure(page, S0_CASE, "de")).toBeFocused();
  await expect(region(page, S0_CASE, "de").getByRole("heading", { name: /^Submissions \(\d+\)$/ })).toBeVisible();

  // case alone: the group header has focus.
  await page.goto("about:blank");
  await openDocuments(page, s, `?case=${S0_CASE}`);
  await expect(page.getByRole("button", { name: `${S0_CASE}, 2 languages, final 1 of 2`, exact: true })).toBeFocused();

  // A named row that no longer matches the decision stays visible with a notice.
  await page.goto("about:blank");
  await openDocuments(page, s, `?decision=confirm-final&case=${S0_CASE}&language=en`);
  await expect(disclosure(page, S0_CASE, "en")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("This no longer needs your decision.", { exact: true })).toBeVisible();

  // decision alone: only matching rows.
  await page.goto("about:blank");
  await openDocuments(page, s, "?decision=confirm-final");
  await expect(disclosure(page, S0_CASE, "de")).toBeVisible();
  await expect(disclosure(page, S0_CASE, "en")).toHaveCount(0);
  await expect(page.getByText("This no longer needs your decision.")).toHaveCount(0);

  // final=missing: the "No final result" segment is current; only the row without a final result.
  await page.goto("about:blank");
  await openDocuments(page, s, "?final=missing");
  await expect(segment(page, "No final result (1)")).toHaveAttribute("aria-current", "page");
  await expect(disclosure(page, S0_CASE, "en")).toBeVisible();
  await expect(disclosure(page, S0_CASE, "de")).toHaveCount(0);

  // language: the exact filter, shown in the Language select.
  await page.goto("about:blank");
  await openDocuments(page, s, "?language=de");
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("de");
  await expect(disclosure(page, S0_CASE, "de")).toBeVisible();
  await expect(disclosure(page, S0_CASE, "en")).toHaveCount(0);

  // open, repeated: both rows expanded.
  await page.goto("about:blank");
  await openDocuments(page, s, `?open=${encodeURIComponent(`${S0_CASE}:en`)}&open=${encodeURIComponent(`${S0_CASE}:de`)}`);
  for (const language of ["en", "de"]) {
    await expect(disclosure(page, S0_CASE, language)).toHaveAttribute("aria-expanded", "true");
    await expect(region(page, S0_CASE, language)).toBeVisible();
  }
  // Collapsing one uses replace navigation and keeps the other in the query.
  await disclosure(page, S0_CASE, "en").click();
  await expect(disclosure(page, S0_CASE, "en")).toHaveAttribute("aria-expanded", "false");
  expect(documentsQueryOf(page.url())).toEqual([`open=${S0_CASE}:de`]);

  // Unknown case: EmptyState with "Show all texts".
  await page.goto("about:blank");
  await openDocuments(page, s, "?case=no-such-text");
  await expect(page.getByText("Text no-such-text not found", { exact: true })).toBeVisible();
  await expect(table(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Show all texts", exact: true }).click();
  await expect(disclosure(page, S0_CASE, "en")).toBeVisible();
  expect(documentsQueryOf(page.url())).toEqual([]);
});

test("Deep link page: S15 page 2 of 2", async ({ page }) => {
  await openScenario(page, "S15", "?page=2");
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages).toContainText("Page 2 of 2");
  const groups = table(page).getByRole("button", { name: /^case-\d{4}, \d languages?, final \d+ of \d+$/ });
  await expect(groups).toHaveCount(5);
  await expect(groups.first()).toHaveAccessibleName(/^case-0051, /);
  // "Next" at the end stays focusable as an aria-disabled link.
  await expect(pages.getByRole("link", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true");
});

test("Back from the report page and from the case viewer restores the Documents query", async ({ page }) => {
  const caseId = "case-0390";
  const { s } = await openScenario(page, "S6", `?decision=report-or-pause&open=${encodeURIComponent(`${caseId}:de`)}`);
  const area = await expand(page, caseId, "de");
  const query = documentsQueryOf(page.url());
  expect(query).toEqual(["decision=report-or-pause", `open=${caseId}:de`]);

  // Report page and back.
  await area.getByRole("link", { name: "Open report", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Problem report", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Back to Documents" }).first().click();
  await expect(page.getByRole("navigation", { name: "Segments", exact: true })).toBeVisible();
  expect(documentsQueryOf(page.url())).toEqual(query);
  await expect(disclosure(page, caseId, "de")).toHaveAttribute("aria-expanded", "true");
  await expect(segment(page, /^Needs your decision \(\d+\)$/)).toHaveAttribute("aria-current", /page|true/);

  // Case viewer and back.
  await page.getByRole("link", { name: `Open ${caseId} · de`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Text: ${caseId}`, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Back to Documents", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Segments", exact: true })).toBeVisible();
  expect(documentsQueryOf(page.url())).toEqual(query);
  await expect(disclosure(page, caseId, "de")).toHaveAttribute("aria-expanded", "true");

  // Browser history back from the case viewer restores it too.
  await page.getByRole("link", { name: `Open ${caseId} · de`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Text: ${caseId}`, level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("navigation", { name: "Segments", exact: true })).toBeVisible();
  expect(documentsQueryOf(page.url())).toEqual(query);
  expect(s.project).toBeTruthy();
});

test("axe: default view, decision filter, expanded row with open Keep, 390 px cards", async ({ page }) => {
  const { s } = await openScenario(page, "S0");
  await expect(disclosure(page, S0_CASE, "de")).toBeVisible();
  expect(await axeViolations(page), "default view").toEqual([]);

  await openDocuments(page, s, "?decision=all");
  await expect(segment(page, "Needs your decision (1)")).toHaveAttribute("aria-current", "page");
  await expect(disclosure(page, S0_CASE, "de")).toBeVisible();
  expect(await axeViolations(page), "decision filter").toEqual([]);

  await openDocuments(page, s);
  const area = await expand(page, S0_CASE, "de");
  await area.getByRole("button", { name: "Keep final result…", exact: true }).click();
  await expect(confirmGroup(page, "Keep final result").getByRole("heading", { name: "Keep final result" })).toBeFocused();
  expect(await axeViolations(page), "expanded row with Keep open").toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("about:blank");
  await openDocuments(page, s);
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(await axeViolations(page), "390 px cards").toEqual([]);
});

// --- Task 7.5: layout, forced colours, reduced motion ------------------------------------------- //

test("320 CSS px: no horizontal scroll; heading, version, final result and Open stay in view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { s } = await openScenario(page, "S0");
  await expect(page.getByRole("article")).toHaveCount(2);

  const checkReflow = async (state: string) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth), state).toBeLessThanOrEqual(320);
    for (const language of ["en", "de"]) {
      const card = page.getByRole("article", { name: `${S0_CASE} · ${language}`, exact: true });
      const facts = [
        card.getByRole("heading", { name: `${S0_CASE} · ${language}`, level: 3 }),
        card.locator(".documents-version"),
        card.locator(".documents-final"),
        card.getByRole("link", { name: `Open ${S0_CASE} · ${language}`, exact: true }),
      ];
      for (const fact of facts) {
        await expect(fact).toBeVisible();
        const box = (await fact.boundingBox())!;
        expect(box.x, `${state} ${language}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${state} ${language}`).toBeLessThanOrEqual(320);
      }
    }
  };
  await checkReflow("collapsed");
  await evidence(page, "320-collapsed");

  await page.getByRole("button", { name: `Show submissions, ${S0_CASE} · de`, exact: true }).click();
  await expect(page.getByRole("article", { name: `${S0_CASE} · de` }).getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  await checkReflow("expanded");
  await evidence(page, "320-expanded");
  expect(s.project).toBeTruthy();
});

test("390 px cards: every interactive target is at least 24 by 24 px, or meets a listed WCAG 2.5.8 exception", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScenario(page, "S0");
  await expect(page.getByRole("article")).toHaveCount(2);
  const toggle = page.getByRole("button", { name: `Show submissions, ${S0_CASE} · de`, exact: true });
  await toggle.click();
  await expect(page.getByRole("article", { name: `${S0_CASE} · de` }).getByRole("heading", { name: "Submissions (2)", level: 3 })).toBeVisible();
  await page.getByRole("article", { name: `${S0_CASE} · de` }).getByRole("button", { name: "Keep final result…", exact: true }).click();
  await expect(confirmGroup(page, "Keep final result")).toBeVisible();

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
    const cards = Array.from(document.querySelectorAll("article.document-card"));
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
    /** Distance from a point to a rectangle (0 inside). */
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
    /** WCAG 2.5.8 spacing: the 24 px circle on the target meets no other target and no other undersized target's circle. */
    /** The first target that breaks the spacing exception, or null when the target is spaced. */
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
  // The exceptions applied, listed: the View links of the two submissions sit in the submission's label
  // line (text-height links; spacing first, else the "inline" exception). Nothing else is exempt.
  expect(report.exceptions, report.exceptions.join("; ")).toHaveLength(2);
  expect(report.exceptions[0]).toMatch(/^(spacing|inline): a "View Annotation · Round 1 · /);
  expect(report.exceptions[1]).toMatch(/^(spacing|inline): a "View Review · Round 1 · /);
});

test("Forced colours: Final row border, pill borders, focus outline, active segment", async ({ page }) => {
  const { labels } = await openScenario(page, "S0");
  await page.emulateMedia({ forcedColors: "active" });
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);

  const area = await expand(page, S0_CASE, "de");
  const final = submissionRow(submissionsTable(area, S0_CASE, "de"), `Annotation · Round 1 · ${esc(labels["ann-0004"])} · de v1 · ${TIME}`);
  await expect(final).toHaveClass(/final-row/);
  const borderLeft = await final.locator("> :first-child").evaluate(cell => parseFloat(getComputedStyle(cell).borderLeftWidth));
  expect(borderLeft).toBeGreaterThan(0);

  const pills = page.locator("main .status-pill");
  expect(await pills.count()).toBeGreaterThan(0);
  const borders = await pills.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return { text: (element.textContent ?? "").trim(), width: parseFloat(style.borderTopWidth), style: style.borderTopStyle };
  }));
  for (const border of borders) {
    expect(border.width, border.text).toBeGreaterThan(0);
    expect(border.style, border.text).not.toBe("none");
  }

  // Keyboard focus is outlined on every stop from the filters into the table.
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

  const colours = await page.getByRole("navigation", { name: "Decision filter" }).getByRole("link").evaluateAll(links => links.map(link => ({
    current: link.getAttribute("aria-current"), colour: getComputedStyle(link).borderBottomColor, width: parseFloat(getComputedStyle(link).borderBottomWidth),
  })));
  await evidence(page, "forced-colours");
  await evidence(page, "forced-colours-bar", page.locator(".decision-bar"));
  const active = colours.find(item => item.current === "page")!;
  expect(active.width).toBeGreaterThan(0);
  for (const inactive of colours.filter(item => item.current === null)) expect(inactive.colour, JSON.stringify(colours)).not.toBe(active.colour);
});

test("Reduced motion: the disclosure chevron does not animate", async ({ page }) => {
  await openScenario(page, "S0");
  const chevron = disclosure(page, S0_CASE, "de").locator(".disclosure-chevron");
  await expect(chevron).toHaveCSS("transition-duration", "0.15s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(chevron).toHaveCSS("transition-duration", "0s");
  await disclosure(page, S0_CASE, "de").click();
  await expect(disclosure(page, S0_CASE, "de")).toHaveAttribute("aria-expanded", "true");
  const animations = await page.locator(".data-table-expanded > td").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).animationName));
  for (const name of animations) expect(name).toBe("none");
});
