import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { selectText, submitCase, TEST_PASSWORD } from "./helpers";

interface Actor { username: string; code: string }
interface ProjectSetup { key: string; lead: Actor; annotator: Actor }

async function redeemCode(page: Page, actor: Actor) {
  await page.goto("/");
  await page.getByRole("button", { name: "I have a setup or reset code" }).click();
  const form = page.getByRole("form", { name: "Set your password" });
  await form.getByLabel("Username", { exact: true }).fill(actor.username);
  await form.getByLabel("Setup or reset code").fill(actor.code);
  await form.getByLabel("New password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByLabel("Repeat the new password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Set password and log in" }).click();
  await expect(page.getByTestId("current-user")).toContainText(actor.username);
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("form", { name: "Log in to Ontocurator" })).toBeVisible();
}

async function loginExisting(page: Page, actor: Actor) {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username", { exact: true }).fill(actor.username);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(actor.username);
}

async function createUser(page: Page, username: string): Promise<Actor> {
  const form = page.getByRole("form", { name: "New user" });
  await form.getByLabel(/^Username/).fill(username);
  await form.getByLabel(/^Display name/).fill(username);
  await form.getByLabel("Languages", { exact: true }).fill("en");
  await form.getByLabel("Languages", { exact: true }).press("Enter");
  await form.getByRole("button", { name: "Create user", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Setup code", exact: true });
  await expect(dialog).toBeVisible();
  const code = await dialog.locator("code").innerText();
  expect(code.length).toBeGreaterThan(0);
  // The header close is hidden until acknowledgement; the footer Close is the acknowledgement-gated action.
  const close = dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeDisabled();
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("I have handed over or stored the code").check();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Users", exact: true })).toContainText(username);
  return { username, code };
}

async function createProjectThroughUi(page: Page): Promise<ProjectSetup> {
  // Each scenario owns its administrator, ordinary accounts and project. Only
  // the administrator uses fixture provisioning; all ordinary roles are real UI writes.
  const suffix = randomUUID().slice(0, 8);
  const username = `ui-admin-${suffix}`;
  const bootstrap = await page.request.post("/__test_user__", { params: {
    username, pseudonym: username, system_admin: "true", setup: "true", assign: "none",
  } });
  expect(bootstrap.ok()).toBeTruthy();
  const issued = await bootstrap.json() as { code: string };
  await redeemCode(page, { username, code: issued.code });
  await page.getByRole("link", { name: "Ontologies", exact: true }).click();
  await page.getByLabel("Ontology files", { exact: true }).and(page.locator('input[type="file"]')).setInputFiles(
    fileURLToPath(new URL("../../tests/fixtures/hp.json", import.meta.url)),
  );
  await page.getByRole("button", { name: "Upload files", exact: true }).click();
  await expect(page.getByRole("table", { name: "Upload results", exact: true })).toContainText("hp.json");
  // The fixture has the exact same ontology already: the server, not the UI, reports deduplication.
  await expect(page.getByRole("table", { name: "Upload results", exact: true })).toContainText("Already present");
  await page.getByRole("link", { name: "Users", exact: true }).click();
  const lead = await createUser(page, `ui-lead-${suffix}`);
  const annotator = await createUser(page, `ui-ann-${suffix}`);

  const key = `ui-project-${suffix}`;
  await page.getByRole("link", { name: "New project", exact: true }).click();
  await page.getByLabel(/^Project key/).fill(key);
  await page.getByLabel(/^Name \(required\)/).fill(`Browser project ${suffix}`);
  await page.getByLabel("Document languages", { exact: true }).fill("en");
  await page.getByLabel("Document languages", { exact: true }).press("Enter");
  await page.getByLabel(/^Built-in template/).selectOption("hpo-phenotype");
  const versions = page.getByLabel(/^Ontology file for HP/);
  const ontology = versions.locator("option").filter({ hasText: "2026-06-23" }).first();
  await expect(ontology).toHaveCount(1);
  const sha = await ontology.getAttribute("value");
  expect(sha).toMatch(/^[0-9a-f]{64}$/);
  await versions.selectOption(sha!);
  await page.getByLabel("Allowed roots for HP", { exact: true }).fill("HP:0000118");
  await page.getByLabel("T1 profile for HP", { exact: true }).selectOption("hpo-phenotype");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/projects/${key}/settings$`));
  const members = page.getByRole("form", { name: "Add member", exact: true });
  for (const [actor, role] of [[lead, "Project lead"], [annotator, "Annotator"]] as const) {
    await members.getByLabel(/^Username/).fill(actor.username);
    await members.getByRole("checkbox", { name: `New member: ${role}`, exact: true }).check();
    await members.getByRole("button", { name: "Add member", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: `${actor.username}: ${role}`, exact: true })).toBeChecked();
  }
  return { key, lead, annotator };
}

async function selectProject(page: Page, key: string) {
  await page.locator(".shell-project-trigger").click();
  await page.locator(`#shell-project-panel a[href="#/projects/${encodeURIComponent(key)}/documents"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/projects/${key}/documents$`));
  await expect(page.locator("#shell-project-panel")).toBeHidden();
}

/** Disclosure of the Documents row of one text in English ("Show details, {text} · en"). */
const rowDisclosure = (page: Page, caseId: string) =>
  page.getByRole("button", { name: `Show details, ${caseId} · en`, exact: true });

/** Rows not in the work plan sit behind the case's "en not in plan · show" line. */
async function showNotInPlan(page: Page, caseId: string) {
  const toggle = page.getByRole("button", { name: `Show en not in plan, ${caseId}`, exact: true });
  if (await toggle.count()) await toggle.click();
}

/** Expand the Documents row of a text and open its "Text versions" list (one version per text here). */
async function openTextVersions(page: Page, caseId: string) {
  await showNotInPlan(page, caseId);
  const disclosure = rowDisclosure(page, caseId);
  if ((await disclosure.getAttribute("aria-expanded")) !== "true") await disclosure.click();
  const area = page.getByRole("region", { name: `${caseId} · en`, exact: true });
  await area.locator("summary").filter({ hasText: /^Text versions \(\d+\)$/ }).click();
  const version = area.locator("li.text-version");
  await expect(version).toHaveCount(1);
  return version;
}

async function importTwoDocuments(page: Page) {
  await page.getByRole("button", { name: "Upload texts…", exact: true }).click();
  const upload = page.getByRole("dialog", { name: "Upload texts", exact: true });
  await upload.getByLabel("Format", { exact: true }).selectOption("text");
  await upload.getByLabel(/^Upload language/).selectOption("en");
  await upload.getByLabel(/^Files/).setInputFiles([
    { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("Hypotonia.\r\n") },
    { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("Seizures.\n") },
  ]);
  await upload.getByRole("button", { name: "Check", exact: true }).click();
  const preview = upload.getByRole("region", { name: "Upload preview", exact: true });
  await expect(preview).toContainText("2 documents added");
  await expect(preview).toContainText("1 with normalized text");
  const rows = page.getByRole("button", { name: /^Show details, / });
  await expect(rows).toHaveCount(0);
  await upload.getByRole("button", { name: "Import 2 texts", exact: true }).click();
  // The upload dialog closes itself after the import; Documents reports the result.
  await expect(upload).toHaveCount(0);
  await expect(page.locator(".ui-toast-message")).toHaveText("Imported 2 documents and 0 proposals.");
  // One row per text and language ("Nothing planned": behind "en not in plan · show"), both collapsed.
  for (const caseId of ["one", "two"]) await showNotInPlan(page, caseId);
  await expect(rows).toHaveCount(2);
  for (const caseId of ["one", "two"]) await expect(rowDisclosure(page, caseId)).toHaveAttribute("aria-expanded", "false");
}

async function distributeAndSubmit(page: Page, setup: ProjectSetup) {
  await logout(page);
  await redeemCode(page, setup.lead);
  await selectProject(page, setup.key);
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await importTwoDocuments(page);
  // Plan annotation for "one" (its row is not in the plan after the import), then assign it
  // through the row's Assign dialog and its seeded "Random distribution…".
  const table = page.getByRole("table", { name: "Documents", exact: true });
  const annotate = table.getByRole("button", { name: "Annotate, one · en", exact: true });
  if ((await annotate.getAttribute("aria-pressed")) !== "true") await annotate.click();
  await expect(annotate).toHaveAttribute("aria-pressed", "true");
  await table.getByRole("button", { name: "Assign annotation…, one · en", exact: true }).click();
  const assign = page.getByRole("dialog", { name: "Assign annotation", exact: true });
  await assign.getByRole("button", { name: "Random distribution…", exact: true }).click();
  const distribution = page.getByRole("dialog", { name: "Propose distribution", exact: true });
  await distribution.getByRole("button", { name: "Propose", exact: true }).click();
  await expect(distribution.getByRole("combobox", { name: "one, slot 1", exact: true })).toHaveValue(setup.annotator.username);
  await distribution.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(distribution).toContainText("Assignment request complete: 1 accepted; 0 refused.");
  await distribution.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(distribution).toHaveCount(0);
  if (await assign.count()) await assign.getByRole("button", { name: "Cancel", exact: true }).click();
  await logout(page);
  await redeemCode(page, setup.annotator);
  const tasks = page.getByTestId("task-row");
  await expect(tasks).toHaveCount(1);
  // My tasks names the text as "{case ID} · {language}".
  await expect(tasks).toContainText("one · en");
  await expect(page.getByTestId("task-row").filter({ hasText: "two · en" })).toHaveCount(0);
  await tasks.getByRole("link", { name: /^(Start|Continue|View)$/ }).click();
  await selectText(page, 0, 9);
  await page.getByLabel("Search ontology term").fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).first().click();
  for (const [axis, value] of [["Assertion", "Present"], ["Experiencer", "Patient"], ["Temporality", "Current"]]) {
    const choice = page.getByRole("group", { name: new RegExp(`^${axis}`) }).getByRole("radio", { name: value, exact: true });
    // Controlled axes reflect the asynchronous server response, as in design.spec.ts.
    await choice.click();
    await expect(choice).toBeChecked();
    await expect(page.locator(".status-badge")).toHaveClass(/status-saved/);
  }
  await submitCase(page);
}

test.describe("Administration through real accounts and jobs", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("admin sets up a project with real setup-code handovers", async ({ page }) => {
    const setup = await createProjectThroughUi(page);
    await page.getByRole("link", { name: "Ontologies", exact: true }).click();
    await expect(page.getByRole("table", { name: "Ontology files", exact: true })
      .getByRole("link", { name: setup.key, exact: true })).toBeVisible();
    await logout(page);
    for (const actor of [setup.lead, setup.annotator]) {
      await redeemCode(page, actor);
      // D7: a lead lands on Documents of the led project; an annotator on My tasks.
      if (actor === setup.lead) await expect(page.getByRole("heading", { name: "No texts yet", exact: true })).toBeVisible();
      else await expect(page.getByRole("heading", { name: "No documents are assigned to you yet." })).toBeVisible();
      await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0);
      await logout(page);
    }
  });

  test("lead uploads plain text with a preview before importing", async ({ page }) => {
    const setup = await createProjectThroughUi(page);
    await logout(page);
    const adminRequests: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/v1/admin/")) adminRequests.push(request.url());
    });
    await redeemCode(page, setup.lead);
    await selectProject(page, setup.key);
    await page.getByRole("link", { name: "Documents", exact: true }).click();
    await importTwoDocuments(page);
    expect(adminRequests).toEqual([]);
  });

  test("lead distributes one document, observes submission and reopens it", async ({ page }) => {
    const setup = await createProjectThroughUi(page);
    await distributeAndSubmit(page, setup);
    await page.getByRole("dialog", { name: "Case submitted", exact: true })
      .getByRole("button", { name: "Back to my tasks", exact: true }).click();
    const tasks = page.getByTestId("task-row");
    await expect(tasks).toHaveCount(1);
    await expect(tasks).toContainText("Submitted");
    await tasks.getByRole("link", { name: /^(Start|Continue|View)$/ }).click();
    await page.reload();
    await expect(page.getByText("Submitted. The project lead can reopen it for changes.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Finish & Submit/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add finding without a text span", exact: true })).toBeDisabled();
    await logout(page);
    await loginExisting(page, setup.lead);
    await selectProject(page, setup.key);
    await page.getByRole("link", { name: "Progress", exact: true }).click();
    const people = page.getByRole("table", { name: "People", exact: true });
    const row = people.getByRole("row").filter({ hasText: setup.annotator.username });
    await expect(row).toBeVisible();
    const submittedColumn = (await people.getByRole("columnheader").allTextContents()).indexOf("Submitted");
    expect(submittedColumn).toBeGreaterThanOrEqual(0);
    // The person is the row header, not a cell: cells start after it.
    const headers = await row.getByRole("rowheader").count();
    await expect(row.getByRole("cell").nth(submittedColumn - headers)).toHaveText("1");
    await page.getByRole("link", { name: "Documents", exact: true }).click();
    const document = await openTextVersions(page, "one");
    await document.locator('summary[aria-label^="Actions for "]').click();
    await document.getByRole("button", { name: "Reopen", exact: true }).click();
    const reopen = page.getByRole("dialog", { name: "Reopen one", exact: true });
    await reopen.getByLabel("Reason (optional)").fill("Check this finding again.");
    await reopen.getByRole("button", { name: "Reopen assignment", exact: true }).click();
    await expect(reopen).toHaveCount(0);
    await expect(document).toContainText("Reopened");
    await logout(page);
    await loginExisting(page, setup.annotator);
    await expect(page.getByTestId("task-row")).toHaveCount(1);
    await expect(page.getByTestId("task-row")).toContainText("Reopened");
  });

  test("lead downloads real T1 and edit-log exports; annotator access is refused", async ({ page }) => {
    const setup = await createProjectThroughUi(page);
    await distributeAndSubmit(page, setup);
    await page.getByRole("dialog", { name: "Case submitted", exact: true })
      .getByRole("button", { name: "Back to my tasks", exact: true }).click();
    await logout(page);
    await loginExisting(page, setup.lead);
    await selectProject(page, setup.key);
    await page.getByRole("link", { name: "Export", exact: true }).click();
    const bundle = page.getByRole("region", { name: "Annotation results", exact: true });
    await bundle.getByRole("button", { name: "Create export", exact: true }).click();
    await expect(bundle.getByRole("button", { name: "Download", exact: true })).toBeVisible();
    await page.reload();
    await expect(bundle.getByRole("button", { name: "Download", exact: true })).toBeVisible();
    const [zip] = await Promise.all([
      page.waitForEvent("download"), bundle.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    expect(zip.suggestedFilename()).toMatch(/\.zip$/);
    expect(await zip.failure()).toBeNull();
    const zipPath = await zip.path();
    expect(zipPath).not.toBeNull();
    const archive = readFileSync(zipPath!);
    expect(archive.length).toBeGreaterThan(22);
    expect(archive.subarray(0, 2).toString("ascii")).toBe("PK");
    const log = page.getByRole("region", { name: "Edit log", exact: true });
    await log.getByRole("button", { name: "Create export", exact: true }).click();
    const [jsonl] = await Promise.all([
      page.waitForEvent("download"), log.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    expect(jsonl.suggestedFilename()).toMatch(/\.jsonl$/);
    expect(await jsonl.failure()).toBeNull();
    const logPath = await jsonl.path();
    expect(logPath).not.toBeNull();
    const lines = readFileSync(logPath!, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(typeof JSON.parse(line)).toBe("object");
    await logout(page);
    await loginExisting(page, setup.annotator);
    await page.goto(`/#/projects/${setup.key}/export`);
    await expect(page.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
    const [denied] = await Promise.all([
      page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/projects/${setup.key}/exports`)),
      bundle.getByRole("button", { name: "Create export", exact: true }).click(),
    ]);
    expect(denied.status()).toBe(403);
    await expect(bundle).toContainText("You do not have access to this page.");
  });
});
