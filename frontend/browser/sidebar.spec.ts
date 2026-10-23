import { expect, test } from "@playwright/test";
import { importPackage, openCase } from "./helpers";

test("sidebar scrolls proposals and saved findings as one list with stable reading geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await importPackage(page, "?scenario=many_proposals", "pkg-many-proposals", "sidebar-reviewer", { proposals: true });
  await openCase(page, { task: "annotate" });

  const scroller = page.locator(".sidebar .sidebar-scroll");
  const proposalsHeader = scroller.locator(".sidebar-header").filter({ hasText: "Review Proposals (30)" });
  const curatedHeader = scroller.locator(".sidebar-header").filter({ hasText: "Findings (0)" });
  await expect(proposalsHeader).toBeVisible();
  await expect(scroller.locator(".badge-ai")).toHaveCount(30);

  // The list overflows and the curated section starts below the fold ...
  const overflow = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeGreaterThan(0);
  await expect(curatedHeader).not.toBeInViewport();

  // ... and is reached by scrolling the one sidebar list.
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(curatedHeader).toBeInViewport();
  await expect(scroller.getByRole("button", { name: "Add finding without a text span" })).toBeInViewport();

  // Half-way down, the proposals header sticks to the top of the list.
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight / 2));
  const [scrollerTop, headerTop] = await Promise.all([
    scroller.evaluate((el) => el.getBoundingClientRect().top),
    proposalsHeader.evaluate((el) => el.getBoundingClientRect().top),
  ]);
  expect(Math.abs(headerTop - scrollerTop)).toBeLessThan(2);

  // Selecting an entry that is scrolled out of sight brings it into view.
  // (A DOM click selects it without Playwright scrolling to it first.)
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  const lastProposal = scroller.locator("[data-list-key^='target:']").last();
  const text = page.locator('.app-layout > .center-pane');
  const geometryBefore = await text.boundingBox();
  await expect(lastProposal).not.toBeInViewport();
  await lastProposal.evaluate((el) => (el as HTMLElement).click());
  await expect(lastProposal).toBeInViewport();
  expect(await text.boundingBox()).toEqual(geometryBefore);
  expect((await page.locator('.sidebar').boundingBox())!.width).toBeLessThanOrEqual(260);
  for (const width of [1440, 1024, 768, 720, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 700) await page.getByRole('navigation', { name: 'Select view' }).getByRole('button', { name: 'Document', exact: true }).click();
    await expect(text).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const before = await text.boundingBox();
    if (width > 700) {
      await lastProposal.evaluate(el => (el as HTMLElement).click());
      expect(await text.boundingBox()).toEqual(before);
    }
    expect((await text.boundingBox())!.width).toBeGreaterThan(width > 700 ? 450 : width - 10);
    await page.screenshot({ path: test.info().outputPath(`editor-${width}.png`) });
  }
});
