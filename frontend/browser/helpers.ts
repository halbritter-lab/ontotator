import { expect, type Page } from "@playwright/test";

export const LAUNCH_URL = "/";
/** The password ``tests/browser_server.py`` sets for every test user. */
export const TEST_PASSWORD = "browser test passphrase";

/** The username of a test user: the pseudonym, lower-cased, other characters as "-". */
export const usernameFor = (pseudonym: string) => pseudonym.toLowerCase().replace(/[^a-z0-9._-]/g, "-");

/**
 * Create the system admin ``pseudonym`` (idempotent; test-only route of the
 * browser server) and log in through the login screen.
 */
export async function loginAs(page: Page, pseudonym: string) {
  const username = usernameFor(pseudonym);
  const created = await page.request.post(
    `/__test_user__?username=${encodeURIComponent(username)}&pseudonym=${encodeURIComponent(pseudonym)}`,
  );
  expect(created.ok()).toBeTruthy();
  await page.goto(LAUNCH_URL);
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username").fill(username);
  await form.getByLabel("Password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(pseudonym);
}

/** Click the single "Open case" action; the identity comes from the session, so nothing asks. */
export async function openCase(page: Page) {
  await page.getByRole("button", { name: /^Open case$/i }).click();
  await expect(page.locator(".status-badge")).toBeVisible();
}

/** Log in as ``annotator`` and import a synthetic package through the dashboard. */
export async function importPackage(page: Page, query: string, packageId: string, annotator: string) {
  await loginAs(page, annotator);
  const fixture = await page.request.get(`/__synthetic_fixture__${query}`);
  expect(fixture.ok()).toBeTruthy();
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: "synthetic.zip",
    mimeType: "application/zip",
    buffer: await fixture.body(),
  });
  await expect(page.getByRole("status", { name: "Import result" })).toContainText(`Package '${packageId}' imported`);
  await expect(page.locator("#package-select")).toHaveValue(packageId);
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
