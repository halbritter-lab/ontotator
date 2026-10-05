import { expect, test } from "@playwright/test";
import { LAUNCH_URL } from "./helpers";

const notice = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Settings from an earlier installation" });

test("settings from an earlier installation: shown, never imported silently, deleted after confirmation", async ({ page }) => {
  const fixture = await page.request.post("/__legacy_fixture__");
  expect(fixture.ok()).toBeTruthy();
  const { path } = (await fixture.json()) as { path: string };

  await page.goto(LAUNCH_URL);
  const region = notice(page);
  await expect(region).toContainText("Settings from an earlier Ontocurator installation were found");
  await expect(region).toContainText(path);
  await expect(region).toContainText("hp-2024.json – file not found, will be skipped");
  await expect(region).toContainText("Port: 8123");
  await expect(region).toContainText("next time Ontocurator starts");

  // The test server replaces the file manager with a no-op.
  await region.getByRole("button", { name: "Open folder" }).click();
  await expect(page.getByText(/Could not open the folder/)).toHaveCount(0);

  await region.getByRole("button", { name: /Delete old settings/ }).click();
  let dialog = page.getByRole("dialog", { name: "Delete old settings?" });
  await expect(dialog).toContainText(path);
  await expect(dialog).toContainText("not affected");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(region).toBeVisible();

  await region.getByRole("button", { name: /Delete old settings/ }).click();
  dialog = page.getByRole("dialog", { name: "Delete old settings?" });
  await dialog.getByRole("button", { name: "Delete file" }).click();
  await expect(page.getByRole("status", { name: "Import result" })).toContainText("was deleted");
  await expect(region).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: /Add ontology/ })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});

test("settings from an earlier installation: import on request", async ({ page }) => {
  expect((await page.request.post("/__legacy_fixture__")).ok()).toBeTruthy();
  await page.goto(LAUNCH_URL);
  const region = notice(page);
  await region.getByRole("button", { name: "Import settings" }).click();
  const result = page.getByRole("status", { name: "Import result" });
  await expect(result).toContainText("Settings from the earlier installation were imported");
  await expect(result).toContainText("port 8123");
  await expect(result).toContainText("next time Ontocurator starts");
  await expect(result).toContainText("hp-2024.json (file not found)");
  await expect(region).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: /Add ontology/ })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});
