/**
 * Documents lead table: decision flows on the scenarios S2, S3, S11 to S15 on the documents
 * overview (spec "Final-result panel", V6, VD17; "Resolved rows and empty state"): "Accept
 * result…", "Compare results…" and "Review changes…" open the text card on Finalization (U3), whose
 * decision block decides and then moves to the next final decision of the list.
 *
 * Every test builds a fresh project through ``POST /__test_documents__`` and logs in
 * as its lead. Person labels are "Display name (pseudonym)" (D1), read from the project
 * members; the lead's own read "(pseudonym, you)". Changes "elsewhere"
 * (another lead, a reviewer, an annotator) go through the API in their own sessions.
 */
import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { components } from "../src/api/generated";
import {
  activityLines, documentsReady, documentsScenario, documentsTab, openCardHistory, openDecisionBlock, rowAction, rowCell, textCard, textName, textRow,
  type DocumentsScenario,
} from "./documentsHelpers";
import { authenticatedRequest, loginExisting, TEST_PASSWORD } from "./helpers";

type Member = components["schemas"]["Member"];
type Assignment = components["schemas"]["AssignmentView"];
type ProblemReport = components["schemas"]["ProblemReportView"];

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

/** "19 Oct, 15:01", optionally with seconds or a year, or "15:01" today. */
const TIME = String.raw`(?:\d{1,2} [A-Z][a-z]{2}(?: \d{4})?, )?\d{2}:\d{2}(?::\d{2})?`;
const OWN_RESULT_REASON = "In this project the consolidator of a text may not be one of its annotators. Another lead must choose this result.";

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The separator of joined copy: " · " before U9 removes it (F11), else ", " or a space. */
const SEP = "(?: · |, | )";
/** "Final result saved for {case} {language}." whatever the separator (" · " before U9). */
const savedFor = (caseId: string, language: string) => new RegExp(`Final result saved for ${esc(caseId)}(?: · | )${esc(language)}\\.`);
const requestId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Person label "Display name (pseudonym)" per fixture role name; the lead's own reads "(pseudonym, you)". */
async function labelsOf(page: Page, s: DocumentsScenario): Promise<Record<string, string>> {
  const response = await authenticatedRequest(page, `/api/v1/projects/${encodeURIComponent(s.project)}/members`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const members = (await response.json()) as Member[];
  const byUsername = new Map(members.map(member => [member.username, member]));
  return Object.fromEntries(Object.entries(s.users).map(([name, username]) => {
    const member = byUsername.get(username);
    if (!member) return [name, username];
    return [name, `${member.display_name} (${member.pseudonym}${username === s.users.lead ? ", you" : ""})`];
  }));
}

/** Regex source for a person in a report or pause line: "Display name (ann-0004)" or the pseudonym alone. */
function personPattern(label: string): string {
  const match = /^(.*) \((ann-\d+)\)$/.exec(label);
  if (!match) return esc(label);
  return `(?:${esc(match[1])} \\()?${match[2]}\\)?`;
}

const documentsUrl = (s: DocumentsScenario, query = "") => `/#/projects/${encodeURIComponent(s.project)}/documents${query}`;

/** Build scenario ``name`` and log in as its lead (without opening Documents yet). */
async function prepare(page: Page, name: string) {
  const s = await documentsScenario(page, name);
  await loginExisting(page, s.users.lead);
  const labels = await labelsOf(page, s);
  return { s, labels };
}

async function openDocuments(page: Page, s: DocumentsScenario, query = "") {
  await page.goto(documentsUrl(s, query));
  await documentsReady(page);
}

/** Another user's API session (own cookie jar and CSRF token). */
async function session(username: string) {
  const baseURL = test.info().project.use.baseURL!;
  const context: APIRequestContext = await playwrightRequest.newContext({ baseURL });
  const login = await context.post("/api/v1/auth/login", { data: { username, password: TEST_PASSWORD }, headers: { Origin: baseURL } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const call = async (path: string, method = "GET", data?: unknown) => {
    const me = await context.get("/api/v1/auth/me");
    expect(me.ok()).toBeTruthy();
    const { csrf_token } = (await me.json()) as { csrf_token: string };
    const response = await context.fetch(path, { method, data, headers: { Origin: baseURL, ...(method === "GET" ? {} : { "X-CSRF-Token": csrf_token }) } });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  return { call, close: () => context.dispose() };
}

/** The lead's own API call in the page session; fails the test on an error status. */
async function leadCall<T>(page: Page, path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await authenticatedRequest(page, path, method, data);
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

async function assignmentsOf(page: Page, s: DocumentsScenario): Promise<Assignment[]> {
  return leadCall<Assignment[]>(page, `/api/v1/projects/${encodeURIComponent(s.project)}/assignments`);
}

/** The live (not revoked) assignment of ``username`` on ``documentId``. */
async function assignmentOf(page: Page, s: DocumentsScenario, documentId: string, username: string): Promise<Assignment> {
  const found = (await assignmentsOf(page, s)).filter(a => a.document_id === documentId && a.username === username && !a.revoked_at);
  expect(found).toHaveLength(1);
  return found[0];
}

/** The visit badge ("Resolved" / "Changed: …") next to a row header. */
const visitBadge = (row: Locator) => row.locator(".documents-row-badge");
/** The decision block's polite live region. */
const panelLive = (panel: Locator) => panel.locator(':scope > p[role="status"]');
/** Activate a focusable ``aria-disabled`` control by keyboard (Playwright's click refuses such elements). */
async function activate(control: Locator) {
  await control.focus();
  await control.press("Enter");
}
/** Open the text card's decision block through the row's "Review changes…" action. */
async function reviewChanges(page: Page, caseId: string, language: string): Promise<Locator> {
  await rowAction(page, "Review changes…", caseId, language).click();
  const panel = await openDecisionBlock(page, caseId, language);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Loading submissions…")).toHaveCount(0);
  return panel;
}

test("first selection: Accept result… opens the text card, saves, announces and reports no decision left", async ({ page }) => {
  const { s } = await prepare(page, "S13");
  const caseId = "case-0713";
  await openDocuments(page, s);
  const en = textRow(page, caseId, "en");
  await expect(rowCell(en, "finalization")).toContainText("Your choice");

  // "Choose final…" became "Accept result…" (one submission, V6, X14, D2); the row shows "Carry to v2…", the card the decision.
  const panel = await openDecisionBlock(page, caseId, "en");
  await expect(panel.getByText(/^Accept .+ as the result\?$/)).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open submission", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Accept result", exact: true }).click();

  // Success line with the bar change; nothing else to decide; focus stays in the card.
  await expect(panel.locator(".final-panel-success")).toContainText(savedFor(caseId, "en"));
  await expect(panelLive(panel)).toHaveText("Final result saved. No more final results to decide.");
  await expect(panel.getByText("No more final results to decide.", { exact: true })).toBeVisible();
  await expect(textCard(page, caseId, "en").locator(":focus")).toHaveCount(1);
  await panel.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(panel).toHaveCount(0);
  await expect(rowCell(en, "finalization")).toContainText("accepted");
  // The accepted result on v1 also settles the carry to v2: nothing is left to decide.
  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
  await expect(documentsTab(page, "Done", 1)).toBeVisible();
});

test("S11 keep: the panel names the causes and Keep final saves at once", async ({ page }) => {
  const { s, labels } = await prepare(page, "S11");
  const caseId = "case-0611";
  const [ann1, ann2] = [esc(labels["ann-0001"]), esc(labels["ann-0002"])];
  await openDocuments(page, s);
  await expect(rowCell(textRow(page, caseId, "en"), "finalization")).toContainText("ready to accept");

  // SELECTED_RESULT_REVISED and SELECTED_NEWER_RESULT.
  const panel = await reviewChanges(page, caseId, "en");
  await expect(panel.getByText(new RegExp(`^Round 1${SEP}${ann1} has a newer submission \\(${TIME}\\)\\.$`))).toBeVisible();
  await expect(panel.getByText(new RegExp(`^Round 1${SEP}${ann2}${SEP}v1 was submitted after the final result was chosen \\(${TIME}\\)\\.$`))).toBeVisible();
  await expect(panel.getByRole("button", { name: "Use the newer result", exact: true })).toBeVisible();

  // The checkbox confirmation of the expanded row is gone: "Keep final on v1" is the decision itself.
  await panel.getByRole("button", { name: "Keep final on v1", exact: true }).click();
  await expect(panel.locator(".final-panel-success")).toContainText(savedFor(caseId, "en"));
  await expect(panel.getByText("No more final results to decide.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(rowAction(page, "Review changes…", caseId, "en")).toHaveCount(0);
  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
});

test("S3 a correction accepted after keep raises the text-corrected cause again", async ({ page }) => {
  const { s, labels } = await prepare(page, "S3");
  const caseId = "case-0211";
  await openDocuments(page, s);
  let panel = await reviewChanges(page, caseId, "de");
  await panel.getByRole("button", { name: "Keep final on v1", exact: true }).click();
  await expect(panel.locator(".final-panel-success")).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(rowAction(page, "Review changes…", caseId, "de")).toHaveCount(0);

  // The reviewer accepts v3 in their own session.
  const reviewer = await session(s.users.reviewer);
  try {
    const assignmentId = Number(s.open_review_assignment_id);
    const opened = (await reviewer.call(`/api/v1/translation-reviews/${assignmentId}`)) as { text: string; draft: { revision: number } };
    const saved = (await reviewer.call(`/api/v1/translation-reviews/${assignmentId}/draft`, "PUT", {
      expected_revision: opened.draft.revision, text: opened.text, form: { decision: "accepted_unchanged", clinical_change: false },
    })) as { revision: number };
    await reviewer.call(`/api/v1/translation-reviews/${assignmentId}/submit`, "POST", { expected_revision: saved.revision });
  } finally { await reviewer.close(); }

  await expect(async () => {
    await page.reload();
    await documentsReady(page);
    await expect(rowAction(page, "Review changes…", caseId, "de")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  panel = await reviewChanges(page, caseId, "de");
  // v2 stays acknowledged; only v3 is raised again, and the v3 review no longer waits.
  await expect(panel.getByText("The text changed from v1 to v3 after this final was chosen.", { exact: true })).toBeVisible();
  await expect(panel.getByText(/v2 \(Accepted\) corrects the text/)).toHaveCount(0);
  await expect(panel.getByText(`Waiting: translation review of v3 by ${labels.reviewer} is open.`, { exact: false })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Keep final on v1", exact: true })).toBeVisible();
});

test("S11 a kept superseded round stays acknowledged after a hold, resume and reopen", async ({ page }) => {
  const { s, labels } = await prepare(page, "S11");
  const caseId = "case-0611";
  const project = encodeURIComponent(s.project);
  const assignments = s.assignments as Record<string, number>;
  const submissions = s.submissions as Record<string, string>;
  await openDocuments(page, s);

  // The lead carries ann-0001's revised result forward: Round 1 is superseded by Round 2.
  const before = (await assignmentsOf(page, s)).find(a => a.id === assignments["ann-0001"])!;
  const created = await leadCall<{ round_id: string }>(page, `/api/v1/assignments/${before.id}/rounds`, "POST", {
    request_id: requestId("round"), expected_workflow_revision: before.workflow_revision, kind: "carry_forward", source_submission_ids: [submissions.revised],
  });
  await page.reload();
  await documentsReady(page);
  const panel = await reviewChanges(page, caseId, "en");
  await expect(panel.getByText(new RegExp(`^Round 1${SEP}${esc(labels["ann-0001"])} has been superseded by Round 2\\.$`))).toBeVisible();
  await panel.getByRole("button", { name: "Keep final on v1", exact: true }).click();
  await expect(panel.locator(".final-panel-success")).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(rowAction(page, "Review changes…", caseId, "en")).toHaveCount(0);

  // ann-0001 reports a problem (task paused); the lead closes the report, reopens it, releases the pause and closes it again.
  const annotator = await session(s.users["ann-0001"]);
  let report: ProblemReport;
  try {
    const current = (await assignmentsOf(page, s)).find(a => a.id === before.id)!;
    report = (await annotator.call(`/api/v1/assignments/${before.id}/problem-reports`, "POST", {
      request_id: requestId("report"), expected_workflow_revision: current.workflow_revision, round_id: created.round_id, reason: "The second seizure is missing.",
    })) as ProblemReport;
  } finally { await annotator.close(); }
  const act = async (action: string, ids: number[] = []) => {
    report = await leadCall<ProblemReport>(page, `/api/v1/problem-reports/${report.report_id}/actions`, "POST", {
      request_id: requestId(action), expected_revision: report.revision, action, reason: `Lead ${action}.`, assignment_ids: ids,
    });
  };
  await act("resolve");
  await act("reopen");
  await act("resume", [before.id]);
  await act("resolve");
  expect((await assignmentsOf(page, s)).find(a => a.id === before.id)?.held).toBe(false);

  await page.reload();
  await documentsReady(page);
  await expect(rowAction(page, "Review changes…", caseId, "en")).toHaveCount(0);
  await expect(rowCell(textRow(page, caseId, "en"), "finalization")).not.toContainText("ready to accept");
  const rows = await leadCall<{ groups: { rows: { language: string; categories: string[] }[] }[] }>(page, `/api/v1/projects/${project}/document-rows?case=${caseId}`);
  expect(rows.groups.flatMap(group => group.rows).find(row => row.language === "en")?.categories ?? []).not.toContain("confirm-final");
});

test("S2 keep under a decision filter: the row turns Resolved and the panel moves to the next decision", async ({ page }) => {
  const { s, labels } = await prepare(page, "S2");
  const caseId = "case-0108";
  const documents = s.documents as Record<string, string>;
  // The lead restarts ann-0001's es and fr work: their final results come from abandoned rounds.
  for (const language of ["es", "fr"]) {
    const assignment = await assignmentOf(page, s, documents[language], s.users["ann-0001"]);
    await leadCall(page, `/api/v1/assignments/${assignment.id}/rounds`, "POST", {
      request_id: requestId("restart"), expected_workflow_revision: assignment.workflow_revision, kind: "clean_restart", reason: "Start over after the source review.",
    });
  }
  await openDocuments(page, s, "?decision=confirm-final");
  await expect(textRow(page, caseId, "es")).toBeVisible();
  await expect(textRow(page, caseId, "fr")).toBeVisible();
  await expect(textName(page, caseId, "de")).toHaveCount(0);

  const panel = await reviewChanges(page, caseId, "es");
  await expect(panel.getByText(new RegExp(`^Round 1${SEP}${esc(labels["ann-0001"])} is abandoned\\.$`))).toBeVisible();
  await panel.getByRole("button", { name: "Keep final on v1", exact: true }).click();

  // VD17: after the decision the panel shows the next final decision of the list (fr).
  const next = await openDecisionBlock(page, caseId, "fr");
  await expect(next).toBeVisible();
  await expect(next.locator(".final-panel-success")).toContainText(savedFor(caseId, "es"));
  await expect(panelLive(next)).toHaveText(new RegExp(`^Final result saved\\. Next: ${esc(caseId)}(?: · | )fr\\.$`));
  await expect(next.getByText(new RegExp(`^Round 1${SEP}${esc(labels["ann-0001"])} is abandoned\\.$`))).toBeVisible();
  await textCard(page, caseId, "fr").locator("[data-dialog-close]").click();

  // The kept row stays visible and Resolved.
  await expect(visitBadge(textRow(page, caseId, "es"))).toHaveText("Resolved");
  await expect(rowAction(page, "Review changes…", caseId, "fr")).toBeVisible();
});

test("S13 Changed: work assigned elsewhere marks the row Changed", async ({ page }) => {
  const { s } = await prepare(page, "S13");
  const caseId = "case-0713";
  const documents = s.documents as Record<string, string>;
  await openDocuments(page, s, "?decision=missing-final");
  await expect(textRow(page, caseId, "en")).toBeVisible();

  // A third annotator on the text (P3 limits the annotations per text).
  await leadCall(page, `/api/v1/projects/${encodeURIComponent(s.project)}/settings`, "PATCH", { annotations_per_text: 3 });
  const assigned = await leadCall<{ refused: unknown[] }>(page, `/api/v1/projects/${encodeURIComponent(s.project)}/assignments`, "POST", {
    rows: [{ document_id: documents.v2, username: s.users["ann-0002"] }], task: "annotate",
  });
  expect(assigned.refused).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const en = textRow(page, caseId, "en");
  await expect(visitBadge(en)).toHaveText("Changed: Work assigned");
  // The open work shows in the row: v2 is annotated now.
  await expect(rowCell(en, "annotation")).not.toContainText("v2 not annotated");
});

test("S11 conflict: another lead changes the selection while the panel is open; Review again reloads", async ({ page }) => {
  const { s } = await prepare(page, "S11");
  const caseId = "case-0611";
  const submissions = s.submissions as Record<string, string>;
  const documents = s.documents as Record<string, string>;
  const pseudonym = `Lead-${Date.now().toString(36)}`;
  const username = pseudonym.toLowerCase();
  const created = await page.request.post(`/__test_user__?${new URLSearchParams({ username, pseudonym, projects: s.project, assign: "none" })}`);
  expect(created.ok(), await created.text()).toBeTruthy();

  await openDocuments(page, s);
  const panel = await reviewChanges(page, caseId, "en");
  await expect(panel.getByRole("button", { name: "Keep final on v1", exact: true })).toBeVisible();

  const other = await session(username);
  try {
    const current = (await other.call(`/api/v1/projects/${encodeURIComponent(s.project)}/document-rows?case=${caseId}`)) as { groups: { rows: { language: string; final: { revision: number } | null }[] }[] };
    const revision = current.groups.flatMap(group => group.rows).find(row => row.language === "en")!.final!.revision;
    await other.call(`/api/v1/projects/${encodeURIComponent(s.project)}/final-selections`, "PUT", {
      document_id: documents.en, submission_id: submissions.newer, expected_revision: revision, acknowledged_cause_ids: [],
    });
  } finally { await other.close(); }

  await panel.getByRole("button", { name: "Keep final on v1", exact: true }).click();
  const notice = panel.getByRole("alert");
  await expect(notice).toContainText("This final result changed.");
  await panel.getByRole("button", { name: "Review again", exact: true }).click();
  await expect(notice).toHaveCount(0);
  // The other lead's choice is the final now: nothing is left to review on this row.
  await expect(rowCell(textRow(page, caseId, "en"), "finalization")).not.toContainText("ready to accept");
});

test("S13 session ends during a decision: nothing is saved and the decision stays available", async ({ page }) => {
  const { s } = await prepare(page, "S13");
  const caseId = "case-0713";
  await openDocuments(page, s);
  const panel = await openDecisionBlock(page, caseId, "en");
  const accept = panel.getByRole("button", { name: "Accept result", exact: true });
  await expect(accept).toBeVisible();
  await page.context().clearCookies();
  await accept.click();
  await expect(panel.getByRole("alert")).toHaveText("Your session ended. Nothing was saved. Sign in and confirm again.");
  await expect(accept).not.toHaveAttribute("aria-disabled", "true");
  await expect(rowCell(textRow(page, caseId, "en"), "finalization")).toContainText("Your choice");
});

test("S12 Resume task opens the report with the pause preselected; releasing it and going back shows Resolved", async ({ page }) => {
  const { s, labels } = await prepare(page, "S12");
  const caseId = "case-0512";
  await openDocuments(page, s, "?decision=report-or-pause");
  await expect(textRow(page, caseId, "de")).toBeVisible();
  await expect(textRow(page, caseId, "en")).toBeVisible();

  // The fr task is paused by the open en report: a history line with "Open report", not a decision.
  await openDocuments(page, s);
  await expect(rowAction(page, "Resume task…", caseId, "fr")).toHaveCount(0);
  const fr = await openCardHistory(page, caseId, "fr");
  const paused = activityLines(fr).filter({ hasText: /^Annotation Task paused/ });
  await expect(paused.getByRole("link", { name: "Open report", exact: true })).toHaveAttribute("href", new RegExp(`/problem-reports/${esc(String((s.reports as Record<string, string>).open))}`));
  await expect(activityLines(fr).filter({ hasText: new RegExp(personPattern(labels["ann-0002"])) }).first()).toBeVisible();

  // de: the task is paused, but its report is resolved: "Resume task…" (row action) opens the report with the pause preselected.
  await openDocuments(page, s, "?decision=report-or-pause");
  // The filtered list has loaded (fr is not a decision), so the visit remembers de.
  await expect(textName(page, caseId, "fr")).toHaveCount(0);
  await expect(rowCell(textRow(page, caseId, "de"), "annotation")).toContainText("⏸");
  await rowAction(page, "Resume task…", caseId, "de").click();

  await expect(page.getByText(/^Problem report · /)).toBeVisible();
  const release = page.getByRole("group", { name: "Release pause", exact: true });
  await expect(release).toBeVisible();
  await expect(release.getByRole("checkbox", { name: new RegExp(`, ${esc(caseId)} de, annotation$`) })).toBeChecked();
  await release.getByRole("textbox", { name: /Reason/ }).fill("The question is answered; continue the annotation.");
  await release.getByRole("button", { name: "Release pause", exact: true }).click();
  await expect(page.getByText(/^Released the pause on /)).toBeVisible();

  await page.getByRole("link", { name: "Back to Documents" }).first().click();
  await expect(page).toHaveURL(/decision=report-or-pause/);
  await documentsReady(page);
  await expect(visitBadge(textRow(page, caseId, "de"))).toHaveText("Resolved");
  await expect(textRow(page, caseId, "en")).toBeVisible();
});

test("S14 waiting: an open translation review and open work after an early selection need nothing from the lead", async ({ page }) => {
  const { s, labels } = await prepare(page, "S14");
  const caseId = "case-0814";
  await openDocuments(page, s);
  await expect(documentsTab(page, "Needs your decision", 0)).toBeVisible();
  await expect(documentsTab(page, "In progress", 2)).toBeVisible();

  // de: the translation review of v1 is open, nobody saved it yet (issue 258); it waits on the reviewer, no action.
  const de = textRow(page, caseId, "de");
  await expect(rowCell(de, "translation")).toContainText("assigned, not started");
  await expect(rowCell(de, "waiting")).toContainText(labels.reviewer);
  await expect(rowCell(de, "next")).toHaveText("");
  // en: Round 1 of ann-0002 is still open after the early selection; it waits on ann-0002.
  const en = textRow(page, caseId, "en");
  await expect(rowCell(en, "annotation")).toContainText("1 of 1 submitted, not started");
  await expect(rowCell(en, "waiting")).toContainText(labels["ann-0002"]);
  await expect(rowCell(en, "next")).toHaveText("");
  const area = await openCardHistory(page, caseId, "en");
  await expect(activityLines(area).filter({ hasText: new RegExp(`^Annotation: ${esc(labels["ann-0002"])}.*Round 1`) })).toHaveCount(1);
});

test("S15 the lead's own result is not selectable when adjudication is separate", async ({ page }) => {
  const { s, labels } = await prepare(page, "S15");
  const caseId = "case-0001";
  await openDocuments(page, s);
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 1 of 2");
  // VD5: groups never collapse; every row of the page is shown.
  await expect(textName(page, "case-0002", "en")).toBeVisible();

  // Both submissions have no findings: full agreement (W1, U7), so the row reads "Accept result…" (issue 198) and the
  // per-submission table is under "Show submissions".
  await rowAction(page, "Accept result…", caseId, "en").click();
  const panel = await openDecisionBlock(page, caseId, "en");
  await expect(panel.getByText("Both submissions have no findings", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Show submissions", exact: true }).click();
  const lead = labels.lead.replace(/ \(.*\)$/, "");
  const own = panel.getByRole("row").filter({ has: page.getByRole("rowheader").filter({ hasText: new RegExp(`^${esc(lead)}`) }) });
  const blocked = own.getByRole("button", { name: "Use as final", exact: true });
  await expect(blocked).toHaveAttribute("aria-disabled", "true");
  await expect(blocked).toHaveAccessibleDescription(new RegExp(`${esc(OWN_RESULT_REASON)}$`));
  await expect(own.getByText(OWN_RESULT_REASON, { exact: true })).toBeVisible();
  await activate(blocked);
  await expect(panelLive(panel)).toHaveText(OWN_RESULT_REASON);
  await expect(panel.locator(".final-panel-success")).toHaveCount(0);

  const otherName = labels["ann-0001"].replace(/ \(.*\)$/, "");
  const other = panel.getByRole("row").filter({ has: page.getByRole("rowheader").filter({ hasText: new RegExp(`^${esc(otherName)}`) }) });
  await expect(other.getByRole("button", { name: "Use as final", exact: true })).not.toHaveAttribute("aria-disabled", "true");
});
