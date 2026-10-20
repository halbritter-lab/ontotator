import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type DocumentRowView, type DocumentRowsPage, type PlanRowResult, type ProjectDocumentSummary, type RowSubmissions } from "../src/api/client";
import { DocumentsPage, type DocumentsPageProps } from "../src/admin/DocumentsPage";
import type { ProjectDocumentsQuery, Route } from "../src/app/router";
import { recordDecision } from "../src/documents/visitState";
import { final, group, item, page, planRow, row, rowKey, scenarioS0, scenarioS1, scenarioS3, scenarioS4, scenarioS5, stepOf, submission, submissions, version, work } from "./documents/fixtures";

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

/** The page with a real route state: Documents navigations update its query (as the app shell does). */
function renderStateful(initial: ProjectDocumentsQuery) {
  const onNavigate = vi.fn();
  function Host() {
    const [query, setQuery] = useState(initial);
    return <DocumentsPage projectKey="p" query={query} canManage currentUser={{ username: "lead", pseudonym: "lead-0002" }} onNavigate={(route: Route, options) => {
      onNavigate(route, options);
      if (route.name === "projectDocuments") { const { name: _name, key: _key, ...rest } = route; setQuery(rest); }
    }} />;
  }
  return { ...render(<Host />), onNavigate };
}

const loaded = () => screen.findByRole("navigation", { name: "Segments" });
const live = () => document.querySelector(".documents-page > p[aria-live='polite']")!;

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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

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
  expect(screen.queryByRole("navigation", { name: "Segments" })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(retry);
  await loaded();
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("table", { name: "Documents" })).toBeTruthy();
});

it("filters by Next step, Plan, Language and Case ID; More filters holds Final result, Origin, Translation status, Status, Sort", async () => {
  mockRows(scenarioS1().page);
  const onNavigate = vi.fn();
  const view = renderPage({ query: { language: "de", segment: "assign", page: "2" }, onNavigate });
  await loaded();
  expect(api.listDocumentRows).toHaveBeenCalledWith("p", { language: "de", segment: "assign", page: 2 });
  const filters = screen.getByRole("group", { name: "Document filters" });
  const step = within(filters).getByLabelText("Next step") as HTMLSelectElement;
  expect(Array.from(step.querySelectorAll("optgroup")).map(entry => entry.label)).toEqual(["Any stage", "Translation review", "Annotation", "Final result", "Done"]);
  expect(within(step).getByRole("option", { name: "Assign translation review" })).toBeTruthy();
  fireEvent.change(step, { target: { value: "assign_translation_review" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", segment: "assign", step: "assign_translation_review" });
  const plan = within(filters).getByLabelText("Plan") as HTMLSelectElement;
  expect(Array.from(plan.options).map(option => option.textContent)).toEqual(["Any plan", "Review", "Annotate", "Review and annotate", "Not in plan"]);
  fireEvent.change(plan, { target: { value: "not_in_plan" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", segment: "assign", plan: "not_in_plan" });
  fireEvent.change(within(filters).getByLabelText("Language"), { target: { value: "" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", segment: "assign" });
  fireEvent.change(within(filters).getByLabelText("Case ID"), { target: { value: "case-+/" } });
  fireEvent.keyDown(within(filters).getByLabelText("Case ID"), { key: "Enter" });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", segment: "assign", q: "case-+/" });
  const more = screen.getByText("More filters").closest("details") as HTMLDetailsElement;
  expect(Array.from(more.querySelectorAll("label")).map(label => label.textContent)).toEqual(["Final result", "Origin", "Translation status", "Status", "Sort"]);
  expect(Array.from((within(more).getByLabelText("Final result") as HTMLSelectElement).options).map(option => option.textContent)).toEqual(["Any", "None"]);
  expect(Array.from((within(more).getByLabelText("Sort") as HTMLSelectElement).options).map(option => option.textContent)).toEqual(["Case ID", "Import batch", "Last activity"]);
  expect(Array.from((within(more).getByLabelText("Translation status") as HTMLSelectElement).options).map(option => option.textContent)).toContain("Accepted without review");
  fireEvent.change(within(more).getByLabelText("Final result"), { target: { value: "none" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", segment: "assign", final: "none" });
  fireEvent.change(within(more).getByLabelText("Sort"), { target: { value: "activity" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", segment: "assign", sort: "activity" });
  fireEvent.change(within(more).getByLabelText("Status"), { target: { value: "held" } });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", segment: "assign", status: "held" });
  // A filter change announces the new count once the data arrives.
  expect(live().textContent).toBe("");
  mockRows(page([scenarioS1().group, scenarioS5().group]));
  view.rerender(<DocumentsPage projectKey="p" canManage currentUser={{ username: "lead", pseudonym: "lead-0002" }} query={{ plan: "review", step: "choose_final", sort: "import", final: "none", owner: "me", stage: "final" }} onNavigate={onNavigate} />);
  await waitFor(() => expect(live().textContent).toBe("2 texts shown"));
  expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", { plan: "review", step: "choose_final", sort: "import", final: "none", owner: "me", stage: "final" });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Assign …" })).toBeNull();
});

it("applies the ID filter once after a pause in typing", async () => {
  mockRows(scenarioS1().page);
  const { onNavigate } = renderPage();
  await loaded();
  const input = screen.getByLabelText("Case ID");
  for (const value of ["c", "ca", "cas"]) fireEvent.change(input, { target: { value } });
  expect(onNavigate).not.toHaveBeenCalled();
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", q: "cas" }));
  expect(onNavigate).toHaveBeenCalledTimes(1);
  fireEvent.blur(input);
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it("re-announces a repeated message in the live region", async () => {
  mockRows(page([group("case-1", [planRow("case-1", "de", stepOf("assign_translation_review"))])]));
  vi.mocked(api.listProjectDocuments).mockReturnValue(new Promise(() => {}));
  renderPage();
  const assign = await screen.findByRole("button", { name: "Assign translation review…, case-1 · de" });
  fireEvent.click(assign);
  expect(live().textContent).toBe("Loading assignment data…");
  fireEvent.click(assign);
  expect(live().textContent).toBe("");
  await waitFor(() => expect(live().textContent).toBe("Loading assignment data…"));
});

it("keeps the rows and shows Could not refresh when a background refetch fails", async () => {
  mockRows(scenarioS1().page);
  renderPage();
  await screen.findByRole("table", { name: "Documents" });
  vi.mocked(api.listDocumentRows).mockRejectedValueOnce(new Error("offline"));
  act(() => { window.dispatchEvent(new Event("focus")); });
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Could not refresh");
  expect(screen.getByRole("table", { name: "Documents" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Segments" })).toBeTruthy();
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("assigns from the row: the assign dialog opens with the row's version", async () => {
  mockRows(page([group("case-1", [planRow("case-1", "de", stepOf("assign_translation_review", { document_id: "case-1-de" }))])]));
  vi.mocked(api.listProjectDocuments).mockResolvedValueOnce([]).mockResolvedValue([summary("case-1-de", "de")]);
  renderPage();
  const assign = await screen.findByRole("button", { name: "Assign translation review…, case-1 · de" });
  await waitFor(() => expect(api.listMembers).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(assign);
  const dialog = await screen.findByRole("dialog", { name: "Assign documents" });
  expect(within(dialog).getByText("1 document selected.")).toBeTruthy();
  expect(api.listProjectDocuments).toHaveBeenCalledTimes(2);
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

it("keeps the page busy with focus on the paging link while the next page loads, and disables the end link", async () => {
  const onNavigate = vi.fn();
  mockRows(page([scenarioS1().group], { page: 2, page_count: 3 }));
  const view = renderPage({ query: { page: "2" }, onNavigate });
  await screen.findByText("Page 2 of 3");
  const next = screen.getByRole("link", { name: "Next" });
  next.focus();
  let resolve!: (value: DocumentRowsPage) => void;
  vi.mocked(api.listDocumentRows).mockImplementation(() => new Promise(done => { resolve = done; }));
  view.rerender(<DocumentsPage projectKey="p" canManage currentUser={{ username: "lead", pseudonym: "lead-0002" }} query={{ page: "3" }} onNavigate={onNavigate} />);
  // The previous page stays, busy; no skeleton replaces the bar and paging.
  expect(screen.getByRole("table", { name: "Documents" }).getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector(".documents-skeleton")).toBeNull();
  expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  expect(document.activeElement).toBe(next);
  await act(async () => { resolve(page([scenarioS1().group], { page: 3, page_count: 3 })); });
  await screen.findByText("Page 3 of 3");
  expect(document.activeElement).toBe(next);
  expect(next.getAttribute("aria-disabled")).toBe("true");
  expect(next.hasAttribute("href")).toBe(false);
  fireEvent.click(next);
  expect(onNavigate).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Previous" }).getAttribute("aria-disabled")).toBeNull();
});

it("renders Submissions of an open card as a list, not the table", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 699px)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  const s1 = scenarioS1();
  mockRows(s1.page, s1.submissions);
  renderPage({ query: { open: [rowKey("case-0042", "en")] } });
  expect(await screen.findByRole("list", { name: "Submissions, case-0042 · en" })).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(expandedProps.at(-1)?.layout).toBe("list");
});

it("expands and focuses a deep-linked row that no longer needs a decision", async () => {
  const s0 = scenarioS0();
  const de = { ...s0.group.rows[1], pinned: true, matches_decision: false, categories: [] };
  mockRows(page([group("synthetic-accepted", [s0.group.rows[0], de])]), s0.submissions);
  renderPage({ query: { case: "synthetic-accepted", language: "de", decision: "all" } });
  expect(await screen.findByText("This no longer needs your decision.")).toBeTruthy();
  expect(api.listDocumentRows).toHaveBeenCalledWith("p", { case: "synthetic-accepted", language: "de", decision: "all" });
  const disclosure = screen.getByRole("button", { name: "Show details, synthetic-accepted · de" });
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

it("shows the empty states per segment", async () => {
  mockRows(page([]));
  const cases: [ProjectDocumentsQuery, string][] = [
    [{ segment: "assign" }, "Nothing to assign"],
    [{ segment: "progress" }, "Nothing in progress"],
    [{ segment: "decision" }, "Nothing needs your decision"],
    [{ plan: "not_in_plan" }, "Every language version is in the plan."],
    [{}, "No texts yet"],
  ];
  for (const [query, title] of cases) {
    const { unmount } = renderPage({ query });
    expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    unmount();
  }
  renderPage();
  expect(await screen.findByText("Upload texts to start.")).toBeTruthy();
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
  fireEvent.click(await screen.findByRole("button", { name: "Show details, case-0042 · en" }));
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

describe("Resolved and Changed badges", () => {
  let served: DocumentRowsPage;
  const serve = (next: DocumentRowsPage) => { served = next; };
  const refetch = async () => {
    const calls = vi.mocked(api.listDocumentRows).mock.calls.length;
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(vi.mocked(api.listDocumentRows).mock.calls.length).toBeGreaterThan(calls));
  };
  const lastRequest = () => vi.mocked(api.listDocumentRows).mock.calls.at(-1)?.[1];
  const disclosure = (name: string) => screen.getByRole("button", { name: `Show details, ${name}` });

  beforeEach(() => {
    vi.mocked(api.listDocumentRows).mockImplementation(async () => structuredClone(served));
    vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "x", language: "de", document_id: "d", submission_id: "s", revision: 2 });
  });

  /** case-0042 en waiting for a decision. */
  const missing = (overrides: Partial<DocumentRowView> = {}) => row({
    case_id: "case-0042", language: "en", versions: [version({ document_id: "case-0042-en" })],
    categories: ["missing-final"], missing_final: { counts: true, reason: null }, ...overrides,
  });

  it("shows Resolved after the lead's own Keep, retains the row and collapses it once", async () => {
    const s0 = scenarioS0();
    const de = s0.group.rows[1];
    serve(page([group("synthetic-accepted", [de])]));
    vi.mocked(api.getRowSubmissions).mockImplementation(async (_key, caseId, language) => structuredClone(s0.submissions[rowKey(caseId, language)] ?? submissions(caseId, language)));
    const { onNavigate } = renderPage({ query: { decision: "confirm-final", open: [rowKey("synthetic-accepted", "de")] } });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "confirm-final", retain: ["synthetic-accepted:de"] }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep final result…" }));
    const confirm = screen.getByRole("group", { name: "Keep final result" });
    fireEvent.click(within(confirm).getByRole("checkbox", { name: "I reviewed these changes and keep this exact result" }));
    serve(page([group("synthetic-accepted", [{ ...de, issues: [], categories: [], final: { ...de.final!, revision: 2 }, matches_decision: false, retained: true }])]));
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep as final" }));
    await waitFor(() => expect(disclosure("synthetic-accepted · de").getAttribute("aria-expanded")).toBe("false"));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", decision: "confirm-final" }, { replace: true });
    expect(lastRequest()).toEqual({ decision: "confirm-final", retain: ["synthetic-accepted:de"] });
    // The badge is on the collapsed row itself, next to its row header.
    expect(within(disclosure("synthetic-accepted · de").closest("th")!).getByText("Resolved")).toBeTruthy();
    fireEvent.click(disclosure("synthetic-accepted · de"));
    expect(disclosure("synthetic-accepted · de").getAttribute("aria-expanded")).toBe("true");
    // Shown once, not repeated in the expanded content.
    expect(screen.getAllByText("Resolved")).toHaveLength(1);
    // A later refresh does not collapse the row again.
    await refetch();
    expect(lastRequest()).toEqual({ decision: "confirm-final", retain: ["synthetic-accepted:de"] });
    expect(disclosure("synthetic-accepted · de").getAttribute("aria-expanded")).toBe("true");
  });

  it("shows Changed: Work assigned when work was assigned elsewhere and keeps the row open", async () => {
    serve(page([group("case-0042", [missing()])]));
    renderPage({ query: { decision: "missing-final", open: [rowKey("case-0042", "en")] } });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "missing-final", retain: ["case-0042:en"] }));
    serve(page([group("case-0042", [missing({
      categories: [], matches_decision: false, retained: true, missing_final: { counts: false, reason: "work_open" },
      work: [work({ assignment_id: 9, document_id: "case-0042-en" })],
    })])]));
    await refetch();
    expect(await screen.findByText("Changed: Work assigned")).toBeTruthy();
    expect(screen.queryByText("Resolved")).toBeNull();
    expect(disclosure("case-0042 · en").getAttribute("aria-expanded")).toBe("true");
  });

  it("shows Changed: Task resumed for an external resume and Resolved for a resume recorded on the report page", async () => {
    const held = missing({ categories: ["report-or-pause"], work: [work({ assignment_id: 7, document_id: "case-0042-en", held: true })] });
    const resumed = { ...held, categories: [], matches_decision: false, retained: true, work: [work({ assignment_id: 7, document_id: "case-0042-en" })] };
    serve(page([group("case-0042", [held])]));
    const { unmount } = renderPage({ query: { decision: "report-or-pause", open: [rowKey("case-0042", "en")] } });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "report-or-pause", retain: ["case-0042:en"] }));
    serve(page([group("case-0042", [resumed])]));
    await refetch();
    expect(await screen.findByText("Changed: Task resumed")).toBeTruthy();
    unmount();

    // Back from the report page: the remount keeps the visit and sees the recorded resume.
    recordDecision("p", "case-0042:en");
    vi.mocked(api.listDocumentRows).mockClear();
    renderPage({ query: { decision: "report-or-pause", open: [rowKey("case-0042", "en")] } });
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalled());
    expect(vi.mocked(api.listDocumentRows).mock.calls[0][1]).toEqual({ decision: "report-or-pause", retain: ["case-0042:en"] });
    await waitFor(() => expect(disclosure("case-0042 · en").getAttribute("aria-expanded")).toBe("false"));
    expect(within(disclosure("case-0042 · en").closest("th")!).getByText("Resolved")).toBeTruthy();
  });

  it("keeps the visit (retained rows and badges) when paging under the same filters", async () => {
    serve(page([group("case-0042", [missing()])], { page_count: 2 }));
    const onNavigate = vi.fn();
    const view = renderPage({ query: { decision: "missing-final" }, onNavigate });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "missing-final", retain: ["case-0042:en"] }));
    view.rerender(<DocumentsPage projectKey="p" canManage query={{ decision: "missing-final", page: "2" }} onNavigate={onNavigate} />);
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "missing-final", page: 2, retain: ["case-0042:en"] }));
    expect(sessionStorage.getItem(`ontocurator:documents-visit:p:${JSON.stringify({ decision: "missing-final" })}`)).not.toBeNull();
  });

  it("starts a new visit after a filter change and sends no retain without a decision filter", async () => {
    serve(page([group("case-0042", [missing()])]));
    const onNavigate = vi.fn();
    const view = renderPage({ query: { decision: "missing-final" }, onNavigate });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "missing-final", retain: ["case-0042:en"] }));
    view.rerender(<DocumentsPage projectKey="p" canManage query={{ decision: "all" }} onNavigate={onNavigate} />);
    await waitFor(() => expect(sessionStorage.getItem(`ontocurator:documents-visit:p:${JSON.stringify({ decision: "missing-final" })}`)).toBeNull());
    expect(api.listDocumentRows).toHaveBeenCalledWith("p", { decision: "all" });
    view.rerender(<DocumentsPage projectKey="p" canManage query={{}} onNavigate={onNavigate} />);
    await waitFor(() => expect(lastRequest()).toEqual({}));
    await refetch();
    expect(lastRequest()).toEqual({});
  });
});

describe("row actions", () => {
  /** case-0042 en waiting for a final result with one eligible submission. */
  const chooseFinal = (caseId = "case-0042", language = "en") => planRow(caseId, language, stepOf("choose_final", { detail: { kind: "annotations_submitted", submitted: 1, total: 1, task_paused: false } }), {
    versions: [version({ document_id: `${caseId}-${language}` })], categories: ["missing-final"], missing_final: { counts: true, reason: null },
  });
  const oneSubmission = (caseId = "case-0042", language = "en") => submissions(caseId, language, { submissions: [submission({ submission_id: `sub-${caseId}`, document_id: `${caseId}-${language}`, author_label: "ann-0001" })] });

  it("Choose final… expands the row and opens Use as final for one eligible submission", async () => {
    mockRows(page([group("case-0042", [chooseFinal()])]), { [rowKey("case-0042", "en")]: oneSubmission() });
    const { onNavigate } = renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Choose final…, case-0042 · en" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", open: ["case-0042:en"] }, { replace: true });
    const confirm = await screen.findByRole("group", { name: "Use as final result" });
    expect(screen.getByRole("button", { name: "Show details, case-0042 · en" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement?.id).toBe("documents-row-case-0042-en-action");
  });

  it("Choose final… focuses Submissions when several submissions are eligible", async () => {
    const two = submissions("case-0042", "en", { submissions: [
      submission({ submission_id: "a", document_id: "case-0042-en" }), submission({ submission_id: "b", document_id: "case-0042-en", author_label: "ann-0002" }),
    ] });
    mockRows(page([group("case-0042", [chooseFinal()])]), { [rowKey("case-0042", "en")]: two });
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Choose final…, case-0042 · en" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Submissions (2)"));
    expect(screen.queryByRole("group", { name: "Use as final result" })).toBeNull();
  });

  it("Review changes… expands the row and opens Keep", async () => {
    const s0 = scenarioS0();
    const de = { ...s0.group.rows[1], next_step: stepOf("confirm_final"), steps: [stepOf("confirm_final")] };
    mockRows(page([group("synthetic-accepted", [s0.group.rows[0], de])]), s0.submissions);
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Review changes…, synthetic-accepted · de" }));
    const keep = await screen.findByRole("group", { name: "Keep final result" });
    expect(within(keep).getByRole("checkbox", { name: "I reviewed these changes and keep this exact result" })).toBeTruthy();
  });

  it("Decide on report… navigates to the report with section=decide", async () => {
    mockRows(page([group("case-0390", [planRow("case-0390", "de", stepOf("decide_report", { report_id: "report-0390" }))])]));
    const { onNavigate } = renderPage({ query: { segment: "decision" } });
    fireEvent.click(await screen.findByRole("button", { name: "Decide on report…, case-0390 · de" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectProblemReport", key: "p", reportId: "report-0390", section: "decide", documents: { segment: "decision" } });
  });

  it("Resume task… navigates with action=resume", async () => {
    const paused = planRow("case-0391", "de", stepOf("resume_task", { assignment_id: 7 }), {
      notes: [item({ code: "TASK_PAUSED_WITHOUT_REPORT", cause_id: "p1", report_id: "report-7", assignment_id: 7 })],
    });
    mockRows(page([group("case-0391", [paused])]));
    const { onNavigate } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Resume task…, case-0391 · de" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectProblemReport", key: "p", reportId: "report-7", action: "resume" });
  });

  it("Resolve… shows the three options under the row", async () => {
    mockRows(page([group("case-1", [planRow("case-1", "de", stepOf("resolve_rejected", { document_id: "case-1-de" }))])]));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 · de" }));
    const box = screen.getByRole("group", { name: "Resolve rejected translation, case-1 · de" });
    expect(within(box).getByRole("button", { name: "Discard the de translation…" })).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Resolve rejected translation, case-1 · de" })).toBeNull();
  });

  it("after success the row updates in place and announces Next: case · language under a segment filter", async () => {
    const first = chooseFinal();
    const second = chooseFinal("case-0099", "de");
    const rowSubmissions = { [rowKey("case-0042", "en")]: oneSubmission(), [rowKey("case-0099", "de")]: oneSubmission("case-0099", "de") };
    mockRows(page([group("case-0042", [first]), group("case-0099", [second])]), rowSubmissions);
    vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "sub-case-0042", revision: 1 });
    renderStateful({ segment: "decision" });
    fireEvent.click(await screen.findByRole("button", { name: "Choose final…, case-0042 · en" }));
    const confirm = await screen.findByRole("group", { name: "Use as final result" });
    const done = { ...first, next_step: stepOf("done"), steps: [stepOf("done")], matches_decision: false, retained: true, categories: [],
      final: final({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "sub-case-0042" }) };
    mockRows(page([group("case-0042", [done]), group("case-0099", [second])]), rowSubmissions);
    fireEvent.click(within(confirm).getByRole("button", { name: "Use as final" }));
    await waitFor(() => expect(live().textContent).toContain("Next: case-0099 · de."));
    expect(screen.getByRole("link", { name: "Next: case-0099 · de" })).toBeTruthy();
    // Updated in place: the row stays (retained) with its new step.
    expect(within(screen.getByRole("button", { name: "Show details, case-0042 · en" }).closest("tr")!).getByText("Done")).toBeTruthy();
  });
});

describe("plan chips on the page", () => {
  it("saves a chip, refetches the rows and shows the toast right after the table", async () => {
    const fr = planRow("case-0101", "fr", stepOf("assign_translation_review"));
    mockRows(page([group("case-0101", [fr], { plan_revision: 2 })], { page_count: 2 }));
    vi.spyOn(api, "patchWorkPlan").mockResolvedValue({
      case_id: "case-0101", language: "fr", flags: { review: false, annotate: true, review_applicable: true, discarded: false }, revision: 3,
      undo: { rows: [], revisions: { "case-0101": 3 } }, withdrawn: [], accepted_document_ids: [],
    } as PlanRowResult);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Review, case-0101 · fr" }));
    expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "fr", { review: false, expected_revision: 2, confirm: false });
    const message = await screen.findByText("fr of case-0101: Review off");
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
    const table = screen.getByRole("table", { name: "Documents" });
    const region = message.closest(".ui-toast-region")!;
    expect(table.closest(".data-table-scroll")?.nextElementSibling ?? table.nextElementSibling).toBe(region);
    expect(region.nextElementSibling?.getAttribute("aria-label")).toBe("Pages");
  });

  it("opens the upload dialog from the heading row", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ languages: ["en"], annotate_accepted_translations_only: false } as never);
    mockRows(scenarioS1().page);
    renderPage();
    await loaded();
    const upload = screen.getByRole("button", { name: "Upload texts…" });
    await waitFor(() => expect(upload.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(upload);
    expect(await screen.findByRole("dialog", { name: "Upload texts" })).toBeTruthy();
  });
});
