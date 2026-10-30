/**
 * The user handbook walkthrough (docs/handbook/*.md, plan build/handbook/PLAN.md H1/H8): every test performs
 * the documented steps behind one or more handbook screenshots on synthetic demo data and asserts what the
 * image shows, so CI fails when a documented step can no longer be performed. With HANDBOOK_SHOTS=1 it also
 * writes docs/handbook/images/<name>.png (fixed 1280x800 viewport); without it, it writes nothing.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cardSegment, documentsReady, openTextCard, personRow, rowCell, showSegment, textRow } from "./documentsHelpers";
import { newBadge, openDocuments, rowAction, textCard } from "./documentsOverviewHelpers";
import { guidelineScenario, loginGuidelineUser } from "./guidelineHelpers";
import { expectSubmitted, loginExisting, openTasksHome, selectText, TEST_PASSWORD } from "./helpers";
import { leadScenario } from "./leadWorkflowHelpers";
import { loginOverviewUser, overviewAct, overviewScenario, type OverviewActBody, type OverviewScenario } from "./overviewHelpers";
import { proposalCheckScenario, loginScenarioUser as loginProposalUser } from "./proposalCheckHelpers";
import { loginScenarioUser, reviewFlowScenario } from "./reviewFlowHelpers";
import { valuesScenario } from "./valuesHelpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });

/** Writes the handbook image ``name`` only when HANDBOOK_SHOTS=1 (the regeneration command). */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.HANDBOOK_SHOTS !== "1") return;
  const dir = resolve(test.info().config.rootDir, "../../docs/handbook/images");
  mkdirSync(dir, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: resolve(dir, `${name}.png`), animations: "disabled", caret: "hide" });
}

/** A fresh system administrator on the filled "Set your password" form (admin.spec.ts redeemCode). */
async function setPasswordForm(page: Page, username: string): Promise<Locator> {
  const created = await page.request.post("/__test_user__", { params: {
    username, pseudonym: username, system_admin: "true", setup: "true", assign: "none",
  } });
  expect(created.ok()).toBeTruthy();
  const { code } = await created.json() as { code: string };
  await openTasksHome(page);
  await page.getByRole("button", { name: "I have a setup or reset code" }).click();
  const form = page.getByRole("form", { name: "Set your password" });
  await form.getByLabel("Username", { exact: true }).fill(username);
  await form.getByLabel("Setup or reset code").fill(code);
  await form.getByLabel("New password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByLabel("Repeat the new password").fill(TEST_PASSWORD);
  return form;
}

/** The lead logs in with the project as last used: the landing opens its Documents. */
async function loginLead(page: Page, project: string, username: string): Promise<void> {
  await page.goto("/");
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [`ontotator.lastProject.v1:${username}`, project]);
  const form = page.getByRole("form", { name: "Log in to Ontotator" });
  await form.getByLabel("Username", { exact: true }).fill(username);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await documentsReady(page);
}

/** Close the toasts a step left (each has "Dismiss"), so they do not cover the next image. */
async function dismissToasts(page: Page): Promise<void> {
  // Retried: a toast of the last step can still appear after the first pass.
  await expect(async () => {
    for (const close of await page.locator(".ui-toast-close").all()) await close.click();
    await expect(page.locator(".ui-toast-region .ui-toast")).toHaveCount(0, { timeout: 1_000 });
  }).toPass();
}

/** Gives a scenario user a person's name, so the images show names instead of usernames. */
async function rename(page: Page, username: string, displayName: string): Promise<void> {
  const response = await page.request.post("/__test_display_name__", { params: { username, display_name: displayName } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Every open group: a ✓ in each conflicting row, then Keep (consolidation-three.spec.ts resolveRest). */
async function decideOpenGroups(page: Page): Promise<void> {
  const groups = page.locator(".cons-group");
  for (let index = 0; index < await groups.count(); index += 1) {
    const group = groups.nth(index);
    if (!(await group.locator(".cons-group-state").count())) continue;
    const toggle = group.locator(".cons-group-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const conflicts = group.locator("tr.cons-row--conflict");
    for (let row = 0; row < await conflicts.count(); row += 1) await conflicts.nth(row).locator("button.cons-take").first().click();
    await group.getByRole("button", { name: /^Keep/ }).first().click();
    await expect(group.locator(".cons-group-done")).toBeVisible();
  }
}

/** All groups decided: "Ready to submit", then the Submit consolidation? dialog without a toast behind it. */
async function openSubmitDialog(page: Page): Promise<Locator> {
  const progress = page.locator(".cons-progress");
  await expect(progress).toContainText("Ready to submit");
  // The last group's inline "Decision saved / Undo" lives until the next action; a reload clears it.
  await page.reload();
  await expect(progress).toContainText("Ready to submit", { timeout: 30_000 });
  await dismissToasts(page);
  await progress.getByRole("button", { name: "Submit consolidation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  return dialog;
}

const selectionBar = (page: Page) => page.getByRole("region", { name: "Selection", exact: true });

test.describe("admin.md", () => {
  test("Create a user, hand over the setup code, create a project", async ({ page }) => {
    const form = await setPasswordForm(page, "admin.demo");
    await form.getByRole("button", { name: "Set password and log in" }).click();
    await expect(page.getByTestId("current-user")).toContainText("admin.demo");
    await page.goto("/#/admin/users");
    await page.getByRole("button", { name: "New user…", exact: true }).click();
    const create = page.getByRole("form", { name: "New user" });
    await create.getByLabel(/^Username/).fill("lena.demo");
    await create.getByLabel(/^Display name/).fill("Lena Demo");
    await create.getByLabel("Languages", { exact: true }).fill("en");
    await create.getByLabel("Languages", { exact: true }).press("Enter");
    await create.getByRole("button", { name: "Create user", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Setup code for lena.demo", exact: true });
    await expect(dialog.locator("code")).not.toBeEmpty();
    const close = dialog.locator(".modal-actions").getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeDisabled();
    for (const name of ["Copy", "Copy hand-over text"]) await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible();
    await dialog.getByText("Hand-over text", { exact: true }).click();
    await expect(dialog.getByText(/Your Ontotator account is ready\./)).toBeVisible();
    await shot(page, "admin-setup-code");
    await dialog.getByLabel("I have handed over or stored the code").check();
    await close.click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("link", { name: "Ontologies", exact: true }).click();
    await page.getByLabel("Ontology files", { exact: true }).and(page.locator('input[type="file"]')).setInputFiles(
      fileURLToPath(new URL("../../tests/fixtures/hp.json", import.meta.url)),
    );
    await page.getByRole("button", { name: "Upload files", exact: true }).click();
    await expect(page.getByRole("table", { name: "Upload results", exact: true })).toContainText("hp.json");
    await page.getByRole("link", { name: "New project", exact: true }).click();
    await expect(page).toHaveURL(/#\/projects\/new$/);
    await page.getByLabel(/^Project key/).fill("demo-phenotypes");
    await page.getByLabel(/^Name \(required\)/).fill("Demo phenotypes");
    await page.getByLabel("Languages of the texts", { exact: true }).fill("en");
    await page.getByLabel("Languages of the texts", { exact: true }).press("Enter");
    await expect(page.getByLabel("Profile source", { exact: true })).toHaveValue(/template/);
    await page.getByLabel(/^Built-in template/).selectOption("hpo-phenotype");
    const versions = page.getByLabel(/^Ontology file for HP/);
    const release = await versions.locator("option").filter({ hasText: "2026-06-23" }).first().getAttribute("value");
    await versions.selectOption(release!);
    const submit = page.getByRole("button", { name: "Create project", exact: true });
    await expect(submit).toBeEnabled();
    await page.locator(":focus").blur();
    // The whole form, from Project key to Create project (the app scrolls inside its own pane, not the page).
    await page.setViewportSize({ width: 1280, height: 1360 });
    await shot(page, "admin-new-project");
    await submit.click();
    await expect(page).toHaveURL(/#\/projects\/demo-phenotypes\/settings\/people$/);
  });
});

test.describe("getting-started.md", () => {
  test("Set your password with a setup or reset code", async ({ page }) => {
    const form = await setPasswordForm(page, "maria.demo");
    for (const label of ["Username", "Setup or reset code", "New password", "Repeat the new password"]) {
      await expect(form.getByLabel(label, { exact: true })).toBeVisible();
    }
    await shot(page, "getting-started-set-password");
    await form.getByRole("button", { name: "Set password and log in" }).click();
    await expect(page.getByTestId("current-user")).toContainText("maria.demo");
  });

  test("See your tasks", async ({ page }) => {
    const s = await guidelineScenario(page, "PUBLISHED");
    await loginGuidelineUser(page, s, "ana");
    // One task started, so the table shows both Start and Continue.
    await page.goto(`/#/tasks/${s.assignments["annotate-1"]}`);
    await expect(page.locator(".text-container")).toBeVisible();
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "My tasks", exact: true }).click();
    const tabs = page.getByRole("tablist", { name: "Task status" });
    // "Paused" only appears while a task is paused.
    for (const tab of ["To do", "Submitted", "All"]) await expect(tabs.getByRole("tab", { name: new RegExp(`^${tab}, \\d+$`) })).toBeVisible();
    await tabs.getByRole("tab", { name: /^All/ }).click();
    await expect(page.getByRole("link", { name: /^Project guidelines v1/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^(Start|Continue)/ })).toHaveCount(2);
    await shot(page, "getting-started-my-tasks");
  });
});

test.describe("annotator.md", () => {
  test("Annotate from scratch, then the submit dialog", async ({ page }) => {
    const s = await reviewFlowScenario(page, "ANNOTATION_LOOP");
    await rename(page, s.users.annotator, s.display_names.annotator = "Lena Vogt");
    await loginScenarioUser(page, s, "annotator");
    await page.goto(`/#/tasks/${s.assignments["loop-en"]}`);
    const text = s.texts["loop-en"];
    await expect(page.locator(".text-container")).toHaveText(text);
    const mark = async (word: string, query: string, code: string) => {
      const start = text.indexOf(word);
      await selectText(page, start, start + word.length);
      await expect(page.getByRole("region", { name: "New finding", exact: true }).locator(".pending-quote")).toHaveText(`“${word}”`);
      await page.getByLabel("Search term", { exact: true }).fill(query);
      await expect(page.getByRole("listbox", { name: "Terms", exact: true }).getByRole("option").first()).toContainText(code);
    };
    await mark("seizure", "seizure", "HP:0001250");
    await shot(page, "annotator-new-finding");
    await page.keyboard.press("Enter");
    await expect(page.locator(".inspector-pane h2.term-heading")).toContainText("Seizure");
    await mark("hypotonia", "hypotonia", "HP:0001252");
    await page.keyboard.press("Enter");
    await expect(page.locator(".inspector-pane h2.term-heading")).toContainText("Hypotonia");
    await expect(page.locator(".status-badge.status-saved")).toHaveText("Saved");
    await shot(page, "annotator-editor");

    await page.getByRole("button", { name: /^Finish & submit/ }).click();
    const dialog = page.getByRole("dialog", { name: "Submit text", exact: true });
    const values = dialog.locator("[data-unconfirmed-values]");
    await expect(values.getByRole("heading", { name: "Values not chosen yet", exact: true })).toBeVisible();
    await expect(values.getByRole("button", { name: /^Confirm as shown: / })).toHaveCount(2);
    await expect(values.getByRole("button", { name: /^Confirm all as shown/ })).toBeVisible();
    const submit = dialog.getByRole("button", { name: /^Submit with \d+ warnings?$/ });
    await expect(submit).toBeVisible();
    await shot(page, "annotator-submit-dialog");
    await submit.click();
    await expectSubmitted(page);
  });

  test("Review proposals", async ({ page }) => {
    const s = await proposalCheckScenario(page, "ONE_ASSIGNED");
    await loginProposalUser(page, s, "tom");
    await page.goto(`/#/tasks/${s.assignments.tom}`);
    await expect(page.locator(".text-container")).toBeVisible();
    await expect(page.locator(".sidebar-header").filter({ hasText: /^Review Proposals/ })).toBeVisible();
    const proposals = page.locator('.sidebar [data-list-key^="target:"]');
    await page.locator("body").press("j");
    await expect(proposals.first()).toHaveClass(/\bselected\b/);
    for (const name of ["Confirm", "Reject", "Edit & Replace", "Unresolved"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first()).toBeVisible();
    }
    // The first proposal, "Keine Krampfanfälle", says Present: Edit & Replace, then Absent in the copy.
    await page.getByRole("button", { name: /^Edit & Replace\b/ }).first().click();
    const changed = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON()?.payload?.command === "set_axes");
    await page.locator('[data-axis-field="assertion"] input[type="radio"][value="absent"]').check();
    expect((await changed).ok()).toBeTruthy();
    await expect(page.locator(".status-badge.status-saved")).toHaveText("Saved");
    await shot(page, "annotator-proposal-review");
  });

  test("Review carried findings", async ({ page }) => {
    const response = await page.request.post("/__test_carry_forward__", { params: { scenario: "t5span" }, timeout: 120_000 });
    expect(response.ok(), await response.text()).toBeTruthy();
    const s = await response.json() as { username: string; assignment_id: number };
    await rename(page, s.username, "Ana Weber");
    await loginExisting(page, s.username);
    await page.goto(`/#/tasks/${s.assignment_id}`);
    await expect(page.locator(".text-container")).toBeVisible();
    // The toolbar names the round ("Round 2, continued from Round 1"); "Review carried findings" only without one.
    await expect(page.locator(".carried-progress__status")).toHaveText("0 of 1 checked");
    await page.getByRole("button", { name: /^Next unchecked/ }).click();
    const section = page.getByRole("region", { name: "Carried finding", exact: true });
    await expect(section.getByText("What to check", { exact: true })).toBeVisible();
    await expect(page.locator('.sidebar [data-list-key^="annotation:"]').filter({ hasText: "Check needed" })).toHaveClass(/\bselected\b/);
    const check = section.getByRole("button", { name: "Mark as checked", exact: true });
    await expect(check).toBeVisible();
    await shot(page, "annotator-carried-finding");
    await check.click();
    await expect(page.locator(".carried-progress__status")).toHaveText("All carried findings checked");
  });

  test("Set values and confirm defaults", async ({ page }) => {
    const s = await valuesScenario(page, "VALUES_STANDARD");
    await rename(page, s.users.annotator, s.display_names.annotator = "Lena Vogt");
    await loginScenarioUser(page, s, "annotator");
    await page.goto(`/#/tasks/${s.assignments.values}`);
    const text = s.texts.values;
    await expect(page.locator(".text-container")).toHaveText(text);
    const start = text.indexOf("seizure");
    await selectText(page, start, start + "seizure".length);
    await page.getByLabel("Search term", { exact: true }).fill("seizure");
    await expect(page.getByRole("listbox", { name: "Terms", exact: true }).getByRole("option").first()).toContainText("HP:0001250");
    await page.keyboard.press("Enter");
    await expect(page.locator(".values-section .axis-default-tag").first()).toHaveText("Default");
    const confirm = page.getByRole("button", { name: /^Confirm defaults \(\d+\)/ });
    await expect(confirm).toBeVisible();
    await expect(page.locator(".status-badge.status-saved")).toHaveText("Saved");
    await shot(page, "annotator-finding-values");
    await confirm.click();
    await expect(confirm).toHaveCount(0);
  });

  test("Review a translation", async ({ page }) => {
    const s = await reviewFlowScenario(page, "REVIEW_FLOW");
    await loginScenarioUser(page, s, "ana");
    await page.goto(`/#/tasks/${s.assignments["failed-translation"]}`);
    await expect(page.getByRole("textbox", { name: "Translation (de)", exact: true })).toHaveValue(s.texts["failed-translation"]);
    await expect(page.getByRole("region", { name: "Source (en)", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Automatic translation checks", exact: true })).toBeVisible();
    for (const name of ["Accepted unchanged", "Accepted with corrections", "Query", "Rejected"]) {
      await expect(page.getByRole("radio", { name, exact: true })).toBeVisible();
    }
    await page.getByRole("radio", { name: "Query", exact: true }).check();
    await page.getByRole("checkbox", { name: "Number or unit", exact: true }).check();
    await page.getByRole("textbox", { name: "Rationale", exact: true }).fill("The automatic check flags the dose unit: please check it against the source.");
    await page.locator(":focus").blur();
    await expect(page.locator(".translation-save-status")).toHaveText("Saved");
    const submit = page.getByRole("button", { name: "Submit review…", exact: true });
    await expect(submit).not.toHaveAttribute("aria-disabled", "true");
    // Tall enough for the four decisions, the categories, the rationale and Submit review… at once.
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.getByRole("radio", { name: "Accepted unchanged", exact: true }).scrollIntoViewIfNeeded();
    await shot(page, "annotator-translation-review");
    await submit.click();
    const confirm = page.getByRole("dialog", { name: "Submit this review?", exact: true });
    await confirm.getByRole("button", { name: "Submit review", exact: true }).click();
    await expect(confirm).toHaveCount(0);
  });
});

test.describe("consolidator.md", () => {
  test("Decide a group, then finish the consolidation", async ({ page }) => {
    const response = await page.request.post("/__test_consolidation__", { params: { started: "true", people: "3" }, timeout: 120_000 });
    expect(response.ok(), await response.text()).toBeTruthy();
    const s = await response.json() as { users: Record<"lead" | "ann-0001" | "ann-0002" | "ann-0003", string>; assignment_id: number };
    const names = { lead: "Mia Kühn", "ann-0001": "Ana Weber", "ann-0002": "Tom Reis", "ann-0003": "Luc Martin" } as const;
    for (const [who, name] of Object.entries(names)) await rename(page, s.users[who as keyof typeof names], name);
    await loginExisting(page, s.users.lead);
    await page.goto(`/#/tasks/${s.assignment_id}`);
    await expect(page.getByRole("heading", { level: 1, name: /^Consolidate / })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("list", { name: "Groups", exact: true })).toBeVisible();
    const group = page.locator(".cons-group").filter({ has: page.locator(".cons-group-title", { hasText: "muscular hypotonia" }) });
    const toggle = group.locator(".cons-group-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const table = group.locator("table.cons-compare");
    // Hypotonia, the term two people chose; Luc's broader parent term is not taken.
    await table.getByRole("button", { name: /^Take Hypotonia from .* for Term$/ }).first().click();
    await table.getByRole("button", { name: /^Take Absent from .* for Assertion$/ }).click();
    await expect(group.locator(".cons-result")).toContainText("Result:");
    await expect(group.locator(".cons-result")).toContainText("Not taken:");
    const keep = group.getByRole("button", { name: "Keep", exact: true });
    await expect(keep).toBeEnabled();
    // Tall enough for the heading, the progress card and the open group together.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await shot(page, "consolidator-group-table");
    await keep.click();
    await expect(toggle).toContainText("decided");

    await decideOpenGroups(page);
    await openSubmitDialog(page).then(dialog => dialog.getByRole("button", { name: /^Submit/ }).click());
    await expect(page.getByText(/^Consolidation submitted\. /)).toBeVisible();
  });

  test("Finish a consolidation: the submit dialog with warnings", async ({ page }) => {
    // Confirmed proposals keep default values, so the server warns on submit.
    const s = await proposalCheckScenario(page, "CONSOLIDATING");
    await rename(page, s.users.lead, s.display_names.lead = "Mia Kühn");
    await loginProposalUser(page, s, "lead");
    await page.goto(`/#/tasks/${s.consolidation_assignment_id}`);
    await expect(page.getByRole("heading", { level: 1, name: /^Consolidate / })).toBeVisible({ timeout: 30_000 });
    await decideOpenGroups(page);
    const dialog = await openSubmitDialog(page);
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    const warned = dialog.getByRole("button", { name: /^Submit with \d+ warnings?$/ });
    await expect(warned).toBeVisible();
    await expect(dialog.getByText("Check before you submit", { exact: true })).toBeVisible();
    await shot(page, "consolidator-submit-dialog");
    await warned.click();
    await expect(page.getByText(/^Consolidation submitted\. /)).toBeVisible();
  });
});

test.describe("lead.md", () => {
  test("Upload texts, plan several texts, assign work", async ({ page }) => {
    const s = await leadScenario(page, "DEFAULT_IMPORT");
    await loginLead(page, s.project, s.users.lead);
    await page.getByRole("button", { name: "Upload texts…", exact: true }).click();
    const upload = page.getByRole("dialog", { name: "Upload texts", exact: true });
    await expect(upload.getByLabel("Format", { exact: true })).toBeVisible();
    await upload.locator("input[type=file]").setInputFiles(s.bundle_path!);
    await upload.getByRole("button", { name: "Check", exact: true }).click();
    await expect(upload.getByText("Checked 1 file: ready to import.", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(upload.getByRole("region", { name: "Work plan" })).toBeVisible();
    await expect(upload.getByText("Adjust per case…", { exact: true })).toBeVisible();
    const importButton = upload.getByRole("button", { name: "Import 3 cases", exact: true });
    await expect(importButton).toBeVisible();
    await shot(page, "lead-upload-preview");
    await importButton.click();
    await expect(upload).toHaveCount(0, { timeout: 90_000 });
    await dismissToasts(page);

    // Plan several texts at once: select all, Plan….
    await page.getByRole("checkbox", { name: /^Select all \d+ filtered texts$/ }).click();
    await selectionBar(page).getByRole("button", { name: "Plan…", exact: true }).click();
    const plan = page.getByRole("dialog", { name: /^Work plan\W+3 cases$/ });
    await expect(plan.getByRole("group", { name: "Quick choice for the selected translations" })).toBeVisible();
    for (const choice of ["Translation review and annotation", "Annotation only, no translation review"]) {
      await expect(plan.getByRole("button", { name: choice, exact: true })).toBeVisible();
    }
    await expect(plan.getByRole("button", { name: "Save for 3 cases", exact: true })).toBeVisible();
    await shot(page, "lead-work-plan");
    await plan.getByRole("button", { name: "Cancel", exact: true }).click();
    await selectionBar(page).getByRole("button", { name: "Clear selection", exact: true }).click();

    // Assign work to the selected texts: the three de texts, Assign review…, Ana.
    for (const caseId of s.case_ids.de!) await rowCell(textRow(page, caseId, "de"), "select").getByRole("checkbox").check();
    await selectionBar(page).getByRole("button", { name: "Assign review…", exact: true }).click();
    const assign = page.getByRole("dialog", { name: /^Assign\W+3 cases$/ });
    await expect(assign.getByRole("combobox", { name: /^Task/ })).toHaveValue("translation_review:de");
    const members = assign.getByRole("table", { name: "Members" });
    for (const header of ["Person", "Reads", "Open tasks"]) await expect(members.getByRole("columnheader", { name: header })).toBeVisible();
    await assign.getByRole("radio", { name: new RegExp(`^${s.display_names.ana}`) }).click();
    await expect(assign.getByRole("status", { name: "Summary" })).toContainText(`${s.display_names.ana} gets 3 translation reviews (de).`);
    await shot(page, "lead-assign");
    await assign.getByRole("button", { name: "Assign 3", exact: true }).click();
    // The three cases also have fr translations: the dialog stays open on the next language (issue 195) and Close ends it.
    await expect(assign.getByRole("combobox", { name: /^Task/ })).toHaveValue("translation_review:fr");
    await expect(assign.getByText(/Next: translation review \(fr\)\. Close when you are done\.$/)).toBeVisible();
    await assign.locator(".modal-actions").getByRole("button", { name: "Close", exact: true }).click();
    await expect(assign).toHaveCount(0);
  });

  test("Text card with the annotation part", async ({ page }) => {
    const s = await proposalCheckScenario(page, "ONE_ASSIGNED");
    await loginLead(page, s.project, s.users.lead);
    await page.getByRole("tab", { name: /^All, \d+$/ }).click();
    const card = await openTextCard(page, "EN100024", "en");
    for (const part of ["Translation", "Annotation", "Finalization"] as const) await expect(cardSegment(card, part)).toBeVisible();
    await showSegment(card, "Annotation");
    await expect(card.getByRole("radiogroup", { name: "Annotation plan" })).toBeVisible();
    await expect(personRow(card, "Annotators", s.display_names.tom)).toBeVisible();
    await shot(page, "lead-text-card");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  });

  test("Documents, compare results, progress and export", async ({ page }) => {
    const s = await overviewScenario(page, "WALKTHROUGH");
    const caseId = s.case_id!;
    const act = (body: Omit<OverviewActBody, "project" | "case_id" | "language">) =>
      overviewAct(page, { project: s.project, case_id: caseId, language: "de", ...body });
    await loginOverviewUser(page, s, "lead");
    await openDocuments(page, s.project);
    await page.getByRole("button", { name: "Upload texts…", exact: true }).click();
    const upload = page.getByRole("dialog", { name: "Upload texts" });
    await upload.locator("input[type=file]").setInputFiles(s.bundle_path!);
    await upload.getByRole("button", { name: "Check", exact: true }).click();
    await upload.getByRole("button", { name: /^Import 1 case/ }).click({ timeout: 60_000 });
    await expect(upload).toHaveCount(0, { timeout: 90_000 });
    await rowAction(page, "Assign review…", caseId, "de").click();
    let dialog = page.getByRole("dialog", { name: /^Assign/ });
    await dialog.getByRole("radio", { name: /^Ana Weber/ }).click();
    await dialog.getByRole("button", { name: "Assign 1", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await act({ actor: "ana", action: "accept_review" });
    await openDocuments(page, s.project);
    await page.reload();
    await rowAction(page, "Assign annotation…", caseId, "de").click();
    dialog = page.getByRole("dialog", { name: /^Assign/ });
    await dialog.getByRole("checkbox", { name: /^Tom Reis/ }).click();
    await dialog.getByRole("checkbox", { name: /^Luc Martin/ }).click();
    await dialog.getByRole("button", { name: "Assign 2 people", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await act({ actor: "tom", action: "submit_annotation", preset: "tom_v1" });
    await act({ actor: "luc", action: "submit_annotation", preset: "luc_v1" });
    await act({ actor: "lead", action: "age_visit" });

    // Open the Documents page: NEW since the last visit, a row that needs a decision.
    await openDocuments(page, s.project);
    await page.reload();
    const row = textRow(page, caseId, "de");
    await expect(newBadge(row)).toHaveCount(1);
    await expect(page.getByRole("tab", { name: /^Needs your decision, 1$/ })).toBeVisible();
    for (const header of ["Translation", "Annotation", "Finalization", "Waiting on", "Next step", "Last activity"]) {
      await expect(page.getByRole("table", { name: "Documents", exact: true }).getByRole("columnheader", { name: header, exact: true })).toBeVisible();
    }
    await expect(rowAction(page, "Compare results…", caseId, "de")).toBeVisible();
    await shot(page, "lead-documents");

    // Accept a result or compare results.
    await rowAction(page, "Compare results…", caseId, "de").click();
    const panel = textCard(page, caseId, "de").getByRole("region", { name: "Final result", exact: true });
    await expect(panel.getByText(/^Agreement: \d+ of \d+ findings match$/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Consolidate…", exact: true })).toBeVisible();
    const useAsFinal = panel.getByRole("button", { name: /^Use as final/ });
    await expect(useAsFinal).toHaveCount(2);
    await shot(page, "lead-compare-results");
    await useAsFinal.first().click();
    await expect(panel.getByRole("status")).toHaveText("Final result saved. No more final results to decide.");
    await panel.getByRole("button", { name: "Close", exact: true }).first().click();

    // Watch progress.
    await page.getByRole("link", { name: "Progress", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh progress", exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "People" })).toBeVisible();
    await shot(page, "lead-progress");

    // Export final results.
    await page.getByRole("link", { name: "Export", exact: true }).click();
    const check = page.getByRole("region", { name: "Export check" });
    await expect(check).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Create final export", exact: true })).toBeVisible();
    await shot(page, "lead-export");
  });

  test("Decide on a problem report", async ({ page }) => {
    const s: OverviewScenario = await overviewScenario(page, "S9");
    await loginOverviewUser(page, s, "lead");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/problem-reports/${encodeURIComponent(s.report_id!)}?section=decide`);
    await expect(page.getByText(s.report_reason!).first()).toBeVisible();
    await expect(page.getByText(/Loading…/)).toHaveCount(0);
    const resume = page.getByRole("button", { name: /^Close and resume Task \d+$/ });
    await expect(resume).toBeVisible();
    await expect(page.getByRole("heading", { name: "Other decisions", exact: true })).toBeVisible();
    await shot(page, "lead-problem-report");
    await resume.click();
    await expect(resume).toHaveCount(0);
  });

  test("Move a started project to a newer release", async ({ page }) => {
    // S6: submitted work locks the project; Tom's open draft gets terms the newer release retires or merges.
    const s = await overviewScenario(page, "S6");
    await overviewAct(page, { project: s.project, case_id: "case-106", language: "de", actor: "tom", action: "draft_annotation", preset: "tom_v2" });
    const newer = await page.request.post("/__test_ontology__", { params: { name: "hp-newer.json" } });
    expect(newer.ok(), await newer.text()).toBeTruthy();
    await loginOverviewUser(page, s, "lead");
    await page.goto(`/#/projects/${encodeURIComponent(s.project)}/settings/ontology`);
    const form = page.getByRole("form", { name: "Ontology release" });
    await expect(form.getByText("Move to another release", { exact: true })).toBeVisible();
    const releases = form.getByLabel(/^hp release/i);
    const value = await releases.locator("option").filter({ hasText: "2026-09-01" }).first().getAttribute("value");
    await releases.selectOption(value!);
    await form.getByRole("button", { name: "Check changes", exact: true }).click();
    const report = page.getByRole("region", { name: "Release change check" });
    await expect(report.getByRole("heading", { name: "Check before moving" })).toBeVisible();
    await expect(report.getByRole("table", { name: "Rewritten draft terms" })).toBeVisible();
    await expect(report.getByRole("table", { name: "Draft terms to change by hand" })).toBeVisible();
    await report.evaluate(element => element.scrollIntoView({ block: "start" }));
    await shot(page, "lead-move-release-check");
    await report.getByRole("button", { name: "Move to this release", exact: true }).click();
    await expect(page.getByText("Ontology release changed.", { exact: true })).toBeVisible();
  });
});
