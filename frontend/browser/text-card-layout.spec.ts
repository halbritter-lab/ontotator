/**
 * Text card layout and focus (issues 330, 333, 334, 335): the stage path's focus ring is fully visible with enough
 * contrast on every segment, the 390 px sheet keeps the Final result's buttons on screen, the card's top edge stays
 * put while switching parts and views, and History / Details name themselves with a heading.
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
