/**
 * Consolidation flows beyond the comparison clicks (#170): "Edit values…", "Other term…", "Attach to a finding…",
 * "Reopen all decisions…", Undo (the row's toast and Ctrl+Z), "+ note" / "Guidelines unclear here", "Hide text", a
 * submit with warnings ("Check before you submit"), "Open in full editor" / "Back to consolidation" and the submit of
 * a consolidator who does not lead the project. Scenario: tests/browser_consolidation_scenarios.py (the 8-group
 * example; `scenario=modifiers&standalone=true` adds Ben's Neonatal onset as a finding; `consolidator=adj` starts it for an
 * adjudicator without the Lead role).
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { documentsReady, openDecisionBlock } from "./documentsHelpers";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

interface Scenario {
  project: string;
  users: Record<string, string>;
  case_id: string;
  assignment_id: number;
  round_id: string;
}

async function scenario(page: Page, params: Record<string, string> = {}): Promise<Scenario> {
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true", ...params }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as Scenario;
}

const heading = (page: Page) => page.getByRole("heading", { level: 1, name: /^Consolidate case-0107\W+en v1$/ });
const expanded = (page: Page) => page.locator(".cons-group-expanded");
const expandedTitle = (page: Page) => page.locator(".cons-group-expanded .cons-group-title");
const take = (page: Page, value: string, field: string) =>
  expanded(page).getByRole("button", { name: new RegExp(`^Take ${value} from .+ for ${field}$`, "i") });
const keep = (page: Page) => expanded(page).getByRole("button", { name: "Keep", exact: true });
/** A group's toggle in the list: "{name} {state}…". */
const group = (page: Page, name: string) => page.locator(".cons-group-toggle").filter({ has: page.locator(".cons-group-title", { hasText: new RegExp(`^${name}$`) }) });
/** Expands the group ``name`` (its toggle collapses an expanded group). */
async function expand(page: Page, name: string): Promise<void> {
  const toggle = group(page, name);
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(expandedTitle(page)).toHaveText(name);
}
/** Modifier scenario: expand ``name``, take each [modifier, person] of its Modifiers row and save with ``button``. */
async function decideModifiers(page: Page, name: string, takes: [string, string][], button = "Keep"): Promise<void> {
  await expand(page, name);
  for (const [modifier, person] of takes) {
    await expanded(page).getByRole("button", { name: `Take ${modifier} from ${person} for Modifiers`, exact: true }).click();
  }
  await expanded(page).getByRole("button", { name: button, exact: true }).click();
  await expect(group(page, name)).toHaveAccessibleName(new RegExp(`^${name} decided`));
}
const progress = (page: Page) => page.locator(".cons-progress-line");
/** The app's toast, not the "Decision saved" Undo in a group's row (styled as a toast). */
const toast = (page: Page) => page.locator(".ui-toast:not(.cons-undo)");

const isCommand = (path: string) => (request: Request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith(`/consolidation-groups/${path}`);
/** The payload of the next consolidation command `path` (resolve, annotate, reopen, reopen-all, undo-reopen-all). */
async function payloadOf(page: Page, path: string, action: () => Promise<void>): Promise<Record<string, unknown>> {
  const sent = page.waitForResponse(response => isCommand(path)(response.request()));
  await action();
  const response = await sent;
  expect(response.ok(), await response.text()).toBeTruthy();
  return (response.request().postDataJSON() as { payload: Record<string, unknown> }).payload;
}

async function openTask(page: Page, s: Scenario, user = s.users.lead): Promise<void> {
  await loginExisting(page, user);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });
  await expect(expandedTitle(page)).toHaveText("muscular hypotonia");
}

/** The 8-group example's open groups, decided as in consolidation.spec.ts (hypotonia, reflexes, hearing, seizure activity). */
async function decideAll(page: Page): Promise<void> {
  await take(page, "absent", "Assertion").click();
  await keep(page).click();
  await expect(expandedTitle(page)).toHaveText("Absent reflexes");
  await keep(page).click();
  await expect(expandedTitle(page)).toHaveText("Reduced hearing");
  await expanded(page).getByRole("button", { name: /^Keep .+'s finding$/ }).click();
  await expect(expandedTitle(page)).toHaveText("Prolonged seizure activity");
  await take(page, "Status epilepticus", "Term").click();
  await take(page, "present", "Assertion").click();
  await keep(page).click();
  await expect(expandedTitle(page)).toHaveCount(0);
  await expect(progress(page)).toContainText("Ready to submit");
}

test("Edit values… keeps the finding with values chosen in the form, also after a reload", async ({ page }) => {
  const s = await scenario(page);
  await openTask(page, s);
  // "Reduced hearing" (ann-0001 only) has no conflicting row: its More… offers Edit values… and Other term….
  await expand(page, "Reduced hearing");
  await expanded(page).getByRole("button", { name: "More actions, Reduced hearing", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Other term…", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Edit values…", exact: true }).click();
  const form = expanded(page).getByRole("group", { name: "Edit values", exact: true });
  await expect(form.getByLabel("Assertion", { exact: true })).toHaveValue("present");
  // Cancel leaves the group open and unchanged.
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expanded(page).getByRole("button", { name: "More actions, Reduced hearing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit values…", exact: true }).click();
  await form.getByLabel("Assertion", { exact: true }).selectOption("absent");
  await form.getByLabel("Temporality", { exact: true }).selectOption("historical");
  const payload = await payloadOf(page, "resolve", () => form.getByRole("button", { name: "Keep with these values", exact: true }).click());
  expect(payload).toMatchObject({ action: "choose", choice: { term_id: "HP:0000365", axes: { assertion: "absent", experiencer: "patient", temporality: "historical" } } });
  await expect(group(page, "Reduced hearing")).toHaveAccessibleName(/^Reduced hearing decided: Absent, Patient, Historical, no modifiers$/);
  await page.reload();
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });
  await expect(group(page, "Reduced hearing")).toHaveAccessibleName(/^Reduced hearing decided: .*Absent, Patient, Historical/);
});

test("Other term… replaces the conflicting terms; the other conflicting row still needs its choice", async ({ page }) => {
  const s = await scenario(page);
  await openTask(page, s);
  await expand(page, "Prolonged seizure activity");
  // A term conflict: More… has only Other term… (Edit values… needs a group without conflicts).
  await expanded(page).getByRole("button", { name: "More actions, Prolonged seizure activity", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Edit values…" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Other term…", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Other term" });
  await picker.getByRole("combobox").fill("Dialeptic");
  await picker.getByRole("option", { name: /Dialeptic seizure/ }).first().click();
  await expect(picker).toHaveCount(0);
  await expect(expanded(page).locator(".cons-result")).toContainText("Dialeptic seizure");
  await expect(expanded(page).locator(".cons-result")).toContainText("Not saved yet.");
  // The assertion still differs: Keep waits for its ✓.
  await expect(expanded(page).getByText("Choose a value in each highlighted row first.", { exact: true })).toBeVisible();
  await take(page, "present", "Assertion").click();
  const payload = await payloadOf(page, "resolve", () => keep(page).click());
  expect(payload).toMatchObject({ action: "choose", choice: { term_id: "HP:0011146", axes: { assertion: "present" } } });
  await expect(group(page, "Prolonged seizure activity")).toHaveAccessibleName(/^Prolonged seizure activity decided: Dialeptic seizure \(HP:0011146\), Present/);
});

test("Undo: the row's Undo and Ctrl+Z reopen the last decision with its choices", async ({ page }) => {
  const s = await scenario(page);
  await openTask(page, s);
  await expect(progress(page)).toContainText("4 of 8 groups open");
  await take(page, "absent", "Assertion").click();
  await keep(page).click();
  await expect(progress(page)).toContainText("3 of 8 groups open");
  const row = page.locator(".cons-undo");
  await expect(row.locator(".ui-toast-message")).toHaveText("Decision saved");
  await payloadOf(page, "reopen", () => row.getByRole("button", { name: "Undo, muscular hypotonia", exact: true }).click());
  await expect(expandedTitle(page)).toHaveText("muscular hypotonia");
  await expect(progress(page)).toContainText("4 of 8 groups open");
  await expect(row).toHaveCount(0);
  // The undone decision's ✓ is staged again: Keep saves it once more.
  await expect(expanded(page).locator(".cons-result")).toContainText("Absent");
  await keep(page).click();
  await expect(expandedTitle(page)).toHaveText("Absent reflexes");
  await expect(progress(page)).toContainText("3 of 8 groups open");
  // Ctrl+Z outside text fields: focus is on the next group's toggle after Keep.
  await expect(page.getByRole("button", { name: /^Absent reflexes/, expanded: true })).toBeFocused();
  await payloadOf(page, "reopen", () => page.keyboard.press("Control+z"));
  await expect(expandedTitle(page)).toHaveText("muscular hypotonia");
  await expect(progress(page)).toContainText("4 of 8 groups open");
  await expect(page.getByText("muscular hypotonia: decision undone.", { exact: true })).toBeAttached();
  // Nothing left to undo: a second Ctrl+Z sends no reopen.
  let reopened = false;
  page.on("request", request => { if (isCommand("reopen")(request)) reopened = true; });
  await page.locator(".cons-group-toggle").first().focus();
  await page.keyboard.press("Control+z");
  await expect(progress(page)).toContainText("4 of 8 groups open");
  expect(reopened).toBe(false);
});

test("Reopen all decisions… opens every decided group; the toast's Undo restores them", async ({ page }) => {
  const s = await scenario(page);
  await openTask(page, s);
  // No decision yet: no More… menu in the header.
  await expect(page.getByRole("button", { name: "More task actions", exact: true })).toHaveCount(0);
  await take(page, "absent", "Assertion").click();
  await keep(page).click();
  await expect(expandedTitle(page)).toHaveText("Absent reflexes");
  await keep(page).click();
  await expect(progress(page)).toContainText("2 of 8 groups open");
  await page.getByRole("button", { name: "More task actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reopen all decisions…", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Reopen 2 decided groups?" });
  await expect(confirm).toContainText("groups where everyone agreed are taken over again");
  // Cancel changes nothing.
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(progress(page)).toContainText("2 of 8 groups open");
  await page.getByRole("button", { name: "More task actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reopen all decisions…", exact: true }).click();
  await payloadOf(page, "reopen-all", () => confirm.getByRole("button", { name: "Reopen all", exact: true }).click());
  await expect(toast(page).locator(".ui-toast-message")).toHaveText("Reopened 2 decided groups.");
  await expect(progress(page)).toContainText("4 of 8 groups open");
  // The agreed groups are taken over again; the reopened groups open without a preselection.
  await expect(page.locator(".cons-group-agreed")).toHaveCount(4);
  await expect(group(page, "muscular hypotonia")).toHaveAccessibleName(/^Conflict muscular hypotonia 1 field to decide$/);
  await expect(group(page, "Absent reflexes")).toHaveAccessibleName(/^Absent reflexes to decide$/);
  await payloadOf(page, "undo-reopen-all", () => toast(page).getByRole("button", { name: "Undo", exact: true }).click());
  await expect(toast(page).locator(".ui-toast-message")).toHaveText("Decisions restored.");
  await expect(progress(page)).toContainText("2 of 8 groups open");
  await expect(group(page, "muscular hypotonia")).toHaveAccessibleName(/^muscular hypotonia decided: .*Absent/);
  await expect(group(page, "Absent reflexes")).toHaveAccessibleName(/^Absent reflexes decided/);
});

// Bug: after "Reopen all", ConsolidationScreen.reopenAll selects the first open group of the view from before the
// reopen (viewRef is not re-rendered yet when data.reopenAll() resolves), so "Reduced hearing" opens instead of the
// first open group in text order, "muscular hypotonia".
test.fixme("Reopen all decisions… selects the first reopened group in text order", async ({ page }) => {
  const s = await scenario(page);
  await openTask(page, s);
  await take(page, "absent", "Assertion").click();
  await keep(page).click();
  await expect(expandedTitle(page)).toHaveText("Absent reflexes");
  await keep(page).click();
  await page.getByRole("button", { name: "More task actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reopen all decisions…", exact: true }).click();
  await payloadOf(page, "reopen-all", () => page.getByRole("dialog", { name: "Reopen 2 decided groups?" }).getByRole("button", { name: "Reopen all", exact: true }).click());
  await expect(progress(page)).toContainText("4 of 8 groups open");
  await expect(expandedTitle(page)).toHaveText("muscular hypotonia");
  await expect(page.getByRole("button", { name: /muscular hypotonia/, expanded: true })).toBeFocused();
});

test("+ note and Guidelines unclear here go with the decision and can be changed on the decided group", async ({ page }) => {
  const s = await scenario(page);
  await openTask(page, s);
  await take(page, "absent", "Assertion").click();
  await expanded(page).getByRole("button", { name: "+ note", exact: true }).click();
  await expanded(page).getByLabel("Note for the lead", { exact: true }).fill("Negation reads oddly here.\nSecond line.");
  await expanded(page).getByLabel("Guidelines unclear here", { exact: true }).check();
  const payload = await payloadOf(page, "resolve", () => keep(page).click());
  expect(payload).toMatchObject({ note: "Negation reads oddly here.\nSecond line.", guidelines_unclear: true });
  const hypotonia = page.locator(".cons-group").filter({ has: group(page, "muscular hypotonia") });
  await expect(group(page, "muscular hypotonia").locator(".cons-tag")).toHaveText("flagged");
  // The closed group's note: its first line.
  await expect(hypotonia.locator(".cons-note-preview")).toHaveText("Note: Negation reads oddly here. …");
  // On the decided group, after a reload: Edit note saves on its own; the checkbox saves at once.
  await page.reload();
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });
  await expect(hypotonia.locator(".cons-note-preview")).toHaveText("Note: Negation reads oddly here. …");
  await expand(page, "muscular hypotonia");
  await expect(hypotonia.locator(".cons-note-text").first()).toHaveText("Note: Negation reads oddly here.\nSecond line.");
  await hypotonia.getByRole("button", { name: "Edit note", exact: true }).click();
  await hypotonia.getByLabel("Note for the lead", { exact: true }).fill("Ask the lead about negation.");
  const edited = await payloadOf(page, "annotate", () => hypotonia.getByRole("button", { name: "Save note", exact: true }).click());
  expect(edited).toMatchObject({ note: "Ask the lead about negation.", guidelines_unclear: true });
  await expect(hypotonia.getByRole("button", { name: "Edit note", exact: true })).toBeVisible();
  // The checkbox follows the saved state (uncheck() would expect it to change at once).
  const unflagged = await payloadOf(page, "annotate", () => hypotonia.getByLabel("Guidelines unclear here", { exact: true }).click());
  expect(unflagged).toMatchObject({ guidelines_unclear: false });
  await expect(group(page, "muscular hypotonia").locator(".cons-tag")).toHaveCount(0);
  await expect(hypotonia.getByLabel("Guidelines unclear here", { exact: true })).not.toBeChecked();
  await page.reload();
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });
  await expect(hypotonia.locator(".cons-note-preview")).toHaveText("Note: Ask the lead about negation.");
  await expect(group(page, "muscular hypotonia").locator(".cons-tag")).toHaveCount(0);
});

test.describe("between 700 and 1100 px", () => {
  test.use({ viewport: { width: 900, height: 900 } });

  test("Hide text hides the text pane and Show text brings it back", async ({ page }) => {
    const s = await scenario(page);
    await openTask(page, s);
    const text = page.locator(".cons-layout");
    await expect(text).toContainText("The patient had two seizures last week.");
    await page.getByRole("button", { name: "Hide text", exact: true }).click();
    await expect(text).not.toContainText("The patient had two seizures last week.");
    await expect(page.getByRole("button", { name: "Hide text", exact: true })).toHaveCount(0);
    // The groups stay usable without the text.
    await take(page, "absent", "Assertion").click();
    await keep(page).click();
    await expect(expandedTitle(page)).toHaveText("Absent reflexes");
    await page.getByRole("button", { name: "Show text", exact: true }).click();
    await expect(text).toContainText("The patient had two seizures last week.");
    await expect(page.getByRole("button", { name: "Show text", exact: true })).toHaveCount(0);
  });
});

test("Open in full editor and Back to consolidation keep the decisions", async ({ page }) => {
  const s = await scenario(page);
  await openTask(page, s);
  await take(page, "absent", "Assertion").click();
  await keep(page).click();
  await page.getByRole("group", { name: "Task", exact: true }).getByRole("button", { name: "Open in full editor", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignment_id}\\?view=editor$`));
  // The editor has no submit of its own: it points back to the consolidation screen.
  await expect(page.getByText("Submit on the consolidation screen.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Finish & submit/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to consolidation", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${s.assignment_id}$`));
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });
  await expect(progress(page)).toContainText("3 of 8 groups open");
  await expect(group(page, "muscular hypotonia")).toHaveAccessibleName(/^muscular hypotonia decided: .*Absent/);
});

test("Attach to a finding… adds a modifier term marked as a finding to a decided finding of its sentence", async ({ page }) => {
  const s = await scenario(page, { scenario: "modifiers", standalone: "true" });
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });
  await expect(expandedTitle(page)).toHaveText("focal seizures");
  await decideModifiers(page, "focal seizures", [["Recurrent", "Ana Weber"], ["Severe", "Ben Roth"]]);
  // Ben's Neonatal onset on "since birth" (S18): a warning, and no target while the sentence's findings are open.
  await expand(page, "since birth");
  await expect(expanded(page)).toContainText("Ben Roth used the modifier term Neonatal onset as a finding. Keep it only if it names the finding itself; otherwise attach it to a finding.");
  await expect(expanded(page).getByRole("button", { name: "Attach to a finding…" })).toHaveCount(0);
  await decideModifiers(page, "seizures", [["Severe", "Ana Weber"]]);
  await decideModifiers(page, "hypotonia", [["Severe", "Ben Roth"]]);
  await expand(page, "since birth");
  await expanded(page).getByRole("button", { name: "Attach to a finding…", exact: true }).click();
  // The decided findings of the same sentence, the nearest first.
  await expect(page.getByRole("menuitem")).toHaveText(["Hypotonia (HP:0001252), “hypotonia”", "Seizure (HP:0001250), “seizures”"]);
  const payload = await payloadOf(page, "resolve", () => page.getByRole("menuitem", { name: /^Hypotonia/ }).click());
  expect(payload).toMatchObject({ action: "leave_out" });
  expect(String(payload.attach_to)).toMatch(/^cons-/);
  await expect(group(page, "since birth")).toHaveAccessibleName("since birth attached: Neonatal onset “since birth” to Hypotonia (HP:0001252), “hypotonia”");
  await expand(page, "hypotonia");
  await expect(expanded(page)).toContainText("Attached modifier: Neonatal onset “since birth” from Ben Roth");
  await expect(expanded(page).locator(".cons-result")).toContainText("Neonatal onset");
  await decideModifiers(page, "Reduced reflexes", [], "Keep Ana Weber's finding");
  await page.getByRole("button", { name: "Submit consolidation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByText("6 groups, 5 findings, 1 not in result", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  // An attached modifier is no finding of its own: nothing to check before submitting.
  await expect(page.getByText("Consolidation submitted. Accept the result in Documents.", { exact: true })).toBeVisible();
});

test("submit with warnings: Check before you submit lists them; only Submit with 1 warning sends", async ({ page }) => {
  const s = await scenario(page, { scenario: "modifiers", standalone: "true" });
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(heading(page)).toBeVisible({ timeout: 30_000 });
  await decideModifiers(page, "focal seizures", [["Recurrent", "Ana Weber"], ["Severe", "Ben Roth"]]);
  // Keep Ben's Neonatal onset as a finding of its own.
  await decideModifiers(page, "since birth", [], "Keep Ben Roth's finding");
  await decideModifiers(page, "seizures", [["Severe", "Ana Weber"]]);
  await decideModifiers(page, "hypotonia", [["Severe", "Ben Roth"]]);
  await decideModifiers(page, "Reduced reflexes", [], "Keep Ana Weber's finding");
  await page.getByRole("button", { name: "Submit consolidation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByText("6 groups, 6 findings, 0 not in result", { exact: true })).toBeVisible();
  const submits: unknown[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && /\/workspaces\/[^/]+\/submit$/.test(new URL(request.url()).pathname)) submits.push(request.postDataJSON());
  });
  const refused = page.waitForResponse(r => r.request().method() === "POST" && /\/workspaces\/[^/]+\/submit$/.test(new URL(r.url()).pathname));
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  expect((await refused).status()).toBe(422);
  await expect(dialog.getByText("Check before you submit", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveText(["1 finding uses a modifier term (such as Severe) as the finding itself."]);
  await expect(dialog.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
  // Back closes without submitting; the next Submit asks again.
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Submit consolidation", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Submit", exact: true })).toBeVisible();
  await expect(dialog.getByText("Check before you submit")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  const accepted = page.waitForResponse(r => r.request().method() === "POST" && /\/workspaces\/[^/]+\/submit$/.test(new URL(r.url()).pathname) && r.ok());
  await dialog.getByRole("button", { name: "Submit with 1 warning", exact: true }).click();
  await accepted;
  expect(submits).toHaveLength(3);
  const payloads = submits.map(body => (body as { payload: Record<string, unknown> }).payload);
  expect(payloads[0]).not.toHaveProperty("warning_acknowledgement");
  expect(payloads[1]).not.toHaveProperty("warning_acknowledgement");
  expect(payloads[2]).toHaveProperty("warning_acknowledgement");
  await expect(page.getByText("Consolidation submitted. Accept the result in Documents.", { exact: true })).toBeVisible();
});

test("a consolidator without the Lead role submits; the lead then accepts the result", async ({ page }) => {
  const s = await scenario(page, { consolidator: "adj" });
  await openTask(page, s, s.users.adj);
  const projects = await page.request.get("/api/v1/projects");
  const project = (await projects.json() as Array<{ project_key: string; can_manage: boolean; roles: string[] }>).find(row => row.project_key === s.project);
  expect(project).toMatchObject({ can_manage: false });
  expect(project?.roles).not.toContain("lead");
  await decideAll(page);
  await page.getByRole("button", { name: "Submit consolidation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await expect(dialog.getByText("The lead then accepts the result.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Then accept the result in Documents.")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Consolidation submitted. The lead then accepts the result.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to my tasks", exact: true })).toBeVisible();
  // Reopened later, the task is read-only and waits for the lead.
  await page.reload();
  await expect(page.getByText("Submitted. Waiting for the lead.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Submit consolidation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open in full editor" })).toHaveCount(0);

  await page.context().clearCookies();
  await loginExisting(page, s.users.lead);
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  const decision = await openDecisionBlock(page, s.case_id, "en");
  await expect(decision.getByText(/^Consolidated by .+$/)).toBeVisible();
  const selecting = page.waitForResponse(r => r.request().method() === "PUT" && /\/final-selections$/.test(new URL(r.url()).pathname));
  await decision.getByRole("button", { name: "Accept result", exact: true }).click();
  expect((await selecting).ok()).toBeTruthy();
});
