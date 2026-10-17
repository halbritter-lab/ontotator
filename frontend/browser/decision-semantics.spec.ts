import { expect, test } from "@playwright/test";
import { importPackage, openCase, submitCase } from "./helpers";

test("one confirmation submits a two-layer negative finding", async ({ page }) => {
  await importPackage(page, "multi_editable", "pkg-scenario-c", "decision-completion");
  await openCase(page, { task: "annotate" });
  await expect(page.getByRole("button", { name: /verified/i })).toHaveCount(0);
  await submitCase(page);
});

test("defaulted warning reveals a hidden result and an explicit axis confirmation clears it", async ({ page }) => {
  await importPackage(page, "decisions", "pkg-defaulted-decisions", "defaulted-reviewer");
  await openCase(page, { task: "review" });
  const proposal = page.locator('.sidebar [data-list-key^="target:"]').first();
  await proposal.click(); await page.keyboard.press("1");
  await expect(proposal).toContainText("Confirmed");
  await page.locator('.sidebar [data-list-key^="target:"]').nth(1).click();
  await page.keyboard.press("2");
  await expect(page.locator('.sidebar [data-list-key^="target:"]').nth(1)).toContainText("Rejected");
  await page.getByRole("button", { name: /Finish & Submit Case/i }).click();
  await expect(page.getByText("1 annotations have defaulted axis values.")).toBeVisible();
  await page.getByRole("button", { name: "Review defaulted annotations" }).click();
  await expect(page.getByRole("checkbox", { name: "Visibility for Hidden findings" })).toBeChecked();
  await expect(page.getByLabel("Proposal details")).toBeFocused();
  await page.getByRole("button", { name: /Edit & Replace/i }).click();
  await page.getByRole("button", { name: "Reset decision and edit copy" }).click();
  await page.getByRole("button", { name: "Confirm Assertion value" }).click();
  await expect(page.getByText("Default value; confirm it or choose a value.")).toHaveCount(0);
  await page.getByRole("button", { name: /Finish & Submit Case/i }).click();
  await expect(page.getByRole("button", { name: "Review defaulted annotations" })).toHaveCount(0);
});

test("repeated outcome keys keep decisions and zero resets without losing the note", async ({ page }) => {
  await importPackage(page, "single", "browser-fixture", "stable-key-reviewer");
  await openCase(page, { task: "review" });
  const proposal = page.locator('.sidebar [data-list-key^="target:"]').first();
  await proposal.click();
  for (const [key, label] of [["1", "Confirmed"], ["2", "Rejected"], ["4", "Uncertain"]]) {
    await page.keyboard.press(key); await expect(proposal).toContainText(label);
    await page.keyboard.press(key); await expect(proposal).toContainText(label);
  }
  const note = page.getByRole("textbox", { name: "Reviewer note" });
  await note.fill("Preserve this note");
  await note.press("1"); await expect(proposal).toContainText("Uncertain");
  await note.fill("Preserve this note");
  await page.locator(".review-actions__title").click();
  await page.keyboard.press("0"); await expect(proposal).toContainText("open");
  await expect(note).toHaveValue("Preserve this note");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", isComposing: true, bubbles: true })));
  await expect(proposal).toContainText("open");
  await page.getByRole("button", { name: /Finish & Submit Case/i }).click();
  await expect(page.getByRole("dialog", { name: "Submit case" })).toBeVisible();
  await page.keyboard.press("1"); await page.keyboard.press("Escape");
  await expect(proposal).toContainText("open");
});
