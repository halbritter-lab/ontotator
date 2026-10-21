import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentGroupView, DocumentRowsPage, DocumentRowView } from "../../src/api/client";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { caseHeaderText, DocumentsTable, type DocumentsTableProps, type TableSelection } from "../../src/documents/DocumentsTable";
import { formatTime, fullTimestamp } from "../../src/documents/labels";
import { group, notInPlanRow, page, planRow, row, stepOf } from "./fixtures";
import { ana, cell, scenario7a, stagedRow, tom } from "./tableFixtures";

afterEach(cleanup);

function selection(selected: readonly string[] = []): TableSelection {
  const keys = new Set(selected);
  return {
    keys,
    caseState: caseKeys => {
      const count = caseKeys.filter(key => keys.has(key)).length;
      return count === 0 ? "none" : count === caseKeys.length ? "all" : "some";
    },
    select: vi.fn(),
    selectCase: vi.fn(),
  };
}

function renderTable(view: DocumentRowsPage, overrides: Partial<DocumentsTableProps> = {}) {
  const props: DocumentsTableProps = {
    page: view,
    projectKey: "p",
    query: {},
    onOpenPanel: vi.fn(),
    onAction: vi.fn(),
    selection: selection(),
    ...overrides,
  };
  const result = render(<DocumentsTable {...props} />);
  return { ...result, props };
}

/** The text row header (`th scope="row"`) whose name starts with "{case} · {language}" (the group label is a rowheader too). */
const header = (name: string) => {
  const found = screen.getAllByRole("rowheader").filter(element => element.getAttribute("scope") === "row" && (element.textContent ?? "").startsWith(name));
  expect(found).toHaveLength(1);
  return found[0];
};
const rowOf = (name: string) => header(name).closest("tr")!;
const cellsOf = (name: string) => Array.from(rowOf(name).children) as HTMLElement[];

/** case-107: en source (not in plan, decided), de with one submission to accept (decision). */
function case107(de: DocumentRowView = scenario7a()): DocumentGroupView {
  const en = notInPlanRow("case-107", "en", {
    is_source: true,
    stages: { review: cell("source", "none"), annotation: cell("not_planned", "none"), final: cell("none", "none") },
  });
  return group("case-107", [en, { ...de, last_activity_at: "2026-10-19T08:15:00Z" }]);
}

describe("structure", () => {
  it("has 8 columns with hidden Select and Action headers", () => {
    renderTable(page([case107()]));
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map(cell => cell.textContent)).toEqual(["Select", "Text", "Review", "Annotation", "Final", "Waiting on", "Action", "Last activity"]);
    expect(headers[0].querySelector(".visually-hidden")?.textContent).toBe("Select");
    expect(headers[6].querySelector(".visually-hidden")?.textContent).toBe("Action");
    expect(cellsOf("case-107 · de")).toHaveLength(8);
  });

  it("group row is a label: case checkbox td, rowgroup th, no disclosure", () => {
    const { props } = renderTable(page([case107()]));
    const box = screen.getByRole("checkbox", { name: "Select case-107 (2 texts)" });
    expect(box.closest("td")).not.toBeNull();
    const groupRow = box.closest("tr")!;
    const label = groupRow.querySelector("th")!;
    expect(label.getAttribute("scope")).toBe("rowgroup");
    expect(label.getAttribute("colspan")).toBe("7");
    expect(label.textContent).toBe("case-107 · en source + 1 translation");
    expect(within(groupRow).queryByRole("button")).toBeNull();
    expect(groupRow.querySelector("time")).toBeNull();
    fireEvent.click(box, { shiftKey: true });
    expect(props.selection!.selectCase).toHaveBeenCalledWith(["case-107:en", "case-107:de"], "range", ["case-107:en", "case-107:de"]);
    expect(caseHeaderText(group("case-9", [row({ case_id: "case-9", language: "fr", is_source: true })]))).toBe("case-9 · fr source");
  });

  it("rows: th scope=row named 'case-107 · de', 20 px indent class", () => {
    const { props } = renderTable(page([case107()]));
    const th = header("case-107 · de");
    expect(th.tagName).toBe("TH");
    expect(th.getAttribute("scope")).toBe("row");
    // The accessible name starts with the text label.
    expect(screen.getAllByRole("rowheader", { name: /^case-107 · de\b/ })).toEqual([th]);
    expect(th.querySelector(".documents-text-cell")).not.toBeNull();
    expect(within(th).getByRole("link", { name: "Open in editor, case-107 · de" })).toBeTruthy();
    const box = within(rowOf("case-107 · de")).getByRole("checkbox", { name: "Select case-107 · de" });
    fireEvent.click(box);
    expect(props.selection!.select).toHaveBeenCalledWith("case-107:de", "toggle", ["case-107:en", "case-107:de"]);
    expect(within(header("case-107 · en")).getByText("source")).toBeTruthy();
  });

  it("group checkbox is mixed when one of two texts is selected", () => {
    renderTable(page([case107()]), { selection: selection(["case-107:de"]) });
    const box = screen.getByRole("checkbox", { name: "Select case-107 (2 texts)" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
    expect((within(rowOf("case-107 · de")).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    cleanup();
    renderTable(page([case107()]), { selection: selection(["case-107:de", "case-107:en"]) });
    const all = screen.getByRole("checkbox", { name: "Select case-107 (2 texts)" }) as HTMLInputElement;
    expect(all.indeterminate).toBe(false);
    expect(all.checked).toBe(true);
  });

  it("decision rows get the edge class and hidden text Needs your decision", () => {
    const undecided = notInPlanRow("case-101", "de", {
      next_step: stepOf("decide_plan"), steps: [stepOf("decide_plan")],
      plan_row: { review: false, annotate: false, review_applicable: true, discarded: false, decided: false },
    });
    renderTable(page([case107(), group("case-101", [undecided])]));
    expect(rowOf("case-107 · de").className).toContain("data-table-row--decision");
    expect(within(header("case-107 · de")).getByText("Needs your decision").className).toBe("visually-hidden");
    expect(rowOf("case-107 · en").className).not.toContain("data-table-row--decision");
    expect(within(header("case-107 · en")).queryByText("Needs your decision")).toBeNull();
    // Undecided rows are decisions too (V10).
    expect(rowOf("case-101 · de").className).toContain("data-table-row--decision");
  });

  it("NEW badge with accessible text New since your last visit", () => {
    const fresh = { ...scenario7a(), new: true } as DocumentRowView;
    renderTable(page([case107(fresh)]));
    const th = header("case-107 · de");
    expect(within(th).getByText("NEW").getAttribute("aria-hidden")).toBe("true");
    expect(within(th).getByText("New since your last visit").className).toBe("visually-hidden");
    expect(within(header("case-107 · en")).queryByText("NEW")).toBeNull();
  });

  it("not-in-plan rows are muted rows, never collapsed", () => {
    const view = group("case-101", [
      notInPlanRow("case-101", "en", { is_source: true }),
      planRow("case-101", "de", stepOf("assign_translation_review")),
      notInPlanRow("case-101", "fr"),
    ], { not_in_plan_languages: ["en", "fr"] });
    renderTable(page([view]));
    expect(screen.queryByText(/not in plan ·/)).toBeNull();
    expect(rowOf("case-101 · fr").className).toContain("documents-row--not-in-plan");
    expect(rowOf("case-101 · de").className).not.toContain("documents-row--not-in-plan");
    expect(cellsOf("case-101 · fr")[2].querySelector(".stage-cell--muted")).not.toBeNull();
    // Quiet "Plan…" on rows outside the plan (VD2) when the plan chips are wired.
    expect(within(rowOf("case-101 · fr")).queryByRole("button", { name: "Plan…, case-101 · fr" })).toBeNull();
  });

  it("Text and Last activity headers sort via onSort with aria-sort", () => {
    const onSort = vi.fn();
    const { unmount } = renderTable(page([case107()]), { sort: "case", onSort });
    const text = screen.getByRole("columnheader", { name: /Text/ });
    const activity = screen.getByRole("columnheader", { name: /Last activity/ });
    expect(text.getAttribute("aria-sort")).toBe("ascending");
    expect(activity.getAttribute("aria-sort")).toBe("none");
    expect(screen.getByRole("columnheader", { name: "Review" }).getAttribute("aria-sort")).toBeNull();
    fireEvent.click(within(text).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("-case");
    fireEvent.click(within(activity).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("activity");
    unmount();
    renderTable(page([case107()]), { sort: "activity", onSort });
    expect(screen.getByRole("columnheader", { name: /Last activity/ }).getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Last activity/ })).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("-activity");
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Text/ })).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("case");
  });

  it("Last activity shows only the time; no disclosure ▸ and no expansion", () => {
    renderTable(page([case107()]));
    const last = cellsOf("case-107 · de")[7];
    expect(last.querySelector("time")!.getAttribute("title")).toBe(fullTimestamp("2026-10-19T08:15:00Z"));
    expect(last.querySelector("time")!.textContent).toBe(formatTime("2026-10-19T08:15:00Z"));
    expect(last.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Show history/ })).toBeNull();
  });
});

describe("row panel entries (acceptance fixes WP-A)", () => {
  it("the text name is a button 'Details, case-107 · de' that opens the panel unfiltered", () => {
    const { props } = renderTable(page([case107()]));
    const name = within(header("case-107 · de")).getByRole("button", { name: "Details, case-107 · de" });
    expect(name.id).toBe("documents-row-case-107-de-header");
    fireEvent.click(name);
    expect(props.onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-107", language: "de" }), { opener: name });
    expect(within(header("case-107 · de")).getByRole("link", { name: "Open in editor, case-107 · de" }).textContent).toBe("Open");
  });

  it("a stage cell is a frameless button that opens the panel filtered to its stage; the detail line describes it", () => {
    const de = stagedRow("case-108", "de", { stages: { annotation: cell("in_progress", "running", { submitted: 0, total: 2, people: [ana, tom] }) } });
    const { props } = renderTable(page([group("case-108", [de])]));
    const stage = screen.getByRole("button", { name: "Annotation: 0 of 2 submitted. Show history, case-108 · de" });
    expect(cellsOf("case-108 · de")[3].contains(stage)).toBe(true);
    expect(stage.className).toBe("documents-stage-button");
    expect(stage.querySelector("svg")).toBeNull();
    expect(document.getElementById(stage.getAttribute("aria-describedby")!)!.textContent).toMatch(/^waiting: /);
    fireEvent.click(stage);
    expect(props.onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-108" }), { stage: "annotation", opener: stage });
    expect(screen.getByRole("button", { name: /^Review: .*\. Show history, case-108 · de$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Final: .*\. Show history, case-108 · de$/ })).toBeTruthy();
  });

  it("marks only the active row (aria-current, highlight class), never with opacity or inert", () => {
    const { container } = renderTable(page([case107()]), { activeKey: "case-107:de" });
    const active = rowOf("case-107 · de");
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(active.classList.contains("documents-row--active")).toBe(true);
    expect(rowOf("case-107 · en").getAttribute("aria-current")).toBeNull();
    expect(container.querySelector("[inert]")).toBeNull();
    expect(container.querySelector("[class*='dim'], [class*='opacity'], [style*='opacity']")).toBeNull();
  });
});

describe("cells", () => {
  it("renders the stage cells, Waiting on and one action", () => {
    const steps = [stepOf("annotation_in_progress", { owner: { kind: "people", person: null, count: 2, people: [ana, tom] } })];
    const progress = stagedRow("case-106", "de", {
      stages: {
        review: cell("accepted", "done", { note: "unchanged" }),
        annotation: cell("in_progress", "running", { people: [tom], submitted: 1, total: 2 }),
        final: cell("after_annotation", "waiting"),
      },
      steps,
    });
    const { props } = renderTable(page([case107(), group("case-106", [progress])]));
    const cells = cellsOf("case-106 · de");
    expect(cells[2].textContent).toBe("✓ Acceptedunchanged");
    expect(cells[2].querySelector(".stage-cell-symbol")!.getAttribute("aria-hidden")).toBe("true");
    expect(cells[3].textContent).toBe("◐ 1 of 2 submittedwaiting: Tom Reis");
    expect(cells[4].textContent).toBe("○ after annotation");
    expect(within(cells[5]).getByText("Ana Weber, Tom Reis").getAttribute("aria-hidden")).toBe("true");
    expect(cells[5].querySelector("[title]")!.getAttribute("title")).toBe("Ana Weber (ann-0003), Tom Reis (ann-0004)");
    expect(cells[6].textContent).toBe("");
    const de = cellsOf("case-107 · de");
    expect(de[4].textContent).toBe("● Your choice1 submission");
    expect(de[5].querySelector("strong")!.textContent).toBe("You");
    const action = within(de[6]).getByRole("button", { name: "Accept as final…, case-107 · de" });
    fireEvent.click(action);
    expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-107", language: "de" }), expect.objectContaining({ code: "choose_final" }));
    expect(cellsOf("case-107 · en")[2].textContent).toBe("— source");
  });

  it("names the source language in a source-changed Review cell and shows the version marker", () => {
    const de = stagedRow("case-115", "de", {
      stages: { review: cell("source_changed", "decision", { from_version: 1 }) },
      steps: [stepOf("assign_translation_review")],
      overrides: { version_marker: { kind: "corrected", version: 2 } },
    });
    const en = notInPlanRow("case-115", "en", { is_source: true });
    renderTable(page([group("case-115", [en, de])]));
    expect(cellsOf("case-115 · de")[2].textContent).toBe("⚠ Source changedtranslation from en v1");
    expect(within(header("case-115 · de")).getByText("v2 corrected").className).toBe("documents-version-marker");
  });

  it("passes the Documents query with the Open link and offers Open my task", () => {
    const view = case107();
    view.rows[1] = { ...view.rows[1], own_open_assignment_id: 41 };
    const query: ProjectDocumentsQuery = { language: "de", segment: "assign" };
    renderTable(page([view]), { query });
    const href = screen.getByRole("link", { name: "Open in editor, case-107 · de" }).getAttribute("href")!;
    expect(href).toContain("documents_language=de");
    expect(screen.getByRole("link", { name: "Open my task" }).getAttribute("href")).toBe("#/tasks/41");
  });

  it("middle-truncates long IDs in the group row with the full value in title", () => {
    const longId = "case-2026-10-19-0211-imported-batch";
    renderTable(page([group(longId, [planRow(longId, "de", stepOf("assign_annotation"))])]));
    const short = screen.getByRole("checkbox", { name: `Select ${longId} (1 text)` }).closest("tr")!.querySelector("th [title]")!;
    expect(short.getAttribute("title")).toBe(longId);
    expect(short.textContent).toContain("…");
  });

  it("shows the visit badge in the row header and the row notice below the row", () => {
    renderTable(page([case107()]), {
      rowBadge: entry => (entry.language === "de" ? <span className="badge">Resolved</span> : null),
      renderRowNotice: entry => (entry.language === "de" ? <p>notice de</p> : null),
    });
    expect(within(header("case-107 · de")).getByText("Resolved")).toBeTruthy();
    expect(screen.getByText("notice de").closest("tr")!.previousElementSibling).toBe(rowOf("case-107 · de"));
  });
});
