import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { documentsTab, openTextCard, rowAction, showSegment, textCard, textName, textNamePattern, textVersionItems } from "./documentsHelpers";
import { openTasksHome, selectText, submitCase, TASKS_HOME, TEST_PASSWORD } from "./helpers";

interface Actor { username: string; code: string }
interface ProjectSetup { key: string; lead: Actor; annotator: Actor }

async function redeemCode(page: Page, actor: Actor) {
  await openTasksHome(page);
  await page.getByRole("button", { name: "I have a setup or reset code" }).click();
  const form = page.getByRole("form", { name: "Set your password" });
  await form.getByLabel("Username", { exact: true }).fill(actor.username);
  await form.getByLabel("Setup or reset code").fill(actor.code);
  await form.getByLabel("New password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByLabel("Repeat the new password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Set password and log in" }).click();
  await expect(page.getByTestId("current-user")).toContainText(actor.username);
  // Setting the password leaves "#/?status=all"; without a last-used project the landing would open Projects.
  await page.goto(TASKS_HOME);
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("form", { name: "Log in to Ontotator" })).toBeVisible();
}

async function loginExisting(page: Page, actor: Actor) {
  await openTasksHome(page);
  const form = page.getByRole("form", { name: "Log in to Ontotator" });
  await form.getByLabel("Username", { exact: true }).fill(actor.username);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(actor.username);
}

async function createUser(page: Page, username: string): Promise<Actor> {
  await page.getByRole("button", { name: "New user…", exact: true }).click();
  const form = page.getByRole("form", { name: "New user" });
  await form.getByLabel(/^Username/).fill(username);
  await form.getByLabel(/^Display name/).fill(username);
  await form.getByLabel("Languages", { exact: true }).fill("en");
  await form.getByLabel("Languages", { exact: true }).press("Enter");
  await form.getByRole("button", { name: "Create user", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Setup code for " + username, exact: true });
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
  await page.getByLabel("Languages of the texts", { exact: true }).fill("en");
  await page.getByLabel("Languages of the texts", { exact: true }).press("Enter");
  await page.getByLabel(/^Built-in template/).selectOption("hpo-phenotype");
  const versions = page.getByLabel(/^Ontology file for HP/);
  const ontology = versions.locator("option").filter({ hasText: "2026-06-23" }).first();
  await expect(ontology).toHaveCount(1);
  const sha = await ontology.getAttribute("value");
  expect(sha).toMatch(/^[0-9a-f]{64}$/);
  await versions.selectOption(sha!);
  await page.getByLabel("Allowed roots for HP", { exact: true }).fill("HP:0000118");
  await page.getByLabel("Annotation scheme for HP", { exact: true }).selectOption("hpo-phenotype");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  // A new project opens its settings on People (M-8a, B6-1).
  await expect(page).toHaveURL(new RegExp(`#/projects/${key}/settings/people$`));
  await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "People", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Add member…", exact: true }).click();
  const members = page.getByRole("form", { name: "Add member", exact: true });
  for (const [actor, role] of [[lead, "Lead"], [annotator, "Annotator"]] as const) {
    await members.getByLabel(/^Username/).fill(actor.username);
    await members.getByRole("checkbox", { name: `New member: ${role}`, exact: true }).check();
    await members.getByRole("button", { name: "Add member", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: `${actor.username}: ${role}`, exact: true })).toBeChecked();
  }
  return { key, lead, annotator };
}

async function selectProject(page: Page, key: string) {
  // Login goes to My tasks (TASKS_HOME); the sidebar project switcher opens Documents of a led project.
  await expect(page.getByText("Loading your projects…", { exact: true })).toHaveCount(0);
  if (new RegExp(`#/projects/${key}/documents(\\?|$)`).test(page.url())) return;
  await page.locator(".project-switcher").click();
  const dialog = page.getByRole("dialog", { name: "Switch project" });
  await dialog.locator(`a[href="#/projects/${encodeURIComponent(key)}/documents"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/projects/${key}/documents$`));
  await expect(dialog).toBeHidden();
}

/** The navigation link "Documents", with the decision counter "Documents, n need your decision" once O8 shows it (V3). */
const DOCUMENTS_LINK = /^Documents(, \d+ needs? your decision)?$/;

/** The text name of the Documents row of one text in English: "Text {text} en". */
const rowDetails = (page: Page, caseId: string) => textName(page, caseId, "en");

/** Open the text card of a text on its Translation part with the version list (one version per text here). */
async function openTextVersions(page: Page, caseId: string) {
  // "Documents" opens "Needs your decision" while anything waits for the lead (VD7); the row is under All.
  await documentsTab(page, "All").click();
  const card = await openTextCard(page, caseId, "en");
  return (await textVersionItems(card, 1)).first();
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
  await expect(upload.getByText("Checked 2 files: ready to import.", { exact: true })).toBeFocused();
  await expect(preview.locator(".upload-summary")).toContainText("Texts2 (en 2)");
  await expect(preview).toContainText("1 text normalized to Unicode NFC.");
  const rows = page.getByRole("button", { name: /^Text / });
  await expect(rows).toHaveCount(0);
  await upload.getByRole("button", { name: "Import 2 texts", exact: true }).click();
  // The upload dialog closes itself after the import; Documents reports the result.
  await expect(upload).toHaveCount(0);
  await expect(page.locator(".ui-toast-message")).toHaveText("Imported 2 documents and 0 proposals.");
  // One row per text and language, no text card open, each with its lead action: "Assign annotation…" when the
  // project's import plan annotates sources, else "Plan…" (VD1, VD2, VD3).
  await documentsTab(page, "All").click();
  await expect(rows).toHaveCount(2);
  for (const caseId of ["one", "two"]) {
    await expect(rowDetails(page, caseId)).toBeVisible();
    await expect(rowAction(page, "Assign annotation…", caseId, "en").or(rowAction(page, "Plan…", caseId, "en"))).toBeVisible();
  }
}

async function distributeAndSubmit(page: Page, setup: ProjectSetup) {
  await logout(page);
  await redeemCode(page, setup.lead);
  await selectProject(page, setup.key);
  await page.getByRole("link", { name: DOCUMENTS_LINK }).click();
  await importTwoDocuments(page);
  // Plan annotation for "one" if the import left it outside the plan ("Plan…" opens the text card on Text details
  // with the plan chips, VD2, U3), then assign it through the row's Assign dialog and its seeded "Distribute evenly…".
  if (await rowAction(page, "Plan…", "one", "en").count()) {
    await rowAction(page, "Plan…", "one", "en").click();
    const card = textCard(page, "one", "en");
    const annotate = card.getByRole("button", { name: textNamePattern("Annotate, ", "one", "en") });
    if ((await annotate.getAttribute("aria-pressed")) !== "true") await annotate.click();
    await expect(annotate).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Close", exact: true }).click();
    await expect(card).toHaveCount(0);
  }
  await rowAction(page, "Assign annotation…", "one", "en").click();
  const assign = page.getByRole("dialog", { name: "Assign annotation", exact: true });
  await assign.getByRole("button", { name: "Distribute evenly…", exact: true }).click();
  const distribution = page.getByRole("dialog", { name: "Propose distribution", exact: true });
  await distribution.getByRole("button", { name: "Propose", exact: true }).click();
  await expect(distribution.getByRole("combobox", { name: "one, person 1", exact: true })).toHaveValue(setup.annotator.username);
  await distribution.getByRole("button", { name: "Confirm", exact: true }).click();
  // A clean save closes both dialogs and reports it in the toast (#195).
  await expect(distribution).toHaveCount(0);
  await expect(page.locator(".ui-toast")).toContainText("Assignments from the even distribution saved.");
  // No dialog may stay open (the failure names the one that does).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await logout(page);
  await redeemCode(page, setup.annotator);
  const tasks = page.getByTestId("task-row");
  await expect(tasks).toHaveCount(1);
  // My tasks names the text as "{case ID} {language}" (" · " before U9).
  await expect(tasks).toContainText(/one\W+en/);
  await expect(page.getByTestId("task-row").filter({ hasText: /two\W+en/ })).toHaveCount(0);
  await tasks.getByRole("link", { name: /^(Start|Continue|View)$/ }).click();
  await selectText(page, 0, 9);
  await page.getByLabel("Search term", { exact: true }).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).first().click();
  // A new project presets the clinical creation defaults (U5): the finding starts with them unconfirmed.
  const axes = [["Assertion", "Present"], ["Experiencer", "Patient"], ["Temporality", "Current"]] as const;
  const axisRadio = (axis: string, name: string | RegExp) =>
    page.getByRole("group", { name: new RegExp(`^${axis}`) }).getByRole("radio", { name, exact: typeof name === "string" });
  for (const [axis, value] of axes) await expect(axisRadio(axis, new RegExp(`^${value}\\W+default\\)?$`))).toBeChecked();
  await page.getByRole("button", { name: /^Confirm defaults \(3\)/ }).click();
  // Controlled axes reflect the asynchronous server response, as in design.spec.ts.
  for (const [axis, value] of axes) await expect(axisRadio(axis, value)).toBeChecked();
  await expect(page.locator(".status-badge")).toHaveClass(/status-saved/);
  await submitCase(page);
}

test.describe("Administration through real accounts and jobs", () => {
  // Setup codes, an import, a distribution and a submission in one test: slower with three workers.
  test.setTimeout(90_000);
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("admin sets up a project with real setup-code handovers", async ({ page }) => {
    const setup = await createProjectThroughUi(page);
    await page.getByRole("link", { name: "Ontologies", exact: true }).click();
    await expect(page.getByRole("table", { name: "Ontology files", exact: true })
      .getByRole("link", { name: setup.key, exact: true })).toBeVisible();
    await logout(page);
    for (const actor of [setup.lead, setup.annotator]) {
      await redeemCode(page, actor);
      // redeemCode ends on My tasks; neither has a task yet.
      await expect(page.getByRole("heading", { name: "No texts are assigned to you yet." })).toBeVisible();
      await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0);
      await logout(page);
    }
  });

  test("a row's More menu on Users lies above the pinned actions of the rows below", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const username = `ui-menu-admin-${randomUUID().slice(0, 8)}`;
    expect((await page.request.post("/__test_user__", { params: { username, pseudonym: username, system_admin: "true", assign: "none" } })).ok()).toBeTruthy();
    await loginExisting(page, { username, code: "" });
    await page.goto("/#/admin/users");
    // The first row: the fixture accounts of other specs (or this admin) are rows below it.
    const more = page.getByRole("button", { name: /^More actions for / }).first();
    await more.click();
    const menu = page.getByRole("menu", { name: (await more.getAttribute("aria-label"))!, exact: true });
    for (const item of await menu.getByRole("menuitem").all()) {
      // The item's right end, where the pinned Actions cells of later rows sit, hits the item itself.
      const hit = await item.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.right - 4, box.top + box.height / 2)); });
      expect(hit).toBe(true);
    }
  });

  test("a More menu near the bottom of the window opens above its button, inside the window", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    const username = `ui-menu-flip-${randomUUID().slice(0, 8)}`;
    expect((await page.request.post("/__test_user__", { params: { username, pseudonym: username, system_admin: "true", assign: "none" } })).ok()).toBeTruthy();
    await loginExisting(page, { username, code: "" });
    await page.goto("/#/admin/users");
    const more = page.getByRole("button", { name: /^More actions for / }).last();
    await more.evaluate(element => element.scrollIntoView({ block: "end" }));
    const button = (await more.boundingBox())!;
    expect(button.y + button.height).toBeGreaterThan(480 - 120);
    await more.click();
    const menu = (await page.getByRole("menu", { name: (await more.getAttribute("aria-label"))!, exact: true }).boundingBox())!;
    expect(menu.y + menu.height).toBeLessThanOrEqual(button.y);
    expect(menu.y).toBeGreaterThanOrEqual(0);
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(1280);
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
    await page.getByRole("link", { name: DOCUMENTS_LINK }).click();
    await importTwoDocuments(page);
    expect(adminRequests).toEqual([]);
  });

  test("lead distributes one document, observes submission and reopens it", async ({ page }) => {
    const setup = await createProjectThroughUi(page);
    await distributeAndSubmit(page, setup);
    // M-6: without a next task the submit lands on My tasks.
    const tasks = page.getByTestId("task-row");
    await expect(tasks).toHaveCount(1);
    await expect(tasks).toContainText("Submitted");
    await tasks.getByRole("link", { name: /^(Start|Continue|View)$/ }).click();
    await page.reload();
    await expect(page.getByText("Read-only. The project lead can reopen it for changes.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Finish & submit/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add finding without a text span", exact: true })).toHaveCount(0);
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
    await page.getByRole("link", { name: DOCUMENTS_LINK }).click();
    // The submitted annotation's row in the Annotation part carries its Reopen… (#108); the version list does not repeat it.
    const document = await openTextVersions(page, "one");
    await expect(document.getByRole("button", { name: /^Reopen/ })).toHaveCount(0);
    await showSegment(textCard(page, "one", "en"), "Annotation");
    await textCard(page, "one", "en").getByRole("list", { name: "Annotators", exact: true }).getByRole("button", { name: /^Reopen .+’s annotation$/ }).click();
    const reopen = page.getByRole("dialog", { name: "Reopen one", exact: true });
    await reopen.getByLabel("Reason (optional)").fill("Check this finding again.");
    await reopen.getByRole("button", { name: "Reopen assignment", exact: true }).click();
    await expect(reopen).toHaveCount(0);
    // Reopened work is open work again: its row in the Annotation part says so.
    await expect(textCard(page, "one", "en").getByRole("list", { name: "Annotators", exact: true }).locator(".status-pill")).toHaveText("Reopened");
    // The text card is modal: close it before logging out.
    await textCard(page, "one", "en").getByRole("button", { name: "Close", exact: true }).click();
    await logout(page);
    await loginExisting(page, setup.annotator);
    await expect(page.getByTestId("task-row")).toHaveCount(1);
    await expect(page.getByTestId("task-row")).toContainText("Reopened");
  });

  test("lead downloads real T1 and edit-log exports; annotator access is refused", async ({ page }) => {
    const setup = await createProjectThroughUi(page);
    await distributeAndSubmit(page, setup);
    // M-6: without a next task the submit lands on My tasks.
    await logout(page);
    await loginExisting(page, setup.lead);
    await selectProject(page, setup.key);
    await page.getByRole("link", { name: "Export", exact: true }).click();
    const bundle = page.getByRole("row", { name: "Annotation results", exact: true });
    await bundle.getByRole("button", { name: "Create", exact: true }).click();
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
    const log = page.getByRole("row", { name: "Edit log", exact: true });
    await log.getByRole("button", { name: "Create", exact: true }).click();
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
      bundle.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    expect(denied.status()).toBe(403);
    await expect(bundle).toContainText("You do not have access to this page.");
  });
});
