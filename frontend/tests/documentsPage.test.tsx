import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, notifySessionRestored, type AssignmentView, type DocumentRowView, type DocumentRowsPage, type PlanRowResult, type RowSubmissions } from "../src/api/client";
import type { AssignWorkDialogProps } from "../src/admin/AssignWorkDialog";
import { DocumentsPage, type DocumentsPageProps } from "../src/admin/DocumentsPage";
import type { ProjectDocumentsQuery, Route } from "../src/app/router";
import { documentsRowId } from "../src/documents/RowCells";
import { recordDecision } from "../src/documents/visitState";
import { FINAL_SELECTION_CHANGED } from "../src/variants/finalSelectionState";
import { DOCUMENTS_CHANGED } from "../src/documents/documentsEvents";
import { useRegisteredShortcuts } from "../src/ui/shortcuts";
import { final, finalPanel, group, item, panelSubmission, notInPlanRow, page, planRow, rejectedRow, row, rowKey, scenarioS0, scenarioS1, scenarioS3, scenarioS4, scenarioS5, stepOf, submission, submissions, version, work } from "./documents/fixtures";
import { ana, cell, scenario7a, stagedRow, tom } from "./documents/tableFixtures";
import { acceptPanel } from "./documents/panelFixtures";
import { reviewRecord } from "./translationFixtures";

const { assignProps } = vi.hoisted(() => ({ assignProps: [] as unknown[] }));
// The assign dialog has its own tests; here only its wiring (props in, onAssigned / onClose out) matters.
vi.mock("../src/admin/AssignWorkDialog", () => ({
  AssignWorkDialog: (props: AssignWorkDialogProps) => { assignProps.push(props); return <div role="dialog" aria-label="Assign stub" />; },
}));
const lastAssign = () => assignProps.at(-1) as AssignWorkDialogProps;
// The upload stub is the dialog (the panel owns it): it reports a finished import with its result message, or closes.
vi.mock("../src/admin/UploadPanel", () => ({
  UploadPanel: ({ onImported, onClose }: { onImported: (message: string) => void; onClose: () => void }) =>
    <div role="dialog" aria-label="Upload texts">
      <button type="button" onClick={() => onImported("Imported 9 documents and 0 proposals.")}>Finish import stub</button>
      <button type="button" onClick={onClose}>Close stub</button>
    </div>,
}));

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

const loaded = () => screen.findByRole("tablist", { name: "Documents views" });
const searchField = () => screen.getByRole("searchbox", { name: "Case ID or text" });
const filterTools = () => screen.getByRole("group", { name: "Document filters" });
const live = () => document.querySelector(".documents-page > p[aria-live='polite']")!;

/** `count` cases "case-0101"… with one de row each (next step Assign translation review). */
const casesPage = (count: number, overrides: Partial<DocumentRowsPage> = {}) => page(Array.from({ length: count }, (_, index) => {
  const caseId = `case-${String(101 + index).padStart(4, "0")}`;
  return group(caseId, [planRow(caseId, "de", stepOf("assign_translation_review"))]);
}), overrides);
const rowBox = (caseId: string, language: string) => screen.getByRole("checkbox", { name: `Select ${caseId} ${language}` });
/** The checkbox of a `casesPage` case's one text (the flat table has no case checkboxes). */
const caseBox = (caseId: string) => rowBox(caseId, "de");
/** The Text cell (`th scope="row"`) of a row, found through its text name ("Text …"). */
const rowHeader = (name: string) => screen.getByRole("button", { name: `Text ${name.replace(", ", " ")}` }).closest("tr")!.querySelector<HTMLElement>("th[scope=row]")!;
/** The text card of a row (a modal dialog "{case} {language}"); `name` is the row name "{case}, {language}". */
const textCard = (name: string) => screen.findByRole("dialog", { name: name.replace(", ", " ") });
/** "3 texts in 3 cases selected" for cases with one text each. */
const selectedText = (count: number) => `${count} ${count === 1 ? "text" : "texts"} in ${count} ${count === 1 ? "case" : "cases"} selected`;
/** Row keys of `document-rows/keys`: the de text of every given case. */
const deKeys = (caseIds: readonly string[], truncated = false) => ({ keys: caseIds.map(caseId => ({ case_id: caseId, language: "de" })), cases: caseIds.length, total: caseIds.length, truncated });
const selectionRegion = () => screen.getByRole("region", { name: "Selection" });
/** A row waiting for a final result ("Compare results…") with one submitted annotation. */
const chooseFinalStep = () => stepOf("choose_final", { detail: { kind: "annotations_submitted", submitted: 1, total: 1, task_paused: false } });

beforeEach(() => {
  vi.spyOn(api, "finalPanel").mockImplementation(async () => finalPanel());
  vi.spyOn(api, "listGuidelines").mockResolvedValue({ current: null, latest_version: null, versions: [], my_latest_seen: null });
  vi.spyOn(api, "listDocumentRows").mockResolvedValue(page([]));
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language));
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ languages: ["en", "de"] } as never);
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue([]);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listUploads").mockResolvedValue([]);
  vi.spyOn(api, "selectionSummary").mockResolvedValue({ cases: 0, steps: [], skipped: {}, common: null, not_shown: 0 });
  vi.spyOn(api, "recordDocumentsVisit").mockResolvedValue({ baseline_at: "2026-10-21T08:00:00Z" });
  assignProps.length = 0;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

it("tells non-leads that Documents is for project leads without loading anything", () => {
  renderPage({ canManage: false });
  expect(screen.getByRole("heading", { name: "Documents is for project leads" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Go to My tasks" }).getAttribute("href")).toBe("#/?status=all");
  expect(screen.queryByRole("table")).toBeNull();
  expect(api.listDocumentRows).not.toHaveBeenCalled();
  expect(api.listProjectDocuments).not.toHaveBeenCalled();
});

it("shows skeleton rows in a busy table while the first page loads", () => {
  // Nothing resolves during the test (no state update after it ends).
  for (const method of ["listDocumentRows", "getProjectSettings", "listProjectDocuments", "listCases", "listAssignments", "listMembers"] as const) {
    vi.mocked(api[method]).mockReturnValue(new Promise(() => {}) as never);
  }
  renderPage();
  const table = screen.getByRole("table", { name: "Documents" });
  expect(table.getAttribute("aria-busy")).toBe("true");
  expect(table.querySelectorAll(".documents-skeleton-row")).toHaveLength(5);
});

it("replaces the bar and table with an error and Retry", async () => {
  vi.mocked(api.listDocumentRows).mockRejectedValueOnce(new Error("Rows failed")).mockResolvedValue(scenarioS1().page);
  renderPage();
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByRole("tablist", { name: "Documents views" })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(retry);
  await loaded();
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("table", { name: "Documents" })).toBeTruthy();
});

it("tabs, search, Filter popover and chips replace the filter selects (VD9)", async () => {
  mockRows(scenarioS1().page);
  const onNavigate = vi.fn();
  const view = renderPage({ query: { language: "de", segment: "assign", page: "2" }, onNavigate });
  await loaded();
  expect(api.listDocumentRows).toHaveBeenCalledWith("p", { language: "de", segment: "assign", page: 2 });
  // No select filter is left on the page.
  expect(document.querySelector(".documents-page select")).toBeNull();
  expect(screen.queryByText("More filters")).toBeNull();
  const tools = filterTools();
  expect(within(tools).getByRole("searchbox", { name: "Case ID or text" }).getAttribute("placeholder")).toBe("Case ID or text…");
  // The table sits in the tab panel of the active tab.
  const panel = screen.getByRole("tabpanel");
  expect(panel.getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { selected: true }).id);
  expect(panel.contains(screen.getByRole("table", { name: "Documents" }))).toBe(true);
  // A chip per active value; removing it drops paging and the selection.
  fireEvent.click(within(tools).getByRole("button", { name: "Remove filter Language: de" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", segment: "assign" });
  // This spy never applies the route: after the event (one task) the route is the base again.
  await act(async () => { await Promise.resolve(); });
  // A tab keeps the facets.
  fireEvent.click(screen.getByRole("tab", { name: /^Done/ }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", segment: "done", language: "de" });
  // The popover footer sets the order at once.
  fireEvent.click(within(tools).getByRole("button", { name: "Filter, 1 active" }));
  fireEvent.click(screen.getByRole("radio", { name: "Last activity" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", segment: "assign", sort: "activity" });
  // A filter change announces the new count once the data arrives.
  expect(live().textContent).toBe("");
  mockRows(page([scenarioS1().group, scenarioS5().group]));
  view.rerender(<DocumentsPage projectKey="p" canManage currentUser={{ username: "lead", pseudonym: "lead-0002" }} query={{ plan: "review", step: "choose_final", sort: "import", final: "none", owner: "me", stage: "final", review_state: "accepted,check_failed", waiting_on: "me" }} onNavigate={onNavigate} />);
  await waitFor(() => expect(live().textContent).toBe("2 texts shown"));
  expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", { plan: "review", step: "choose_final", sort: "import", final: "none", owner: "me", stage: "final", review_state: ["accepted", "check_failed"], waiting_on: "me" });
  expect(within(filterTools()).getAllByRole("button", { name: /^Remove filter / }).map(chip => chip.textContent)).toEqual([
    "Translation review: Accepted", "Translation review: Check failed", "Plan: Translation review", "Waiting on: You", "Step: Choose final result", "Stage: Final result", "Owner: You", "Final result: None",
  ]);
  // Only text and case checkboxes select inside the table; no old "Assign …".
  expect(within(screen.getByRole("table", { name: "Documents" })).getAllByRole("checkbox").every(box => box.getAttribute("aria-label")?.startsWith("Select "))).toBe(true);
  expect(screen.queryByRole("button", { name: "Assign …" })).toBeNull();
});

it("search debounces 300 ms, also on Enter and blur, clear button", async () => {
  mockRows(scenarioS1().page);
  const { onNavigate } = renderPage();
  await loaded();
  vi.useFakeTimers();
  try {
    const input = searchField();
    for (const value of ["c", "ca", "cas"]) fireEvent.change(input, { target: { value } });
    act(() => { vi.advanceTimersByTime(299); });
    expect(onNavigate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", q: "cas" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    // Enter applies at once (the text label form "case-104 de" is sent as typed, VD11).
    fireEvent.change(input, { target: { value: "case-104 de" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", q: "case-104 de" });
    // Blur applies at once.
    fireEvent.change(input, { target: { value: "case-+/" } });
    fireEvent.blur(input);
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", q: "case-+/" });
    expect(onNavigate).toHaveBeenCalledTimes(3);
    act(() => { vi.advanceTimersByTime(400); });
    expect(onNavigate).toHaveBeenCalledTimes(3);
    // The clear button empties the field, removes the search and keeps focus in the field.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("chip removal moves focus to the next chip or the search field", async () => {
  mockRows(scenarioS1().page);
  const { onNavigate } = renderStateful({ language: "de,fr", step: "choose_final", segment: "assign" });
  await loaded();
  const chip = (name: string) => within(filterTools()).getByRole("button", { name: `Remove filter ${name}` });
  fireEvent.click(chip("Language: fr"));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", step: "choose_final", segment: "assign" }, undefined);
  await waitFor(() => expect(document.activeElement).toBe(chip("Step: Choose final result")));
  fireEvent.click(chip("Step: Choose final result"));
  await waitFor(() => expect(document.activeElement).toBe(searchField()));
  expect(within(filterTools()).getAllByRole("button", { name: /^Remove filter / }).map(item => item.textContent)).toEqual(["Language: de"]);
  // Clear all removes every filter and the search, not the tab or the order.
  fireEvent.change(searchField(), { target: { value: "case" } });
  fireEvent.keyDown(searchField(), { key: "Enter" });
  fireEvent.click(within(filterTools()).getByRole("button", { name: "Clear all" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", segment: "assign" }, undefined);
  await waitFor(() => expect(within(filterTools()).queryAllByRole("button", { name: /^Remove filter / })).toHaveLength(0));
  expect((searchField() as HTMLInputElement).value).toBe("");
  expect(within(filterTools()).queryByRole("button", { name: "Clear all" })).toBeNull();
});

it("{k} of {n} counts the active tab", async () => {
  mockRows(casesPage(3, { bar: { ...casesPage(3).bar, shown: 3, to_assign: 12, all: 40, needs_decision: 6 } }));
  const view = renderPage({ query: { segment: "assign", language: "de" } });
  await loaded();
  expect(within(filterTools()).getByText("3 of 12")).toBeTruthy();
  view.unmount();
  renderPage({ query: { language: "de" } });
  await loaded();
  expect(within(filterTools()).getByText("3 of 40")).toBeTruthy();
  cleanup();
  // Without a filter or search the line is not shown.
  renderPage({ query: { segment: "assign" } });
  await loaded();
  expect(within(filterTools()).queryByText(/ of /)).toBeNull();
});

describe("exact filters from Progress links", () => {
  const linked: ProjectDocumentsQuery = { q: "case-01", step: "resolve_rejected,resolve_queried", plan: "review,review_and_annotate", stage: "translation_review", paused: "no", sort: "import", page: "2" };

  it("sends comma-joined filters as lists, final=any and paused", async () => {
    mockRows(casesPage(3));
    renderPage({ query: { ...linked, final: "any", step: "resolve_rejected,unknown_step,resolve_queried" } });
    await loaded();
    expect(api.listDocumentRows).toHaveBeenCalledWith("p", {
      q: "case-01", final: "any", step: ["resolve_rejected", "resolve_queried"], stage: "translation_review", plan: ["review", "review_and_annotate"], paused: "no", sort: "import", page: 2,
    });
  });

  it("selection filters include q and decision", async () => {
    mockRows(casesPage(3));
    vi.spyOn(api, "documentRowKeys").mockResolvedValueOnce(deKeys(["case-0101"]));
    renderPage({ query: { ...linked, decision: "translation" } });
    await loaded();
    const expected = { q: "case-01", decision: "translation", step: ["resolve_rejected", "resolve_queried"], stage: "translation_review", plan: ["review", "review_and_annotate"], paused: "no" };
    // The bar is for bulk work: two texts.
    fireEvent.click(caseBox("case-0101"));
    fireEvent.click(caseBox("case-0102"));
    await waitFor(() => expect(api.selectionSummary).toHaveBeenLastCalledWith("p", { rows: [{ case_id: "case-0101", language: "de" }, { case_id: "case-0102", language: "de" }] }, expected));
    fireEvent.click(within(selectionRegion()).getByRole("button", { name: "Assign…" }));
    expect(lastAssign()).toMatchObject({ sort: "import", filters: expected });
    expect(Object.keys((lastAssign() as { filters?: object }).filters ?? {}).sort()).toEqual(Object.keys(expected).sort());
    act(() => { lastAssign().onClose(); });
    // Two of three selected: the header checkbox is mixed (#47 A-20).
    expect((screen.getByRole("checkbox", { name: "Select all 3 filtered texts" }) as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all 3 filtered texts" }));
    await waitFor(() => expect(api.documentRowKeys).toHaveBeenCalledWith("p", { filters: expected, sort: "import" }));
  });

  it("drops a final filter under a decision filter (the API takes one of them)", async () => {
    mockRows(casesPage(1));
    renderPage({ query: { decision: "translation", final: "none" } });
    await loaded();
    expect(api.listDocumentRows).toHaveBeenCalledWith("p", { decision: "translation" });
  });

  it("shows Export final results… when bar.finals > 0 even if no shown case has a final", async () => {
    mockRows(casesPage(2, { bar: { ...casesPage(2).bar, finals: 4 } }));
    renderPage({ query: { segment: "assign" } });
    await loaded();
    expect(screen.getByRole("link", { name: "Export final results…" }).getAttribute("href")).toBe("#/projects/p/export");
    cleanup();
    mockRows(casesPage(2));
    renderPage();
    await loaded();
    expect(screen.queryByRole("link", { name: "Export final results…" })).toBeNull();
  });

  it("shows a chip per value of multi-value filters", async () => {
    mockRows(casesPage(1));
    const onNavigate = vi.fn();
    renderPage({ query: { step: "resolve_rejected,resolve_queried", plan: "annotate,review_and_annotate", stage: "final,done", paused: "no", final: "any" }, onNavigate });
    await loaded();
    const chips = within(filterTools()).getAllByRole("button", { name: /^Remove filter / });
    expect(chips.map(chip => chip.textContent)).toEqual([
      "Plan: Annotate", "Plan: Translation review and annotation", "Step: Resolve rejected translation", "Step: Resolve queried translation",
      "Stage: Final result", "Stage: Done", "Not paused", "Final result: Has a final result",
    ]);
    expect(screen.queryByText(/Also filtered/)).toBeNull();
    // Removing one value keeps the others.
    fireEvent.click(chips[0]);
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", step: "resolve_rejected,resolve_queried", plan: "review_and_annotate", stage: "final,done", paused: "no", final: "any" });
  });

  it("selection filters pass facets, the Done tab and the descending sort through", async () => {
    mockRows(casesPage(3));
    vi.spyOn(api, "documentRowKeys").mockResolvedValueOnce(deKeys(["case-0101"]));
    renderPage({ query: { segment: "done", language: "de,fr", origin: "correction", review_state: "accepted", annotation_state: "submitted", final_state: "final", waiting_on: "me", plan: "not_decided", sort: "-activity" } });
    await loaded();
    const expected = { segment: "done", language: ["de", "fr"], origin: "correction", review_state: "accepted", annotation_state: "submitted", final_state: "final", waiting_on: "me", plan: "not_decided" };
    // The bar is for bulk work: two texts.
    fireEvent.click(caseBox("case-0101"));
    fireEvent.click(caseBox("case-0102"));
    await waitFor(() => expect(api.selectionSummary).toHaveBeenLastCalledWith("p", { rows: [{ case_id: "case-0101", language: "de" }, { case_id: "case-0102", language: "de" }] }, expected));
    fireEvent.click(within(selectionRegion()).getByRole("button", { name: "Assign…" }));
    expect(lastAssign()).toMatchObject({ sort: "activity", filters: expected });
    act(() => { lastAssign().onClose(); });
    // Two of three selected: the header checkbox is mixed (#47 A-20).
    expect((screen.getByRole("checkbox", { name: "Select all 3 filtered texts" }) as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all 3 filtered texts" }));
    await waitFor(() => expect(api.documentRowKeys).toHaveBeenCalledWith("p", { filters: expected, sort: "-activity" }));
  });
});

it("re-announces a repeated message in the live region", async () => {
  mockRows(casesPage(2));
  renderPage();
  await loaded();
  fireEvent.click(caseBox("case-0101"), { shiftKey: true });
  await waitFor(() => expect(live().textContent).toBe(selectedText(1)));
  // The same range again: the same message is cleared and set again.
  fireEvent.click(caseBox("case-0101"), { shiftKey: true });
  expect(live().textContent).toBe("");
  await waitFor(() => expect(live().textContent).toBe(selectedText(1)));
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
  expect(screen.getByRole("tablist", { name: "Documents views" })).toBeTruthy();
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("reloads after the same user logs in again, so the session banners go (#13)", async () => {
  mockRows(scenarioS1().page);
  renderPage();
  await screen.findByRole("table", { name: "Documents" });
  vi.mocked(api.listDocumentRows).mockRejectedValueOnce(new Error("offline"));
  act(() => { window.dispatchEvent(new Event("focus")); });
  await screen.findByRole("alert");
  act(() => notifySessionRestored());
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

describe("case selection", () => {
  it("no case checkboxes: texts not in plan are rows only with the switch, then selectable like any text", async () => {
    window.localStorage.clear();
    mockRows(page([group("case-0101", [planRow("case-0101", "en", stepOf("assign_annotation"), { is_source: true }), planRow("case-0101", "de", stepOf("assign_translation_review")), notInPlanRow("case-0101", "fr")])]));
    renderPage();
    await loaded();
    expect(screen.queryByRole("checkbox", { name: /^Select case-0101 \(/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Select case-0101 fr" })).toBeNull();
    fireEvent.click(rowBox("case-0101", "en"));
    fireEvent.click(rowBox("case-0101", "de"));
    expect(within(selectionRegion()).getByText("2 texts in 1 case selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Show texts not in plan \(/ }));
    fireEvent.click(rowBox("case-0101", "fr"));
    expect(within(selectionRegion()).getByText("3 texts in 1 case selected")).toBeTruthy();
    window.localStorage.clear();
  });

  it("Shift-click selects a range and announces the count", async () => {
    mockRows(casesPage(25));
    renderPage();
    await loaded();
    fireEvent.click(caseBox("case-0101"));
    fireEvent.click(caseBox("case-0120"), { shiftKey: true });
    await waitFor(() => expect(live().textContent).toBe(selectedText(20)));
    expect(within(selectionRegion()).getByText(selectedText(20))).toBeTruthy();
    expect((caseBox("case-0110") as HTMLInputElement).checked).toBe(true);
    expect((caseBox("case-0121") as HTMLInputElement).checked).toBe(false);
    // Ctrl-click removes one case and keeps the anchor.
    fireEvent.click(caseBox("case-0110"), { ctrlKey: true });
    await waitFor(() => expect(live().textContent).toBe(selectedText(19)));
    fireEvent.click(caseBox("case-0122"), { shiftKey: true });
    await waitFor(() => expect(live().textContent).toBe(selectedText(22)));
  });

  it("Shift+ArrowDown moves and selects; Space toggles; listed in ? help under Selection", async () => {
    let help: ReturnType<typeof useRegisteredShortcuts> = [];
    function Help() { help = useRegisteredShortcuts(); return null; }
    mockRows(casesPage(3));
    render(<Help />);
    renderPage();
    await loaded();
    const first = caseBox("case-0101");
    first.focus();
    fireEvent.click(first); // Space on a focused checkbox is a click
    fireEvent.keyDown(rowBox("case-0101", "de"), { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(rowBox("case-0102", "de"));
    expect((caseBox("case-0102") as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(live().textContent).toBe(selectedText(2)));
    fireEvent.keyDown(rowBox("case-0102", "de"), { key: "ArrowUp", shiftKey: true });
    expect(document.activeElement).toBe(rowBox("case-0101", "de"));
    fireEvent.click(first);
    expect((first as HTMLInputElement).checked).toBe(false);
    expect(help.filter(row => row.group === "Selection").map(row => row.description)).toEqual(
      expect.arrayContaining(["Move to the next or previous row and select it", "Select or deselect the focused row"]));
  });

  it("Space toggles the focused row checkbox", async () => {
    mockRows(casesPage(3));
    renderPage();
    await loaded();
    const first = rowBox("case-0101", "de");
    first.focus();
    fireEvent.click(first); // Space on a focused checkbox is a click
    expect((first as HTMLInputElement).checked).toBe(true);
    expect((caseBox("case-0101") as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(live().textContent).toBe(selectedText(1)));
    // Shift+ArrowDown moves to the next row's checkbox and selects it.
    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(rowBox("case-0102", "de"));
    expect((rowBox("case-0102", "de") as HTMLInputElement).checked).toBe(true);
    expect(within(selectionRegion()).getByText(selectedText(2))).toBeTruthy();
    fireEvent.click(first);
    expect((first as HTMLInputElement).checked).toBe(false);
    // One selected text still shows the bar (R-3).
    await waitFor(() => expect(live().textContent).toBe(selectedText(1)));
    expect(within(selectionRegion()).getByText(selectedText(1))).toBeTruthy();
  });

  it("Ctrl+Z and Meta+Z undo the last plan change while a row checkbox has focus", async () => {
    const fr = planRow("case-0101", "fr", stepOf("assign_translation_review"));
    mockRows(page([group("case-0101", [fr], { plan_revision: 2 })]));
    const saved = (revision: number) => ({
      case_id: "case-0101", language: "fr", flags: { review: false, annotate: true, review_applicable: true, discarded: false }, revision,
      undo: { rows: [{ case_id: "case-0101", language: "fr", review: true, annotate: true }], revisions: { "case-0101": revision } }, withdrawn: [], accepted_document_ids: [],
    } as PlanRowResult);
    vi.spyOn(api, "patchWorkPlan").mockResolvedValueOnce(saved(3)).mockResolvedValueOnce(saved(5));
    vi.spyOn(api, "setWorkPlanRows").mockResolvedValue({ changed_rows: 1, revisions: { "case-0101": 4 }, undo: { rows: [], revisions: {} }, withdrawn: [] });
    // The plan chips of an in-plan row are in the row panel's Details (VD2).
    renderStateful({ panel: "case-0101:fr", panel_tab: "details" });
    fireEvent.click(await screen.findByRole("button", { name: "Translation review, case-0101 fr" }));
    await screen.findByText("fr of case-0101: Translation review off");
    // The text card is modal: close it to reach the case checkbox.
    fireEvent.click(within(await textCard("case-0101 fr")).getByRole("button", { name: "Close" }));
    const box = rowBox("case-0101", "fr");
    box.focus();
    fireEvent.keyDown(box, { key: "z", ctrlKey: true });
    await waitFor(() => expect(api.setWorkPlanRows).toHaveBeenCalledTimes(1));
    expect(api.setWorkPlanRows).toHaveBeenLastCalledWith("p", expect.objectContaining({ undo: true }));
    await waitFor(() => expect(screen.queryByText("fr of case-0101: Translation review off")).toBeNull());
    fireEvent.keyDown(screen.getByRole("button", { name: "Text case-0101 fr" }), { key: "Enter" });
    fireEvent.click(within(await textCard("case-0101 fr")).getByRole("button", { name: "Details" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Translation review, case-0101 fr/ }));
    await screen.findByText(/fr of case-0101: Translation review/);
    fireEvent.click(within(await textCard("case-0101 fr")).getByRole("button", { name: "Close" }));
    rowBox("case-0101", "fr").focus();
    fireEvent.keyDown(rowBox("case-0101", "fr"), { key: "z", metaKey: true });
    await waitFor(() => expect(api.setWorkPlanRows).toHaveBeenCalledTimes(2));
  });

  it("header checkbox selects all filtered texts across pages", async () => {
    mockRows(casesPage(3, { group_count: 50, page_count: 17 }));
    const all = Array.from({ length: 50 }, (_, index) => `case-${String(101 + index).padStart(4, "0")}`);
    vi.spyOn(api, "documentRowKeys").mockResolvedValueOnce(deKeys(all));
    const view = renderPage({ query: { language: "de", segment: "assign", page: "2" } });
    await loaded();
    const header = screen.getByRole("checkbox", { name: "Select all 50 filtered texts" });
    expect(header.className).toContain("checkbox-target");
    fireEvent.click(header);
    await waitFor(() => expect(within(selectionRegion()).getByText(selectedText(50))).toBeTruthy());
    expect(api.documentRowKeys).toHaveBeenCalledWith("p", { filters: { language: "de", segment: "assign" }, sort: "case" });
    expect((header as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(live().textContent).toBe(selectedText(50)));
    fireEvent.click(header);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selection" })).toBeNull());
    view.unmount();
    // More than 2000 match: the first 2000 are selected and the bar says so.
    mockRows(casesPage(3, { group_count: 2500, page_count: 50 }));
    const first = Array.from({ length: 2000 }, (_, index) => `c-${index}`);
    vi.mocked(api.documentRowKeys).mockResolvedValueOnce(deKeys(first, true));
    renderPage();
    await loaded();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select the first 2000 of 2500 filtered texts" }));
    await waitFor(() => expect(within(selectionRegion()).getByText(selectedText(2000))).toBeTruthy());
    expect(within(selectionRegion()).getByText("Selection is limited to 2000 cases. Selected the first 2000.")).toBeTruthy();
  });

  it("header checkbox clicked twice clears what it selected when the 2000-case cap truncated it", async () => {
    mockRows(casesPage(3, { group_count: 2500, page_count: 50 }));
    const first = Array.from({ length: 2000 }, (_, index) => `c-${index}`);
    vi.spyOn(api, "documentRowKeys").mockResolvedValueOnce(deKeys(first, true));
    renderPage();
    await loaded();
    // One case selected before: the header adds only 1999 more cases.
    fireEvent.click(rowBox("case-0101", "de"));
    const header = screen.getByRole("checkbox", { name: "Select the first 2000 of 2500 filtered texts" }) as HTMLInputElement;
    fireEvent.click(header);
    await waitFor(() => expect(within(selectionRegion()).getByText(selectedText(2000))).toBeTruthy());
    expect(within(selectionRegion()).getByText("Selection is limited to 2000 cases. Selected the first 2000.")).toBeTruthy();
    expect(header.checked).toBe(true);
    // The second click clears the header's texts (no second request) and keeps the earlier selection.
    fireEvent.click(header);
    await waitFor(() => expect(live().textContent).toBe(selectedText(1)));
    expect(within(selectionRegion()).getByText(selectedText(1))).toBeTruthy();
    expect(api.documentRowKeys).toHaveBeenCalledTimes(1);
    expect(header.checked).toBe(false);
    expect((rowBox("case-0101", "de") as HTMLInputElement).checked).toBe(true);
  });

  it("Select by case IDs… replaces the selection and the selection survives paging and filters", async () => {
    mockRows(casesPage(3, { page_count: 2 }));
    vi.spyOn(api, "lookupCaseIds").mockResolvedValue({ found: ["case-0102", "case-0999"], unknown: [] });
    vi.spyOn(api, "documentRowKeys").mockResolvedValue(deKeys(["case-0102", "case-0999"]));
    renderStateful({});
    await loaded();
    fireEvent.click(caseBox("case-0101"));
    fireEvent.click(screen.getByRole("button", { name: "Select by case IDs…" }));
    const dialog = screen.getByRole("dialog", { name: "Select by case IDs" });
    fireEvent.change(within(dialog).getByLabelText("Paste case IDs"), { target: { value: "case-0102\ncase-0999" } });
    await within(dialog).findByText("2 found, 0 unknown");
    fireEvent.click(within(dialog).getByRole("button", { name: "Select 2" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Select by case IDs" })).toBeNull());
    expect(within(selectionRegion()).getByText(selectedText(2))).toBeTruthy();
    expect((caseBox("case-0101") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: /^To assign/ }));
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", { segment: "assign" }));
    fireEvent.click(screen.getByRole("link", { name: "Next" }));
    // Under a tab the request also retains the rows shown before (visit state).
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", expect.objectContaining({ segment: "assign", page: 2 })));
    expect(within(selectionRegion()).getByText(selectedText(2))).toBeTruthy();
    await waitFor(() => expect(api.selectionSummary).toHaveBeenLastCalledWith("p", { rows: deKeys(["case-0102", "case-0999"]).keys }, { segment: "assign" }));
  });

  it("Assign… opens the many-cases dialog with the current sort and filters and clears the selection after success", async () => {
    mockRows(casesPage(3));
    renderPage({ query: { language: "de", segment: "assign", sort: "import", q: "case-01" } });
    await loaded();
    fireEvent.click(caseBox("case-0101"));
    fireEvent.click(caseBox("case-0103"), { shiftKey: true });
    fireEvent.click(within(selectionRegion()).getByRole("button", { name: "Assign…" }));
    const props = lastAssign();
    expect(props).toMatchObject({ mode: "cases", projectKey: "p", caseIds: ["case-0101", "case-0102", "case-0103"], sort: "import", filters: { language: "de", segment: "assign" } });
    expect(screen.getByRole("dialog", { name: "Assign stub" })).toBeTruthy();
    const calls = vi.mocked(api.listDocumentRows).mock.calls.length;
    act(() => { if (props.mode === "cases") props.onAssigned("3 translation reviews assigned to Ana Weber", []); });
    expect(screen.queryByRole("dialog", { name: "Assign stub" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
    expect(await screen.findByText("3 translation reviews assigned to Ana Weber", { selector: ".ui-toast-message" })).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api.listDocumentRows).mock.calls.length).toBeGreaterThan(calls));
    // Cancel closes without touching the selection.
    fireEvent.click(caseBox("case-0102"));
    fireEvent.click(caseBox("case-0103"));
    fireEvent.click(within(selectionRegion()).getByRole("button", { name: "Assign…" }));
    act(() => { lastAssign().onClose(); });
    expect(screen.queryByRole("dialog", { name: "Assign stub" })).toBeNull();
    expect(within(selectionRegion()).getByText(selectedText(2))).toBeTruthy();
  });

  it("offers Select the 6 skipped cases in the toast", async () => {
    mockRows(casesPage(8));
    renderPage();
    await loaded();
    fireEvent.click(caseBox("case-0101"));
    fireEvent.click(caseBox("case-0108"), { shiftKey: true });
    fireEvent.click(within(selectionRegion()).getByRole("button", { name: "Assign…" }));
    const skipped = ["case-0103", "case-0104", "case-0105", "case-0105", "case-0106", "case-0107", "case-0108"];
    act(() => { const props = lastAssign(); if (props.mode === "cases") props.onAssigned("2 translation reviews assigned to Ana Weber", skipped); });
    vi.spyOn(api, "documentRowKeys").mockImplementation(async (_key, body) => deKeys(body?.case_ids ?? []));
    fireEvent.click(await screen.findByRole("button", { name: "Select the 6 skipped cases" }));
    await waitFor(() => expect(within(selectionRegion()).getByText(selectedText(6))).toBeTruthy());
    expect(api.documentRowKeys).toHaveBeenCalledWith("p", { case_ids: ["case-0103", "case-0104", "case-0105", "case-0106", "case-0107", "case-0108"] });
    expect((caseBox("case-0103") as HTMLInputElement).checked).toBe(true);
    expect((caseBox("case-0101") as HTMLInputElement).checked).toBe(false);
  });

  it("row Assign actions open the row dialog", async () => {
    mockRows(page([group("case-1", [planRow("case-1", "de", stepOf("assign_translation_review")), planRow("case-1", "fr", stepOf("assign_annotation"))])]));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Assign review…, case-1 de" }));
    expect(lastAssign()).toMatchObject({ mode: "row", projectKey: "p", task: "translation_review", row: { case_id: "case-1", language: "de" } });
    act(() => { lastAssign().onClose(); });
    fireEvent.click(screen.getByRole("button", { name: "Assign annotation…, case-1 fr" }));
    const props = lastAssign();
    expect(props).toMatchObject({ mode: "row", task: "annotate", row: { case_id: "case-1", language: "fr" } });
    const calls = vi.mocked(api.listDocumentRows).mock.calls.length;
    act(() => { if (props.mode === "row") props.onAssigned("1 annotation assigned to Ana Weber"); });
    expect(screen.queryByRole("dialog", { name: "Assign stub" })).toBeNull();
    expect(await screen.findByText("1 annotation assigned to Ana Weber", { selector: ".ui-toast-message" })).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api.listDocumentRows).mock.calls.length).toBeGreaterThan(calls));
  });
});

it("hides the Translation column and filter group while the project has no translation (U-4)", async () => {
  const native = { document_id: "d-en", case_id: "case-0101", external_id: "e", language: "en", version: 1, origin: "native", derived_from: null, translation: null, translation_status: null, status_reason: null, text_sha256: "x", assigned_to_me: false };
  vi.mocked(api.getProjectSettings).mockResolvedValue({ languages: ["en"] } as never);
  vi.mocked(api.listCases).mockResolvedValue([{ case_id: "case-0101", variants: [native] }] as never);
  mockRows(casesPage(1));
  renderPage(); await loaded();
  const headers = () => within(screen.getByRole("table", { name: "Documents" })).getAllByRole("columnheader").map(header => header.textContent);
  await waitFor(() => expect(headers()).not.toContain("Translation"));
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  expect(screen.queryByRole("group", { name: "Translation review" })).toBeNull();
  cleanup();
  // A translation language set up brings it back.
  vi.mocked(api.getProjectSettings).mockResolvedValue({ languages: ["en", "de"] } as never);
  renderPage(); await loaded();
  await waitFor(() => expect(within(screen.getByRole("table", { name: "Documents" })).getAllByRole("columnheader").map(header => header.textContent)).toContain("Translation"));
});

it("renders the new table with stage columns", async () => {
  const progress = stagedRow("case-106", "de", {
    stages: {
      review: cell("accepted", "done", { note: "unchanged" }),
      annotation: cell("in_progress", "running", { people: [tom], submitted: 1, total: 2 }),
      final: cell("after_annotation", "waiting"),
    },
    steps: [stepOf("annotation_in_progress", { owner: { kind: "people", person: null, count: 2, people: [ana, tom] } })],
  });
  mockRows(page([group("case-107", [scenario7a()]), group("case-106", [progress])]));
  const { onNavigate } = renderPage();
  await loaded();
  const table = screen.getByRole("table", { name: "Documents" });
  expect(within(table).getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Select", "Text", "Translation", "Annotation", "Finalization", "Waiting on", "Next step", "Last activity"]);
  const decision = rowHeader("case-107 de").closest("tr")!;
  expect(decision.className).toContain("data-table-row--decision");
  expect(within(decision).getByText("Your choice")).toBeTruthy();
  expect(within(decision).getByRole("button", { name: "Accept result…, case-107 de" })).toBeTruthy();
  const running = rowHeader("case-106 de").closest("tr")!;
  expect(running.textContent).toContain("1 of 2 submitted");
  expect(running.textContent).toContain("1 of 2 submitted · open: Tom Reis");
  expect(running.textContent).toContain("Ana Weber, Tom Reis");
  // No group disclosure, no Plan / Owner columns.
  expect(screen.queryByRole("button", { name: /^case-107, / })).toBeNull();
  // Sorting by the Text header.
  fireEvent.click(within(screen.getByRole("columnheader", { name: /Text/ })).getByRole("button"));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", sort: "-case" });
});

it("shows the descending header sorts by their base order in the popover footer", async () => {
  mockRows(page([scenarioS1().group]));
  const view = renderPage({ query: { sort: "-activity" } });
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  expect((screen.getByRole("radio", { name: "Last activity" }) as HTMLInputElement).checked).toBe(true);
  view.unmount();
  renderPage({ query: { sort: "-case" } });
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  expect((screen.getByRole("radio", { name: "Case ID" }) as HTMLInputElement).checked).toBe(true);
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

it("paging links answer Space like buttons (V4)", async () => {
  mockRows(page([scenarioS1().group], { page: 2, page_count: 3 }));
  const { onNavigate } = renderPage({ query: { page: "2" } });
  await screen.findByText("Page 2 of 3");
  fireEvent.keyDown(screen.getByRole("link", { name: "Next" }), { key: " " });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", page: "3" });
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

it("opens the text card from a card's action as the full-width sheet with the decision block", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 699px)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  const s1 = scenarioS1();
  const en = { ...s1.group.rows.find(entry => entry.language === "en")!, next_step: chooseFinalStep(), steps: [chooseFinalStep()] };
  mockRows(page([{ ...s1.group, rows: [en] }]), s1.submissions);
  renderStateful({});
  fireEvent.click(await screen.findByRole("button", { name: "Compare results…, case-0042 en" }));
  const sheet = await textCard("case-0042 en");
  expect(sheet.classList.contains("text-card--sheet")).toBe(true);
  expect(within(sheet).getByRole("region", { name: "Final result" })).toBeTruthy();
  expect(within(sheet).getByRole("button", { name: "Close" })).toBeTruthy();
});

it("focuses a deep-linked row that no longer needs a decision and shows its notice", async () => {
  const s0 = scenarioS0();
  const de = { ...s0.group.rows[1], pinned: true, matches_decision: false, categories: [] };
  mockRows(page([group("synthetic-accepted", [s0.group.rows[0], de])]), s0.submissions);
  renderPage({ query: { case: "synthetic-accepted", language: "de", decision: "all" } });
  expect(await screen.findByText("This no longer needs your decision.")).toBeTruthy();
  expect(api.listDocumentRows).toHaveBeenCalledWith("p", { case: "synthetic-accepted", language: "de", decision: "all" });
  // Focus goes to the row header's name (spec "Edge cases › Deep links"); a deep link opens no panel.
  const name = document.getElementById(documentsRowId("synthetic-accepted", "de", "header"))!;
  expect(rowHeader("synthetic-accepted de").contains(name)).toBe(true);
  expect(name.getAttribute("aria-label")).toBe("Text synthetic-accepted de");
  await waitFor(() => expect(document.activeElement).toBe(name));
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("shows an unknown text and an empty decision filter with Show all texts", async () => {
  mockRows(page([], { case_found: false }));
  const { onNavigate, unmount } = renderPage({ query: { case: "nope" } });
  expect(await screen.findByRole("heading", { name: "Text nope not found" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Show all texts" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p" });
  unmount();
  mockRows(page([], { bar: { ...page([]).bar, all: 3 } }));
  renderPage({ query: { decision: "all" } });
  expect(await screen.findByRole("heading", { name: "Nothing needs your decision" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Show all texts" })).toBeTruthy();
});

it("shows the empty states per tab, for filters and for an empty project", async () => {
  mockRows(page([], { bar: { ...page([]).bar, all: 3 } }));
  const cases: [ProjectDocumentsQuery, string][] = [
    [{ segment: "assign" }, "Nothing to assign"],
    [{ segment: "progress" }, "Nothing in progress"],
    [{ segment: "decision" }, "Nothing needs your decision"],
    [{ segment: "done", language: "de" }, "Nothing done yet"],
  ];
  for (const [query, title] of cases) {
    const { unmount } = renderPage({ query });
    expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    unmount();
  }
  // An empty project shows "No texts yet" with the upload on every tab, as it has no tabs to leave.
  mockRows(page([]));
  const deepLinked = renderPage({ query: { segment: "assign" } });
  expect(await screen.findByRole("heading", { name: "No texts yet" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Upload texts…" })).toBeTruthy();
  deepLinked.unmount();
  renderPage();
  expect(await screen.findByText("Upload texts to start.")).toBeTruthy();
  // An empty project offers only the upload, inside the empty state: no tabs, filters or selection (#46).
  expect(screen.getAllByRole("button", { name: "Upload texts…" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Upload texts…" }).className).toContain("btn-primary");
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByRole("toolbar", { name: "Document filters" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Select by case IDs…" })).toBeNull();
  cleanup();
  // The tab has rows, the filters exclude them: "No texts match these filters." with Clear all.
  mockRows(page([], { bar: { ...page([]).bar, all: 3 } }));
  const { onNavigate } = renderPage({ query: { plan: "not_in_plan", sort: "import" } });
  expect(await screen.findByRole("heading", { name: "No texts match these filters." })).toBeTruthy();
  fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Clear all" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", sort: "import" });
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

it("opens no row panel for a deep link with several languages", async () => {
  mockRows(scenarioS1().page);
  renderPage({ query: { case: "case-0042", language: "de,fr" } });
  await loaded();
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("the text name opens the row panel with replace navigation", async () => {
  mockRows(scenarioS1().page);
  const { onNavigate } = renderPage({ query: { language: "en" } });
  fireEvent.keyDown(await screen.findByRole("button", { name: "Text case-0042 en" }), { key: "Enter" });
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "en", panel: "case-0042:en" }, { replace: true });
});

it("gives the row panel the case's plan revision, the plan chips and the lead (Details tab)", async () => {
  const s5 = scenarioS5();
  mockRows(page([{ ...s5.group, plan_revision: 7 }]), s5.submissions);
  renderPage({ query: { panel: rowKey("case-0377", "en"), panel_tab: "details" } });
  const panel = await textCard("case-0377 en");
  // VD2 (2): the Plan line with the row's chips is in Details.
  const plan = await within(panel).findByRole("group", { name: "Plan" });
  expect(within(plan).getAllByRole("button").length).toBeGreaterThan(0);
  expect(within(panel).getByText("Plan revision").nextElementSibling!.textContent).toBe("7");
  // No submissions table or final-result decision for a row without a lead decision.
  expect(within(panel).queryByRole("region", { name: "Final result" })).toBeNull();
});

it("reloads the submissions of the panel's row only when its last activity changed", async () => {
  const s1 = scenarioS1();
  mockRows(s1.page, s1.submissions);
  renderPage({ query: { panel: rowKey("case-0042", "en") } });
  await textCard("case-0042 en");
  await waitFor(() => expect(api.getRowSubmissions).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
  await act(async () => { await Promise.resolve(); });
  expect(api.getRowSubmissions).toHaveBeenCalledTimes(1);
  const changed = structuredClone(s1.page);
  for (const entry of changed.groups.flatMap(item => item.rows)) entry.last_activity_at = "2026-10-21T11:59:00Z";
  mockRows(changed, s1.submissions);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(api.getRowSubmissions).toHaveBeenCalledTimes(2));
  expect(api.listDocumentRows).toHaveBeenCalledTimes(3);
});

describe("text changes (V5)", () => {
  const tcVersions = (caseId: string) => [
    version({ document_id: `${caseId}-de-v1`, external_id: `${caseId}-de`, chain_id: "de", version: 1, is_newest_in_chain: false }),
    version({ document_id: `${caseId}-de-v2`, external_id: `${caseId}-de`, chain_id: "de", version: 2, origin: "correction" }),
  ];
  beforeEach(() => {
    vi.spyOn(api, "previewTextChange").mockResolvedValue({ from_version: 1, to_version: 2, findings: 3, placed: 3, unplaced: 0, in_changed_passages: 0,
      persons: [{ username: "ana", display_name: "Ana Weber", author: true, has_work: true }] });
  });

  it("Handle text change… opens one dialog per person from the text card and toasts the result", async () => {
    const handleTom = stepOf("handle_text_change", { stage: "annotation", assignment_id: 41, document_id: "case-201-de-v2" });
    const handleAna = stepOf("handle_text_change", { stage: "annotation", assignment_id: 42, document_id: "case-201-de-v2" });
    const de = planRow("case-201", "de", handleTom, { versions: tcVersions("case-201"), steps: [handleTom, handleAna],
      work: [work({ assignment_id: 41, document_id: "case-201-de-v1", person: tom, status: "in_progress" }), work({ assignment_id: 42, document_id: "case-201-de-v1", person: ana, status: "in_progress" })] });
    mockRows(page([group("case-201", [de])]));
    const resolve = vi.spyOn(api, "resolveTextChange").mockResolvedValue({} as AssignmentView);
    vi.spyOn(api, "listAssignments").mockResolvedValue([{ id: 42, workflow_revision: 3 } as AssignmentView]);
    renderStateful({});
    // The row shows the first step only; the text card offers one entry per person.
    expect(await screen.findByRole("button", { name: "Handle text change…, Tom Reis, case-201 de" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Text case-201 de" }), { key: "Enter" });
    const card = await screen.findByRole("dialog", { name: "case-201 de" });
    expect(within(card).getByRole("button", { name: "Handle text change…, Tom Reis" })).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Handle text change…, Ana Weber" }));
    const dialog = await screen.findByRole("dialog", { name: "Handle text change: case-201 de" });
    expect(within(dialog).getByText("Ana Weber has an open annotation on v1. The text is now v2.")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Withdraw" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(42, { resolution: "withdrawn", target_document_id: "case-201-de-v2", expected_workflow_revision: 3 }));
    expect((await screen.findAllByText("Ana Weber’s task is withdrawn. v2 needs a new annotation.")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog", { name: "Handle text change: case-201 de" })).toBeNull();
  });

  it("keeps the Handle text change dialog open when a refresh drops its row from the page", async () => {
    const handle = stepOf("handle_text_change", { stage: "annotation", assignment_id: 42, document_id: "case-202-de-v2" });
    const de = planRow("case-202", "de", handle, { versions: tcVersions("case-202"),
      work: [work({ assignment_id: 42, document_id: "case-202-de-v1", person: ana, status: "in_progress" })] });
    mockRows(page([group("case-202", [de])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Handle text change…, case-202 de" }));
    const dialog = await screen.findByRole("dialog", { name: "Handle text change: case-202 de" });
    vi.mocked(api.listDocumentRows).mockImplementation(async () => page([]));
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByRole("table", { name: "Documents" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Handle text change: case-202 de" })).toBe(dialog);
  });

  it("Carry to v2… opens the carry dialog; Annotate v2 from scratch opens the assign dialog", async () => {
    const carry = stepOf("carry_text_change", { stage: "annotation", assignment_id: 51, submission_id: "sub-1", document_id: "case-202-de-v2" });
    const de = planRow("case-202", "de", carry, { versions: tcVersions("case-202"),
      work: [work({ assignment_id: 51, document_id: "case-202-de-v1", person: ana, status: "submitted", round_ordinal: 1 })] });
    mockRows(page([group("case-202", [de])]));
    const carrySpy = vi.spyOn(api, "carrySubmission").mockResolvedValue({ resolution: "dismissed", assignment: null, round: null, carried_findings: 0 });
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Carry to v2…, case-202 de" }));
    const dialog = await screen.findByRole("dialog", { name: "Carry to v2: case-202 de" });
    expect(await within(dialog).findByText("Ana Weber submitted on v1 (Round 1, 3 findings).")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Annotate v2 from scratch" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(carrySpy).toHaveBeenCalledWith("p", "sub-1", expect.objectContaining({ mode: "dismiss", target_document_id: "case-202-de-v2" })));
    await waitFor(() => expect(lastAssign()).toMatchObject({ mode: "row", task: "annotate" }));
  });

  it("Assign review… for a changed source opens the assign dialog with review_reason source_changed", async () => {
    const de = planRow("case-203", "de", stepOf("review_source_change", { stage: "translation_review" }));
    mockRows(page([group("case-203", [de])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Assign review…, case-203 de" }));
    await waitFor(() => expect(lastAssign()).toMatchObject({ mode: "row", task: "translation_review", reviewReason: "source_changed" }));
  });
});

it("opens the translation review history of a version from Text versions", async () => {
  const s3 = scenarioS3();
  mockRows(s3.page, s3.submissions);
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([]);
  renderPage({ query: { panel: rowKey("case-0211", "de"), panel_tab: "versions" } });
  fireEvent.click(await screen.findByRole("button", { name: "Translation reviews for v1" }));
  expect(api.listTranslationReviews).toHaveBeenCalledWith("p", "case-0211-de");
  const dialog = await screen.findByRole("dialog", { name: "Translation reviews: case-0211-de" });
  expect(await within(dialog).findByText("No one has reviewed this translation yet.")).toBeTruthy();
});

it("labels each translation review with its guideline version", async () => {
  const s3 = scenarioS3();
  mockRows(s3.page, s3.submissions);
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([
    reviewRecord({ id: 2, guideline_version: 2, guideline_withdrawn: true }),
    reviewRecord({ id: 1, guideline_version: null }),
  ]);
  renderPage({ query: { panel: rowKey("case-0211", "de"), panel_tab: "versions" } });
  fireEvent.click(await screen.findByRole("button", { name: "Translation reviews for v1" }));
  const dialog = await screen.findByRole("dialog", { name: "Translation reviews: case-0211-de" });
  await within(dialog).findAllByRole("listitem");
  expect([...dialog.querySelectorAll(".review-guideline")].map(line => line.textContent)).toEqual(["Guidelines v2 (withdrawn)", "Guidelines: not recorded"]);
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

  beforeEach(() => {
    vi.mocked(api.listDocumentRows).mockImplementation(async () => structuredClone(served));
    vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "x", language: "de", document_id: "d", submission_id: "s", revision: 2 });
  });

  /** case-0042 en waiting for a decision. */
  const missing = (overrides: Partial<DocumentRowView> = {}) => row({
    case_id: "case-0042", language: "en", versions: [version({ document_id: "case-0042-en" })],
    categories: ["missing-final"], missing_final: { counts: true, reason: null }, ...overrides,
  });

  it("shows Resolved after the lead's own Keep and retains the row; the row panel stays on it", async () => {
    const s0 = scenarioS0();
    const de = { ...s0.group.rows[1], next_step: stepOf("confirm_final"), steps: [stepOf("confirm_final")] };
    serve(page([group("synthetic-accepted", [de])]));
    vi.mocked(api.getRowSubmissions).mockImplementation(async (_key, caseId, language) => structuredClone(s0.submissions[rowKey(caseId, language)] ?? submissions(caseId, language)));
    // The panel is open on the row (route parameter `panel`).
    const { onNavigate } = renderPage({ query: { decision: "confirm-final", panel: "synthetic-accepted:de" } });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "confirm-final", retain: ["synthetic-accepted:de"] }));
    const panel = await textCard("synthetic-accepted de");
    serve(page([group("synthetic-accepted", [{ ...de, issues: [], categories: [], final: { ...de.final!, revision: 2 }, matches_decision: false, retained: true, next_step: null, steps: [] }])]));
    fireEvent.click(await within(panel).findByRole("button", { name: "Keep final on v1" }));
    expect(await within(panel).findByText("No more final results to decide.")).toBeTruthy();
    // The badge is on the row itself, next to its row header, once; nothing collapses or navigates.
    await waitFor(() => expect(within(rowHeader("synthetic-accepted de")).getByText("Resolved")).toBeTruthy());
    expect(screen.getAllByText("Resolved")).toHaveLength(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(lastRequest()).toEqual({ decision: "confirm-final", retain: ["synthetic-accepted:de"] });
    await refetch();
    expect(lastRequest()).toEqual({ decision: "confirm-final", retain: ["synthetic-accepted:de"] });
    expect(screen.getByRole("dialog", { name: "synthetic-accepted de" })).toBe(panel);
  });

  it("shows Changed: Work assigned when work was assigned elsewhere", async () => {
    serve(page([group("case-0042", [missing()])]));
    renderPage({ query: { decision: "missing-final", panel: rowKey("case-0042", "en") } });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "missing-final", retain: ["case-0042:en"] }));
    serve(page([group("case-0042", [missing({
      categories: [], matches_decision: false, retained: true, missing_final: { counts: false, reason: "work_open" },
      work: [work({ assignment_id: 9, document_id: "case-0042-en" })],
    })])]));
    await refetch();
    expect(await screen.findByText("Changed: Work assigned")).toBeTruthy();
    expect(screen.queryByText("Resolved")).toBeNull();
  });

  it("shows Changed: Task resumed for an external resume and Resolved for a resume recorded on the report page", async () => {
    const held = missing({ categories: ["report-or-pause"], work: [work({ assignment_id: 7, document_id: "case-0042-en", held: true })] });
    const resumed = { ...held, categories: [], matches_decision: false, retained: true, work: [work({ assignment_id: 7, document_id: "case-0042-en" })] };
    serve(page([group("case-0042", [held])]));
    const { unmount } = renderPage({ query: { decision: "report-or-pause", panel: rowKey("case-0042", "en") } });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "report-or-pause", retain: ["case-0042:en"] }));
    serve(page([group("case-0042", [resumed])]));
    await refetch();
    expect(await screen.findByText("Changed: Task resumed")).toBeTruthy();
    unmount();

    // Back from the report page: the remount keeps the visit and sees the recorded resume.
    recordDecision("p", "case-0042:en");
    vi.mocked(api.listDocumentRows).mockClear();
    renderPage({ query: { decision: "report-or-pause", panel: rowKey("case-0042", "en") } });
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalled());
    expect(vi.mocked(api.listDocumentRows).mock.calls[0][1]).toEqual({ decision: "report-or-pause", retain: ["case-0042:en"] });
    await waitFor(() => expect(within(rowHeader("case-0042 en")).getByText("Resolved")).toBeTruthy());
  });

  it("Refresh starts a new visit: an assigned row stops being retained and loses its badge (#176)", async () => {
    serve(page([group("case-0042", [missing()])]));
    renderPage({ query: { segment: "assign" } });
    await waitFor(() => expect(lastRequest()).toEqual({ segment: "assign", retain: ["case-0042:en"] }));
    serve(page([group("case-0042", [missing({
      categories: [], matches_decision: false, retained: true, missing_final: { counts: false, reason: "work_open" },
      work: [work({ assignment_id: 9, document_id: "case-0042-en" })],
    })])]));
    await refetch();
    expect(await screen.findByText("Changed: Work assigned")).toBeTruthy();
    serve(page([]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(lastRequest()).toEqual({ segment: "assign" }));
    await waitFor(() => expect(screen.queryByText("Changed: Work assigned")).toBeNull());
    expect(sessionStorage.getItem(`ontotator:documents-visit:p:${JSON.stringify({ segment: "assign" })}`)).toBeNull();
  });

  it("keeps the visit (retained rows and badges) when paging under the same filters", async () => {
    serve(page([group("case-0042", [missing()])], { page_count: 2 }));
    const onNavigate = vi.fn();
    const view = renderPage({ query: { decision: "missing-final" }, onNavigate });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "missing-final", retain: ["case-0042:en"] }));
    view.rerender(<DocumentsPage projectKey="p" canManage query={{ decision: "missing-final", page: "2" }} onNavigate={onNavigate} />);
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "missing-final", page: 2, retain: ["case-0042:en"] }));
    expect(sessionStorage.getItem(`ontotator:documents-visit:p:${JSON.stringify({ decision: "missing-final" })}`)).not.toBeNull();
  });

  it("starts a new visit after a filter change and sends no retain without a decision filter", async () => {
    serve(page([group("case-0042", [missing()])]));
    const onNavigate = vi.fn();
    const view = renderPage({ query: { decision: "missing-final" }, onNavigate });
    await waitFor(() => expect(lastRequest()).toEqual({ decision: "missing-final", retain: ["case-0042:en"] }));
    view.rerender(<DocumentsPage projectKey="p" canManage query={{ decision: "all" }} onNavigate={onNavigate} />);
    await waitFor(() => expect(sessionStorage.getItem(`ontotator:documents-visit:p:${JSON.stringify({ decision: "missing-final" })}`)).toBeNull());
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

  it("Compare results… opens the row panel with the decision block (route parameter panel); Close returns focus to the row action", async () => {
    mockRows(page([group("case-0042", [chooseFinal()])]), { [rowKey("case-0042", "en")]: oneSubmission() });
    vi.mocked(api.finalPanel).mockResolvedValue(acceptPanel("case-0042", "en"));
    const { onNavigate } = renderStateful({});
    const action = await screen.findByRole("button", { name: "Compare results…, case-0042 en" });
    action.focus();
    fireEvent.click(action);
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", panel: "case-0042:en" }, { replace: true });
    const panel = await textCard("case-0042 en");
    expect(await within(panel).findByText("Accept Ana Weber’s annotation as the result?")).toBeTruthy();
    // The card is modal and takes focus; the row is the active row; the card opens on Finalization with the decision block.
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(rowHeader("case-0042 en").closest("tr")!.getAttribute("aria-current")).toBe("true");
    expect(within(panel).getByRole("button", { name: /^Finalization / }).getAttribute("aria-current")).toBe("step");
    expect(within(panel).getByRole("region", { name: "Final result" })).toBeTruthy();
    expect(within(panel).queryByRole("tablist")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "case-0042 en" })).toBeNull());
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p" }, { replace: true });
    await waitFor(() => expect(document.activeElement?.id).toBe("documents-row-case-0042-en-action"));
  });

  it("Change final… in a decided row's panel (Final stage) opens the decision block on the compare content", async () => {
    const decided = row({ case_id: "case-0050", language: "de", final: final({ case_id: "case-0050", language: "de", document_id: "case-0050-de", submission_id: "s-ana", revision: 3 }) });
    mockRows(page([group("case-0050", [decided])]));
    vi.mocked(api.finalPanel).mockResolvedValue(finalPanel({ submissions: [
      panelSubmission({ submission_id: "s-ana", document_id: "case-0050-de", author: ana, author_label: "ann-0003" }),
      panelSubmission({ submission_id: "s-tom", document_id: "case-0050-de", author: tom, author_label: "ann-0004" }),
    ] }));
    const select = vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "case-0050", language: "de", document_id: "case-0050-de", submission_id: "s-tom", revision: 4 });
    renderStateful({ panel: "case-0050:de", panel_stage: "final" });
    const panel = await textCard("case-0050 de");
    // A row without a lead step keeps its Action cell empty (the row panel offers the action).
    expect(screen.queryByRole("button", { name: /more action/ })).toBeNull();
    expect(within(panel).queryByRole("region", { name: "Final result" })).toBeNull();
    fireEvent.click(await within(panel).findByRole("button", { name: "Change final…" }));
    const table = await within(panel).findByRole("table", { name: "Submissions, case-0050 de" });
    const tomRow = within(table).getAllByRole("row").find(entry => entry.textContent?.includes("Tom Reis"))!;
    fireEvent.click(within(tomRow).getByRole("button", { name: "Use as final" }));
    await waitFor(() => expect(select).toHaveBeenCalledWith("p", expect.objectContaining({ submission_id: "s-tom", expected_revision: 3 })));
  });

  it("panel route parameter reopens the panel and editor links return to it", async () => {
    mockRows(page([group("case-0042", [chooseFinal()])]));
    vi.mocked(api.finalPanel).mockResolvedValue(acceptPanel("case-0042", "en"));
    const { onNavigate } = renderPage({ query: { segment: "decision", panel: "case-0042:en" } });
    const panel = await textCard("case-0042 en");
    expect(api.finalPanel).toHaveBeenCalledWith("p", "case-0042", "en");
    fireEvent.click(await within(panel).findByRole("link", { name: "Open submission" }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ name: "projectCase", caseId: "case-0042", documents: { segment: "decision", panel: "case-0042:en" } }));
  });

  it("Escape returns focus to the row action, or the row header when the row left", async () => {
    const first = chooseFinal();
    mockRows(page([group("case-0042", [first])]));
    vi.mocked(api.finalPanel).mockResolvedValue(acceptPanel("case-0042", "en"));
    vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "case-0042-s1", revision: 1 });
    renderStateful({});
    const action = await screen.findByRole("button", { name: "Compare results…, case-0042 en" });
    action.focus();
    fireEvent.click(action);
    await textCard("case-0042 en");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(action));

    // After the decision the row has no action any more: focus goes to its row header.
    fireEvent.click(action);
    const again = await textCard("case-0042 en");
    const done = { ...first, next_step: stepOf("done"), steps: [stepOf("done")], categories: [],
      final: final({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "case-0042-s1" }) };
    mockRows(page([group("case-0042", [done])]));
    fireEvent.click(await within(again).findByRole("button", { name: "Accept result" }));
    expect(await within(again).findByText("No more final results to decide.")).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement?.id).toBe(documentsRowId("case-0042", "en", "header")));
  });

  it("Review changes… opens the panel with Keep final on v1 for every cause shown", async () => {
    const s0 = scenarioS0();
    vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "synthetic-accepted", language: "de", document_id: "synthetic-accepted-de", submission_id: "sub-s0-r1", revision: 2 });
    const restored = item({ code: "PLAN_RESTORED", cause_id: "PLAN_RESTORED:synthetic-accepted:de:3", category: "confirm-final" });
    const de = { ...s0.group.rows[1], issues: [restored], next_step: stepOf("confirm_final"), steps: [stepOf("confirm_final")] };
    mockRows(page([group("synthetic-accepted", [s0.group.rows[0], de])]), s0.submissions);
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Review changes…, synthetic-accepted de" }));
    const panel = await textCard("synthetic-accepted de");
    expect(await within(panel).findByText("This language version returned to the plan. Confirm its earlier final result.")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Keep final on v1" }));
    await waitFor(() => expect(api.selectFinalResult).toHaveBeenCalledWith("p", expect.objectContaining({
      document_id: "synthetic-accepted-de", submission_id: "sub-s0-r1", acknowledged_cause_ids: ["PLAN_RESTORED:synthetic-accepted:de:3"],
    })));
  });

  it("Decide on report… navigates to the report with section=decide", async () => {
    mockRows(page([group("case-0390", [planRow("case-0390", "de", stepOf("decide_report", { report_id: "report-0390" }))])]));
    const { onNavigate } = renderPage({ query: { segment: "decision" } });
    fireEvent.click(await screen.findByRole("button", { name: "Decide on report…, case-0390 de" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectProblemReport", key: "p", reportId: "report-0390", section: "decide", documents: { segment: "decision" } });
  });

  it("Resume task… navigates with action=resume", async () => {
    const paused = planRow("case-0391", "de", stepOf("resume_task", { assignment_id: 7 }), {
      notes: [item({ code: "TASK_PAUSED_WITHOUT_REPORT", cause_id: "p1", report_id: "report-7", assignment_id: 7 })],
    });
    mockRows(page([group("case-0391", [paused])]));
    const { onNavigate } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Resume task…, case-0391 de" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectProblemReport", key: "p", reportId: "report-7", action: "resume" });
  });

  it("Resolve… shows the three options under the row", async () => {
    mockRows(page([group("case-1", [planRow("case-1", "de", stepOf("resolve_rejected", { document_id: "case-1-de" }))])]));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 de" }));
    const box = screen.getByRole("group", { name: "Resolve rejected translation, case-1 de" });
    expect(within(box).getByRole("button", { name: "Discard the de translation…" })).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Resolve rejected translation, case-1 de" })).toBeNull();
  });

  it("after a decision the panel moves to the next final decision and the row updates in place", async () => {
    const first = chooseFinal();
    const second = chooseFinal("case-0099", "de");
    mockRows(page([group("case-0042", [first]), group("case-0099", [second])]));
    vi.mocked(api.finalPanel).mockImplementation(async (_key, caseId, language) => acceptPanel(caseId, language));
    vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "case-0042-s1", revision: 1 });
    const changed = vi.fn();
    window.addEventListener(FINAL_SELECTION_CHANGED, changed);
    const { onNavigate } = renderStateful({ segment: "decision" });
    fireEvent.click(await screen.findByRole("button", { name: "Compare results…, case-0042 en" }));
    const panel = await textCard("case-0042 en");
    const done = { ...first, next_step: stepOf("done"), steps: [stepOf("done")], matches_decision: false, retained: true, categories: [],
      final: final({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "case-0042-s1" }) };
    mockRows(page([group("case-0042", [done]), group("case-0099", [second])]));
    fireEvent.click(await within(panel).findByRole("button", { name: "Accept result" }));
    expect(api.selectFinalResult).toHaveBeenCalledWith("p", { document_id: "case-0042-en", submission_id: "case-0042-s1", expected_revision: 0, acknowledged_cause_ids: [] });
    // The same frame (not remounted) shows the next row at once.
    await waitFor(() => expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe("case-0099 de"));
    expect(panel.getAttribute("aria-label")).toBe("case-0099 de");
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", segment: "decision", panel: "case-0099:de" }, { replace: true });
    expect(within(panel).getByText("Final result saved for case-0042 en.")).toBeTruthy();
    const block = within(panel).getByRole("region", { name: "Final result" });
    await waitFor(() => expect(block.querySelector("p[role='status']")!.textContent).toBe("Final result saved. Next: case-0099 de."));
    expect(changed).toHaveBeenCalled();
    window.removeEventListener(FINAL_SELECTION_CHANGED, changed);
    // Updated in place: the row stays (retained) without the action.
    await waitFor(() => expect(within(screen.getByRole("button", { name: "Text case-0042 en" }).closest("tr")!).queryByRole("button", { name: /Compare results…/ })).toBeNull());
  });

  it("Next decision closes the panel and runs that row's action without the panel in its links", async () => {
    const first = chooseFinal();
    const report = planRow("case-0390", "de", stepOf("decide_report", { report_id: "report-0390" }));
    mockRows(page([group("case-0042", [first]), group("case-0390", [report])]));
    vi.mocked(api.finalPanel).mockResolvedValue(acceptPanel("case-0042", "en"));
    vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "case-0042", language: "en", document_id: "case-0042-en", submission_id: "case-0042-s1", revision: 1 });
    const { onNavigate } = renderStateful({ segment: "decision" });
    fireEvent.click(await screen.findByRole("button", { name: "Compare results…, case-0042 en" }));
    const panel = await textCard("case-0042 en");
    mockRows(page([group("case-0042", [{ ...first, next_step: stepOf("done"), steps: [stepOf("done")], categories: [] }]), group("case-0390", [report])]));
    fireEvent.click(await within(panel).findByRole("button", { name: "Accept result" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "Next decision: case-0390 de (problem report)" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectProblemReport", key: "p", reportId: "report-0390", section: "decide", documents: { segment: "decision" } }, undefined);
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
    renderPage({ query: { panel: "case-0101:fr", panel_tab: "details" } });
    fireEvent.click(await screen.findByRole("button", { name: "Translation review, case-0101 fr" }));
    expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "fr", { review: false, expected_revision: 2, confirm: false });
    const message = await screen.findByText("fr of case-0101: Translation review off");
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
    const table = screen.getByRole("table", { name: "Documents" });
    const region = message.closest(".ui-toast-region")!;
    expect(table.closest(".data-table-scroll")?.nextElementSibling ?? table.nextElementSibling).toBe(region);
    expect(region.nextElementSibling?.getAttribute("aria-label")).toBe("Pages");
  });

  it("the card's segmented plan controls save each step at once through the row PATCH", async () => {
    const fr = { ...planRow("case-0101", "fr", stepOf("assign_annotation")), proposal_count: 12, annotation_mode: { mode: "proposals" as const, source: "project" as const, locked: false, override: null, proposal_count: 12 } };
    mockRows(page([group("case-0101", [fr], { plan_revision: 2 })]));
    vi.spyOn(api, "patchWorkPlan").mockResolvedValue({
      case_id: "case-0101", language: "fr", flags: { review: false, annotate: true, review_applicable: true, discarded: false, annotation_mode: "scratch" }, revision: 3,
      undo: { rows: [], revisions: { "case-0101": 3 } }, withdrawn: [], accepted_document_ids: [],
    } as PlanRowResult);
    renderPage({ query: { panel: "case-0101:fr", panel_stage: "annotation" } });
    const card = await textCard("case-0101 fr");
    expect(within(card).queryByRole("button", { name: "Change plan…" })).toBeNull();
    const mode = await within(card).findByRole("radiogroup", { name: "Annotation plan" });
    const choices = within(mode).getAllByRole("radio") as HTMLInputElement[];
    expect(choices.map(choice => choice.closest("label")!.textContent)).toEqual(["From proposals", "From scratch", "Off"]);
    expect(choices.map(choice => choice.checked)).toEqual([true, false, false]);
    expect(document.getElementById(mode.getAttribute("aria-describedby")!)!.textContent).toBe("Annotators start from the 12 tool proposals and confirm, reject or correct them.");
    fireEvent.click(within(mode).getByRole("radio", { name: "From scratch" }));
    await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledTimes(1));
    expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "fr", { review: true, annotate: true, annotation_mode: "scratch", expected_revision: 2, confirm: false });
    expect(await within(card).findByText("Saved")).toBeTruthy();
    expect(await screen.findByText("fr of case-0101: plan saved")).toBeTruthy();
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
  });

  it("a refused mode shows the reason inline in the card and keeps the saved mode", async () => {
    const fr = { ...planRow("case-0101", "fr", stepOf("assign_annotation")), proposal_count: 12, annotation_mode: { mode: "proposals" as const, source: "project" as const, locked: false, override: null, proposal_count: 12 } };
    mockRows(page([group("case-0101", [fr], { plan_revision: 2 })]));
    vi.spyOn(api, "patchWorkPlan").mockRejectedValue(new ApiError(409, "Locked", "ANNOTATION_MODE_LOCKED"));
    renderPage({ query: { panel: "case-0101:fr", panel_stage: "annotation" } });
    const card = await textCard("case-0101 fr");
    const mode = await within(card).findByRole("radiogroup", { name: "Annotation plan" });
    fireEvent.click(within(mode).getByRole("radio", { name: "From scratch" }));
    expect(await within(card).findByText("The annotation of this text has already started this way, so it cannot change.")).toBeTruthy();
    expect((within(mode).getByRole("radio", { name: "From proposals" }) as HTMLInputElement).checked).toBe(true);
  });

  it("a locked mode keeps every choice focusable with who started it; the change is not sent", async () => {
    const fr = { ...planRow("case-0101", "fr", stepOf("assign_annotation")), proposal_count: 12, annotation_mode: { mode: "proposals" as const, source: "project" as const, locked: true, override: null, proposal_count: 12 },
      work: [work({ assignment_id: 4, document_id: "case-0101-fr", task: "annotate", status: "in_progress", person: { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false } })] };
    mockRows(page([group("case-0101", [fr], { plan_revision: 2 })]));
    vi.spyOn(api, "patchWorkPlan");
    renderPage({ query: { panel: "case-0101:fr", panel_stage: "annotation" } });
    const card = await textCard("case-0101 fr");
    const mode = await within(card).findByRole("radiogroup", { name: "Annotation plan" });
    const lock = "Fixed: Tom Reis has started from proposals. Remove the unsubmitted assignment below to change it.";
    for (const choice of within(mode).getAllByRole("radio") as HTMLInputElement[]) {
      expect(choice.getAttribute("aria-disabled")).toBe("true");
      expect(choice.disabled).toBe(false);
      expect(document.getElementById(choice.getAttribute("aria-describedby")!)!.textContent).toBe(lock);
    }
    fireEvent.click(within(mode).getByRole("radio", { name: "From scratch" }));
    expect(api.patchWorkPlan).not.toHaveBeenCalled();
    expect((within(mode).getByRole("radio", { name: "From proposals" }) as HTMLInputElement).checked).toBe(true);
  });

  it("a mode fixed by submitted work says so instead of asking to remove unsubmitted work (#17.1)", async () => {
    const fr = { ...planRow("case-0101", "fr", stepOf("assign_annotation")), proposal_count: 12, annotation_mode: { mode: "proposals" as const, source: "project" as const, locked: true, override: null, proposal_count: 12 },
      work: [work({ assignment_id: 4, document_id: "case-0101-fr", task: "annotate", status: "submitted", person: { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false } })] };
    mockRows(page([group("case-0101", [fr], { plan_revision: 2 })]));
    renderPage({ query: { panel: "case-0101:fr", panel_stage: "annotation" } });
    const card = await textCard("case-0101 fr");
    const mode = await within(card).findByRole("radiogroup", { name: "Annotation plan" });
    expect(document.getElementById(mode.getAttribute("aria-describedby")!)!.textContent)
      .toBe("Fixed: Tom Reis has submitted work started from proposals. Changing the mode discards that work.");
  });

  it("Change mode… on a locked mode opens the warning that names the discarded work (#109)", async () => {
    const fr = { ...planRow("case-0101", "fr", stepOf("assign_annotation")), proposal_count: 12, annotation_mode: { mode: "proposals" as const, source: "locked" as const, locked: true, override: null, proposal_count: 12 },
      work: [work({ assignment_id: 4, document_id: "case-0101-fr", task: "annotate", status: "submitted", person: { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false } })] };
    mockRows(page([group("case-0101", [fr], { plan_revision: 2 })]));
    const tom = { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false };
    const previewCall = vi.spyOn(api, "previewModeChange").mockResolvedValue({ case_id: "case-0101", language: "fr", from_mode: "proposals", to_mode: "scratch", revision: 2,
      submissions: [{ submission_id: "sub-tom", document_id: "case-0101-fr", mode: "proposal_check", recorded_at: "2026-10-20T10:00:00Z", author: tom }],
      assignments: [{ assignment_id: 4, document_id: "case-0101-fr", task: "annotate", status: "submitted", person: tom }] });
    renderPage({ query: { panel: "case-0101:fr", panel_stage: "annotation" } });
    const card = await textCard("case-0101 fr");
    fireEvent.click(await within(card).findByRole("button", { name: "Change mode…" }));
    const warning = await screen.findByRole("dialog", { name: "Change annotation of case-0101 fr to from scratch?" });
    expect(await within(warning).findByText("Tom Reis: 1 submission is discarded.")).toBeTruthy();
    expect(previewCall).toHaveBeenCalledWith(expect.any(String), { case_id: "case-0101", language: "fr", mode: "scratch" });
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

  it("closing the upload dialog during an import shows no toast and reloads nothing (OQ2)", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ languages: ["en"], annotate_accepted_translations_only: false } as never);
    mockRows(scenarioS1().page);
    renderPage();
    await loaded();
    const upload = screen.getByRole("button", { name: "Upload texts…" });
    await waitFor(() => expect(upload.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(upload);
    const calls = vi.mocked(api.listDocumentRows).mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Close stub" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Upload texts" })).toBeNull());
    expect(document.querySelector(".ui-toast-message")).toBeNull();
    expect(vi.mocked(api.listDocumentRows).mock.calls.length).toBe(calls);
  });

  it("closes the upload dialog after an import, announces the result once (the toast) and reloads the rows", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ languages: ["en"], annotate_accepted_translations_only: false } as never);
    mockRows(scenarioS1().page);
    renderPage();
    await loaded();
    const upload = screen.getByRole("button", { name: "Upload texts…" });
    await waitFor(() => expect(upload.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(upload);
    const calls = vi.mocked(api.listDocumentRows).mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Finish import stub" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Upload texts" })).toBeNull());
    // One live region says it: the toast's, not the page's as well (#47 A-25).
    expect(live().textContent).toBe("");
    expect(document.querySelector(".ui-toast-message")?.textContent).toBe("Imported 9 documents and 0 proposals.");
    await waitFor(() => expect(vi.mocked(api.listDocumentRows).mock.calls.length).toBeGreaterThan(calls));
  });
});

describe("lead review fixes", () => {
  const planResult = (caseId: string, language: string, flags: { review: boolean; annotate: boolean }, revision: number) => ({
    case_id: caseId, language, flags: { ...flags, review_applicable: true, discarded: false }, revision,
    undo: { rows: [{ case_id: caseId, language, review: true, annotate: true, restored_revision: null }], revisions: { [caseId]: revision } },
    withdrawn: [], accepted_document_ids: [],
  } as PlanRowResult);

  it("lists every text flat, also above 50 matching cases (VD5)", async () => {
    const plain = (caseId: string) => group(caseId, [planRow(caseId, "de", stepOf("assign_annotation"))]);
    const many = Array.from({ length: 50 }, (_, index) => plain(`case-${String(index).padStart(3, "0")}`));
    mockRows(page([group("case-d", [planRow("case-d", "de", stepOf("decide_report"))]), ...many], { group_count: 51 }));
    renderPage();
    await loaded();
    expect(screen.getByRole("button", { name: "Text case-000 de" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Text case-d de" }).closest("tr")!.className).toContain("data-table-row--decision");
    expect(document.querySelector("th[scope='rowgroup']")).toBeNull();
  });

  it("hides texts not in plan behind the remembered switch; on they are muted rows with Add to plan… (VD1, F5)", async () => {
    window.localStorage.clear();
    const planned = planRow("case-2", "de", stepOf("assign_annotation"));
    const view = page([group("case-1", [notInPlanRow("case-1", "en", { is_source: true }), notInPlanRow("case-1", "fr")]), group("case-2", [planned])]);
    mockRows({ ...view, bar: { ...view.bar, shown: 3, all: 3, facets: { plan: { not_in_plan: 3, not_decided: 1, annotate: 1 } } } });
    renderPage();
    const toggle = await screen.findByRole("checkbox", { name: "Show texts not in plan (2)" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: "Text case-1 fr" })).toBeNull();
    // The tab says 3, the table holds 1 (#198).
    expect(within(filterTools()).getByText("1 of 3")).toBeTruthy();
    fireEvent.click(toggle);
    expect(within(filterTools()).queryByText(/ of 3$/)).toBeNull();
    const fr = screen.getByRole("button", { name: "Text case-1 fr" }).closest("tr")!;
    expect(fr.className).toContain("documents-row--not-in-plan");
    expect(within(fr).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Text case-1 fr", "Add to plan…, case-1 fr"]);
    expect(window.localStorage.getItem("ontotator.documents.showNotInPlan.v1:lead")).toBe("1");
    fireEvent.click(within(fr).getByRole("button", { name: "Add to plan…, case-1 fr" }));
    expect(await screen.findByRole("dialog", { name: "Plan for case-1 fr" })).toBeTruthy();
    cleanup();
    // Remembered; the tabs never list texts outside the plan and have no switch.
    mockRows(view);
    renderPage();
    expect(((await screen.findByRole("checkbox", { name: /^Show texts not in plan/ })) as HTMLInputElement).checked).toBe(true);
    cleanup();
    mockRows(view);
    renderPage({ query: { segment: "assign" } });
    await loaded();
    expect(screen.queryByRole("checkbox", { name: /^Show texts not in plan/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Text case-1 fr" })).toBeNull();
    window.localStorage.clear();
  });

  it("Assign review or accept… saves through the panel and later chip saves use the returned revision", async () => {
    const de = planRow("case-1", "de", stepOf("translation_not_accepted", { document_id: "case-1-de" }), { plan_row: { review: false, annotate: true, review_applicable: true, discarded: false } });
    mockRows(page([group("case-1", [de], { plan_revision: 2 })]));
    vi.spyOn(api, "patchWorkPlan").mockResolvedValueOnce(planResult("case-1", "de", { review: true, annotate: true }, 5)).mockImplementation(() => new Promise(() => {}));
    // Open, so the expansion's plan chips are in view for the later save.
    renderPage({ query: { panel: "case-1:de", panel_tab: "details" } });
    fireEvent.click(await screen.findByRole("button", { name: "Assign review or accept…, case-1 de" }));
    const box = screen.getByRole("group", { name: "Translation not accepted, case-1 de" });
    fireEvent.click(within(box).getByRole("button", { name: "Turn translation review on" }));
    expect(live().textContent).toBe("Saving…");
    expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-1", "de", { review: true, expected_revision: 2, confirm: false });
    await waitFor(() => expect(live().textContent).toBe("Translation review on for case-1 de. Next: Assign review…"));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Translation not accepted, case-1 de" })).toBeNull());
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Annotate, case-1 de" }));
    expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-1", "de", { annotate: false, expected_revision: 5, confirm: false });
  });

  it("a plan changed elsewhere in Assign review or accept… notes the revision, reloads and says so", async () => {
    const de = planRow("case-1", "de", stepOf("translation_not_accepted", { document_id: "case-1-de" }), { plan_row: { review: false, annotate: true, review_applicable: true, discarded: false } });
    mockRows(page([group("case-1", [de], { plan_revision: 2 })]));
    vi.spyOn(api, "patchWorkPlan").mockRejectedValueOnce(new ApiError(409, "changed", "WORK_PLAN_CHANGED", { cases: [{ case_id: "case-1", revision: 8 }] }))
      .mockImplementation(() => new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Assign review or accept…, case-1 de" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn translation review on" }));
    expect(await screen.findByText("This plan changed. Reloaded the current plan.")).toBeTruthy();
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Turn translation review on" }));
    expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-1", "de", { review: true, expected_revision: 8, confirm: false });
  });

  it("keeps focus on the plan chip when a confirmed save takes the row out of the plan (the row folds)", async () => {
    const en = notInPlanRow("case-1", "en", { is_source: true });
    const de = planRow("case-1", "de", stepOf("assign_translation_review"), { plan_row: { review: true, annotate: false, review_applicable: true, discarded: false } });
    mockRows(page([group("case-1", [en, de], { plan_revision: 2 })]));
    const consequences = { withdrawn: [], finals_leaving: [], restored: [], open_reports: [{ case_id: "case-1", language: "de", held: false }] };
    vi.spyOn(api, "patchWorkPlan").mockRejectedValueOnce(new ApiError(409, "confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences))
      .mockResolvedValueOnce(planResult("case-1", "de", { review: false, annotate: false }, 3));
    renderPage({ query: { panel: "case-1:de", panel_tab: "details" } });
    fireEvent.click(await screen.findByRole("button", { name: "Translation review, case-1 de" }));
    const box = await screen.findByRole("group", { name: "Change the plan of case-1 de" });
    mockRows(page([group("case-1", [en, notInPlanRow("case-1", "de")], { plan_revision: 3 })]));
    fireEvent.click(within(box).getByRole("button", { name: "Save" }));
    // Out of the plan the row leaves the list (the switch is off); the card stays open on it.
    await waitFor(() => expect(screen.getByText("No texts in plan on this page.")).toBeTruthy());
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Translation review, case-1 de"));
  });
});

describe("Resolve renders inline under the row (Change 13, F1, F5)", () => {
  const rejected = () => planRow("case-1", "de", stepOf("resolve_rejected", { document_id: "case-1-de" }));
  const actionButton = () => document.getElementById(documentsRowId("case-1", "de", "action"));
  const resolveBox = () => screen.queryByRole("group", { name: "Resolve rejected translation, case-1 de" });
  const resolveHeading = () => within(resolveBox()!).getByRole("heading", { name: "Resolve rejected translation, case-1 de" });

  it("Resolve… renders inline under the row with the lead-correction option and focuses its heading", async () => {
    mockRows(page([group("case-1", [rejected()])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 de" }));
    const box = resolveBox()!;
    expect(box.closest(".documents-row-notice-slot")).not.toBeNull();
    expect(within(box).getByRole("button", { name: "Correct the translation…" })).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(resolveHeading()));
    expect(screen.getAllByRole("group", { name: "Resolve rejected translation, case-1 de" })).toHaveLength(1);
  });

  it("Cancel and Escape return focus to the row's Resolve… button", async () => {
    mockRows(page([group("case-1", [rejected()])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 de" }));
    await waitFor(() => expect(document.activeElement).toBe(resolveHeading()));
    fireEvent.click(within(resolveBox()!).getByRole("button", { name: "Cancel" }));
    expect(resolveBox()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(actionButton()));

    fireEvent.click(actionButton()!);
    await waitFor(() => expect(document.activeElement).toBe(resolveHeading()));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(resolveBox()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(actionButton()));
  });

  it("Assign review or accept… renders the same way", async () => {
    const reviewOff = planRow("case-1", "de", stepOf("translation_not_accepted", { document_id: "case-1-de", stage: "annotation" }), {
      plan_row: { review: false, annotate: true, review_applicable: true, discarded: false },
    });
    mockRows(page([group("case-1", [reviewOff])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Assign review or accept…, case-1 de" }));
    const box = await screen.findByRole("group", { name: "Translation not accepted, case-1 de" });
    expect(box.closest(".documents-row-notice-slot")).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole("heading", { name: "Translation not accepted, case-1 de" })));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Translation not accepted, case-1 de" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(actionButton()));
  });

  it("Correct the translation… opens the lead correction inline and never the case viewer (F1)", async () => {
    vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ document_id: "case-1-de", text_sha256: "sha-1" } as Awaited<ReturnType<typeof api.getVariantMetadata>>);
    vi.spyOn(api, "startLeadCorrection").mockResolvedValue({ id: 41 } as AssignmentView);
    mockRows(page([group("case-1", [rejectedRow("case-1", "de")])]));
    const { onNavigate } = renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 de" }));
    fireEvent.click(within(resolveBox()!).getByRole("button", { name: "Correct the translation…" }));
    const panel = screen.getByRole("group", { name: "Correct the translation, case-1 de" });
    expect(panel.closest(".documents-row-notice-slot")).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole("heading", { name: "Correct the translation, case-1 de" })));
    fireEvent.click(within(panel).getByRole("button", { name: "Open translation review" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 }, undefined));
    expect(api.startLeadCorrection).toHaveBeenCalledWith("p", "case-1-de", { expected_text_sha256: "sha-1", confirm_language: false });
    expect(onNavigate.mock.calls.some(([route]) => (route as Route).name === "projectCase")).toBe(false);

    // The expansion no longer offers its own correction entry.
    cleanup();
    mockRows(page([group("case-1", [rejectedRow("case-1", "de")])]));
    renderStateful({ panel: rowKey("case-1", "de") });
    await textCard("case-1 de");
    expect(screen.queryByRole("button", { name: /Correct the translation/ })).toBeNull();
  });

  it("cards behave the same", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 699px)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    mockRows(page([group("case-1", [rejected()])]));
    renderStateful({});
    await screen.findByRole("list", { name: "Documents" });
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 de" }));
    await waitFor(() => expect(document.activeElement).toBe(resolveHeading()));
    fireEvent.click(within(resolveBox()!).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(actionButton()));
  });
});

describe("visit baseline and navigation counter (VD6, V3)", () => {
  it("records the visit once on mount, not on tab or filter change", async () => {
    mockRows(scenarioS1().page);
    renderStateful({});
    await loaded();
    expect(api.recordDocumentsVisit).toHaveBeenCalledOnce();
    expect(api.recordDocumentsVisit).toHaveBeenCalledWith("p");
    fireEvent.click(screen.getByRole("tab", { name: /^To assign/ }));
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", { segment: "assign" }));
    fireEvent.change(searchField(), { target: { value: "case" } });
    fireEvent.keyDown(searchField(), { key: "Enter" });
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", { segment: "assign", q: "case" }));
    act(() => { window.dispatchEvent(new Event("focus")); });
    await loaded();
    expect(api.recordDocumentsVisit).toHaveBeenCalledOnce();
  });

  it("requests the first rows only after the visit was recorded (or failed)", async () => {
    let finish!: () => void;
    vi.mocked(api.recordDocumentsVisit).mockReturnValue(new Promise(resolve => { finish = () => resolve({ baseline_at: "2026-10-21T08:00:00Z" }); }));
    mockRows(scenarioS1().page);
    renderPage();
    await act(async () => { await Promise.resolve(); });
    expect(api.listDocumentRows).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await loaded();
    expect(api.listDocumentRows).toHaveBeenCalledOnce();
  });

  it("fires documents-changed after an own action", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ languages: ["en"], annotate_accepted_translations_only: false } as never);
    mockRows(scenarioS1().page);
    const changed = vi.fn();
    window.addEventListener(DOCUMENTS_CHANGED, changed);
    try {
      renderPage();
      await loaded();
      // Loading and refetching alone fire nothing.
      act(() => { window.dispatchEvent(new Event("focus")); });
      await loaded();
      expect(changed).not.toHaveBeenCalled();
      const upload = screen.getByRole("button", { name: "Upload texts…" });
      await waitFor(() => expect(upload.getAttribute("aria-disabled")).toBeNull());
      fireEvent.click(upload);
      fireEvent.click(await screen.findByRole("button", { name: "Finish import stub" }));
      await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    } finally { window.removeEventListener(DOCUMENTS_CHANGED, changed); }
  });
});

describe("text card (U3)", () => {
  const proposalsRow = () => stagedRow("case-0200", "de", {
    stages: { review: cell("accepted", "done"), annotation: cell("partly_assigned", "todo", { assigned: 1, target: 2 }), final: cell("after_annotation", "waiting") },
    overrides: { proposal_count: 17, annotation_mode: { mode: "proposals", source: "project", locked: true, override: null, proposal_count: 17 } },
  });

  it("a row's card opens from the route and shows the translation segment for panel_stage=review", async () => {
    mockRows(page([group("case-0200", [proposalsRow()])]));
    renderStateful({ panel: "case-0200:de", panel_stage: "review" });
    const card = await textCard("case-0200 de");
    const path = within(card).getByRole("navigation", { name: "Text path" });
    expect(within(path).getByRole("button", { name: /^Translation / }).getAttribute("aria-current")).toBe("step");
    expect(within(card).getByRole("heading", { name: "Translation" })).toBeTruthy();
    // The path switches the segment through the route (panel_stage).
    fireEvent.click(within(path).getByRole("button", { name: /^Annotation / }));
    expect(await within(card).findByRole("button", { name: "Assign annotators…" })).toBeTruthy();
  });

  it("a row click selects; a double click opens the card and marks the row current (R-4)", async () => {
    mockRows(page([group("case-0200", [proposalsRow()])]));
    const { onNavigate } = renderStateful({});
    const box = await screen.findByRole("checkbox", { name: "Select case-0200 de" });
    const waiting = box.closest("tr")!.children[5] as HTMLElement;
    fireEvent.click(waiting);
    expect(box).toHaveProperty("checked", true);
    expect(screen.queryByRole("dialog", { name: "case-0200 de" })).toBeNull();
    fireEvent.click(waiting, { detail: 1 });
    fireEvent.click(waiting, { detail: 2 });
    fireEvent.doubleClick(waiting);
    expect(screen.getByRole("checkbox", { name: "Select case-0200 de" })).toHaveProperty("checked", true);
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", panel: "case-0200:de" }, { replace: true });
    await textCard("case-0200 de");
    expect(box.closest("tr")!.className).toContain("documents-row--active");
  });

  it("closing the card keeps the selection", async () => {
    mockRows(page([group("case-0200", [proposalsRow()])]));
    const { onNavigate } = renderStateful({});
    const box = await screen.findByRole("checkbox", { name: "Select case-0200 de" });
    fireEvent.click(box);
    expect(box).toHaveProperty("checked", true);
    fireEvent.keyDown(screen.getByRole("button", { name: "Text case-0200 de" }), { key: "Enter" });
    const card = await textCard("case-0200 de");
    fireEvent.click(within(card).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "case-0200 de" })).toBeNull());
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p" }, { replace: true });
    expect(screen.getByRole("checkbox", { name: "Select case-0200 de" })).toHaveProperty("checked", true);
  });

  it("Assign annotators… opens the assign dialog with the lead as a choice and the consolidator rule", async () => {
    mockRows(page([group("case-0200", [proposalsRow()])], { adjudicator_not_annotator: true }));
    renderStateful({ panel: "case-0200:de", panel_stage: "annotation" });
    const card = await textCard("case-0200 de");
    expect(within(card).queryByRole("button", { name: "Annotate from proposals myself" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Assign annotators…" }));
    expect(lastAssign()).toMatchObject({ mode: "row", task: "annotate", row: { case_id: "case-0200", language: "de" }, me: { username: "lead", name: "lead-0002" }, consolidatorRule: true });
  });

  it("the assign dialog opened from the card comes after the card, so it sits on top", async () => {
    mockRows(page([group("case-0200", [proposalsRow()])]));
    renderStateful({ panel: "case-0200:de", panel_stage: "annotation" });
    const card = await textCard("case-0200 de");
    fireEvent.click(within(card).getByRole("button", { name: "Assign annotators…" }));
    const assign = await screen.findByRole("dialog", { name: "Assign stub" });
    expect(card.compareDocumentPosition(assign) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("‹ › skip texts not in plan; with the switch on they are walked too", async () => {
    window.localStorage.clear();
    const en = notInPlanRow("case-0200", "en", { is_source: true });
    mockRows(page([group("case-0200", [en, stagedRow("case-0200", "de", {})]), group("case-0201", [stagedRow("case-0201", "de", {})])]));
    renderStateful({ panel: "case-0201:de" });
    fireEvent.click(within(await textCard("case-0201 de")).getByRole("button", { name: "Previous text" }));
    fireEvent.click(within(await textCard("case-0200 de")).getByRole("button", { name: "Previous text" }));
    await waitFor(() => expect(live().textContent).toBe("First row"));
    fireEvent.click(within(await textCard("case-0200 de")).getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /^Show texts not in plan/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Text case-0200 de" }), { key: "Enter" });
    fireEvent.click(within(await textCard("case-0200 de")).getByRole("button", { name: "Previous text" }));
    await textCard("case-0200 en");
    window.localStorage.clear();
  });

  it("the card lists the case's other languages; a click switches the card, texts not in plan offer Add to plan…", async () => {
    const en = notInPlanRow("case-0200", "en", { is_source: true });
    mockRows(page([group("case-0200", [en, stagedRow("case-0200", "de", {}), stagedRow("case-0200", "fr", {})])]));
    renderStateful({ panel: "case-0200:de" });
    const card = await textCard("case-0200 de");
    const list = within(card).getByRole("list", { name: "Other languages" });
    expect(within(list).getAllByRole("listitem").map(item => item.textContent)).toEqual(["ensourcenot in planAdd to plan…", "fr"]);
    // The open row is current; its planned sibling in the table is tinted.
    expect(screen.getByRole("button", { name: "Text case-0200 fr", hidden: true }).closest("tr")!.className).toContain("documents-row--sibling");
    fireEvent.click(within(list).getByRole("button", { name: "Add to plan…, case-0200 en" }));
    expect(await screen.findByRole("dialog", { name: "Plan for case-0200 en" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Plan for case-0200 en" })).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(list).getByRole("button", { name: "Show case-0200 fr" }));
    await textCard("case-0200 fr");
  });

  it("‹ › announce the text the card shows now", async () => {
    mockRows(page([group("case-0200", [proposalsRow()]), group("case-0201", [stagedRow("case-0201", "de", {})])]));
    renderStateful({ panel: "case-0200:de" });
    const card = await textCard("case-0200 de");
    fireEvent.click(within(card).getByRole("button", { name: "Next text" }));
    await textCard("case-0201 de");
    await waitFor(() => expect(live().textContent).toBe("Showing case-0201 de"));
  });
});
