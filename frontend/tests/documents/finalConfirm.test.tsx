import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, ConflictError, type DocumentRowView, type DocumentRowsPage, type RowSubmissions } from "../../src/api/client";
import { DocumentsPage, type DocumentsPageProps } from "../../src/admin/DocumentsPage";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { barChanges, currentFinalLabel, failureOf, successMessage } from "../../src/documents/FinalConfirm";
import { rowSubmissionLabel } from "../../src/documents/SubmissionsTable";
import { FINAL_SELECTION_CHANGED } from "../../src/variants/finalSelectionState";
import { bar, final, group, item, page, row, rowKey, scenarioS0, scenarioS1, submission, submissions, version, work } from "./fixtures";

const OWN_REASON = "This project keeps adjudication separate from annotation. Another lead must choose this result.";

let currentPage: DocumentRowsPage;
let currentSubmissions: Record<string, RowSubmissions>;

function serve(next: DocumentRowsPage, rowSubmissions: Record<string, RowSubmissions> = currentSubmissions) {
  currentPage = next;
  currentSubmissions = rowSubmissions;
}

function renderPage(query: ProjectDocumentsQuery) {
  const onNavigate = vi.fn();
  const props: DocumentsPageProps = { projectKey: "p", query, canManage: true, currentUser: { username: "lead", pseudonym: "lead-0002" }, onNavigate };
  return { ...render(<DocumentsPage {...props} />), onNavigate };
}

const liveRegion = () => document.querySelector(".documents-page > p[role='status']")!;
const confirmGroup = (name: string) => screen.getByRole("group", { name });
/** Refetch the rows as on window focus. */
const refetch = async () => {
  const calls = vi.mocked(api.listDocumentRows).mock.calls.length;
  act(() => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(vi.mocked(api.listDocumentRows).mock.calls.length).toBe(calls + 1));
};

/** case-0042 en without a final result: two submitted annotations. */
function openRow(overrides: Partial<DocumentRowView> = {}) {
  const s1 = scenarioS1();
  const en = { ...s1.group.rows[0], final: null, missing_final: { counts: true, reason: null }, categories: ["missing-final" as const], ...overrides };
  return { s1, en, page: page([group("case-0042", [en])]) };
}

beforeEach(() => {
  currentPage = page([]);
  currentSubmissions = {};
  vi.spyOn(api, "listDocumentRows").mockImplementation(async () => structuredClone(currentPage));
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => structuredClone(currentSubmissions[rowKey(caseId, language)] ?? submissions(caseId, language)));
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ languages: ["en", "de"] } as never);
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue([]);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "x", language: "en", document_id: "d", submission_id: "s", revision: 1 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("uses a submission as the first final result and focuses the new Final row's View link", async () => {
  const { s1, en, page: initial } = openRow();
  serve(initial, s1.submissions);
  const changed = vi.fn();
  window.addEventListener(FINAL_SELECTION_CHANGED, changed);
  renderPage({ open: [rowKey("case-0042", "en")] });
  const [first] = await screen.findAllByRole("button", { name: "Use as final…" });
  fireEvent.click(first);
  const label = rowSubmissionLabel(s1.submissions[rowKey("case-0042", "en")].submissions[0], "en", false);
  const confirm = confirmGroup("Use as final result");
  expect(document.activeElement).toBe(within(confirm).getByRole("heading", { name: "Use as final result" }));
  expect(within(confirm).getByText(`Use ${label} as the final result for case-0042 · en?`)).toBeTruthy();
  serve(page([group("case-0042", [{ ...en, final: final({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "sub-0042-a", revision: 1 }), categories: [] }])], { bar: bar({ total: 0, missing_final: 0 }) }));
  fireEvent.click(within(confirm).getByRole("button", { name: "Use as final" }));
  expect(api.selectFinalResult).toHaveBeenCalledWith("p", { document_id: "case-0042-en", submission_id: "sub-0042-a", expected_revision: 0, acknowledged_cause_ids: [] });
  await waitFor(() => expect(liveRegion().textContent).toContain(`${label} is now the final result.`));
  expect(liveRegion().textContent).toContain("Needs your decision: 0 (was 1).");
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe(`View ${label}`));
  expect(document.activeElement?.closest("tr")?.classList.contains("final-row")).toBe(true);
  expect(screen.queryByRole("group", { name: "Use as final result" })).toBeNull();
  expect(changed).toHaveBeenCalled();
  window.removeEventListener(FINAL_SELECTION_CHANGED, changed);
});


it("replaces the final result with the captured revision", async () => {
  const s1 = scenarioS1();
  const en = { ...s1.group.rows[0], final: { ...s1.group.rows[0].final!, revision: 4 } };
  serve(page([group("case-0042", [en])]), s1.submissions);
  renderPage({ open: [rowKey("case-0042", "en")] });
  fireEvent.click(await screen.findByRole("button", { name: "Replace…" }));
  const [a, b] = s1.submissions[rowKey("case-0042", "en")].submissions;
  const group1 = confirmGroup("Replace final result");
  expect(within(group1).getByText(`Replace ${rowSubmissionLabel(a, "en", false)} with ${rowSubmissionLabel(b, "en", false)}? The previous choice stays in the history.`)).toBeTruthy();
  fireEvent.click(within(group1).getByRole("button", { name: "Replace" }));
  expect(api.selectFinalResult).toHaveBeenCalledWith("p", { document_id: "case-0042-en", submission_id: "sub-0042-b", expected_revision: 4, acknowledged_cause_ids: [] });
});

it("adds still-open work, the abandoned-round note and the own-result note to Use", async () => {
  const s1 = scenarioS1();
  const data = s1.submissions[rowKey("case-0042", "en")];
  const mine = { ...data, submissions: [submission({ ...data.submissions[0], is_me: true, round_id: "r1", round_ordinal: 1, round_state: "abandoned" }), data.submissions[1]] };
  const en = { ...s1.group.rows[0], final: null, work: [work({ assignment_id: 3, document_id: "case-0042-en", author_label: "ann-0009", status: "in_progress" })] };
  serve(page([group("case-0042", [en])]), { [rowKey("case-0042", "en")]: mine });
  renderPage({ open: [rowKey("case-0042", "en")] });
  fireEvent.click((await screen.findAllByRole("button", { name: "Use as final…" }))[0]);
  const confirm = confirmGroup("Use as final result");
  expect(within(confirm).getByText("Still open: ann-0009 annotating.")).toBeTruthy();
  expect(within(confirm).getByText("This result belongs to an abandoned round; you will be asked to confirm it again after choosing.")).toBeTruthy();
  expect(within(confirm).getByText("This is your own result.")).toBeTruthy();
});

it("keeps own results unselectable while the current project rule is on", async () => {
  const s1 = scenarioS1();
  const data = s1.submissions[rowKey("case-0042", "en")];
  const mine = { ...data, submissions: [submission({ ...data.submissions[0], is_me: true }), data.submissions[1]] };
  serve(page([group("case-0042", [{ ...s1.group.rows[0], final: null }])], { adjudicator_not_annotator: true }), { [rowKey("case-0042", "en")]: mine });
  renderPage({ open: [rowKey("case-0042", "en")] });
  const [own] = await screen.findAllByRole("button", { name: "Use as final…" });
  expect(own.getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(own.getAttribute("aria-describedby")!.split(" ").at(-1)!)?.textContent).toBe(OWN_REASON);
  fireEvent.click(own);
  expect(screen.queryByRole("group", { name: "Use as final result" })).toBeNull();
  expect(liveRegion().textContent).toBe(OWN_REASON);
});

it("makes Keep unavailable when the rule is switched on after the selection", async () => {
  const s0 = scenarioS0();
  const de = { ...s0.group.rows[1], final: { ...s0.group.rows[1].final!, is_mine: true, adjudicator_not_annotator: false } };
  serve(page([group("synthetic-accepted", [de])]), s0.submissions);
  renderPage({ open: [rowKey("synthetic-accepted", "de")] });
  const keep = await screen.findByRole("button", { name: "Keep final result…" });
  expect(keep.getAttribute("aria-disabled")).toBeNull();
  serve(page([group("synthetic-accepted", [de])], { adjudicator_not_annotator: true }));
  await refetch();
  await waitFor(() => expect(screen.getByRole("button", { name: "Keep final result…" }).getAttribute("aria-disabled")).toBe("true"));
  fireEvent.click(screen.getByRole("button", { name: "Keep final result…" }));
  expect(screen.queryByRole("group", { name: "Keep final result" })).toBeNull();
  expect(liveRegion().textContent).toBe(OWN_REASON);
});

it("keeps the final result only with the checkbox and acknowledges every cause shown at open", async () => {
  const s0 = scenarioS0();
  const de = s0.group.rows[1];
  const second = item({ code: "SELECTED_ROUND_SUPERSEDED", cause_id: "SELECTED_ROUND_SUPERSEDED:round-s0-1", category: "confirm-final" });
  const withTwo = { ...de, issues: [...de.issues, second] };
  serve(page([group("synthetic-accepted", [withTwo])]), s0.submissions);
  renderPage({ open: [rowKey("synthetic-accepted", "de")] });
  fireEvent.click(await screen.findByRole("button", { name: "Keep final result…" }));
  const confirm = confirmGroup("Keep final result");
  expect(within(confirm).getByText(/^Keep Annotation · Round 1 · ann-0004 · de v1 · .+ as the final result for synthetic-accepted · de\?$/)).toBeTruthy();
  expect(within(confirm).getByText("v2 (Ready for review) corrects the text of the final result.")).toBeTruthy();
  expect(within(confirm).getByText("Round 1 (ann-0004) has been superseded by Round 2.")).toBeTruthy();
  const primary = within(confirm).getByRole("button", { name: "Keep as final" });
  expect(primary.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(primary);
  expect(within(confirm).getByText("Check the box to confirm you reviewed these changes.")).toBeTruthy();
  expect(api.selectFinalResult).not.toHaveBeenCalled();

  // A refresh that changes neither the revision nor the cause set keeps the confirmation open.
  serve(page([group("synthetic-accepted", [{ ...withTwo, last_activity_at: "2026-10-19T09:00:00Z" }])]));
  await refetch();
  expect(confirmGroup("Keep final result")).toBe(confirm);

  fireEvent.click(within(confirm).getByRole("checkbox", { name: "I reviewed these changes and keep this exact result" }));
  expect(primary.getAttribute("aria-disabled")).toBeNull();
  serve(page([group("synthetic-accepted", [{ ...de, issues: [], categories: [], final: { ...de.final!, revision: 2 } }])]));
  fireEvent.click(primary);
  expect(api.selectFinalResult).toHaveBeenCalledWith("p", {
    document_id: "synthetic-accepted-de", submission_id: "sub-s0-r1", expected_revision: 1,
    acknowledged_cause_ids: [de.issues[0].cause_id, second.cause_id],
  });
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Submissions (2)"));
  expect(liveRegion().textContent).toMatch(/^Kept Annotation · Round 1 · ann-0004 · de v1 · .+\. Still open: Round 3 \(ann-0004\) is in progress\. You can choose again once it is submitted\./);
});

it("closes the confirmation when the row's revision or cause set changes on refresh", async () => {
  const s0 = scenarioS0();
  const de = s0.group.rows[1];
  serve(page([group("synthetic-accepted", [de])]), s0.submissions);
  renderPage({ open: [rowKey("synthetic-accepted", "de")] });
  fireEvent.click(await screen.findByRole("button", { name: "Keep final result…" }));
  expect(confirmGroup("Keep final result")).toBeTruthy();
  serve(page([group("synthetic-accepted", [{ ...de, final: { ...de.final!, revision: 2 } }])]));
  await refetch();
  await waitFor(() => expect(screen.queryByRole("group", { name: "Keep final result" })).toBeNull());
});

it("allows one confirmation per page and blocks other triggers while busy", async () => {
  const { s1, page: initial } = openRow();
  serve(initial, s1.submissions);
  renderPage({ open: [rowKey("case-0042", "en")] });
  const [first, second] = await screen.findAllByRole("button", { name: "Use as final…" });
  fireEvent.click(first);
  fireEvent.click(second);
  expect(screen.getAllByRole("group", { name: "Use as final result" })).toHaveLength(1);
  expect(liveRegion().textContent).toBe("Previous confirmation closed.");
  const label = rowSubmissionLabel(s1.submissions[rowKey("case-0042", "en")].submissions[1], "en", false);
  expect(within(confirmGroup("Use as final result")).getByText(`Use ${label} as the final result for case-0042 · en?`)).toBeTruthy();
  vi.mocked(api.selectFinalResult).mockReturnValue(new Promise(() => {}));
  fireEvent.click(within(confirmGroup("Use as final result")).getByRole("button", { name: "Use as final" }));
  await waitFor(() => expect(first.getAttribute("aria-disabled")).toBe("true"));
  fireEvent.click(first);
  expect(within(confirmGroup("Use as final result")).getByText(`Use ${label} as the final result for case-0042 · en?`)).toBeTruthy();
});

it("returns focus to the trigger on Cancel and Escape", async () => {
  const { s1, page: initial } = openRow();
  serve(initial, s1.submissions);
  renderPage({ open: [rowKey("case-0042", "en")] });
  const [first] = await screen.findAllByRole("button", { name: "Use as final…" });
  fireEvent.click(first);
  fireEvent.click(within(confirmGroup("Use as final result")).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: "Use as final result" })).toBeNull();
  expect(document.activeElement).toBe(first);
  fireEvent.click(first);
  fireEvent.keyDown(within(confirmGroup("Use as final result")).getByRole("heading"), { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Use as final result" })).toBeNull();
  expect(document.activeElement).toBe(first);
});

it("shows a conflict with who changed it and reloads the row on Review again", async () => {
  const { s1, page: initial } = openRow();
  serve(initial, s1.submissions);
  renderPage({ open: [rowKey("case-0042", "en")] });
  fireEvent.click((await screen.findAllByRole("button", { name: "Use as final…" }))[0]);
  vi.mocked(api.selectFinalResult).mockRejectedValue(new ConflictError("conflict", "REVISION_CONFLICT", { current_revision: 1, selected_by: "lead-0003", updated_at: "2026-10-19T08:00:00Z" }));
  fireEvent.click(within(confirmGroup("Use as final result")).getByRole("button", { name: "Use as final" }));
  const notice = await within(confirmGroup("Use as final result")).findByText(/The final result or its warnings changed since you opened this\. Nothing was saved\./);
  expect(notice.textContent).toContain("Changed by lead-0003 at");
  const calls = vi.mocked(api.listDocumentRows).mock.calls.length;
  fireEvent.click(within(confirmGroup("Use as final result")).getByRole("button", { name: "Review again" }));
  expect(screen.queryByRole("group", { name: "Use as final result" })).toBeNull();
  await waitFor(() => expect(vi.mocked(api.listDocumentRows).mock.calls.length).toBe(calls + 1));
});

it("offers Retry after a network error and keeps the confirmation after a session end", async () => {
  const { s1, page: initial } = openRow();
  serve(initial, s1.submissions);
  renderPage({ open: [rowKey("case-0042", "en")] });
  fireEvent.click((await screen.findAllByRole("button", { name: "Use as final…" }))[0]);
  vi.mocked(api.selectFinalResult).mockRejectedValueOnce(new ApiError(500, "boom"));
  fireEvent.click(within(confirmGroup("Use as final result")).getByRole("button", { name: "Use as final" }));
  expect(await within(confirmGroup("Use as final result")).findByText("Could not save. Nothing changed.")).toBeTruthy();
  vi.mocked(api.selectFinalResult).mockRejectedValueOnce(new AuthError("expired", undefined, "NOT_AUTHENTICATED", 401));
  fireEvent.click(within(confirmGroup("Use as final result")).getByRole("button", { name: "Retry" }));
  expect(await within(confirmGroup("Use as final result")).findByText("Your session ended. Nothing was saved. Sign in and confirm again.")).toBeTruthy();
  const primary = within(confirmGroup("Use as final result")).getByRole("button", { name: "Use as final" });
  expect(primary.getAttribute("aria-busy")).toBeNull();
  expect(within(confirmGroup("Use as final result")).queryByRole("button", { name: "Retry" })).toBeNull();
  expect(api.selectFinalResult).toHaveBeenCalledTimes(2);
});

it("links the next decision while a decision filter is active", async () => {
  const { s1, en } = openRow();
  const other = row({ case_id: "case-0099", language: "de", versions: [version({ document_id: "case-0099-de" })], categories: ["missing-final"], missing_final: { counts: true, reason: null } });
  serve(page([group("case-0042", [en]), group("case-0099", [other])]), s1.submissions);
  const { onNavigate } = renderPage({ decision: "all", open: [rowKey("case-0042", "en")] });
  fireEvent.click((await screen.findAllByRole("button", { name: "Use as final…" }))[0]);
  serve(page([group("case-0042", [{ ...en, final: final({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "sub-0042-a" }), categories: [] }]), group("case-0099", [other])]));
  fireEvent.click(within(confirmGroup("Use as final result")).getByRole("button", { name: "Use as final" }));
  const next = await screen.findByRole("link", { name: "Next decision: case-0099 · de" });
  expect(liveRegion().textContent).toContain("Next decision: case-0099 · de.");
  fireEvent.click(next);
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", decision: "all", open: ["case-0042:en", "case-0099:de"] }, { replace: true });
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Show history, case-0099 · de"));
});

it("maps errors, success messages and bar changes", () => {
  expect(failureOf(new AuthError("x", undefined, "NOT_AUTHENTICATED", 401))).toEqual({ kind: "session" });
  expect(failureOf(new ConflictError("x", "OWN_RESULT_NOT_SELECTABLE"))).toEqual({ kind: "conflict", changedBy: null, changedAt: null, ownResult: true });
  expect(failureOf(new Error("offline"))).toEqual({ kind: "error" });
  expect(barChanges(bar({ total: 2, confirm_final: 1 }), bar({ total: 1, confirm_final: 0 }))).toBe("Needs your decision: 1 (was 2). Final result to confirm: 0 (was 1).");
  const base = { rowKey: "c:de", caseId: "c", language: "de", documentId: "d", submissionId: "s", expectedRevision: 1, causeIds: [], triggerId: "t", label: "L", oldLabel: null, stillOpen: null, roundNote: null, own: false, causeLines: [] };
  expect(successMessage({ ...base, kind: "use", waiting: [] })).toBe("L is now the final result.");
  expect(successMessage({ ...base, kind: "keep", waiting: [] })).toBe("Kept L.");
});

it("reports a save whose reload failed and keeps the shown rows with Could not refresh", async () => {
  const { s1, page: initial } = openRow();
  serve(initial, s1.submissions);
  renderPage({ open: [rowKey("case-0042", "en")] });
  fireEvent.click((await screen.findAllByRole("button", { name: "Use as final…" }))[0]);
  const label = rowSubmissionLabel(s1.submissions[rowKey("case-0042", "en")].submissions[0], "en", false);
  vi.mocked(api.listDocumentRows).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(within(confirmGroup("Use as final result")).getByRole("button", { name: "Use as final" }));
  await waitFor(() => expect(liveRegion().textContent).toBe(`${label} is now the final result. The list could not be refreshed.`));
  const notice = document.querySelector(".documents-success") as HTMLElement;
  expect(notice.textContent).toContain(`${label} is now the final result.`);
  await waitFor(() => expect(document.activeElement).toBe(notice));
  expect(screen.getByRole("alert").textContent).toContain("Could not refresh");
  expect(screen.getByRole("table", { name: "Documents" })).toBeTruthy();
});

it("announces a confirmation whose row vanished and moves focus to the page heading", async () => {
  const s0 = scenarioS0();
  const [en, de] = s0.group.rows;
  serve(page([group("synthetic-accepted", [en, de])]), s0.submissions);
  renderPage({ open: [rowKey("synthetic-accepted", "de")] });
  fireEvent.click(await screen.findByRole("button", { name: "Keep final result…" }));
  const box = within(confirmGroup("Keep final result")).getByRole("checkbox");
  box.focus();
  serve(page([group("synthetic-accepted", [en])]));
  await refetch();
  await waitFor(() => expect(screen.queryByRole("group", { name: "Keep final result" })).toBeNull());
  await waitFor(() => expect(liveRegion().textContent).toBe("synthetic-accepted · de is no longer shown. The confirmation was closed."));
  expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Documents" }));
});

it("labels a final result without a recorded time without inventing one", () => {
  const target = row({ case_id: "c", language: "de", versions: [version({ document_id: "c-de" })],
    final: final({ case_id: "c", language: "de", document_id: "c-de", submission_id: "s1", recorded_at: null, selected_at: "2026-10-18T10:05:00Z", updated_at: "2026-10-18T10:05:00Z" }) });
  expect(currentFinalLabel(target, null)).toBe("Annotation · Round 1 · ann-0001 · de v1");
});
