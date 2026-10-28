/**
 * The "Upload texts" dialog with a 185-text bundle (issue 128): fixed footer, the body as the only
 * scroll area, the result line focused after Check, a short Tab path to Import, no internal IDs
 * outside "Technical details", the paged text list, and "Unfinished uploads (n)".
 *
 * Every test builds a fresh project through ``POST /__test_lead_workflow__?scenario=UPLOAD_DIALOG``
 * (62 cases: en sources with tool proposals, de and fr machine translations; fr is not a project
 * language). Set ``UPLOAD_DIALOG_SHOTS`` to a directory to save screenshots for human review.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticatedRequest, TEST_PASSWORD } from "./helpers";
import { leadScenario, type LeadScenario } from "./leadWorkflowHelpers";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const shotsDir = process.env.UPLOAD_DIALOG_SHOTS;
async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  const size = page.viewportSize();
  await page.screenshot({ path: resolve(shotsDir, `${size?.width}x${size?.height}-${name}.png`) });
}
function record(name: string, data: unknown) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(resolve(shotsDir, `${name}.json`), JSON.stringify(data, null, 2));
}

async function loginLead(page: Page, s: LeadScenario) {
  await page.goto("/");
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [`ontotator.lastProject.v1:${s.users.lead}`, s.project]);
  const form = page.getByRole("form", { name: "Log in to Ontotator" });
  await form.getByLabel("Username", { exact: true }).fill(s.users.lead);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
}

const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Upload texts", exact: true });
const footerOf = (dialog: Locator) => dialog.locator(".modal-actions");

async function openDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Upload texts…", exact: true }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Choose the bundle, Check and wait for the focused result line. */
async function checkBundle(page: Page, s: LeadScenario): Promise<{ dialog: Locator; line: Locator }> {
  const dialog = await openDialog(page);
  await expect(dialog.getByLabel("Format", { exact: true })).toBeVisible();
  await dialog.locator("input[type=file]").setInputFiles(s.bundle_path!);
  await expect(dialog.getByRole("list", { name: "Chosen files" })).toContainText(".zip");
  await shot(page, "1-choose-files");
  await footerOf(dialog).getByRole("button", { name: "Check", exact: true }).click();
  // The check can finish before the status line is seen; it is captured when it is.
  if (await dialog.getByText("Checking 1 file …", { exact: true }).waitFor({ timeout: 5_000 }).then(() => true, () => false)) await shot(page, "2-checking");
  const line = dialog.getByText("Checked 1 file: ready to import.", { exact: true });
  await expect(line).toBeVisible({ timeout: 90_000 });
  return { dialog, line };
}

async function tabsTo(page: Page, target: Locator, limit = 60): Promise<number> {
  for (let presses = 1; presses <= limit; presses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(element => element === document.activeElement)) return presses;
  }
  return -1;
}

for (const size of [{ width: 1280, height: 800 }, { width: 1600, height: 900 }]) {
  test(`185-text bundle at ${size.width}×${size.height}: compact preview, focused result, short Tab path, import`, async ({ page }) => {
    await page.setViewportSize(size);
    const s = await leadScenario(page, "UPLOAD_DIALOG");
    await loginLead(page, s);
    const { dialog, line } = await checkBundle(page, s);

    // After Check the focus is on the result line, a status message.
    await expect(line).toHaveAttribute("role", "status");
    await expect(line).toBeFocused();
    await shot(page, "3-preview");

    // The body is the only scroll area; with the disclosures closed it stays short.
    const body = dialog.locator(".ui-dialog-body");
    const scrollHeight = await body.evaluate(element => element.scrollHeight);
    const importButton = footerOf(dialog).getByRole("button", { name: "Import 62 cases", exact: true });
    await expect(importButton).toBeInViewport({ ratio: 1 });
    const pageScroll = await page.evaluate(() => document.scrollingElement!.scrollTop);
    expect(pageScroll).toBe(0);
    await expect(footerOf(dialog).getByRole("button")).toHaveText(["Cancel", "Discard", "Import 62 cases"]);
    await line.focus();
    const tabs = await tabsTo(page, importButton);
    record(`acceptance-${size.width}x${size.height}`, { scrollHeight, tabsFromResultToImport: tabs });
    expect(scrollHeight).toBeLessThanOrEqual(1300);
    expect(tabs).toBeGreaterThan(0);
    expect(tabs).toBeLessThanOrEqual(15);

    // Summary and notes; fr is not a project language: a warning line, no refusal.
    const preview = dialog.getByRole("region", { name: "Upload preview", exact: true });
    await expect(preview.locator(".upload-summary")).toContainText("Cases62");
    await expect(preview.locator(".upload-summary")).toContainText("de 62, en 62, fr 61");
    await expect(preview.getByText("fr is not a project language: 61 texts will be imported anyway.")).toBeVisible();
    await expect(preview.getByText(/translations? failed an automatic check\./)).toBeVisible();
    await expect(preview.getByRole("region", { name: "Proposal sources" })).toContainText("124 proposals in 62 texts");
    // No internal identifiers outside an open "Technical details", and no "None" cells.
    const upload = (await (await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/uploads?status=ready`)).json() as { id: number; plan_sha256: string }[])[0];
    const visible = await dialog.innerText();
    expect(visible).not.toContain(upload.plan_sha256.slice(0, 12));
    expect(visible).not.toMatch(/\bUpload \d+\b|\bNone\b|run-case-|bundle-lead-/);

    // The text list: collapsed, then 25 rows per page with filters.
    await preview.getByText("Texts in this upload (185)", { exact: true }).click();
    const table = preview.getByRole("table", { name: "Texts in this upload" });
    await expect(table.getByRole("row")).toHaveCount(26);
    await expect(preview.getByText("1–25 of 185 texts", { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Next", exact: true }).click();
    await expect(preview.getByText("26–50 of 185 texts", { exact: true })).toBeVisible();
    await preview.getByLabel("Show", { exact: true }).selectOption("failed");
    await expect(table).toContainText("Units added in translation");
    await preview.getByLabel("Case ID", { exact: true }).fill("case-0304");
    await expect(preview.getByText(/^1–\d of \d texts?$/)).toBeVisible();
    await shot(page, "3b-preview-texts-open");
    await preview.getByText("Technical details", { exact: true }).click();
    await expect(preview.locator(".upload-technical-body")).toContainText(upload.plan_sha256);
    await preview.getByText("Technical details", { exact: true }).evaluate(element => element.scrollIntoView({ block: "start" }));
    await shot(page, "3c-technical-details");
    await preview.getByText("Technical details", { exact: true }).click();
    await preview.getByText("Texts in this upload (185)", { exact: true }).click();

    // Cancel keeps the upload: "Unfinished uploads (1)" opens it again.
    await footerOf(dialog).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const again = await openDialog(page);
    await again.getByText("Unfinished uploads (1)", { exact: true }).click();
    await expect(again.locator(".upload-unfinished-list")).toContainText(/Started .*\.zip/);
    await shot(page, "7-unfinished-uploads");
    await again.getByRole("button", { name: "Open preview", exact: true }).click();
    await expect(again.getByText("Checked 1 file: ready to import.", { exact: true })).toBeFocused();

    // Import: the progress line, only Close; then the dialog closes itself and Documents shows the toast.
    await footerOf(again).getByRole("button", { name: "Import 62 cases", exact: true }).click();
    await expect(again.getByText(/^Importing 62 cases …/)).toBeVisible();
    await expect(footerOf(again).getByRole("button")).toHaveText(["Close"]);
    await shot(page, "5-importing");
    await expect(again).toHaveCount(0, { timeout: 120_000 });
    await expect(page.locator(".ui-toast-message")).toHaveText("Imported 185 documents and 124 proposals.");
    await shot(page, "5b-imported-toast");

    // A committed upload is not listed any more.
    const after = await openDialog(page);
    await expect(after.getByLabel("Format", { exact: true })).toBeVisible();
    await expect(after.getByText(/^Unfinished uploads/)).toHaveCount(0);
  });
}

test("Discard returns to step 1 with the files kept; a discarded upload is not listed", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const s = await leadScenario(page, "UPLOAD_DIALOG");
  await loginLead(page, s);
  const { dialog } = await checkBundle(page, s);
  await footerOf(dialog).getByRole("button", { name: "Discard", exact: true }).click();
  const message = dialog.getByText("Upload discarded. Nothing was imported.", { exact: true });
  await expect(message).toBeFocused();
  await expect(dialog.getByRole("list", { name: "Chosen files" })).toContainText(".zip");
  await expect(dialog.getByText(/^Unfinished uploads/)).toHaveCount(0);
  await shot(page, "6-discarded");
});

test("plain text uploaded as a bundle: problems per file and a format switch", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const s = await leadScenario(page, "UPLOAD_DIALOG");
  await loginLead(page, s);
  const dialog = await openDialog(page);
  await dialog.locator("input[type=file]").setInputFiles([
    { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("Hypotonia.\n") },
    { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("Seizures.\n") },
  ]);
  await footerOf(dialog).getByRole("button", { name: "Check", exact: true }).click();
  const line = dialog.getByText("Checked 2 files: problems found. Nothing can be imported.", { exact: true });
  await expect(line).toBeFocused({ timeout: 60_000 });
  await expect(line).toHaveAttribute("role", "alert");
  await expect(dialog.getByRole("region", { name: "Problems in one.txt" })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Problems in two.txt" })).toBeVisible();
  await expect(dialog.getByText(/look like plain text/)).toBeVisible();
  await shot(page, "4-problems");
  await dialog.getByRole("button", { name: "Switch to Plain text", exact: true }).click();
  await expect(dialog.getByLabel("Format", { exact: true })).toHaveValue("text");
  await dialog.getByLabel(/^Upload language/).selectOption("en");
  await footerOf(dialog).getByRole("button", { name: "Check", exact: true }).click();
  await expect(dialog.getByText("Checked 2 files: ready to import.", { exact: true })).toBeFocused({ timeout: 60_000 });
  await expect(footerOf(dialog).getByRole("button", { name: "Import 2 texts", exact: true })).toBeVisible();
  // Plain text speaks of texts, not of a bundle or proposals.
  await expect(dialog.locator(".upload-summary")).not.toContainText("Proposals");
  await expect(dialog).not.toContainText("Versions in bundle");
});
