import { expect, type Page } from "@playwright/test";
import type { TaskSummary } from "../src/api/client";

export const LAUNCH_URL = "/";
/** My tasks on the "All" tab; the login helpers start here so the last-used landing never redirects them. */
export const TASKS_HOME = "/#/?status=all";

/**
 * A fresh load of the app (as `goto("/")` always was) that starts on My tasks "All": the hash is set
 * before logging in, so the last-used landing (F8) never redirects the login helpers. A plain
 * `goto(TASKS_HOME)` from another "/#/…" address would only change the hash of the running app.
 */
export async function openTasksHome(page: Page) {
  await page.goto(LAUNCH_URL);
  await page.evaluate(home => window.history.replaceState(null, "", home), TASKS_HOME.slice(1));
}

/** The password ``tests/browser_server.py`` sets for every test user. */
export const TEST_PASSWORD = "browser test passphrase";

/** The username of a test user: the pseudonym, lower-cased, other characters as "-". */
export const usernameFor = (pseudonym: string) => pseudonym.toLowerCase().replace(/[^a-z0-9._-]/g, "-");

/** Log in an already provisioned ordinary account without adding any roles/work. */
export async function loginExisting(page: Page, username: string) {
  await openTasksHome(page);
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username", { exact: true }).fill(username);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  // The shell shows "Display name (pseudonym)", never the username (D1); the
  // session itself must belong to ``username``.
  await expect(page.getByTestId("current-user")).toBeVisible();
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  const identity = await me.json() as { username: string; pseudonym: string };
  expect(identity.username).toBe(username);
  await expect(page.getByTestId("current-user")).toContainText(identity.pseudonym);
}

/** Current page cookies and freshly read CSRF token; never a second actor context. */
export async function authenticatedRequest(page: Page, path: string, method = "GET", data?: unknown) {
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  const identity = await me.json() as { csrf_token: string };
  return page.request.fetch(path, { method, data, headers: {
    Origin: new URL(page.url()).origin,
    ...(method === "GET" ? {} : { "X-CSRF-Token": identity.csrf_token }),
  } });
}

/**
 * Create the user ``pseudonym`` with every role in ``projects`` (idempotent;
 * test-only route of the browser server) and log in through the login screen.
 */
export async function loginAs(page: Page, pseudonym: string, projects: string[] = [], options: { proposals?: boolean } = {}) {
  const username = usernameFor(pseudonym);
  const query = new URLSearchParams({ username, pseudonym });
  if (projects.length) query.set("projects", projects.join(","));
  if (options.proposals) query.set("proposals", "true");
  const created = await page.request.post(`/__test_user__?${query.toString()}`);
  expect(created.ok()).toBeTruthy();
  await openTasksHome(page);
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username").fill(username);
  await form.getByLabel("Password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(pseudonym);
}

/** Open an actual assigned task, retaining the server's row order. */
export async function openCase(page: Page, options: { task?: "annotate" | "review"; documentId?: string; projectKey?: string } = {}) {
  const task = options.task ?? "annotate";
  const response = await page.request.get("/api/v1/me/tasks");
  expect(response.ok()).toBeTruthy();
  const tasks = await response.json() as TaskSummary[];
  const projectFilter = options.projectKey ?? new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("project") ?? undefined;
  const candidates = tasks.filter(row => row.task === task && (projectFilter === undefined || row.project_key === projectFilter)
    && (options.documentId === undefined || row.document_id === options.documentId));
  if (projectFilter === undefined) expect(new Set(candidates.map(row => row.project_key)).size, "Choose an exact project for ambiguous task lists").toBe(1);
  const selected = candidates[0];
  expect(selected, "A current assignment must match the exact project/internal document/task").toBeDefined();
  const documentId = options.documentId ?? selected.document_id;
  const projectKey = projectFilter ?? selected.project_key;
  const assignment = tasks.find(row => row.project_key === projectKey && row.document_id === documentId && row.task === task)!;
  await page.locator(`a[href="#/tasks/${assignment.assignment_id}"]`).click();
  await expect(page.locator(".status-badge")).toBeVisible();
}

/**
 * Log in as ``annotator`` with every role in the seeded project ``projectKey``
 * and filter My tasks. The browser server seeds every scenario at
 * start-up (``_scenario`` names the one the spec relies on).
 */
export async function importPackage(page: Page, _scenario: string, projectKey: string, annotator: string, options: { proposals?: boolean } = {}) {
  await loginAs(page, annotator, [projectKey], options);
  await page.goto(`${LAUNCH_URL}#/?project=${encodeURIComponent(projectKey)}`);
  await expect(page.locator("#project-select")).toBeVisible();
  await expect(page.locator("#project-select")).toHaveValue(projectKey);
}

/** "Finish & Submit Case" (or "Finish & Submit (n open)"), acknowledge open values and confirm. */
export async function submitCase(page: Page) {
  await page.getByRole("button", { name: /^Finish & Submit/ }).click();
  const dialog = page.getByRole("dialog", { name: "Submit case" });
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", { name: /^Submit case$/ });
  // Unconfirmed values (defaults or empty) are acknowledged in one tick; the dialog resends once.
  const acknowledgement = dialog.getByRole("checkbox", { name: /^Submit with \d+ unconfirmed values?$/ });
  if (await acknowledgement.isVisible()) {
    await expect(submit).toBeDisabled();
    await acknowledgement.check();
  }
  await submit.click();
  await expect(page.getByRole("dialog", { name: "Case submitted" })).toContainText(/Submitted \d/);
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
