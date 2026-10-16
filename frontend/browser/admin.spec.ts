import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { TEST_PASSWORD } from "./helpers";

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
  const close = dialog.getByRole("button", { name: "Close", exact: true });
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
  for (const [actor, role] of [[lead, "lead"], [annotator, "annotator"]] as const) {
    await members.getByLabel(/^Username/).fill(actor.username);
    await members.getByRole("checkbox", { name: `New member: ${role}`, exact: true }).check();
    await members.getByRole("button", { name: "Add member", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: `${actor.username}: ${role}`, exact: true })).toBeChecked();
  }
  return { key, lead, annotator };
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
      await expect(page.getByRole("heading", { name: "No documents are assigned to you yet." })).toBeVisible();
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
    await page.getByRole("link", { name: "Documents", exact: true }).click();
    await page.getByRole("button", { name: "Upload documents", exact: true }).click();
    const upload = page.getByRole("dialog", { name: "Upload documents", exact: true });
    await upload.getByLabel("Format", { exact: true }).selectOption("text");
    await upload.getByLabel(/^Upload language/).selectOption("en");
    await upload.getByLabel(/^Files/).setInputFiles([
      { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("Hypotonia.\r\n") },
      { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("Seizures.\n") },
    ]);
    await upload.getByRole("button", { name: "Check", exact: true }).click();
    const preview = upload.getByRole("region", { name: "Upload preview", exact: true });
    await expect(preview).toContainText("2 added");
    await expect(preview).toContainText("1 normalised");
    await expect(page.getByTestId("document-row")).toHaveCount(0);
    await upload.getByRole("button", { name: "Import", exact: true }).click();
    await expect(upload.getByText("Imported 2 documents and 0 proposals.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(upload).toHaveCount(0);
    await expect(page.getByTestId("document-row")).toHaveCount(2);
    await expect(page.getByRole("table", { name: "Documents", exact: true })).toContainText("one");
    await expect(page.getByRole("table", { name: "Documents", exact: true })).toContainText("two");
    expect(adminRequests).toEqual([]);
  });
});
