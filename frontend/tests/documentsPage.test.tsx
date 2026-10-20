import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView, type DocumentRowView, type DocumentRowsPage, type PlanRowResult, type RowSubmissions } from "../src/api/client";
import type { AssignWorkDialogProps } from "../src/admin/AssignWorkDialog";
import { DocumentsPage, type DocumentsPageProps } from "../src/admin/DocumentsPage";
import type { ProjectDocumentsQuery, Route } from "../src/app/router";
import { documentsRowId } from "../src/documents/RowCells";
import { stageBlockHeadingId } from "../src/documents/StageBlocks";
import { recordDecision } from "../src/documents/visitState";
import { useRegisteredShortcuts } from "../src/ui/shortcuts";
import { final, group, item, notInPlanRow, page, planRow, rejectedRow, row, rowKey, scenarioS0, scenarioS1, scenarioS3, scenarioS4, scenarioS5, stepOf, submission, submissions, version, work } from "./documents/fixtures";

const { expandedProps, assignProps } = vi.hoisted(() => ({ expandedProps: [] as Record<string, unknown>[], assignProps: [] as unknown[] }));
// The assign dialog has its own tests; here only its wiring (props in, onAssigned / onClose out) matters.
vi.mock("../src/admin/AssignWorkDialog", () => ({
  AssignWorkDialog: (props: AssignWorkDialogProps) => { assignProps.push(props); return <div role="dialog" aria-label="Assign stub" />; },
}));
const lastAssign = () => assignProps.at(-1) as AssignWorkDialogProps;
// The upload stub reports a finished import with its result message.
vi.mock("../src/admin/UploadPanel", () => ({
  UploadPanel: ({ onImported }: { onImported: (message: string) => void }) =>
    <button type="button" onClick={() => onImported("Imported 9 documents and 0 proposals.")}>Finish import stub</button>,
}));
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

/** `count` cases "case-0101"… with one de row each (next step Assign translation review). */
const casesPage = (count: number, overrides: Partial<DocumentRowsPage> = {}) => page(Array.from({ length: count }, (_, index) => {
  const caseId = `case-${String(101 + index).padStart(4, "0")}`;
  return group(caseId, [planRow(caseId, "de", stepOf("assign_translation_review"))]);
}), overrides);
const caseBox = (caseId: string) => screen.getByRole("checkbox", { name: new RegExp(`^Select ${caseId} \\(`) });
const selectionRegion = () => screen.getByRole("region", { name: "Selection" });

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
  vi.spyOn(api, "selectionSummary").mockResolvedValue({ cases: 0, steps: [], skipped: {}, common: null, not_shown: 0 });
  assignProps.length = 0;
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
  expect(Array.from(step.querySelectorAll("optgroup")).map(entry => entry.label)).toEqual(["Problem reports and paused tasks", "Translation review", "Annotation", "Final result", "Done"]);
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
  expect(Array.from((within(more).getByLabelText("Final result") as HTMLSelectElement).options).map(option => option.textContent)).toEqual(["Any", "None", "Has a final result"]);
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
  // Only case checkboxes and the header checkbox select; no per-row bulk checkboxes, no old "Assign …".
  expect(screen.getAllByRole("checkbox").every(box => box.getAttribute("aria-label")?.startsWith("Select ") || box.id === "documents-select-all")).toBe(true);
  expect(screen.queryByRole("button", { name: "Assign …" })).toBeNull();
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
    vi.spyOn(api, "listDocumentCaseIds").mockResolvedValueOnce({ case_ids: ["case-0101"], total: 1, truncated: false });
    renderPage({ query: { ...linked, decision: "translation" } });
    await loaded();
    const expected = { q: "case-01", decision: "translation", step: ["resolve_rejected", "resolve_queried"], stage: "translation_review", plan: ["review", "review_and_annotate"], paused: "no" };
    fireEvent.click(caseBox("case-0102"));
    await waitFor(() => expect(api.selectionSummary).toHaveBeenLastCalledWith("p", ["case-0102"], expected));
    fireEvent.click(within(selectionRegion()).getByRole("button", { name: "Assign…" }));
    expect(lastAssign()).toMatchObject({ sort: "import", filters: expected });
    expect(Object.keys((lastAssign() as { filters?: object }).filters ?? {}).sort()).toEqual(Object.keys(expected).sort());
    act(() => { lastAssign().onClose(); });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all 3 filtered cases" }));
    await waitFor(() => expect(api.listDocumentCaseIds).toHaveBeenCalledWith("p", { ...expected, sort: "import" }));
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

  it("shows a readable filter label for multi-value filters", async () => {
    mockRows(casesPage(1));
    const onNavigate = vi.fn();
    renderPage({ query: { step: "resolve_rejected,resolve_queried", plan: "annotate,review_and_annotate", stage: "final,done", paused: "no", final: "any" }, onNavigate });
    await loaded();
    const filters = screen.getByRole("group", { name: "Document filters" });
    const step = within(filters).getByLabelText("Next step") as HTMLSelectElement;
    expect(step.selectedOptions[0].textContent).toBe("Resolve rejected translation or Resolve queried translation");
    const plan = within(filters).getByLabelText("Plan") as HTMLSelectElement;
    expect(plan.selectedOptions[0].textContent).toBe("Annotate or Review and annotate");
    expect((within(filters).getByLabelText("Final result") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Has a final result");
    expect(within(filters).getByText("Also filtered: Stage Final result or Done · Not paused")).toBeTruthy();
    // Picking one value replaces the list.
    fireEvent.change(plan, { target: { value: "annotate" } });
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", step: "resolve_rejected,resolve_queried", plan: "annotate", stage: "final,done", paused: "no", final: "any" });
    cleanup();
    mockRows(casesPage(1));
    renderPage({ query: { step: "assign_annotation", plan: "review" } });
    await loaded();
    expect((screen.getByLabelText("Next step") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Assign annotation");
    expect(screen.queryByText(/Also filtered/)).toBeNull();
  });
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
  mockRows(casesPage(2));
  renderPage();
  await loaded();
  fireEvent.click(caseBox("case-0101"), { shiftKey: true });
  await waitFor(() => expect(live().textContent).toBe("1 case selected"));
  // The same range again: the same message is cleared and set again.
  fireEvent.click(caseBox("case-0101"), { shiftKey: true });
  expect(live().textContent).toBe("");
  await waitFor(() => expect(live().textContent).toBe("1 case selected"));
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

describe("case selection", () => {
  it("case checkbox is named with the case and its language count", async () => {
    mockRows(page([group("case-0101", [planRow("case-0101", "en", stepOf("assign_annotation"), { is_source: true }), planRow("case-0101", "de", stepOf("assign_translation_review")), notInPlanRow("case-0101", "fr")])]));
    renderPage();
    await loaded();
    const box = screen.getByRole("checkbox", { name: "Select case-0101 (3 languages)" });
    expect(box.closest("th")?.getAttribute("scope")).toBe("rowgroup");
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
    fireEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(within(selectionRegion()).getByText("1 case selected")).toBeTruthy();
  });

  it("Shift-click selects a range and announces the count", async () => {
    mockRows(casesPage(25));
    renderPage();
    await loaded();
    fireEvent.click(caseBox("case-0101"));
    fireEvent.click(caseBox("case-0120"), { shiftKey: true });
    await waitFor(() => expect(live().textContent).toBe("20 cases selected"));
    expect(within(selectionRegion()).getByText("20 cases selected")).toBeTruthy();
    expect((caseBox("case-0110") as HTMLInputElement).checked).toBe(true);
    expect((caseBox("case-0121") as HTMLInputElement).checked).toBe(false);
    // Ctrl-click removes one case and keeps the anchor.
    fireEvent.click(caseBox("case-0110"), { ctrlKey: true });
    await waitFor(() => expect(live().textContent).toBe("19 cases selected"));
    fireEvent.click(caseBox("case-0122"), { shiftKey: true });
    await waitFor(() => expect(live().textContent).toBe("22 cases selected"));
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
    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });
    expect(document.activeElement).toBe(caseBox("case-0102"));
    expect((caseBox("case-0102") as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(live().textContent).toBe("2 cases selected"));
    fireEvent.keyDown(caseBox("case-0102"), { key: "ArrowUp", shiftKey: true });
    expect(document.activeElement).toBe(first);
    fireEvent.click(first);
    expect((first as HTMLInputElement).checked).toBe(false);
    expect(help.filter(row => row.group === "Selection").map(row => row.description)).toEqual(
      expect.arrayContaining(["Move to the next or previous case and select it", "Select or deselect the focused case"]));
  });

  it("Ctrl+Z and Meta+Z undo the last plan change while a case checkbox has focus", async () => {
    const fr = planRow("case-0101", "fr", stepOf("assign_translation_review"));
    mockRows(page([group("case-0101", [fr], { plan_revision: 2 })]));
    const saved = (revision: number) => ({
      case_id: "case-0101", language: "fr", flags: { review: false, annotate: true, review_applicable: true, discarded: false }, revision,
      undo: { rows: [{ case_id: "case-0101", language: "fr", review: true, annotate: true }], revisions: { "case-0101": revision } }, withdrawn: [], accepted_document_ids: [],
    } as PlanRowResult);
    vi.spyOn(api, "patchWorkPlan").mockResolvedValueOnce(saved(3)).mockResolvedValueOnce(saved(5));
    vi.spyOn(api, "setWorkPlanRows").mockResolvedValue({ changed_rows: 1, revisions: { "case-0101": 4 }, undo: { rows: [], revisions: {} }, withdrawn: [] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Review, case-0101 · fr" }));
    await screen.findByText("fr of case-0101: Review off");
    const box = caseBox("case-0101");
    box.focus();
    fireEvent.keyDown(box, { key: "z", ctrlKey: true });
    await waitFor(() => expect(api.setWorkPlanRows).toHaveBeenCalledTimes(1));
    expect(api.setWorkPlanRows).toHaveBeenLastCalledWith("p", expect.objectContaining({ undo: true }));
    await waitFor(() => expect(screen.queryByText("fr of case-0101: Review off")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: /^Review, case-0101 · fr/ }));
    await screen.findByText(/fr of case-0101: Review/);
    caseBox("case-0101").focus();
    fireEvent.keyDown(caseBox("case-0101"), { key: "z", metaKey: true });
    await waitFor(() => expect(api.setWorkPlanRows).toHaveBeenCalledTimes(2));
  });

  it("header checkbox selects all filtered cases across pages", async () => {
    mockRows(casesPage(3, { group_count: 50, page_count: 17 }));
    const all = Array.from({ length: 50 }, (_, index) => `case-${String(101 + index).padStart(4, "0")}`);
    vi.spyOn(api, "listDocumentCaseIds").mockResolvedValueOnce({ case_ids: all, total: 50, truncated: false });
    const view = renderPage({ query: { language: "de", segment: "assign", page: "2" } });
    await loaded();
    const header = screen.getByRole("checkbox", { name: "Select all 50 filtered cases" });
    expect(header.className).toContain("checkbox-target");
    fireEvent.click(header);
    await waitFor(() => expect(within(selectionRegion()).getByText("50 cases selected")).toBeTruthy());
    expect(api.listDocumentCaseIds).toHaveBeenCalledWith("p", { language: "de", segment: "assign" });
    expect((header as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(live().textContent).toBe("50 cases selected"));
    fireEvent.click(header);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selection" })).toBeNull());
    view.unmount();
    // More than 2000 match: the first 2000 are selected and the bar says so.
    mockRows(casesPage(3, { group_count: 2500, page_count: 50 }));
    const first = Array.from({ length: 2000 }, (_, index) => `c-${index}`);
    vi.mocked(api.listDocumentCaseIds).mockResolvedValueOnce({ case_ids: first, total: 2500, truncated: true });
    renderPage();
    await loaded();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select the first 2000 of 2500 filtered cases" }));
    await waitFor(() => expect(within(selectionRegion()).getByText("2000 cases selected")).toBeTruthy());
    expect(within(selectionRegion()).getByText("Selection is limited to 2000 cases. Selected the first 2000.")).toBeTruthy();
  });

  it("Select by case IDs… replaces the selection and the selection survives paging and filters", async () => {
    mockRows(casesPage(3, { page_count: 2 }));
    vi.spyOn(api, "lookupCaseIds").mockResolvedValue({ found: ["case-0102", "case-0999"], unknown: [] });
    renderStateful({});
    await loaded();
    fireEvent.click(caseBox("case-0101"));
    fireEvent.click(screen.getByRole("button", { name: "Select by case IDs…" }));
    const dialog = screen.getByRole("dialog", { name: "Select by case IDs" });
    fireEvent.change(within(dialog).getByLabelText("Paste case IDs"), { target: { value: "case-0102\ncase-0999" } });
    await within(dialog).findByText("2 found · 0 unknown");
    fireEvent.click(within(dialog).getByRole("button", { name: "Select 2" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Select by case IDs" })).toBeNull());
    expect(within(selectionRegion()).getByText("2 cases selected")).toBeTruthy();
    expect((caseBox("case-0101") as HTMLInputElement).checked).toBe(false);
    fireEvent.change(within(screen.getByRole("group", { name: "Document filters" })).getByLabelText("Plan"), { target: { value: "review" } });
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", { plan: "review" }));
    fireEvent.click(screen.getByRole("link", { name: "Next" }));
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", { plan: "review", page: 2 }));
    expect(within(selectionRegion()).getByText("2 cases selected")).toBeTruthy();
    await waitFor(() => expect(api.selectionSummary).toHaveBeenLastCalledWith("p", ["case-0102", "case-0999"], { plan: "review" }));
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
    fireEvent.click(within(selectionRegion()).getByRole("button", { name: "Assign…" }));
    act(() => { lastAssign().onClose(); });
    expect(screen.queryByRole("dialog", { name: "Assign stub" })).toBeNull();
    expect(within(selectionRegion()).getByText("1 case selected")).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Select the 6 skipped cases" }));
    expect(within(selectionRegion()).getByText("6 cases selected")).toBeTruthy();
    expect((caseBox("case-0103") as HTMLInputElement).checked).toBe(true);
    expect((caseBox("case-0101") as HTMLInputElement).checked).toBe(false);
  });

  it("row Assign actions open the row dialog", async () => {
    mockRows(page([group("case-1", [planRow("case-1", "de", stepOf("assign_translation_review")), planRow("case-1", "fr", stepOf("assign_annotation"))])]));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Assign translation review…, case-1 · de" }));
    expect(lastAssign()).toMatchObject({ mode: "row", projectKey: "p", task: "translation_review", row: { case_id: "case-1", language: "de" } });
    act(() => { lastAssign().onClose(); });
    fireEvent.click(screen.getByRole("button", { name: "Assign annotation…, case-1 · fr" }));
    const props = lastAssign();
    expect(props).toMatchObject({ mode: "row", task: "annotate", row: { case_id: "case-1", language: "fr" } });
    const calls = vi.mocked(api.listDocumentRows).mock.calls.length;
    act(() => { if (props.mode === "row") props.onAssigned("1 annotation assigned to Ana Weber"); });
    expect(screen.queryByRole("dialog", { name: "Assign stub" })).toBeNull();
    expect(await screen.findByText("1 annotation assigned to Ana Weber", { selector: ".ui-toast-message" })).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api.listDocumentRows).mock.calls.length).toBeGreaterThan(calls));
  });
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
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 700px)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
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

it("passes the case's plan revision and the row assign dialog to the expanded row", async () => {
  const s5 = scenarioS5();
  mockRows(page([{ ...s5.group, plan_revision: 7 }]), s5.submissions);
  renderPage({ query: { open: [rowKey("case-0377", "en")] } });
  await screen.findByRole("heading", { name: /^Submissions \(/ });
  expect(expandedProps.at(-1)?.planRevision).toBe(7);
  expect(typeof expandedProps.at(-1)?.onAssign).toBe("function");
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
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 700px)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
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

  it("Review changes… opens Keep for a PLAN_RESTORED row", async () => {
    const s0 = scenarioS0();
    vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "synthetic-accepted", language: "de", document_id: "synthetic-accepted-de", submission_id: "sub-s0-r1", revision: 2 });
    const restored = item({ code: "PLAN_RESTORED", cause_id: "PLAN_RESTORED:synthetic-accepted:de:3", category: "confirm-final" });
    const de = { ...s0.group.rows[1], issues: [restored], next_step: stepOf("confirm_final"), steps: [stepOf("confirm_final")] };
    mockRows(page([group("synthetic-accepted", [s0.group.rows[0], de])]), s0.submissions);
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Review changes…, synthetic-accepted · de" }));
    const keep = await screen.findByRole("group", { name: "Keep final result" });
    expect(within(keep).getByText("This language version returned to the plan. Confirm its earlier final result.")).toBeTruthy();
    fireEvent.click(within(keep).getByRole("checkbox", { name: "I reviewed these changes and keep this exact result" }));
    fireEvent.click(within(keep).getByRole("button", { name: "Keep as final" }));
    await waitFor(() => expect(api.selectFinalResult).toHaveBeenCalledWith("p", expect.objectContaining({
      acknowledged_cause_ids: ["PLAN_RESTORED:synthetic-accepted:de:3"],
    })));
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

  it("closes the upload dialog after an import, announces the result and reloads the rows", async () => {
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
    expect(live().textContent).toBe("Imported 9 documents and 0 proposals.");
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

  it("keeps a group expanded after its decision is resolved when more than 50 cases match", async () => {
    const plain = (caseId: string) => group(caseId, [planRow(caseId, "de", stepOf("assign_annotation"))]);
    const many = Array.from({ length: 50 }, (_, index) => plain(`case-${String(index).padStart(3, "0")}`));
    mockRows(page([group("case-d", [planRow("case-d", "de", stepOf("decide_report"))]), ...many]));
    renderPage();
    await loaded();
    const toggle = () => document.getElementById("documents-group-case-d-toggle")!;
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("documents-group-case-000-toggle")!.getAttribute("aria-expanded")).toBe("false");
    // The decision is resolved and the rows reload: the group keeps its expansion.
    mockRows(page([plain("case-d"), ...many]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("1 decision")).toBeNull());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("documents-group-case-000-toggle")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves More filters to the lead and opens it only when one of its filters becomes active", async () => {
    mockRows(scenarioS1().page);
    const onNavigate = vi.fn();
    const view = renderPage({ query: { sort: "activity" }, onNavigate });
    await loaded();
    const more = () => screen.getByText("More filters").closest("details") as HTMLDetailsElement;
    expect(more().open).toBe(true);
    const rerender = (query: ProjectDocumentsQuery) => view.rerender(<DocumentsPage projectKey="p" canManage currentUser={{ username: "lead", pseudonym: "lead-0002" }} query={query} onNavigate={onNavigate} />);
    act(() => { more().open = false; fireEvent(more(), new Event("toggle")); });
    rerender({ sort: "activity", language: "de" });
    expect(more().open).toBe(false);
    rerender({});
    expect(more().open).toBe(false);
    rerender({ status: "held" });
    expect(more().open).toBe(true);
    // Clearing its filter does not close it under the lead.
    rerender({});
    expect(more().open).toBe(true);
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p", {}));
  });

  it("shows the not-in-plan rows expanded under the Plan filter Not in plan", async () => {
    mockRows(page([group("case-1", [notInPlanRow("case-1", "en", { is_source: true }), notInPlanRow("case-1", "fr")])]));
    renderPage({ query: { plan: "not_in_plan" } });
    const hide = await screen.findByRole("button", { name: "Hide en, fr not in plan, case-1" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Show details, case-1 · fr" })).toBeTruthy();
    fireEvent.click(hide);
    expect(screen.getByRole("button", { name: "Show en, fr not in plan, case-1" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Show details, case-1 · fr" })).toBeNull();
  });

  it("Assign review or accept… saves through the panel and later chip saves use the returned revision", async () => {
    const de = planRow("case-1", "de", stepOf("translation_not_accepted", { document_id: "case-1-de" }), { plan_row: { review: false, annotate: true, review_applicable: true, discarded: false } });
    mockRows(page([group("case-1", [de], { plan_revision: 2 })]));
    vi.spyOn(api, "patchWorkPlan").mockResolvedValueOnce(planResult("case-1", "de", { review: true, annotate: true }, 5)).mockImplementation(() => new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Assign review or accept…, case-1 · de" }));
    const box = screen.getByRole("group", { name: "Translation not accepted, case-1 · de" });
    fireEvent.click(within(box).getByRole("button", { name: "Turn Review on" }));
    expect(live().textContent).toBe("Saving…");
    expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-1", "de", { review: true, expected_revision: 2, confirm: false });
    await waitFor(() => expect(live().textContent).toBe("Review on for case-1 · de. Next: Assign translation review."));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Translation not accepted, case-1 · de" })).toBeNull());
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Annotate, case-1 · de" }));
    expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-1", "de", { annotate: false, expected_revision: 5, confirm: false });
  });

  it("a plan changed elsewhere in Assign review or accept… notes the revision, reloads and says so", async () => {
    const de = planRow("case-1", "de", stepOf("translation_not_accepted", { document_id: "case-1-de" }), { plan_row: { review: false, annotate: true, review_applicable: true, discarded: false } });
    mockRows(page([group("case-1", [de], { plan_revision: 2 })]));
    vi.spyOn(api, "patchWorkPlan").mockRejectedValueOnce(new ApiError(409, "changed", "WORK_PLAN_CHANGED", { cases: [{ case_id: "case-1", revision: 8 }] }))
      .mockImplementation(() => new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Assign review or accept…, case-1 · de" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn Review on" }));
    expect(await screen.findByText("This plan changed. Reloaded the current plan.")).toBeTruthy();
    await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Turn Review on" }));
    expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-1", "de", { review: true, expected_revision: 8, confirm: false });
  });

  it("focuses the case's not-in-plan toggle when a confirmed save moved the row out of view", async () => {
    const en = notInPlanRow("case-1", "en", { is_source: true });
    const de = planRow("case-1", "de", stepOf("assign_translation_review"), { plan_row: { review: true, annotate: false, review_applicable: true, discarded: false } });
    mockRows(page([group("case-1", [en, de], { plan_revision: 2 })]));
    const consequences = { withdrawn: [], finals_leaving: [], restored: [], open_reports: [{ case_id: "case-1", language: "de", held: false }] };
    vi.spyOn(api, "patchWorkPlan").mockRejectedValueOnce(new ApiError(409, "confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences))
      .mockResolvedValueOnce(planResult("case-1", "de", { review: false, annotate: false }, 3));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Review, case-1 · de" }));
    const box = await screen.findByRole("group", { name: "Change the plan of case-1 · de" });
    mockRows(page([group("case-1", [en, notInPlanRow("case-1", "de")], { plan_revision: 3 })]));
    fireEvent.click(within(box).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.activeElement?.id).toBe("documents-group-case-1-not-in-plan"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Show en, de not in plan, case-1");
  });
});

describe("Resolve focuses the Translation review block", () => {
  const rejected = () => planRow("case-1", "de", stepOf("resolve_rejected", { document_id: "case-1-de" }));
  const translationHeading = () => document.getElementById(stageBlockHeadingId("case-1", "de", "translation_review"));
  const actionButton = () => document.getElementById(documentsRowId("case-1", "de", "action"));
  const resolveBox = () => screen.queryByRole("group", { name: "Resolve rejected translation, case-1 · de" });

  it("Resolve… expands the row and focuses the Translation review heading", async () => {
    mockRows(page([group("case-1", [rejected()])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 · de" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Show details, case-1 · de" }).getAttribute("aria-expanded")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(translationHeading()));
    expect(translationHeading()).not.toBeNull();
  });

  it("renders the options inside the Translation review block", async () => {
    mockRows(page([group("case-1", [rejected()])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 · de" }));
    await waitFor(() => expect(translationHeading()).not.toBeNull());
    const box = resolveBox()!;
    expect(within(box).getByRole("button", { name: "Correct the translation…" })).toBeTruthy();
    expect(translationHeading()!.closest(".stage-block")!.contains(box)).toBe(true);
    // Only one copy of the options (not also below the row).
    expect(screen.getAllByRole("group", { name: "Resolve rejected translation, case-1 · de" })).toHaveLength(1);
  });

  it("Cancel and Escape return focus to the row's Resolve… button", async () => {
    mockRows(page([group("case-1", [rejected()])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 · de" }));
    await waitFor(() => expect(document.activeElement).toBe(translationHeading()));
    fireEvent.click(within(resolveBox()!).getByRole("button", { name: "Cancel" }));
    expect(resolveBox()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(actionButton()));

    fireEvent.click(actionButton()!);
    await waitFor(() => expect(document.activeElement).toBe(translationHeading()));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(resolveBox()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(actionButton()));
  });

  it("falls back to options below the row when there is no Translation block", async () => {
    const reviewOff = planRow("case-1", "de", stepOf("translation_not_accepted", { document_id: "case-1-de", stage: "annotation" }), {
      plan_row: { review: false, annotate: true, review_applicable: true, discarded: false },
    });
    mockRows(page([group("case-1", [reviewOff])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Assign review or accept…, case-1 · de" }));
    const box = await screen.findByRole("group", { name: "Translation not accepted, case-1 · de" });
    expect(box.closest(".stage-block")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole("heading", { name: "Translation not accepted, case-1 · de" })));
    expect(translationHeading()).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Translation not accepted, case-1 · de" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(actionButton()));
  });

  it("no longer navigates to the case viewer for Correct the translation…", async () => {
    vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ document_id: "case-1-de", text_sha256: "sha-1" } as Awaited<ReturnType<typeof api.getVariantMetadata>>);
    vi.spyOn(api, "startLeadCorrection").mockResolvedValue({ id: 41 } as AssignmentView);
    mockRows(page([group("case-1", [rejectedRow("case-1", "de")])]));
    const { onNavigate } = renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 · de" }));
    await waitFor(() => expect(document.activeElement).toBe(translationHeading()));
    // The block's own entry is not repeated next to the Resolve options.
    expect(screen.queryByRole("button", { name: "Correct the translation yourself…" })).toBeNull();
    fireEvent.click(within(resolveBox()!).getByRole("button", { name: "Correct the translation…" }));
    const panel = screen.getByRole("group", { name: "Correct the translation, case-1 · de" });
    expect(translationHeading()!.closest(".stage-block")!.contains(panel)).toBe(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Open translation review" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 }, undefined));
    expect(api.startLeadCorrection).toHaveBeenCalledWith("p", "case-1-de", { expected_text_sha256: "sha-1", confirm_language: false });
    expect(onNavigate.mock.calls.some(([route]) => (route as Route).name === "projectCase")).toBe(false);

    // The expanded row alone offers the same panel from the Translation review block.
    cleanup();
    mockRows(page([group("case-1", [rejectedRow("case-1", "de")])]));
    renderStateful({});
    fireEvent.click(await screen.findByRole("button", { name: "Show details, case-1 · de" }));
    fireEvent.click(await screen.findByRole("button", { name: "Correct the translation yourself…" }));
    expect(screen.getByRole("group", { name: "Correct the translation, case-1 · de" })).toBeTruthy();
  });

  it("cards behave the same", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 700px)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    mockRows(page([group("case-1", [rejected()])]));
    renderStateful({});
    await screen.findByRole("list", { name: "Documents" });
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…, case-1 · de" }));
    await waitFor(() => expect(document.activeElement).toBe(translationHeading()));
    expect(translationHeading()!.closest(".stage-block")!.contains(resolveBox()!)).toBe(true);
    fireEvent.click(within(resolveBox()!).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(actionButton()));
  });
});
