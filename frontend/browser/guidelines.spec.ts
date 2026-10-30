/**
 * Project guidelines end to end (plan "Project guidelines" G6b; spec "Testing > Browser (Playwright)").
 *
 * Every test builds its own project through ``POST /__test_guidelines__`` (EMPTY: no guideline yet;
 * PUBLISHED: v1 published by the lead with the change note "First version"). Ana owns the en annotate
 * tasks ``annotate-1`` and ``annotate-2``, Ben the de translation review ``review-de``. Each person
 * works in an own browser context.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import { decisionBlock, documentsReady, openTextCard, showSegment, textCard } from "./documentsHelpers";
import { authenticatedRequest, submitCase } from "./helpers";
import { guidelineScenario, loginGuidelineUser, type GuidelinePerson, type GuidelineScenario } from "./guidelineHelpers";

type Assignment = components["schemas"]["AssignmentView"];
type Listing = components["schemas"]["GuidelineListing"];
type Preflight = components["schemas"]["FinalPreflight"];
type Job = components["schemas"]["JobView"];
type TranslationReview = components["schemas"]["TranslationReviewRecord"];

test.setTimeout(300_000);
test.use({ actionTimeout: 15_000 });

const V2_NOTE = "Also annotate family history findings.";
/** Distinctive sentences of the two guideline texts (tests/browser_guideline_scenarios.py). */
const V1_TEXT = "Annotate every phenotype the text states about the patient.";
const V2_TEXT = "Version 2: also annotate family history findings";

/** Screenshots for human review only (never baselines). */
const evidenceDir = () => resolve(test.info().config.rootDir, "../../build/project-guidelines/evidence");
async function evidence(page: Page, name: string) {
  mkdirSync(evidenceDir(), { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir(), `guidelines-${name}.png`), fullPage: true });
}

const root = (s: GuidelineScenario) => `/api/v1/projects/${encodeURIComponent(s.project)}`;

async function value<T>(page: Page, path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await authenticatedRequest(page, path, method, data);
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

/** A logged-in page of scenario person ``name`` in its own browser context. */
async function actor(browser: Browser, s: GuidelineScenario, name: GuidelinePerson) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await loginGuidelineUser(page, s, name);
  return { page, close: () => context.close() };
}

const settingsUrl = (s: GuidelineScenario) => `/#/projects/${encodeURIComponent(s.project)}/settings/guideline`;
const guidelinesButton = (page: Page, version: number) =>
  page.getByRole("button", { name: new RegExp(`^Guidelines v${version}, open the project guidelines`) });
const anyGuidelinesButton = (page: Page) => page.locator("button.task-guidelines-entry");
/** The editor header's "More actions" menu button; its menu holds the guidelines entry. */
const moreButton = (page: Page) => page.getByRole("button", { name: "More actions", exact: true });
/** Opens the editor's "More" menu, expects the guidelines item ``name`` (or none), closes the menu. */
async function expectGuidelinesItem(page: Page, name: string | RegExp | null) {
  await moreButton(page).click();
  if (name === null) await expect(page.getByRole("menuitem", { name: /^Guidelines/ })).toHaveCount(0);
  else await expect(page.getByRole("menuitem", typeof name === "string" ? { name, exact: true } : { name })).toBeVisible();
  await page.keyboard.press("Escape");
}
const drawer = (page: Page, version: number) => page.getByRole("complementary", { name: `Guidelines v${version}`, exact: true });
const fileInput = (page: Page) => page.getByLabel("Guideline file (.md or .txt, up to 256 KB)", { exact: true });
const notSeenLine = (page: Page) => page.locator(".guidelines-not-seen");
const PUBLISH_HINT = "Everyone sees a notice in their next task. Published versions cannot be edited, only withdrawn.";
/** The in-force card of Settings › Guidelines shows ``version`` from ``file``. */
async function expectInForce(page: Page, version: number, file: string, options?: { timeout?: number }) {
  await expect(page.getByRole("heading", { name: `In force Guidelines v${version}`, level: 2, exact: true })).toBeVisible(options);
  await expect(page.locator(".guidelines-in-force-file")).toContainText(new RegExp(`^${file.replace(".", "\\.")} · `));
}
/** Open the publish form (it opens by itself while nothing is in force). */
async function openPublish(page: Page) {
  const open = page.getByRole("button", { name: "Publish a new version", exact: true });
  await expect(open.or(fileInput(page)).first()).toBeVisible();
  if (await open.count()) await open.click();
  await expect(fileInput(page)).toBeVisible();
}
/** Choose ``item`` from the "More…" menu of version ``version`` inside ``scope``. */
async function moreAction(page: Page, scope: Locator, version: number, item: string) {
  await scope.getByRole("button", { name: `More actions, v${version}`, exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** Go to ``url``; reload when the page already shows it (a same-hash goto keeps the stale view). */
async function visit(page: Page, url: string) {
  if (page.url().endsWith(url)) await page.reload(); else await page.goto(url);
}

async function openTask(page: Page, s: GuidelineScenario, task: "annotate-1" | "annotate-2") {
  await visit(page, `/#/tasks/${s.assignments[task]}`);
  await expect(page.locator(".text-container")).toBeVisible();
}

/** Lead on Settings › Guidelines: choose ``file`` (and a note), check the preview facts, publish as ``version``. */
async function publish(page: Page, s: GuidelineScenario, file: "v1.md" | "v2.md", version: number, note = "") {
  await visit(page, settingsUrl(s));
  await openPublish(page);
  await fileInput(page).setInputFiles(s.files[file]);
  if (note) await page.getByLabel("What changed? (optional)").fill(note);
  await expect(page.getByRole("region", { name: `Preview of ${file}`, exact: true })).toBeVisible();
  await expect(page.getByText(PUBLISH_HINT, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Publish as v${version}`, exact: true }).click();
  const success = page.locator(".guidelines-success");
  await expect(success).toContainText(`Published v${version}. Annotators and reviewers see the update notice when they next open a task.`);
  await expect(success).toBeFocused();
}

/**
 * Lead Documents: the decision block of ``case language`` in the text card (route parameters ``panel`` and
 * ``panel_stage``), loaded; a decided row opens it through "Change final…".
 */
async function finalResult(page: Page, s: GuidelineScenario, caseId: string, language: string): Promise<Locator> {
  await visit(page, `/#/projects/${encodeURIComponent(s.project)}/documents?panel=${encodeURIComponent(`${caseId}:${language}`)}&panel_stage=final`);
  const card = textCard(page, caseId, language);
  await expect(card).toBeVisible();
  const panel = decisionBlock(card);
  const change = card.getByRole("button", { name: "Change final…", exact: true });
  await expect(panel.or(change).first()).toBeVisible();
  if (!(await panel.count())) await change.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Loading submissions…")).toHaveCount(0);
  return panel;
}

/** Lead Documents: open the "Translation reviews" dialog of the row ``case language`` (the card's version list). */
async function translationReviews(page: Page, s: GuidelineScenario, caseId: string, language: string): Promise<void> {
  await visit(page, `/#/projects/${encodeURIComponent(s.project)}/documents`);
  await documentsReady(page);
  const area = await openTextCard(page, caseId, language);
  await showSegment(area, "Translation");
  await area.getByRole("button", { name: /^Translation reviews for / }).first().click();
}

/** Run an export job to the end and return the downloaded archive. */
async function download(page: Page, jobId: number): Promise<Buffer> {
  await expect.poll(async () => (await value<Job>(page, `/api/v1/jobs/${jobId}`)).status, { timeout: 60_000 }).toBe("succeeded");
  const response = await authenticatedRequest(page, `/api/v1/jobs/${jobId}/download`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.body();
}

/** The entries of a ZIP archive (stored or deflated; no ZIP64). */
function unzip(data: Buffer): Map<string, Buffer> {
  let end = data.length - 22;
  while (end >= 0 && data.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Not a ZIP archive");
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error("Broken central directory");
    const method = data.readUInt16LE(offset + 10);
    const size = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + size);
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Annotation sets of a T1 bundle, by annotation set id. */
function annotationSets(bundle: Buffer): Map<string, { guideline_ref?: string | null }> {
  const sets = new Map<string, { guideline_ref?: string | null }>();
  for (const [name, data] of unzip(bundle)) {
    if (!name.startsWith("documents/")) continue;
    const set = (JSON.parse(data.toString("utf8")) as { annotation_set: { annotation_set_id: string; guideline_ref?: string | null } }).annotation_set;
    sets.set(set.annotation_set_id, set);
  }
  return sets;
}
const refOf = (sets: Map<string, { guideline_ref?: string | null }>, submissionId: string) =>
  [...sets.entries()].find(([id]) => id.endsWith(submissionId))?.[1].guideline_ref;

test("EMPTY: publish v1, read it in a task, publish v2, review under v2, export references, withdraw v2", async ({ page, browser }) => {
  const s = await guidelineScenario(page, "EMPTY");
  await loginGuidelineUser(page, s, "lead");
  const ana = await actor(browser, s, "ana");
  const ben = await actor(browser, s, "ben");
  try {
    // 1. Lead: empty state, then publish v1 (.md) with its preview.
    await visit(page, settingsUrl(s));
    await expect(page.getByRole("heading", { name: "No guidelines yet", level: 2, exact: true })).toBeVisible();
    await expect(page.getByText("Annotators and reviewers find them in every task.", { exact: true })).toBeVisible();
    await publish(page, s, "v1.md", 1);
    await expectInForce(page, 1, "v1.md");
    await evidence(page, "lead-published-v1");

    // 2. Ana: first-exposure notice, drawer (no script run, no image request), submit.
    const external: string[] = [];
    const dialogs: string[] = [];
    ana.page.on("request", request => { if (request.url().includes("example.org")) external.push(request.url()); });
    ana.page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await openTask(ana.page, s, "annotate-1");
    await expect(ana.page.getByText("This project has guidelines (v1)", { exact: true })).toBeVisible();
    await expect(ana.page.getByText("Read them before you start; they are available at any time under More › Guidelines in the toolbar.", { exact: true })).toBeVisible();
    await moreButton(ana.page).click();
    await ana.page.getByRole("menuitem", { name: "Guidelines v1 (new)", exact: true }).click();
    const panel = drawer(ana.page, 1);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Guidelines v1", level: 2 })).toBeFocused();
    await expect(panel.getByText(V1_TEXT)).toBeVisible();
    await expect(panel.getByRole("table")).toBeVisible();
    await expect(panel.getByRole("link", { name: /^Image: Example span/ })).toBeVisible();
    await expect(panel.locator("script")).toHaveCount(0);
    await expect(panel.locator("img")).toHaveCount(0);
    await expect(panel.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "All versions", exact: true })).toHaveAttribute("target", "_blank");
    await evidence(ana.page, "ana-drawer-v1");
    await panel.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(panel).toHaveCount(0);
    await expect(moreButton(ana.page)).toBeFocused();
    // Opening the drawer marks v1 as seen: the "(new)" mark goes.
    await expectGuidelinesItem(ana.page, "Guidelines v1");
    expect(external, "no image request").toEqual([]);
    expect(dialogs, "no script executed").toEqual([]);
    await submitCase(ana.page);
    const firstSubmission = (await value<Assignment>(ana.page, `/api/v1/assignments/${s.assignments["annotate-1"]}`)).last_submission_id!;
    expect(firstSubmission).toBeTruthy();

    // 3. Lead: Ana left "Not yet seen by"; Ben is still listed.
    await visit(page, settingsUrl(s));
    // The names open on demand.
    await notSeenLine(page).getByText("who not yet?", { exact: true }).click();
    await expect(notSeenLine(page)).toContainText(s.display_names.ben);
    await expect(notSeenLine(page)).not.toContainText(s.display_names.ana);

    // 4. Lead publishes v2 with a change note.
    await publish(page, s, "v2.md", 2, V2_NOTE);
    await expect(page.locator(".guidelines-facts dd").nth(1)).toHaveText(V2_NOTE);

    // 5. Ana's next task shows "Guidelines updated to v2" once, not on the following visit.
    await openTask(ana.page, s, "annotate-2");
    await expect(ana.page.getByText("Guidelines updated to v2", { exact: true })).toBeVisible();
    await expect(ana.page.getByText(`v2: ${V2_NOTE}`, { exact: true })).toBeVisible();
    await expect(ana.page.getByRole("button", { name: "Read guidelines v2", exact: true })).toBeVisible();
    await expectGuidelinesItem(ana.page, "Guidelines v2 (new)");
    await evidence(ana.page, "ana-update-notice-v2");
    await ana.page.goto("/#/");
    await expect(ana.page.locator(`a[href="#/tasks/${s.assignments["annotate-2"]}"]`)).toBeVisible();
    await openTask(ana.page, s, "annotate-2");
    await expectGuidelinesItem(ana.page, /^Guidelines v2/);
    await expect(ana.page.getByText("Guidelines updated to v2", { exact: true })).toHaveCount(0);
    await submitCase(ana.page);
    const secondSubmission = (await value<Assignment>(ana.page, `/api/v1/assignments/${s.assignments["annotate-2"]}`)).last_submission_id!;
    expect(secondSubmission).toBeTruthy();

    // 6. Ben's translation review shows "Guidelines v2"; his submit records v2.
    await visit(ben.page, `/#/tasks/${s.assignments["review-de"]}`);
    const target = ben.page.getByRole("textbox", { name: "Translation (de)", exact: true });
    await expect(target).toBeVisible();
    await expect(guidelinesButton(ben.page, 2)).toBeVisible();
    await expect(guidelinesButton(ben.page, 2)).toContainText("Guidelines v2");
    await expect(ben.page.getByText("This project has guidelines (v2)", { exact: true })).toBeVisible();
    await evidence(ben.page, "ben-review-v2");
    await ben.page.getByRole("radio", { name: "Accepted unchanged", exact: true }).check();
    await expect(ben.page.locator(".translation-save-status")).toHaveText("Saved");
    await ben.page.getByRole("button", { name: "Submit review…", exact: true }).click();
    const confirm = ben.page.getByRole("dialog", { name: "Submit this review?", exact: true });
    await confirm.getByRole("button", { name: "Submit review", exact: true }).click();
    // Issue 125: the task flow names the submitted review in a toast and leaves it.
    await expect(ben.page.locator(".ui-toast").filter({ hasText: / submitted\./ })).toBeVisible();

    // Documents: the final-result panel labels each submission with its version.
    let result = await finalResult(page, s, "guide-0001", "en");
    await expect(result.getByText("Guidelines v1 (current: v2)", { exact: true })).toBeVisible();
    result = await finalResult(page, s, "guide-0002", "en");
    await expect(result.getByText("Guidelines v2", { exact: true })).toBeVisible();
    await evidence(page, "documents-final-panel-v2");
    // Ben's review records v2: in the records and as the guideline line of the Documents "Translation reviews" dialog.
    const review = await value<Assignment>(ben.page, `/api/v1/assignments/${s.assignments["review-de"]}`);
    const reviews = () => value<TranslationReview[]>(page, `${root(s)}/documents/${encodeURIComponent(review.document_id)}/translation-reviews`);
    expect((await reviews()).map(record => [record.guideline_version, record.guideline_withdrawn])).toEqual([[2, false]]);
    await translationReviews(page, s, "guide-0001", "de");
    const reviewDialog = page.getByRole("dialog", { name: `Translation reviews: ${review.document_id}`, exact: true });
    await expect(reviewDialog.getByRole("listitem").first()).toBeVisible();
    await expect(reviewDialog.locator(".review-guideline")).toHaveText(["Guidelines v2"]);
    await evidence(page, "documents-translation-reviews-v2");
    await reviewDialog.getByRole("button", { name: "Close", exact: true }).last().click();

    // 7. Export: the annotation sets reference v1 and v2; the final archive carries no guideline file.
    const listing = await value<Listing>(page, `${root(s)}/guidelines`);
    const ref = (version: number) =>
      `urn:ontotator:${s.project}:guidelines:v${version}#sha256=${listing.versions.find(item => item.version === version)!.sha256}`;
    const t1 = await value<{ job_id: number }>(page, `${root(s)}/exports`, "POST", { kind: "t1" });
    const t1Sets = annotationSets(await download(page, t1.job_id));
    expect(refOf(t1Sets, firstSubmission)).toBe(ref(1));
    expect(refOf(t1Sets, secondSubmission)).toBe(ref(2));

    for (const task of ["annotate-1", "annotate-2"] as const) {
      const assignment = await value<Assignment>(ana.page, `/api/v1/assignments/${s.assignments[task]}`);
      await value(page, `${root(s)}/final-selections`, "PUT", {
        document_id: assignment.document_id, submission_id: assignment.last_submission_id, expected_revision: 0,
      });
    }
    const state = await value<Preflight>(page, `${root(s)}/exports/final/preflight`, "POST");
    const queued = await value<Record<string, number>>(page, `${root(s)}/exports/final`, "POST", {
      request_id: `guidelines-${Date.now()}`,
      state_digest: state.state_digest,
      acknowledged_warnings: state.warnings.map(warning => ({ id: warning.id, cause_revision: warning.cause_revision })),
      accepted_omissions: state.omissions,
    });
    const archive = unzip(await download(page, queued.job_id));
    const names = [...archive.keys()];
    expect(names.filter(name => /guideline/i.test(name)), "no guideline files").toEqual([]);
    for (const [name, data] of archive) {
      const nested = name.endsWith(".zip") ? [...unzip(data).values()] : [data];
      for (const part of nested) {
        expect(part.includes(V1_TEXT), `${name} holds no v1 text`).toBe(false);
        expect(part.includes(V2_TEXT), `${name} holds no v2 text`).toBe(false);
      }
    }
    expect(JSON.parse(archive.get("receipt.json")!.toString("utf8"))).not.toHaveProperty("guidelines");
    const selected = annotationSets(archive.get("selected.t1.zip")!);
    expect(refOf(selected, firstSubmission)).toBe(ref(1));
    expect(refOf(selected, secondSubmission)).toBe(ref(2));
    const index = archive.get("index.csv")!.toString("utf8").replace(/^\u{FEFF}/u, "").split(/\r?\n/)[0].split(",");
    expect(index.at(-1)).toBe("guideline_version");

    // 8. Lead withdraws v2: the task button disappears; Documents shows "Guidelines v2 (withdrawn)".
    await visit(page, settingsUrl(s));
    await moreAction(page, page.locator(".guidelines-current-actions"), 2, "Withdraw v2…");
    const withdraw = page.getByRole("dialog", { name: "Withdraw v2?", exact: true });
    await expect(withdraw).toContainText("The text, file name and change note of v2 are deleted and can no longer be read or exported.");
    await expect(withdraw).toContainText("No guideline is in force until you publish a new version. v1 does not come back automatically.");
    await withdraw.getByLabel("Reason (optional)").fill("Published too early.");
    await withdraw.getByRole("button", { name: "Withdraw v2", exact: true }).click();
    await expect(withdraw).toHaveCount(0);
    await expect(page.locator(".guidelines-success")).toContainText("v2 withdrawn.");
    await expect(page.locator(".guidelines-success")).toBeFocused();
    await expect(page.getByText(/^No guideline is in force\. v2 was withdrawn on .+ by .+\. Publish a new version, or republish an earlier version from the list below\.$/)).toBeVisible();
    await evidence(page, "lead-withdrawn-v2");

    await openTask(ana.page, s, "annotate-2");
    // annotate-2 is submitted: the read-only status replaces the save status.
    await expect(ana.page.locator(".case-toolbar .case-status")).toBeVisible();
    await expectGuidelinesItem(ana.page, null);
    await visit(ben.page, `/#/tasks/${s.assignments["review-de"]}`);
    await expect(ben.page.getByRole("textbox", { name: "Translation (de)", exact: true })).toBeVisible();
    await expect(anyGuidelinesButton(ben.page)).toHaveCount(0);

    expect((await reviews()).map(record => [record.guideline_version, record.guideline_withdrawn])).toEqual([[2, true]]);
    result = await finalResult(page, s, "guide-0002", "en");
    await expect(result.getByText("Guidelines v2 (withdrawn)", { exact: true })).toBeVisible();
    result = await finalResult(page, s, "guide-0001", "en");
    await expect(result.getByText("Guidelines v1", { exact: true })).toBeVisible();
    await evidence(page, "documents-withdrawn-v2");

    // 9. Lead republishes v1: its text fills the publish form for review and becomes v3.
    await visit(page, settingsUrl(s));
    const versions = page.getByRole("table", { name: "Guideline versions" });
    // Withdrawn v2 has no actions; v1 offers Republish under More….
    await expect(versions.getByRole("button", { name: "More actions, v2" })).toHaveCount(0);
    await moreAction(page, versions, 1, "Republish v1…");
    const preview = page.locator(".guidelines-preview");
    await expect(preview).toBeFocused();
    await expect(preview.getByRole("heading", { name: "Annotation guideline" })).toBeVisible();
    await expect(page.getByLabel("What changed? (optional)")).toHaveValue("Republished v1");
    await page.getByRole("button", { name: "Publish as v3", exact: true }).click();
    await expect(page.locator(".guidelines-success")).toContainText("Published v3.");
    await expectInForce(page, 3, "v1.md");
    await evidence(page, "lead-republished-v1");
  } finally {
    await Promise.all([ana.close(), ben.close()]);
  }
});

test("PUBLISHED: refused files show the server messages", async ({ page }) => {
  const s = await guidelineScenario(page, "PUBLISHED");
  await loginGuidelineUser(page, s, "lead");
  await visit(page, settingsUrl(s));
  await expectInForce(page, 1, "v1.md");
  await openPublish(page);

  // The server refuses the same files with these codes; the UI shows their messages (admin/errors.ts).
  const refusal = async (file: "big.txt" | "bad.pdf", mimeType: string) => {
    const me = await page.request.get("/api/v1/auth/me");
    const { csrf_token } = (await me.json()) as { csrf_token: string };
    const response = await page.request.post(`${root(s)}/guidelines`, {
      headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf_token },
      multipart: {
        file: { name: file, mimeType, buffer: readFileSync(s.files[file]) },
        change_note: "",
        expected_latest_version: "1",
      },
    });
    expect(response.status(), await response.text()).toBeGreaterThanOrEqual(400);
    return ((await response.json()) as { code?: string }).code;
  };
  expect(await refusal("big.txt", "text/plain")).toBe("GUIDELINE_TOO_LARGE");
  expect(await refusal("bad.pdf", "application/pdf")).toBe("GUIDELINE_FILE_TYPE");
  const big = { message: "The file is larger than 256 KB." };
  const pdf = { message: "Upload a .md or .txt file." };

  for (const [file, message] of [["big.txt", big.message], ["bad.pdf", pdf.message]] as const) {
    await fileInput(page).setInputFiles(s.files[file]);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(fileInput(page)).toHaveAccessibleDescription(new RegExp(message.replace(/[.()]/g, "\\$&")));
    await expect(page.getByRole("button", { name: /^Publish as v/ })).toHaveCount(0);
    await evidence(page, `refused-${file.replace(".", "-")}`);
  }
  // Nothing was published.
  const listing = await value<Listing>(page, `${root(s)}/guidelines`);
  expect(listing.latest_version).toBe(1);
});

test("PUBLISHED: Publish and Discard stay above a long preview and stick while it is read", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const s = await guidelineScenario(page, "PUBLISHED");
  await loginGuidelineUser(page, s, "lead");
  await visit(page, settingsUrl(s));
  await expectInForce(page, 1, "v1.md", { timeout: 20_000 });
  await openPublish(page);
  const paragraphs = Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1}: annotate what the text states about the patient.`);
  await fileInput(page).setInputFiles({ name: "long.md", mimeType: "text/markdown", buffer: Buffer.from(`# Long guideline\n\n${paragraphs.join("\n\n")}\n`) });
  const preview = page.getByRole("region", { name: "Preview of long.md", exact: true });
  await expect(preview).toBeVisible();
  const publishButton = page.getByRole("button", { name: "Publish as v2", exact: true });
  // The consequences come before Publish (#47 A-24); the actions come before the preview.
  const facts = page.getByText(PUBLISH_HINT, { exact: true });
  expect(await facts.evaluate((element, button) => !!(element.compareDocumentPosition(button!) & Node.DOCUMENT_POSITION_FOLLOWING), await publishButton.elementHandle())).toBe(true);
  await publishButton.scrollIntoViewIfNeeded();
  await expect(publishButton).toBeInViewport();
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeInViewport();

  // Read the preview to its end with the page scrolled past the facts: the action bar sticks to the top.
  const metrics = await preview.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    const main = element.closest(".shell-main")!;
    main.scrollTop += element.getBoundingClientRect().top - main.getBoundingClientRect().top;
    const bar = document.querySelector(".guidelines-publish-bar")!;
    return { main: main.getBoundingClientRect().top, bar: bar.getBoundingClientRect().top, position: getComputedStyle(bar).position,
      scrollTop: main.scrollTop, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, page: document.scrollingElement?.scrollTop };
  });
  expect(Math.abs(metrics.bar - metrics.main), `the action bar is stuck to the top of the scroll area: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expect(preview.getByText("Paragraph 120:", { exact: false })).toBeInViewport();
  // The hint line sits in the sticky bar, so it stays with the buttons.
  await expect(facts).toBeInViewport();
  await expect(publishButton).toBeInViewport();
  mkdirSync(resolve(test.info().config.rootDir, "../../build/acceptance-fixes/evidence"), { recursive: true });
  await page.screenshot({ path: resolve(test.info().config.rootDir, "../../build/acceptance-fixes/evidence/d1-guidelines-sticky-actions.png") });
  await publishButton.click();
  await expect(page.locator(".guidelines-success")).toContainText("Published v2.");
});

test("PUBLISHED: My tasks link and the guidelines page", async ({ page }) => {
  const s = await guidelineScenario(page, "PUBLISHED");
  await loginGuidelineUser(page, s, "ana");
  await page.goto("/#/");
  const link = page.getByRole("link", { name: /^Project guidelines v1(, .+)?$/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", `#/projects/${encodeURIComponent(s.project)}/guidelines`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/projects/${s.project}/guidelines$`));
  await expect(page.getByRole("heading", { name: "Project guidelines", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Guidelines v1", level: 2 })).toBeVisible();
  await expect(page.getByText(V1_TEXT)).toBeVisible();
  await expect(page.locator(".guideline-reader-meta")).toHaveText(/^Published .+\W+First version$/);
  const versions = page.getByRole("list", { name: "Versions" });
  await expect(versions.getByRole("listitem")).toHaveCount(1);
  await expect(versions.getByRole("listitem").first()).toHaveText(/^v1\W+Published .+\W+First version\W+current$/);
  // Non-leads see no reach.
  await expect(page.getByText(/Seen by/)).toHaveCount(0);
  await evidence(page, "guidelines-page");

  // The chosen-version address shows the same version.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/guidelines/v1`);
  await expect(page.getByRole("heading", { name: "Guidelines v1", level: 2 })).toBeVisible();
  await expect(versions.getByRole("link", { name: "v1", exact: true })).toHaveAttribute("aria-current", "page");
  // Opening the page records the read: v1 is no longer new in a task.
  await expect.poll(async () => (await value<Listing>(page, `${root(s)}/guidelines`)).my_latest_seen).toBe(1);
  await openTask(page, s, "annotate-1");
  await expectGuidelinesItem(page, "Guidelines v1");
});
