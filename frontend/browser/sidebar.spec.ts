import { expect, test } from "@playwright/test";
import { importPackage, openCase } from "./helpers";

test("sidebar scrolls proposals and curated annotations as one list", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await importPackage(page, "?scenario=many_proposals", "pkg-many-proposals", "sidebar-reviewer");
  await page.locator("#mode-select").selectOption("review");
  await openCase(page, { identity: "sidebar-reviewer" });

  const scroller = page.locator(".sidebar .sidebar-scroll");
  const proposalsHeader = scroller.locator(".sidebar-header").filter({ hasText: "Review Proposals (30)" });
  const curatedHeader = scroller.locator(".sidebar-header").filter({ hasText: "Curated Annotations (0)" });
  await expect(proposalsHeader).toBeVisible();
  await expect(scroller.locator(".badge-ai")).toHaveCount(30);

  // The list overflows and the curated section starts below the fold ...
  const overflow = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeGreaterThan(0);
  await expect(curatedHeader).not.toBeInViewport();

  // ... and is reached by scrolling the one sidebar list.
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(curatedHeader).toBeInViewport();
  await expect(scroller.getByRole("button", { name: "+ New Annotation" })).toBeInViewport();

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
  await expect(lastProposal).not.toBeInViewport();
  await lastProposal.evaluate((el) => (el as HTMLElement).click());
  await expect(lastProposal).toBeInViewport();
});
