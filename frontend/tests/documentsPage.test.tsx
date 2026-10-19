import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type DocumentRowsPage, type ProjectDocumentSummary, type RowSubmissions } from "../src/api/client";
import { DocumentsPage, type DocumentsPageProps } from "../src/admin/DocumentsPage";
import { group, page, row, rowKey, scenarioS0, scenarioS1, scenarioS3, scenarioS4, scenarioS5, submissions, version } from "./documents/fixtures";

const { expandedProps } = vi.hoisted(() => ({ expandedProps: [] as Record<string, unknown>[] }));
vi.mock("../src/documents/ExpandedRow", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/documents/ExpandedRow")>();
  return {
    ...actual,
    ExpandedRow: (props: Parameters<typeof actual.ExpandedRow>[0]) => { expandedProps.push(props as unknown as Record<string, unknown>); return actual.ExpandedRow(props); },
  };
});

function mockRows(rows: DocumentRowsPage, rowSubmissions: Record<string, RowSubmissions> = {}) {
  // Every response is a new object, as from the network.
  vi.mocked(api.listDocumentRows).mockImplementation(async () => structuredClone(rows));
  vi.mocked(api.getRowSubmissions).mockImplementation(async (_key, caseId, language) => rowSubmissions[rowKey(caseId, language)] ?? submissions(caseId, language));
}

function renderPage(props: Partial<DocumentsPageProps> = {}) {
  const onNavigate = props.onNavigate ?? vi.fn();
  const view = render(<DocumentsPage projectKey="p" query={{}} canManage currentUser={{ username: "lead", pseudonym: "lead-0002" }} {...props} onNavigate={onNavigate} />);
  return { ...view, onNavigate };
}

const summary = (documentId: string, language: string): ProjectDocumentSummary => ({
  document_id: documentId, case_id: documentId, external_id: documentId, version: 1, origin: "native", translation_status: null, status_reason: null,
  accepted_without_review: false, language, position: 1, text_length: 10, status: "not_started", assignees: [],
});

beforeEach(() => {
  expandedProps.length = 0;
  vi.spyOn(api, "listDocumentRows").mockResolvedValue(page([]));
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language));
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ languages: ["en", "de"] } as never);
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue([]);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listUploads").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("tells non-leads that Documents is for project leads without loading anything", () => {
  renderPage({ canManage: false });
  expect(screen.getByRole("heading", { name: "Documents is for project leads" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Go to My tasks" }).getAttribute("href")).toBe("#/");
  expect(screen.queryByRole("table")).toBeNull();
  expect(api.listDocumentRows).not.toHaveBeenCalled();
  expect(api.listProjectDocuments).not.toHaveBeenCalled();
});

it("shows skeleton rows in a busy table while the first page loads", () => {
  vi.mocked(api.listDocumentRows).mockReturnValue(new Promise(() => {}));
  renderPage();
  const table = screen.getByRole("table", { name: "Documents" });
  expect(table.getAttribute("aria-busy")).toBe("true");
  expect(table.querySelectorAll(".documents-skeleton-row")).toHaveLength(5);
});

it("replaces the bar and table with an error and Retry", async () => {
  vi.mocked(api.listDocumentRows).mockRejectedValueOnce(new Error("Rows failed")).mockResolvedValue(scenarioS1().page);
  renderPage();
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByRole("heading", { name: "Needs your decision" })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(retry);
  await screen.findByRole("heading", { name: "Needs your decision" });
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("table", { name: "Documents" })).toBeTruthy();
});

it("offers the filters, pushes filter changes without page and announces the new count", async () => {
  mockRows(scenarioS1().page);
  const onNavigate = vi.fn();
  const view = renderPage({ query: { language: "de", decision: "all", page: "2" }, onNavigate });
  await screen.findByRole("heading", { name: "Needs your decision" });
  expect(api.listDocumentRows).toHaveBeenCalledWith("p", { language: "de", decision: "all", page: 2 });
  expect(Array.from((screen.getByLabelText("Status") as HTMLSelectElement).options).map(option => option.textContent))
    .toEqual(["All statuses", "Unassigned", "Open", "In progress", "Submitted", "Reopened", "Paused"]);
  const more = screen.getByText("More filters").closest("details") as HTMLDetailsElement;
  expect(within(more).getByLabelText("Origin")).toBeTruthy();
  expect(Array.from((within(more).getByLabelText("Translation status") as HTMLSelectElement).options).map(option => option.textContent)).toContain("Accepted without review");
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "held" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", decision: "all", status: "held" });
  fireEvent.change(screen.getByLabelText("ID"), { target: { value: "case-+/" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", decision: "all", q: "case-+/" });
  const live = document.querySelector("p[aria-live='polite']")!;
  expect(live.textContent).toBe("");
  mockRows(page([scenarioS1().group, scenarioS5().group]));
  view.rerender(<DocumentsPage projectKey="p" canManage currentUser={{ username: "lead", pseudonym: "lead-0002" }} query={{ language: "de", decision: "all", status: "held" }} onNavigate={onNavigate} />);
  await waitFor(() => expect(live.textContent).toBe("2 texts shown"));
  expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", { language: "de", decision: "all", status: "held" });
});

it("selects every checkbox row of the page including collapsed groups and opens the dialogs with those versions", async () => {
  const s0 = scenarioS0();
  mockRows(page([s0.group, scenarioS1().group, scenarioS4().group], { group_count: 60 }), s0.submissions);
  vi.mocked(api.listProjectDocuments).mockResolvedValue([summary("synthetic-accepted-en", "en"), summary("synthetic-accepted-de-v2", "de"), summary("case-0042-en", "en"), summary("unrelated", "en")]);
  renderPage();
  await screen.findByRole("heading", { name: "Needs your decision" });
  expect(screen.queryByLabelText("Select case-0042 · en")).toBeNull();
  const assign = screen.getByRole("button", { name: "Assign …" });
  expect(assign.getAttribute("aria-disabled")).toBe("true");
  expect(assign.hasAttribute("disabled")).toBe(false);
  fireEvent.click(assign);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByLabelText("Select all"));
  expect(document.querySelector("p[aria-live='polite']")!.textContent).toBe("Selected 3 rows. 1 row needs a choice in Text versions.");
  expect(screen.getByText("3 selected")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Assign …" }).getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Assign …" }));
  expect(within(await screen.findByRole("dialog", { name: "Assign documents" })).getByText("3 documents selected.")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("dialog").querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Propose distribution …" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

it("adds per-version checkboxes from Text versions to the bulk selection", async () => {
  const s4 = scenarioS4();
  mockRows(s4.page, s4.submissions);
  renderPage({ query: { open: [rowKey("case-0305", "fr")] } });
  expect(await screen.findByText("Choose in Text versions")).toBeTruthy();
  fireEvent.click(await screen.findByLabelText("Select Provider A v1 for assignment"));
  expect(screen.getByText("1 selected")).toBeTruthy();
});

it("pages with Previous and Next links", async () => {
  mockRows(page([scenarioS1().group], { page: 2, page_count: 3 }));
  const { onNavigate } = renderPage({ query: { page: "2", language: "en" } });
  expect(await screen.findByText("Page 2 of 3")).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Next" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "en", page: "3" });
  fireEvent.click(screen.getByRole("link", { name: "Previous" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "en" });
});

it("expands and focuses a deep-linked row that no longer needs a decision", async () => {
  const s0 = scenarioS0();
  const de = { ...s0.group.rows[1], pinned: true, matches_decision: false, categories: [] };
  mockRows(page([group("synthetic-accepted", [s0.group.rows[0], de])]), s0.submissions);
  renderPage({ query: { case: "synthetic-accepted", language: "de", decision: "all" } });
  expect(await screen.findByText("This no longer needs your decision.")).toBeTruthy();
  expect(api.listDocumentRows).toHaveBeenCalledWith("p", { case: "synthetic-accepted", language: "de", decision: "all" });
  const disclosure = screen.getByRole("button", { name: "Show submissions, synthetic-accepted · de" });
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(document.activeElement).toBe(disclosure));
});

it("shows an unknown text and an empty decision filter with Show all texts", async () => {
  mockRows(page([], { case_found: false }));
  const { onNavigate, unmount } = renderPage({ query: { case: "nope" } });
  expect(await screen.findByRole("heading", { name: "Text nope not found" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Show all texts" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p" });
  unmount();
  mockRows(page([]));
  renderPage({ query: { decision: "all" } });
  expect(await screen.findByRole("heading", { name: "Nothing needs your decision" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Show all texts" })).toBeTruthy();
});

it("explains a preflight-only missing final result on a deep-linked row", async () => {
  const s4 = scenarioS4();
  mockRows(s4.page, s4.submissions);
  const { unmount } = renderPage({ query: { case: "case-0305", language: "fr" } });
  expect(await screen.findByText("No final result. Not counted as a decision yet: work still open: ann-0001 annotating; ann-0002 annotating.")).toBeTruthy();
  unmount();
  const s0 = scenarioS0();
  mockRows(s0.page, s0.submissions);
  renderPage({ query: { case: "synthetic-accepted", language: "en" } });
  expect(await screen.findByText("No final result. Not counted as a decision yet: no submission.")).toBeTruthy();
});

it("expands a row with replace navigation", async () => {
  mockRows(scenarioS1().page);
  const { onNavigate } = renderPage({ query: { language: "en" } });
  fireEvent.click(await screen.findByRole("button", { name: "Show submissions, case-0042 · en" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "en", open: ["case-0042:en"] }, { replace: true });
});

it("passes the current project rule, not the final's snapshot, to the expanded row", async () => {
  const s5 = scenarioS5();
  mockRows(page([s5.group], { adjudicator_not_annotator: true }), s5.submissions);
  renderPage({ query: { open: [rowKey("case-0377", "en")] } });
  await screen.findByRole("heading", { name: /^Submissions \(/ });
  expect(s5.group.rows[0].final?.adjudicator_not_annotator).toBeNull();
  expect(expandedProps.at(-1)?.adjudicatorNotAnnotator).toBe(true);
});

it("reloads the submissions of open rows when the rows refresh", async () => {
  const s1 = scenarioS1();
  mockRows(s1.page, s1.submissions);
  renderPage({ query: { open: [rowKey("case-0042", "en")] } });
  await screen.findByRole("heading", { name: "Submissions (2)" });
  expect(api.getRowSubmissions).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(api.getRowSubmissions).toHaveBeenCalledTimes(2));
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
});

it("opens the translation review history of a version from Text versions", async () => {
  const s3 = scenarioS3();
  mockRows(s3.page, s3.submissions);
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([]);
  renderPage({ query: { open: [rowKey("case-0211", "de")] } });
  fireEvent.click(await screen.findByRole("button", { name: "Translation reviews for v1" }));
  expect(api.listTranslationReviews).toHaveBeenCalledWith("p", "case-0211-de");
  const dialog = await screen.findByRole("dialog", { name: "Translation reviews: case-0211-de" });
  expect(await within(dialog).findByText("No one has reviewed this translation yet.")).toBeTruthy();
});

it("renders cards on narrow viewports", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 699px)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  mockRows(page([group("case-1", [row({ case_id: "case-1", language: "en", versions: [version({ document_id: "case-1-en" })] })])]));
  renderPage();
  const list = await screen.findByRole("list", { name: "Documents" });
  expect(within(list).getByRole("article")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});
