import { expect, test } from "@playwright/test";
import { authenticatedRequest, importPackage, openCase, submitCase } from "./helpers";

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
  await page.getByRole("textbox", { name: "Reviewer note" }).fill("Initial reviewer note");
  await page.locator(".review-actions__title").click();
  for (const [key, label] of [["1", "Confirmed"], ["2", "Rejected"], ["4", "Unresolved"]]) {
    await page.keyboard.press(key); await expect(proposal).toContainText(label);
    await page.keyboard.press(key); await expect(proposal).toContainText(label);
  }
  const note = page.getByRole("textbox", { name: "Reviewer note" });
  await note.fill("Preserve this note");
  await note.press("1"); await expect(proposal).toContainText("Unresolved");
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


test("unresolved notes are required, survive reload and block submission when locally cleared", async ({ page }) => {
  await importPackage(page, "single", "browser-fixture", "unresolved-note-reviewer");
  await openCase(page, { task: "review" });
  const proposals = page.locator('.sidebar [data-list-key^="target:"]');
  await proposals.first().click();
  const note = page.getByRole("textbox", { name: "Reviewer note" });
  await page.getByRole("button", { name: /Unresolved/ }).click();
  await expect(proposals.first()).toContainText("open"); await expect(note).toBeFocused();
  await expect(note).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({ path: "../.superpowers/sdd/2026-10-17-phase0-priorities/b02-unresolved-note-required.png", fullPage: true });
  await page.locator(".review-actions__title").click(); await page.keyboard.press("4");
  await expect(note).toBeFocused(); await expect(proposals.first()).toContainText("open");
  await note.fill("Needs specialist review"); await page.locator(".review-actions__title").click();
  await page.keyboard.press("4"); await expect(proposals.first()).toContainText("Unresolved");
  await proposals.nth(1).click(); await page.keyboard.press("1");
  await expect(proposals.nth(1)).toContainText("Confirmed");
  await proposals.first().click(); await note.fill("  "); await proposals.nth(1).click();
  await page.getByRole("button", { name: /Finish & Submit Case/ }).click();
  await expect(page.getByRole("dialog", { name: "Submit case" })).toHaveCount(0);
  await expect(note).toBeFocused(); await expect(note).toHaveValue("  ");
  await expect(page.locator(".status-badge")).toHaveText("Reviewer note required – changes not saved");
  await page.getByRole("button", { name: "← My tasks" }).click();
  await expect(page.getByRole("dialog", { name: "Changes not saved" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(note).toBeFocused(); await expect(note).toHaveValue("  ");
  const savedNote = page.waitForResponse(r => r.url().endsWith("/decisions") && r.request().method() === "POST");
  await note.fill("Corrected reviewer reason"); await page.locator(".review-actions__title").click();
  const savedResponse = await savedNote; expect(savedResponse.ok()).toBeTruthy();
  const saved = await savedResponse.json();
  const unresolved = saved.decisions.find((d: { outcome: string }) => d.outcome === "uncertain");
  const bypass = await authenticatedRequest(page, new URL(savedResponse.url()).pathname, "POST", {
    mutation_id: "blank-note-bypass", expected_revision: saved.revision,
    payload: { target: unresolved.target, outcome: "uncertain", note: " " },
  });
  expect(bypass.status()).toBe(422); expect((await bypass.json()).code).toBe("REVIEW_NOTE_REQUIRED");
  await page.reload(); await proposals.first().click();
  await expect(note).toHaveValue("Corrected reviewer reason"); await expect(proposals.first()).toContainText("Unresolved");
  const submitted = page.waitForResponse(r => r.url().endsWith("/submit") && r.request().method() === "POST");
  await submitCase(page);
  const submission = await (await submitted).json();
  expect(submission.decisions.find((d: { outcome: string }) => d.outcome === "uncertain").note).toBe("Corrected reviewer reason");
  expect(submission.snapshots).toHaveLength(1);
});
