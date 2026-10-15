import { expect, test, type Page } from "@playwright/test";
import {
  importPackage,
  LAUNCH_URL,
  loginAs,
  mentionWithOffsets,
  openCase,
  selectText,
  submitCase,
  TEST_PASSWORD,
} from "./helpers";

const importFixture = (page: Page, annotator: string) => importPackage(page, "", "browser-fixture", annotator);

test("first run: log in without projects, get a T1 import, open a case without typing initials", async ({ page }) => {
  // A user without memberships sees the guide, and nothing to upload.
  await loginAs(page, "first-run");
  const guide = page.getByRole("region", { name: "Get started" });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText(
    "No projects are available to you yet. Ask an administrator to add you to a project.",
  );
  await expect(guide).not.toContainText(/initials/i);
  await expect(page.locator("#mode-select")).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // The administrator imports a T1 bundle (the job runs inline) and adds the user.
  const imported = await page.request.post("/__test_import__?username=first-run");
  expect(imported.ok()).toBeTruthy();
  expect(((await imported.json()) as { proposals: number }).proposals).toBeGreaterThan(0);
  await page.reload();
  await expect(guide).toHaveCount(0);
  await expect(page.locator("#project-select")).toHaveValue("t1-browser");

  // The identity comes from the session: nothing asks for initials or a confirmation.
  await openCase(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("annotator-identity")).toContainText("first-run");
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 0");
});

test("login: a wrong password is refused; a setup code sets the password and logs in", async ({ page }) => {
  const username = "login-flow";
  const created = await page.request.post(`/__test_user__?username=${username}&pseudonym=${username}&setup=true`);
  expect(created.ok()).toBeTruthy();
  const { code } = (await created.json()) as { code: string };

  await page.goto(LAUNCH_URL);
  const login = page.getByRole("form", { name: "Log in to Ontocurator" });
  await login.getByLabel("Username").fill(username);
  await login.getByLabel("Password").fill("not the password at all");
  await login.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Username or password is wrong");
  await expect(page.getByTestId("current-user")).toHaveCount(0);

  await page.getByRole("button", { name: "I have a setup or reset code" }).click();
  const setup = page.getByRole("form", { name: "Set your password" });
  await setup.getByLabel("Username").fill(username);
  await setup.getByLabel("Setup or reset code").fill(code);
  await setup.getByLabel("New password", { exact: true }).fill(TEST_PASSWORD);
  await setup.getByLabel("Repeat the new password").fill(TEST_PASSWORD);
  await setup.getByRole("button", { name: "Set password and log in" }).click();
  await expect(page.getByTestId("current-user")).toContainText(username);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("form", { name: "Log in to Ontocurator" })).toBeVisible();
  await expect(page.getByTestId("current-user")).toHaveCount(0);
});

test("real backend: review, resume, reload and submit", async ({ page }) => {
  await importFixture(page, "browser-reviewer");
  await page.locator("#mode-select").selectOption("review");
  await openCase(page);
  await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (2)" })).toBeVisible();
  await page.locator(".doc-item").filter({ hasText: "HP:0001252" }).click();
  await expect(page.getByLabel(/Proposal details/i)).toContainText("present");
  await expect(page.getByLabel(/Proposal details/i)).toContainText("Hypotonia");
  await page.getByRole("button", { name: /Confirm/i }).first().click();
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");

  // Back on the dashboard the case is in progress; reopening resumes it without asking again.
  await page.getByRole("button", { name: "← Dashboard" }).click();
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await openCase(page);
  await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (2)" })).toBeVisible();
  await expect(page.locator(".doc-item").filter({ hasText: "HP:0001252" })).toContainText(/confirmed/i);
  await page.locator(".doc-item").filter({ hasText: "HP:0001250" }).click();
  await page.getByRole("button", { name: /Confirm/i }).first().click();
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 2");
  await submitCase(page);

  await expect(page.getByRole("button", { name: /Download export/i })).toHaveCount(0);
  await page.reload();
  await page.locator("#project-select").selectOption("browser-fixture");
  await expect(page.locator("#project-select")).toHaveValue("browser-fixture");
  await expect(page.getByText(/Forbidden|Unauthorized|Error loading/)).toHaveCount(0);
});

test("real backend: invalid input does not block correction", async ({ page }) => {
  await importFixture(page, "browser-independent");
  await page.locator("#mode-select").selectOption("independent");
  await openCase(page);
  await expect(page.getByText(/Review Proposals/i)).toHaveCount(0);
  await page.getByRole("button", { name: /\+ New Annotation/i }).click();
  await page.getByLabel(/Search ontology term/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  // Selected candidate creates annotation
  await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
  await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001252");
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");
});

test("real backend: repeated and discontinuous evidence preserves Unicode offsets", async ({ page }) => {
  await importFixture(page, "browser-spans");
  await page.locator("#mode-select").selectOption("independent");
  await openCase(page);
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");
  await page.getByRole("button", { name: "+ Segment", exact: true }).click();
  await selectText(page, 14, 21);
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 2");
  await expect(mentionWithOffsets(page, "[0:9], [14:21]")).toHaveText("“Hypotonia … seizure”");
  await page.getByRole("button", { name: /\+ Add Mention/i }).click();
  await selectText(page, 23, 27); // UTF-16: emoji plus e and combining acute.
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 3");
  // Stored offsets count code points: [23:26] covers "😀", "e" and the combining accent.
  await expect(mentionWithOffsets(page, "[23:26]")).toBeVisible();
  await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
});
