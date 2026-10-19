import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentGroupView, DocumentRowsPage } from "../../src/api/client";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { DocumentsTable, initialExpandedGroups, type DocumentsTableProps } from "../../src/documents/DocumentsTable";
import { formatTime, fullTimestamp, issueAriaLabel } from "../../src/documents/labels";
import { group, item, page, row, scenarioS0, scenarioS2, scenarioS3, scenarioS4, version, work } from "./fixtures";

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
    selected: new Set(),
    onToggleSelect: vi.fn(),
    ...overrides,
  };
  const result = render(<DocumentsTable {...props} />);
  return { ...result, props };
}

const rowOf = (name: string) => screen.getByRole("button", { name: `Show submissions, ${name}` }).closest("tr")!;
const cellsOf = (name: string) => Array.from(rowOf(name).children) as HTMLElement[];

describe("structure", () => {
  it("renders one tbody per text with a group header disclosure", () => {
    const s0 = scenarioS0();
    const s4 = scenarioS4();
    const { container } = renderTable(page([s0.group, s4.group]));
    expect(container.querySelectorAll("tbody")).toHaveLength(2);
    const header = screen.getByRole("button", { name: "synthetic-accepted, 2 languages, final 1 of 2" });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    const controls = header.getAttribute("aria-controls")!.split(" ");
    expect(controls).toHaveLength(2);
    for (const id of controls) expect(document.getElementById(id)?.tagName).toBe("TR");
    const headerCell = header.closest("th")!;
    expect(headerCell.getAttribute("scope")).toBe("rowgroup");
    expect(headerCell.textContent).toContain("1 issue");
    expect(headerCell.querySelector("time")).not.toBeNull();
    expect(headerCell.textContent).not.toContain("ann-");
  });

  it("shows issue and note counts in the group header and calls onToggleGroup", () => {
    const de = row({
      case_id: "case-1", language: "de",
      issues: [
        item({ code: "OPEN_PROBLEM_REPORT", cause_id: "r1", category: "report-or-pause" }),
        item({ code: "SELECTED_TEXT_CORRECTED", cause_id: "c1", category: "confirm-final" }),
      ],
      notes: [item({ code: "SOURCE_UPDATE_UNREVIEWED", cause_id: "s1" })],
      categories: ["report-or-pause", "confirm-final"],
    });
    const onToggleGroup = vi.fn();
    renderTable(page([group("case-1", [de])]), { expandedGroups: new Set(), onToggleGroup });
    const header = screen.getByRole("button", { name: "case-1, 1 language, final 0 of 1" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.hasAttribute("aria-controls")).toBe(false);
    expect(header.closest("th")!.textContent).toContain("2 issues");
    expect(header.closest("th")!.textContent).toContain("1 note");
    expect(screen.queryByRole("button", { name: /Show submissions/ })).toBeNull();
    fireEvent.click(header);
    expect(onToggleGroup).toHaveBeenCalledWith("case-1");
  });

  it("renders seven columns in order with the text and language as row header", () => {
    renderTable(scenarioS0().page);
    const headers = screen.getAllByRole("columnheader").map(cell => cell.textContent);
    expect(headers).toEqual(["Select", "Text · language", "Text version(s)", "Work", "Final result", "Issues", "Last activity"]);
    const disclosure = screen.getByRole("button", { name: "Show submissions, synthetic-accepted · de" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.querySelector("svg.icon")).not.toBeNull();
    const rowHeader = disclosure.closest("th")!;
    expect(rowHeader.getAttribute("scope")).toBe("row");
    expect(within(rowHeader).getByRole("link", { name: "Open synthetic-accepted · de" }).getAttribute("href")).toContain("variant=synthetic-accepted-de");
    expect(within(rowHeader).queryByRole("link", { name: /Open my task/ })).toBeNull();
    expect(cellsOf("synthetic-accepted · de")).toHaveLength(7);
  });

  it("offers Open my task when the lead has an open own task", () => {
    const s0 = scenarioS0();
    s0.group.rows[1] = { ...s0.group.rows[1], own_open_assignment_id: 41 };
    renderTable(page([s0.group]));
    expect(screen.getByRole("link", { name: "Open my task" }).getAttribute("href")).toBe("#/tasks/41");
  });

  it("passes the Documents query with the Open link", () => {
    const query: ProjectDocumentsQuery = { language: "de", decision: "all" };
    renderTable(scenarioS0().page, { query });
    const href = screen.getByRole("link", { name: "Open synthetic-accepted · de" }).getAttribute("href")!;
    expect(href).toContain("documents_language=de");
    expect(href).toContain("documents_decision=all");
  });

  it("toggles a row and marks the open row expanded with its region", () => {
    const onToggleRow = vi.fn();
    const renderExpanded = vi.fn(() => <section aria-label="Expanded">content</section>);
    renderTable(scenarioS0().page, { query: { open: ["synthetic-accepted:de"] }, onToggleRow, renderExpanded });
    const disclosure = screen.getByRole("button", { name: "Show submissions, synthetic-accepted · de" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(disclosure.getAttribute("aria-controls")!)!;
    expect(region.textContent).toBe("content");
    expect(renderExpanded).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Show submissions, synthetic-accepted · en" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(onToggleRow).toHaveBeenCalledWith("synthetic-accepted:de");
  });
});

describe("cells", () => {
  it("S3: version, final with version marker and confirm issues", () => {
    renderTable(scenarioS3().page);
    const [, , versions, workCell, finalCell, issues] = cellsOf("case-0211 · de");
    expect(versions.textContent).toBe("v3 · Correction of v2 · Ready for review");
    expect(workCell.textContent).toBe("Translation review open (v3)");
    expect(finalCell.textContent).toBe(`Annotation · Round 2 · ann-0004 · ${formatTime("2026-10-18T10:00:00Z")} · v1`);
    expect(finalCell.querySelector("svg.icon")).not.toBeNull();
    const label = issueAriaLabel({ "confirm-final": 2 }, {});
    const badge = within(issues).getByRole("img", { name: label });
    expect(badge.textContent).toBe("2");
    expect(badge.querySelector(".status-pill--warning")).not.toBeNull();
  });

  it("S4: parallel roots, choose in versions and the Open description", () => {
    renderTable(scenarioS4().page);
    const [select, , versions] = cellsOf("case-0305 · fr");
    expect(versions.textContent).toBe("2 independent translations: Provider A, Provider B");
    expect(within(select).queryByRole("checkbox")).toBeNull();
    expect(select.textContent).toBe("Choose in Text versions");
    const open = screen.getByRole("link", { name: "Open case-0305 · fr" });
    expect(document.getElementById(open.getAttribute("aria-describedby")!)?.textContent).toBe("Opens Provider B v1, the most recent translation");
    expect(open.getAttribute("href")).toContain("variant=case-0305-fr-b");
  });

  it("S0: work wording, no final shows None and the checkbox selects the bulk version", () => {
    const onToggleSelect = vi.fn();
    renderTable(scenarioS0().page, { onToggleSelect, selected: new Set(["synthetic-accepted-de-v2"]) });
    const [select, , , workCell, , issues] = cellsOf("synthetic-accepted · de");
    expect(workCell.textContent).toBe("ann-0004 annotating (Round 3); ann-0003 submitted");
    // ROUND_REVIEW_PENDING is not counted.
    expect(within(issues).getByRole("img").getAttribute("aria-label")).toBe(issueAriaLabel({ "confirm-final": 1 }, {}));
    const checkbox = within(select).getByRole("checkbox", { name: "Select synthetic-accepted · de" });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith("synthetic-accepted-de-v2", false);
    const [, , , , enFinal, enIssues] = cellsOf("synthetic-accepted · en");
    expect(enFinal.textContent).toBe("None");
    expect(enIssues.textContent).toBe("");
  });

  it("shows notes as neutral text inside the grouped accessible label", () => {
    const de = row({
      case_id: "case-1", language: "de",
      issues: [
        item({ code: "OPEN_PROBLEM_REPORT", cause_id: "r1", category: "report-or-pause" }),
        item({ code: "SELECTED_TEXT_CORRECTED", cause_id: "c1", category: "confirm-final" }),
      ],
      notes: [
        item({ code: "SOURCE_UPDATE_UNREVIEWED", cause_id: "s1" }),
        item({ code: "ROUND_REVIEW_PENDING", cause_id: "w1" }),
      ],
      categories: ["report-or-pause", "confirm-final"],
    });
    renderTable(page([group("case-1", [de])]));
    const issues = cellsOf("case-1 · de")[5];
    const label = issueAriaLabel({ "report-or-pause": 1, "confirm-final": 1 }, { "Source text changed": 1 });
    expect(label).toBe("2 issues: problem report or paused task 1; final result to confirm 1. 1 note: source text changed");
    const badge = within(issues).getByRole("img", { name: label });
    expect(badge.textContent).toBe("21 note");
  });

  it("shows a Paused badge in Work for an active hold", () => {
    const de = row({ case_id: "case-1", language: "de", work: [work({ assignment_id: 9, document_id: "case-1-de", author_label: "ann-0005", status: "in_progress", held: true, round_ordinal: 1 })] });
    renderTable(page([group("case-1", [de])]));
    const workCell = cellsOf("case-1 · de")[3];
    expect(workCell.textContent).toBe("ann-0005 annotating (Round 1)Paused");
  });

  it("renders last activity as a time with a full title", () => {
    renderTable(scenarioS3().page);
    const activity = cellsOf("case-0211 · de")[6];
    const time = activity.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe("2026-10-19T08:15:00Z");
    expect(time.getAttribute("title")).toBe(fullTimestamp("2026-10-19T08:15:00Z"));
    expect(time.textContent).toBe(formatTime("2026-10-19T08:15:00Z"));
  });

  it("shows the matched version in a collapsed row whose displayed version does not match", () => {
    const v1 = version({ document_id: "case-9-de", chain_id: "case-9-de", external_id: "case-9-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "automatic_check_failed", is_newest_in_chain: false });
    const v2 = version({ document_id: "case-9-de-v2", chain_id: "case-9-de", external_id: "case-9-de", chain_name: "DeepL", version: 2, origin: "correction", derived_from: "case-9-de", translation_status: "accepted", matches_filter: false });
    const de = row({ case_id: "case-9", language: "de", versions: [v1, v2] });
    const { unmount } = renderTable(page([group("case-9", [de])]));
    expect(cellsOf("case-9 · de")[2].textContent).toBe("v2 · Correction of v1 · AcceptedMatched: v1 · Check failed");
    unmount();
    renderTable(page([group("case-9", [de])]), { query: { open: ["case-9:de"] } });
    expect(cellsOf("case-9 · de")[2].textContent).toBe("v2 · Correction of v1 · Accepted");
  });

  it("middle-truncates long IDs with the full value in title", () => {
    const longId = "case-2026-10-19-0211-imported-batch";
    renderTable(page([group(longId, [row({ case_id: longId, language: "de" })])]));
    const header = screen.getByRole("button", { name: `${longId}, 1 language, final 0 of 1` });
    const short = header.querySelector("[title]")!;
    expect(short.getAttribute("title")).toBe(longId);
    expect(short.textContent).toContain("…");
    expect(short.textContent!.length).toBeLessThan(longId.length);
    expect(screen.getByRole("link", { name: `Open ${longId} · de` })).toBeTruthy();
  });
});

describe("initialExpandedGroups", () => {
  const plain = (caseId: string): DocumentGroupView => group(caseId, [row({ case_id: caseId, language: "en" })]);

  it("expands every group when the project has at most 50 texts", () => {
    const view = page([plain("a"), plain("b")]);
    expect([...initialExpandedGroups(view)]).toEqual(["a", "b"]);
  });

  it("keeps only groups with a bar-category issue expanded above 50 texts", () => {
    const s2 = scenarioS2();
    const view = page([plain("a"), s2.group], { group_count: 51 });
    expect([...initialExpandedGroups(view)]).toEqual(["case-0108"]);
  });
});

describe("row badge", () => {
  it("shows the visit badge next to the row header of a collapsed row, outside the row's names", () => {
    const s0 = scenarioS0();
    renderTable(s0.page, { rowBadge: entry => (entry.language === "de" ? <span className="badge">Resolved</span> : null) });
    const disclosure = screen.getByRole("button", { name: "Show submissions, synthetic-accepted · de" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    const header = disclosure.closest("th")!;
    expect(within(header).getByText("Resolved")).toBeTruthy();
    expect(disclosure.textContent).not.toContain("Resolved");
    expect(screen.getByRole("link", { name: "Open synthetic-accepted · de" })).toBeTruthy();
    expect(rowOf("synthetic-accepted · en").textContent).not.toContain("Resolved");
  });
});
