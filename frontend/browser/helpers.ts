import { expect, type Page } from "@playwright/test";

export const LAUNCH_URL = "/#token=browser-test-token";

/**
 * Click the single "Open case" action. The first open in a page session must
 * ask "You are annotating as <identity>" (required identity confirmation);
 * later opens in the same page session must not ask again.
 */
export async function openCase(page: Page, opts: { identity?: string } = {}) {
  await page.getByRole("button", { name: /^Open case$/i }).click();
  if (opts.identity) {
    const dialog = page.getByRole("dialog", { name: new RegExp(`You are annotating as ${opts.identity}`) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Yes, continue/i }).click();
  }
  await expect(page.locator(".status-badge")).toBeVisible();
}

/** Import a synthetic package through the dashboard and enter the identity. */
export async function importPackage(page: Page, query: string, packageId: string, annotator: string) {
  await page.goto(LAUNCH_URL);
  const fixture = await page.request.get(`/__synthetic_fixture__${query}`);
  expect(fixture.ok()).toBeTruthy();
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: "synthetic.zip",
    mimeType: "application/zip",
    buffer: await fixture.body(),
  });
  await expect(page.getByRole("status", { name: "Import result" })).toContainText(`Package '${packageId}' imported`);
  await expect(page.locator("#package-select")).toHaveValue(packageId);
  const identity = page.getByLabel(/Your initials \/ ID/i);
  await identity.fill(annotator);
  await identity.press("Enter");
  await expect(page.getByTestId("dashboard-identity")).toHaveText(annotator);
}

/** "Finish & Submit Case", tick "Entire text checked" and confirm. */
export async function submitCase(page: Page) {
  await page.getByRole("button", { name: /Finish & Submit Case/i }).click();
  const dialog = page.getByRole("dialog", { name: "Submit case" });
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", { name: /^Submit case$/ });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Entire text checked for further findings/i).check();
  await submit.click();
  await expect(page.getByRole("dialog", { name: "Case submitted" })).toContainText(/Case successfully submitted/i);
}

/** Select document text by UTF-16 offsets and fire the mouseup the editor listens to. */
export async function selectText(page: Page, start: number, end: number) {
  await page.locator(".text-container").evaluate((container, offsets) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let position = 0;
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (!started && offsets.start < position + length) {
        range.setStart(node, offsets.start - position);
        started = true;
      }
      if (started && offsets.end <= position + length) {
        range.setEnd(node, offsets.end - position);
        break;
      }
      position += length;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, { start, end });
}

/** The evidence mention whose offsets are exactly ``ranges`` (shown as tooltip). */
export const mentionWithOffsets = (page: Page, ranges: string) =>
  page.locator(".mention-snippet").and(page.getByTitle(`Offsets: ${ranges}`, { exact: true }));
