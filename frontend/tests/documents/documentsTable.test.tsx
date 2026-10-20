import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentGroupView, DocumentRowsPage } from "../../src/api/client";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { caseHeaderText, DocumentsTable, initialExpandedGroups, type DocumentsTableProps } from "../../src/documents/DocumentsTable";
import { formatTime, fullTimestamp } from "../../src/documents/labels";
import { group, notInPlanRow, page, planRow, row, stepOf } from "./fixtures";

afterEach(cleanup);

/** Every group expanded unless the test says otherwise. */
function renderTable(view: DocumentRowsPage, overrides: Partial<DocumentsTableProps> = {}) {
  const props: DocumentsTableProps = {
    page: view,
    projectKey: "p",
    query: {},
    expandedGroups: new Set(view.groups.map(entry => entry.case_id)),
    onToggleGroup: vi.fn(),
    onToggleRow: vi.fn(),
    shownNotInPlan: new Set(),
    onToggleNotInPlan: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
  const result = render(<DocumentsTable {...props} />);
  return { ...result, props };
}

const rowOf = (name: string) => screen.getByRole("button", { name: `Show details, ${name}` }).closest("tr")!;
const cellsOf = (name: string) => Array.from(rowOf(name).children) as HTMLElement[];

/** case-0101: en source (not in plan), de to assign a review, fr choose final. */
function case0101(): DocumentGroupView {
  return group("case-0101", [
    notInPlanRow("case-0101", "en", { is_source: true }),
    planRow("case-0101", "de", stepOf("assign_translation_review", { badges: ["check_failed"], detail: { kind: "version", version: 1, origin: "machine_translation", translation_status: "automatic_check_failed", task_paused: false } }), { last_activity_at: "2026-10-19T08:15:00Z" }),
    planRow("case-0101", "fr", stepOf("choose_final", { detail: { kind: "annotations_submitted", submitted: 2, total: 2, task_paused: false } })),
  ], { not_in_plan_languages: ["en"] });
}

describe("structure", () => {
  it("renders six columns in order", () => {
    renderTable(page([case0101()]));
    expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Text · language", "Plan", "Next step", "Owner", "Action", "Last activity"]);
    expect(cellsOf("case-0101 · de")).toHaveLength(6);
    const disclosure = screen.getByRole("button", { name: "Show details, case-0101 · de" });
    const header = disclosure.closest("th")!;
    expect(header.getAttribute("scope")).toBe("row");
    expect(within(header).getByRole("link", { name: "Open case-0101 · de" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("Choose in Text versions")).toBeNull();
  });

  it("renders the case header with source plus translations and a decision badge", () => {
    const onToggleGroup = vi.fn();
    renderTable(page([case0101()]), { onToggleGroup });
    const toggle = screen.getByRole("button", { name: "case-0101 · en source + 2 translations" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const header = toggle.closest("th")!;
    expect(header.getAttribute("scope")).toBe("rowgroup");
    expect(within(header).getByText("1 decision")).toBeTruthy();
    expect(header.querySelector("time")).not.toBeNull();
    fireEvent.click(toggle);
    expect(onToggleGroup).toHaveBeenCalledWith("case-0101");
    expect(caseHeaderText(group("case-9", [row({ case_id: "case-9", language: "fr", is_source: true })]))).toBe("case-9 · fr source");
    expect(caseHeaderText(group("case-9", [row({ case_id: "case-9", language: "de" })], { language_count: 3 }))).toBe("case-9 · 3 languages");
  });

  it("collapses not-in-plan rows into one line with show", () => {
    const view = group("case-0101", [
      notInPlanRow("case-0101", "en", { is_source: true }),
      planRow("case-0101", "de", stepOf("assign_translation_review")),
      notInPlanRow("case-0101", "fr"),
      notInPlanRow("case-0101", "es"),
    ], { not_in_plan_languages: ["en", "fr", "es"] });
    const onToggleNotInPlan = vi.fn();
    const renderPlan = vi.fn(entry => <span>{`chips ${entry.language}`}</span>);
    const { unmount } = renderTable(page([view]), { onToggleNotInPlan, renderPlan });
    expect(screen.queryByRole("button", { name: "Show details, case-0101 · fr" })).toBeNull();
    const line = screen.getByText(/not in plan ·/).closest("th")!;
    expect(line.textContent).toBe("en, fr, es not in plan · show");
    const show = within(line).getByRole("button", { name: "Show en, fr, es not in plan, case-0101" });
    expect(show.textContent).toBe("show");
    expect(show.id).toBe("documents-group-case-0101-not-in-plan");
    expect(show.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(show);
    expect(onToggleNotInPlan).toHaveBeenCalledWith("case-0101");
    unmount();
    renderTable(page([view]), { shownNotInPlan: new Set(["case-0101"]), renderPlan });
    expect(screen.getByText(/not in plan ·/).closest("th")!.textContent).toBe("en, fr, es not in plan · hide");
    expect(screen.getByRole("button", { name: "Hide en, fr, es not in plan, case-0101" }).getAttribute("aria-expanded")).toBe("true");
    expect(within(rowOf("case-0101 · fr")).getByText("chips fr")).toBeTruthy();
    expect(cellsOf("case-0101 · fr")[2].textContent).toBe("Not in plan");
  });

  it("expands groups with a decision initially and collapses the others above 50 cases", () => {
    const plain = (caseId: string) => group(caseId, [planRow(caseId, "de", stepOf("assign_annotation"))]);
    const deciding = group("case-d", [planRow("case-d", "de", stepOf("decide_report"))]);
    expect([...initialExpandedGroups(page([plain("a"), deciding]))]).toEqual(["a", "case-d"]);
    expect([...initialExpandedGroups(page([plain("a"), deciding], { group_count: 51 }))]).toEqual(["case-d"]);
    // Not-in-plan rows never count as a decision.
    const hidden = group("case-h", [notInPlanRow("case-h", "de", { next_step: stepOf("choose_final") })]);
    expect([...initialExpandedGroups(page([hidden], { group_count: 51 }))]).toEqual([]);
  });

  it("toggles a row and marks the open row expanded with its region", () => {
    const onToggleRow = vi.fn();
    const renderExpanded = vi.fn(() => <section aria-label="Expanded">content</section>);
    renderTable(page([case0101()]), { query: { open: ["case-0101:de"] }, onToggleRow, renderExpanded });
    const disclosure = screen.getByRole("button", { name: "Show details, case-0101 · de" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(disclosure.getAttribute("aria-controls")!)!.textContent).toBe("content");
    fireEvent.click(disclosure);
    expect(onToggleRow).toHaveBeenCalledWith("case-0101:de");
  });

  it("renders the row notice below a collapsed row", () => {
    renderTable(page([case0101()]), { renderRowNotice: entry => (entry.language === "fr" ? <p>notice fr</p> : null) });
    const notice = screen.getByText("notice fr");
    expect(notice.closest("tr")!.previousElementSibling).toBe(rowOf("case-0101 · fr"));
  });
});

describe("cells", () => {
  it("names the row action with step and text", () => {
    const { props } = renderTable(page([case0101()]));
    const action = screen.getByRole("button", { name: "Assign translation review…, case-0101 · de" });
    expect(action.textContent).toBe("Assign translation review…");
    expect(action.id).toBe("documents-row-case-0101-de-action");
    fireEvent.click(action);
    expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-0101", language: "de" }), expect.objectContaining({ code: "assign_translation_review" }));
    expect(screen.getByRole("button", { name: "Choose final…, case-0101 · fr" })).toBeTruthy();
    expect(cellsOf("case-0101 · fr")[2].textContent).toBe("Choose final resultYour decision2 of 2 annotations submitted");
    expect(cellsOf("case-0101 · fr")[3].textContent).toBe("You");
    expect(cellsOf("case-0101 · fr")[3].querySelector("strong")).not.toBeNull();
  });

  it("shows badges Your decision, Check failed, Paused and +1 more step", () => {
    const steps = [stepOf("decide_report", { badges: ["your_decision", "paused"], detail: { kind: "report", excerpt: "Negation dropped", reporter: { pseudonym: "ann-0005", display_name: "Ben Roth", is_me: false }, task_paused: true } }), stepOf("choose_final")];
    const view = group("case-0102", [
      planRow("case-0102", "de", steps[0], { steps }),
      planRow("case-0102", "fr", stepOf("assign_translation_review", { badges: ["check_failed"] })),
      planRow("case-0102", "it", stepOf("annotation_in_progress", { stage: "annotation", owner: { kind: "people", person: null, count: 2 } })),
      planRow("case-0102", "nl", stepOf("translation_review_in_progress", { owner: { kind: "person", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false }, count: 1 } })),
    ]);
    const onToggleRow = vi.fn();
    renderTable(page([view]), { onToggleRow });
    const de = cellsOf("case-0102 · de")[2];
    expect(within(de).getByText("Your decision")).toBeTruthy();
    expect(within(de).getByText("Paused")).toBeTruthy();
    expect(within(de).getByText("“Negation dropped” · Ben Roth (ann-0005) · task paused")).toBeTruthy();
    fireEvent.click(within(de).getByRole("button", { name: "+1 more step, case-0102 · de" }));
    expect(onToggleRow).toHaveBeenCalledWith("case-0102:de");
    expect(within(cellsOf("case-0102 · fr")[2]).getByText("Check failed")).toBeTruthy();
    expect(cellsOf("case-0102 · it")[3].textContent).toBe("2 annotators");
    expect(cellsOf("case-0102 · it")[4].textContent).toBe("");
    expect(cellsOf("case-0102 · nl")[3].textContent).toBe("Ana Weber (ann-0004)");
    expect(rowOf("case-0102 · nl").textContent).not.toContain("username");
  });

  it("passes the Documents query with the Open link and offers Open my task", () => {
    const view = case0101();
    view.rows[1] = { ...view.rows[1], own_open_assignment_id: 41 };
    const query: ProjectDocumentsQuery = { language: "de", segment: "assign" };
    renderTable(page([view]), { query });
    const href = screen.getByRole("link", { name: "Open case-0101 · de" }).getAttribute("href")!;
    expect(href).toContain("documents_language=de");
    expect(href).toContain("documents_segment=assign");
    expect(screen.getByRole("link", { name: "Open my task" }).getAttribute("href")).toBe("#/tasks/41");
  });

  it("marks the source row and renders last activity as a time with a full title", () => {
    renderTable(page([case0101()]), { shownNotInPlan: new Set(["case-0101"]) });
    expect(within(cellsOf("case-0101 · en")[0]).getByText("source")).toBeTruthy();
    const time = cellsOf("case-0101 · de")[5].querySelector("time")!;
    expect(time.getAttribute("title")).toBe(fullTimestamp("2026-10-19T08:15:00Z"));
    expect(time.textContent).toBe(formatTime("2026-10-19T08:15:00Z"));
  });

  it("middle-truncates long IDs with the full value in title", () => {
    const longId = "case-2026-10-19-0211-imported-batch";
    renderTable(page([group(longId, [planRow(longId, "de", stepOf("assign_annotation"))])]));
    const header = screen.getByRole("button", { name: `${longId} · 1 language` });
    const short = header.querySelector("[title]")!;
    expect(short.getAttribute("title")).toBe(longId);
    expect(short.textContent).toContain("…");
  });

  it("shows the visit badge next to the row header, outside the row's names", () => {
    renderTable(page([case0101()]), { rowBadge: entry => (entry.language === "de" ? <span className="badge">Resolved</span> : null) });
    const disclosure = screen.getByRole("button", { name: "Show details, case-0101 · de" });
    expect(within(disclosure.closest("th")!).getByText("Resolved")).toBeTruthy();
    expect(disclosure.textContent).not.toContain("Resolved");
  });
});

describe("case selection", () => {
  it("puts the case checkbox first in each case header and passes the click mode", () => {
    const onSelect = vi.fn();
    renderTable(page([case0101(), group("case-0102", [planRow("case-0102", "de", stepOf("assign_annotation"))])]), {
      groupSelection: { selected: caseId => caseId === "case-0102", onSelect, checkboxLabel: caseId => `Select ${caseId}` },
    });
    const first = screen.getByRole("checkbox", { name: "Select case-0101" }) as HTMLInputElement;
    expect(first.closest("th")?.firstElementChild).toBe(first);
    expect(first.checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Select case-0102" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(first, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith("case-0101", "range");
    fireEvent.click(first, { metaKey: true });
    expect(onSelect).toHaveBeenLastCalledWith("case-0101", "toggle-keep-anchor");
    // Rows themselves have no bulk checkboxes.
    expect(within(rowOf("case-0101 · de")).queryByRole("checkbox")).toBeNull();
  });
});
