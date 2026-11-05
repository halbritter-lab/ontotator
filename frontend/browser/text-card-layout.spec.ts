/**
 * Text card layout and focus (issues 330, 333, 334, 335): the stage path's focus ring is fully visible with enough
 * contrast on every segment, the 390 px sheet keeps the Final result's buttons on screen, the card's top edge stays
 * put while switching parts and views, and History / Details name themselves with a heading. Issues 329, 331, 332: one
 * left edge per part (boxed notices are the one inset), person rows in the version list without a wrapping remove
 * button, one remove label, no empty action block, and every lead button inside the banner or part it acts on.
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and logs in as its lead.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cardPath, documentsScenario, showSegment, type DocumentsScenario } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

async function openCard(page: Page, s: DocumentsScenario, caseId: string, language: string): Promise<Locator> {
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents?panel=${encodeURIComponent(`${caseId}:${language}`)}`);
  const card = page.getByRole("dialog");
  await expect(cardPath(card)).toBeVisible();
  return card;
}

const cardTop = async (card: Locator): Promise<number> => Math.round((await card.boundingBox())!.y);

test("stage path: every segment, the current one too, shows a whole focus ring with at least 3:1 contrast (issue 334)", async ({ page }) => {
  const s = await documentsScenario(page, "S0");
  await loginExisting(page, s.users.lead);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    const card = await openCard(page, s, "synthetic-accepted", "de");
    const segments = cardPath(card).getByRole("button");
    const count = await segments.count();
    expect(count).toBe(3);
    let sawCurrent = false;
    for (let index = 0; index < count; index++) {
      const segment = segments.nth(index);
      // Keyboard focus (focus-visible): from the previous stop with Tab.
      await segment.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(segment).toBeFocused();
      const ring = await segment.evaluate(element => {
        const rgb = (value: string) => (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const luminance = ([r, g, b]: number[]) => {
          const channel = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };
        const after = getComputedStyle(element, "::after");
        const own = getComputedStyle(element);
        const [a, b] = [luminance(rgb(after.borderTopColor)), luminance(rgb(own.backgroundColor))];
        const box = element.getBoundingClientRect();
        // The ring is drawn inside the arrow: clear of the 10 px chevrons left (except the first segment) and right.
        const first = element.closest("li")?.previousElementSibling == null;
        return {
          content: after.content, width: parseFloat(after.borderTopWidth), style: after.borderTopStyle,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          left: parseFloat(after.left), right: parseFloat(after.right), top: parseFloat(after.top), bottom: parseFloat(after.bottom),
          minLeft: first ? 0 : 11, height: box.height, current: element.getAttribute("aria-current") === "step",
        };
      });
      const state = `${width} px, segment ${index + 1}${ring.current ? " (current)" : ""}`;
      sawCurrent ||= ring.current;
      expect(ring.content, state).not.toBe("none");
      expect(ring.style, state).toBe("solid");
      expect(ring.width, state).toBeGreaterThanOrEqual(2);
      expect(ring.contrast, state).toBeGreaterThanOrEqual(3);
      expect(ring.left, state).toBeGreaterThan(ring.minLeft);
      expect(ring.right, state).toBeGreaterThan(11);
      expect(ring.top, state).toBeGreaterThanOrEqual(0);
      expect(ring.bottom, state).toBeGreaterThanOrEqual(0);
    }
    expect(sawCurrent, `${width} px: one segment is the current one`).toBe(true);
  }
});

test("390 px sheet: the Final result lists the submissions without sideways scrolling; Use as final is on screen (issue 333)", async ({ page }) => {
  const s = await documentsScenario(page, "S16");
  await loginExisting(page, s.users.lead);
  await page.setViewportSize({ width: 390, height: 844 });
  const card = await openCard(page, s, "case-1602", "en");
  await showSegment(card, "Finalization");
  const block = card.getByRole("region", { name: "Final result", exact: true });
  const uses = block.getByRole("button", { name: "Use as final", exact: true });
  await expect(uses).toHaveCount(2);
  const overflow = await card.locator(".ui-dialog-body").evaluate(body => body.scrollWidth - body.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const target of [...await uses.all(), ...await block.getByRole("link", { name: /^Open submission, / }).all()]) {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});

test("the card's top edge stays put when switching parts and opening History or Details (issue 330)", async ({ page }) => {
  const s = await documentsScenario(page, "S10");
  await loginExisting(page, s.users.lead);
  for (const [width, height] of [[1024, 768], [1440, 900], [1920, 900]]) {
    await page.setViewportSize({ width, height });
    const card = await openCard(page, s, "case-0444", "de");
    const tops: Record<string, number> = {};
    for (const part of ["Translation", "Annotation", "Finalization"] as const) {
      await showSegment(card, part);
      tops[part] = await cardTop(card);
    }
    for (const view of ["History", "Details"]) {
      await card.getByRole("button", { name: new RegExp(`^${view}( \\(\\d+\\))?$`) }).click();
      await expect(card.getByRole("heading", { level: 3, name: view, exact: true })).toBeVisible();
      tops[view] = await cardTop(card);
      await card.getByRole("button", { name: "Back", exact: true }).click();
      await expect(cardPath(card)).toBeVisible();
    }
    expect(new Set(Object.values(tops)).size, `${width} px: ${JSON.stringify(tops)}`).toBe(1);
  }
});

test("History and Details have a level-3 heading; a problem report reads as title, meta line and Open report (issue 335)", async ({ page }) => {
  const s = await documentsScenario(page, "S6");
  await loginExisting(page, s.users.lead);
  await page.setViewportSize({ width: 1440, height: 900 });
  const card = await openCard(page, s, "case-0390", "de");
  await card.getByRole("button", { name: /^History( \(\d+\))?$/ }).click();
  await expect(card.getByRole("heading", { level: 3, name: "History", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Back", exact: true }).click();
  await card.getByRole("button", { name: "Details", exact: true }).click();
  await expect(card.getByRole("heading", { level: 3, name: "Details", exact: true })).toBeVisible();
  const report = card.locator("section", { has: page.getByRole("heading", { name: "Problem reports (1)", level: 4 }) }).getByRole("listitem");
  await expect(report).toHaveCount(1);
  const lines = await report.evaluate(item => [...item.children].map(child => {
    const box = child.getBoundingClientRect();
    return { text: (child.textContent ?? "").trim(), top: Math.round(box.top), bottom: Math.round(box.bottom) };
  }));
  expect(lines).toHaveLength(3);
  expect(lines[1].text).toMatch(/ · Report: Open · Paused tasks: 1$/);
  expect(lines[2].text).toBe("Open report");
  // Three lines, one under the other.
  expect(lines[1].top).toBeGreaterThanOrEqual(lines[0].bottom);
  expect(lines[2].top).toBeGreaterThanOrEqual(lines[1].bottom);
  await expect(report.getByRole("link", { name: "Open report", exact: true })).toBeVisible();
});

/**
 * The left edges of a part: for each visual line the x of its first glyph (a bordered button or pill counts from its box),
 * relative to the part. Text inside a boxed notice (a warning, the next-step box, the plan control) is reported apart
 * with the notice's own left edge; a disclosure summary counts from its box (its marker sits on the edge).
 */
async function partEdges(card: Locator): Promise<{ part: number[]; boxes: { box: number; text: number[] }[]; footer: number[] }> {
  return card.locator(".text-card-part").evaluate(part => {
    const BOXED = ".notice, .text-card-next, .final-panel-text-change, .text-card-plan-control";
    const origin = part.getBoundingClientRect().left;
    const lineStarts = (root: Element, skip: (el: Element) => boolean) => {
      const lines: { top: number; bottom: number; left: number }[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || !node.textContent?.trim() || skip(el) || el.closest(".visually-hidden, [aria-hidden=true]")) continue;
        const control = el.closest(".btn, .status-pill, summary");
        const style = control ? getComputedStyle(control) : null;
        const boxed = control && (control.tagName === "SUMMARY" || (parseFloat(style!.borderLeftWidth) > 0 && style!.borderLeftColor !== "rgba(0, 0, 0, 0)") || style!.backgroundColor !== "rgba(0, 0, 0, 0)");
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width) continue;
          const left = boxed ? control!.getBoundingClientRect().left : rect.left;
          const line = lines.find(entry => rect.top < entry.bottom - 2 && rect.bottom > entry.top + 2);
          if (line) { line.left = Math.min(line.left, left); line.top = Math.min(line.top, rect.top); line.bottom = Math.max(line.bottom, rect.bottom); }
          else lines.push({ top: rect.top, bottom: rect.bottom, left });
        }
      }
      return [...new Set(lines.map(line => Math.round(line.left - origin)))].sort((a, b) => a - b);
    };
    const boxes = [...part.querySelectorAll(BOXED)].filter(box => !box.parentElement?.closest(BOXED));
    const footer = part.closest(".text-card")!.querySelector(".text-card-footer");
    return {
      part: lineStarts(part, el => !!el.closest(BOXED)),
      boxes: boxes.map(box => ({ box: Math.round(box.getBoundingClientRect().left - origin), text: lineStarts(box, () => false) })),
      footer: footer ? lineStarts(footer, () => false) : [],
    };
  });
}

/** Action rows (`.text-card-actions`) that are displayed but hold nothing. */
const emptyActionRows = (card: Locator): Promise<number> => card.locator(".text-card-actions").evaluateAll(rows =>
  rows.filter(row => getComputedStyle(row).display !== "none" && (row.getBoundingClientRect().height === 0 || !row.children.length)).length);

/** Buttons and button links of the card body outside a banner, a part, Other languages, the sheet's top line and the path. */
const looseButtons = (card: Locator): Promise<string[]> => card.locator(".text-card-body").evaluate(body => [...body.querySelectorAll("button, a.btn")]
  .filter(button => !button.closest(".text-card-part, .text-card-banner, .text-card-languages, .text-card-topline, nav, .text-card-not-planned"))
  .map(button => (button.textContent ?? "").trim()));

test("Finalization: the part, the warning, the decision block and the footer share the part's edge plus one inset; the warning's Remove… is a button (issue 331)", async ({ page }) => {
  const s = await documentsScenario(page, "S16");
  await loginExisting(page, s.users.lead);
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const card = await openCard(page, s, "case-1602", "en");
    await showSegment(card, "Finalization");
    await expect(card.getByRole("region", { name: "Final result", exact: true })).toBeVisible();
    const edges = await partEdges(card);
    const state = `${width} px: ${JSON.stringify(edges)}`;
    // Title, decision text, How is this counted?, the table, Consolidate…: all on the part's edge.
    expect(edges.part, state).toEqual([0]);
    // The warning is the one inset: its box on the edge, its text and its Remove… button on one inner edge.
    expect(edges.boxes.map(box => box.box), state).toEqual([0]);
    expect(edges.boxes[0].text, state).toHaveLength(1);
    expect(edges.footer, state).toEqual([0]);
    const remove = card.locator(".notice").getByRole("button", { name: /^Remove .+ assignment$/ });
    await expect(remove).toHaveText("Remove…");
    await expect(remove).toHaveClass(/btn-secondary/);
  }
});

test("Translation: every person on a version is one person row with a status pill; no remove button wraps; one remove label (issue 329)", async ({ page }) => {
  const s = await documentsScenario(page, "S10");
  await loginExisting(page, s.users.lead);
  await page.setViewportSize({ width: 1440, height: 900 });
  const card = await openCard(page, s, "case-0444", "de");
  await showSegment(card, "Translation");
  await card.locator(".text-version-older > details > summary").click();
  const part = card.locator(".text-card-part");
  const people = part.locator(".text-versions .person-row");
  expect(await people.count()).toBeGreaterThanOrEqual(6);
  const rows = await people.evaluateAll(items => items.map(item => {
    const buttons = [...item.querySelectorAll("button, a.btn")].map(button => button.getBoundingClientRect());
    const status = item.querySelector(".person-row-status")?.getBoundingClientRect();
    return { height: Math.round(item.getBoundingClientRect().height), buttonLines: new Set(buttons.map(box => Math.round(box.top))).size, status: status ? Math.round(status.left) : null,
      text: (item.textContent ?? "").replace(/\s+/g, " ") };
  }));
  for (const row of rows) {
    expect(row.status, row.text).not.toBeNull();
    expect(row.buttonLines, row.text).toBeLessThanOrEqual(1);
    expect(row.height, row.text).toBeLessThan(68);
  }
  // Within one version's list the status pills form a column.
  for (const list of await part.locator(".text-versions .person-rows").all()) {
    const lefts = await list.locator(".person-row-status").evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBeLessThanOrEqual(1);
  }
  const removes = await card.getByRole("button", { name: /^Remove/ }).allTextContents();
  expect(removes.length).toBeGreaterThan(0);
  expect(new Set(removes)).toEqual(new Set(["Remove…"]));
  // One left edge besides the boxed next step and the plan control.
  const edges = await partEdges(card);
  expect(edges.part, JSON.stringify(edges)).toEqual([0]);
  await expect(part.getByRole("link", { name: /^View text / }).first()).toHaveClass(/btn-secondary/);
});

test("lead buttons sit in the banner or part they act on; Open result and Change final… share a row; no empty action block (issue 332)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // S6: the report banner holds its decision.
  const s6 = await documentsScenario(page, "S6");
  await loginExisting(page, s6.users.lead);
  let card = await openCard(page, s6, "case-0390", "de");
  const banner = card.getByRole("group", { name: /^1 open problem report/ });
  await expect(banner.getByRole("button", { name: "Decide on report…", exact: true })).toBeVisible();
  await expect(banner.getByRole("link", { name: /^Open problem report, / })).toBeVisible();
  expect(await looseButtons(card)).toEqual([]);
  for (const part of ["Translation", "Annotation", "Finalization"] as const) {
    await showSegment(card, part);
    expect(await emptyActionRows(card), part).toBe(0);
    expect(await card.locator(".text-card-body").evaluate(body => body.lastElementChild?.classList.contains("text-card-part")), part).toBe(true);
  }

  // S10: Resolve… in the Translation part, labelled as the next step.
  const s10 = await documentsScenario(page, "S10");
  await page.context().clearCookies();
  await loginExisting(page, s10.users.lead);
  card = await openCard(page, s10, "case-0444", "de");
  expect(await looseButtons(card)).toEqual([]);
  await showSegment(card, "Translation");
  await expect(card.locator(".text-card-part").getByRole("group", { name: "Next step: Resolve rejected translation", exact: true })
    .getByRole("button", { name: "Resolve…", exact: true })).toBeVisible();

  // S13: Carry to v2… in the Annotation part, where the card opens.
  const s13 = await documentsScenario(page, "S13");
  await page.context().clearCookies();
  await loginExisting(page, s13.users.lead);
  card = await openCard(page, s13, "case-0713", "en");
  await expect(cardPath(card).getByRole("button", { name: /^Annotation / })).toHaveAttribute("aria-current", "step");
  await expect(card.locator(".text-card-part").getByRole("button", { name: "Carry to v2…", exact: true })).toBeVisible();
  expect(await looseButtons(card)).toEqual([]);

  // S5: Open result and Change final… in one row of the Finalization part.
  const s5 = await documentsScenario(page, "S5");
  await page.context().clearCookies();
  await loginExisting(page, s5.users.lead);
  card = await openCard(page, s5, "case-0377", "en");
  await showSegment(card, "Finalization");
  const part = card.locator(".text-card-part");
  const open = await part.getByRole("link", { name: "Open result", exact: true }).boundingBox();
  const change = await part.getByRole("button", { name: "Change final…", exact: true }).boundingBox();
  expect(Math.round(change!.y)).toBe(Math.round(open!.y));
  expect(await emptyActionRows(card)).toBe(0);
  expect(await looseButtons(card)).toEqual([]);
});

test("390 px: only Open text and Other languages stand above the path, on one line (issue 332)", async ({ page }) => {
  const s = await documentsScenario(page, "S0");
  await loginExisting(page, s.users.lead);
  await page.setViewportSize({ width: 390, height: 844 });
  const card = await openCard(page, s, "synthetic-accepted", "de");
  const before = await card.locator(".text-card-body").evaluate(body => {
    const children = [...body.children];
    return children.slice(0, children.findIndex(child => child.tagName === "NAV")).map(child => child.className);
  });
  expect(before).toEqual(["text-card-topline"]);
  const topline = card.locator(".text-card-topline");
  const open = (await topline.getByRole("link", { name: /^Open text, / }).boundingBox())!;
  const language = (await topline.getByRole("button", { name: /^Show / }).first().boundingBox())!;
  expect(Math.abs(open.y + open.height / 2 - (language.y + language.height / 2))).toBeLessThanOrEqual(2);
  expect(await looseButtons(card)).toEqual([]);
});
