/**
 * Practice projects (issue 266): an annotator clicks "Try it out" on My tasks and opens a practice task.
 * The learner is a member of this spec's own fixture project (`browser-fixture-practice`); the practice
 * project is made by the server for that learner alone.
 */
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const PROJECT = "browser-fixture-practice";

test("Try it out builds a private practice project and opens a practice task", async ({ page }) => {
  test.setTimeout(90_000);
  await loginAs(page, "Practice Learner", [PROJECT]);
  const card = page.getByRole("region", { name: "New here? Try it out first" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Try it out" }).click();

  const group = page.getByTestId("practice-group");
  await expect(group).toBeVisible({ timeout: 60_000 });
  await expect(card).toBeHidden();
  // The learner holds every role in the fixture project, so the consolidation task is there too.
  await expect(group.getByTestId("practice-task-row")).toHaveCount(4);
  await expect(group).toContainText("0 of 4 tasks done");
  // Practice tasks are never among the real tasks.
  await expect(page.getByTestId("task-row").filter({ hasText: "PRACTICE-" })).toHaveCount(0);
  const projects = await (await page.request.get("/api/v1/projects")).json() as { project_key: string }[];
  expect(projects.some(project => project.project_key.startsWith("practice-"))).toBe(false);

  await group.getByTestId("practice-task-row").filter({ hasText: "Annotate from scratch" }).getByRole("link").click();
  await expect(page.getByTestId("practice-banner")).toContainText("Nothing here counts. Invented texts only.");
  const banner = page.getByTestId("practice-banner");
  await expect(banner.getByRole("button", { name: "Leave practice" })).toBeInViewport({ ratio: 1 });
  // The panel starts folded to one line with the next step; the steps open on click.
  const panel = page.getByRole("group", { name: "Your practice" });
  await expect(panel.getByRole("status")).toContainText("Next:");
  await expect(panel).toContainText("0 of 4");
  await expect(panel.getByText("Mark a finding and choose its term")).toBeHidden();
  await panel.locator("summary").click();
  await expect(panel.getByText("Mark a finding and choose its term")).toBeVisible();
  // The banner keeps its own row: the panel never covers it.
  const bannerBox = (await banner.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y).toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height);
  await expect(page.locator(".case-toolbar [role=status]")).toBeVisible();

  await page.getByRole("button", { name: "Leave practice" }).click();
  await expect(page.getByRole("heading", { name: "My tasks", level: 1 })).toBeVisible();
  await expect(page.getByTestId("practice-group")).toBeVisible();
});
