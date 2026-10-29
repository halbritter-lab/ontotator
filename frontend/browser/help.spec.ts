/** The bundled handbook (#/help): opened from the header, chapter links stay in the app, in-page anchors scroll. */
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("opens the handbook in the app, follows a chapter link and an in-page anchor", async ({ page }) => {
  await loginAs(page, "Help Reader");
  await page.getByRole("link", { name: "Handbook", exact: true }).click();
  await expect(page).toHaveURL(/#\/help$/);
  const article = page.locator("article.help-document");
  await expect(article.locator("h1")).toBeVisible();
  const chapters = page.getByRole("navigation", { name: "Handbook chapters" });
  // Every chapter is listed by its title, not by its file name such as "lead-results".
  for (const title of await chapters.locator("a").allTextContents()) expect(title).not.toMatch(/^[a-z]+(-[a-z]+)*$|^README$/);

  // A chapter link of the README opens that chapter in the app.
  const chapterLink = article.locator('a[href^="#/help/"]').first();
  const href = (await chapterLink.getAttribute("href"))!;
  await chapterLink.click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[?]/g, "\\?")}$`));
  const opened = /#\/help\/([^?]+)/.exec(href)![1];
  await expect(chapters.locator(`a[href="#/help/${opened}"]`)).toHaveAttribute("aria-current", "page");

  // Find a chapter with an in-page anchor; clicking it scrolls without a route change.
  for (const name of await chapters.locator("a").evaluateAll(links => links.map(link => link.getAttribute("href")!))) {
    await page.goto(`/${name}`);
    await expect(article.locator("h1")).toBeVisible();
    const anchor = article.locator(`a[href^="${name === "#/help" ? "#/help?section=" : `${name}?section=`}"]`).last();
    if (await anchor.count() === 0) continue;
    const id = new URLSearchParams((await anchor.getAttribute("href"))!.split("?")[1]).get("section")!;
    // Contextual help opens a section by deep link; it lands on the heading.
    await page.goto(`/${name}?section=${id}`);
    await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
    await page.goto(`/${name}`);
    await anchor.click();
    await expect(page).toHaveURL(new RegExp(`${name}$`));
    await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
    return;
  }
  throw new Error("No chapter has an in-page anchor link");
});
