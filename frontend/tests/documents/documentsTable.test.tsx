import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentGroupView, DocumentRowsPage, DocumentRowView } from "../../src/api/client";
import { caseHeaderText, DocumentsTable, type DocumentsTableProps, type TableSelection } from "../../src/documents/DocumentsTable";
import { formatTime, fullTimestamp } from "../../src/documents/labels";
import { group, notInPlanRow, page, planRow, row, stepOf, work } from "./fixtures";
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
    onOpenPanel: vi.fn(),
    onAction: vi.fn(),
    selection: selection(),
    ...overrides,
  };
  const result = render(<DocumentsTable {...props} />);
  return { ...result, props };
}

/** The text row header (`th scope="row"`) whose text starts with "{case} · {language}" (the group label is a rowheader too). */
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

/** A row with the read model's proposal count (P5 contract field). */
const withProposals = (entry: DocumentRowView, count: number) => ({ ...entry, proposal_count: count }) as DocumentRowView;

describe("structure", () => {
  it("has the columns Text, Translation, Annotation, Finalization, Waiting on, Next step, Last activity", () => {
    renderTable(page([case107()]));
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map(cell => cell.textContent)).toEqual(["Select", "Text", "Translation", "Annotation", "Finalization", "Waiting on", "Next step", "Last activity"]);
    expect(headers[0].querySelector(".visually-hidden")?.textContent).toBe("Select");
    expect(headers[6].querySelector(".visually-hidden")).toBeNull();
    expect(cellsOf("case-107 · de")).toHaveLength(8);
  });

  it("a not-planned source is folded into the case line", () => {
    const { props } = renderTable(page([case107()]));
    const box = screen.getByRole("checkbox", { name: "Select case-107 (2 texts)" });
    const groupRow = box.closest("tr")!;
    const label = groupRow.querySelector("th")!;
    expect(label.getAttribute("scope")).toBe("rowgroup");
    expect(label.querySelector(".documents-id")!.textContent).toBe("case-107");
    expect(label.querySelector(".documents-group-meta")!.textContent).toBe("source en (native), 1 translation");
    expect(label.textContent).not.toContain("·");
    expect(screen.getAllByRole("rowheader").filter(element => element.getAttribute("scope") === "row")).toHaveLength(1);
    expect(screen.queryByRole("checkbox", { name: "Select case-107 · en" })).toBeNull();
    // The case checkbox covers the folded source too (shown rows first); the range order covers the shown rows only.
    fireEvent.click(box, { shiftKey: true });
    expect(props.selection!.selectCase).toHaveBeenCalledWith(["case-107:de", "case-107:en"], "range", ["case-107:de"]);
  });

  it("a folded source selected elsewhere (Select all filtered, Select by IDs) shows in the case checkbox", () => {
    renderTable(page([case107()]), { selection: selection(["case-107:en"]) });
    const box = screen.getByRole("checkbox", { name: "Select case-107 (2 texts)" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    cleanup();
    renderTable(page([case107()]), { selection: selection(["case-107:de", "case-107:en"]) });
    expect((screen.getByRole("checkbox", { name: "Select case-107 (2 texts)" }) as HTMLInputElement).checked).toBe(true);
  });

  it("the case line opens the folded source's card", () => {
    const { props } = renderTable(page([case107()]));
    const button = screen.getByRole("button", { name: "source en (native), 1 translation" });
    expect(button.className).toBe("documents-group-meta");
    fireEvent.click(button);
    expect(props.onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-107", language: "en" }), { opener: button });
    cleanup();
    renderTable(page([case107()]), { onOpenPanel: undefined });
    expect(screen.queryByRole("button", { name: "source en (native), 1 translation" })).toBeNull();
    expect(screen.getByText("source en (native), 1 translation").tagName).toBe("SPAN");
  });

  it("a planned native text stays a row", () => {
    const native = stagedRow("EN100017", "en", { overrides: { is_source: true } });
    renderTable(page([group("EN100017", [native])]));
    expect(header("EN100017 · en")).toBeTruthy();
    const label = screen.getByRole("checkbox", { name: "Select EN100017 (1 text)" }).closest("tr")!.querySelector("th")!;
    expect(label.querySelector(".documents-group-meta")).toBeNull();
    // A case whose only row is a not-planned source keeps that row.
    cleanup();
    renderTable(page([group("case-9", [notInPlanRow("case-9", "fr", { is_source: true })])]));
    expect(header("case-9 · fr")).toBeTruthy();
    expect(caseHeaderText(group("case-9", [row({ case_id: "case-9", language: "fr", is_source: true })]))).toBe("case-9 · fr source");
  });

  it("group checkbox is mixed when one of two texts is selected", () => {
    const two = group("case-130", [stagedRow("case-130", "de"), stagedRow("case-130", "fr")]);
    renderTable(page([two]), { selection: selection(["case-130:de"]) });
    const box = screen.getByRole("checkbox", { name: "Select case-130 (2 texts)" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
    expect((within(rowOf("case-130 · de")).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("decision rows get the edge class and hidden text Needs your decision", () => {
    const undecided = notInPlanRow("case-101", "de", {
      next_step: stepOf("decide_plan"), steps: [stepOf("decide_plan")],
      plan_row: { review: false, annotate: false, review_applicable: true, discarded: false, decided: false },
    });
    renderTable(page([case107(), group("case-101", [undecided])]));
    expect(rowOf("case-107 · de").className).toContain("data-table-row--decision");
    expect(within(header("case-107 · de")).getByText("Needs your decision").className).toBe("visually-hidden");
    expect(rowOf("case-101 · de").className).toContain("data-table-row--decision");
  });

  it("NEW badge with accessible text New since your last visit", () => {
    const fresh = { ...scenario7a(), new: true } as DocumentRowView;
    renderTable(page([case107(fresh)]));
    const th = header("case-107 · de");
    expect(within(th).getByText("NEW").getAttribute("aria-hidden")).toBe("true");
    expect(within(th).getByText("New since your last visit").className).toBe("visually-hidden");
  });

  it("not-in-plan translations are muted rows, never collapsed", () => {
    const view = group("case-101", [
      notInPlanRow("case-101", "en", { is_source: true }),
      planRow("case-101", "de", stepOf("assign_translation_review")),
      notInPlanRow("case-101", "fr"),
    ], { not_in_plan_languages: ["en", "fr"] });
    renderTable(page([view]));
    expect(rowOf("case-101 · fr").className).toContain("documents-row--not-in-plan");
    expect(rowOf("case-101 · de").className).not.toContain("documents-row--not-in-plan");
    expect(cellsOf("case-101 · fr")[2].querySelector(".stage-cell--muted")).not.toBeNull();
  });

  it("Text and Last activity headers sort via onSort with aria-sort", () => {
    const onSort = vi.fn();
    const { unmount } = renderTable(page([case107()]), { sort: "case", onSort });
    const text = screen.getByRole("columnheader", { name: /Text/ });
    const activity = screen.getByRole("columnheader", { name: /Last activity/ });
    expect(text.getAttribute("aria-sort")).toBe("ascending");
    expect(activity.getAttribute("aria-sort")).toBe("none");
    expect(screen.getByRole("columnheader", { name: "Translation" }).getAttribute("aria-sort")).toBeNull();
    fireEvent.click(within(text).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("-case");
    fireEvent.click(within(activity).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("activity");
    unmount();
    renderTable(page([case107()]), { sort: "activity", onSort });
    expect(screen.getByRole("columnheader", { name: /Last activity/ }).getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Last activity/ })).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("-activity");
  });

  it("Last activity shows only the time", () => {
    renderTable(page([case107()]));
    const last = cellsOf("case-107 · de")[7];
    expect(last.querySelector("time")!.getAttribute("title")).toBe(fullTimestamp("2026-10-19T08:15:00Z"));
    expect(last.querySelector("time")!.textContent).toBe(formatTime("2026-10-19T08:15:00Z"));
    expect(last.querySelector("button")).toBeNull();
  });

  it("marks only the active row (aria-current, highlight class), never with opacity or inert", () => {
    const { container } = renderTable(page([case107()]), { activeKey: "case-107:de" });
    const active = rowOf("case-107 · de");
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(active.classList.contains("documents-row--active")).toBe(true);
    expect(container.querySelector("[inert]")).toBeNull();
    expect(container.querySelector("[class*='dim'], [class*='opacity'], [style*='opacity']")).toBeNull();
  });
});

describe("text cell", () => {
  it("the language is plain text with a flag in a button that opens the card", () => {
    const { props } = renderTable(page([case107()]));
    const th = header("case-107 · de");
    const name = within(th).getByRole("button", { name: "Open text card, case-107 de" });
    expect(name.id).toBe("documents-row-case-107-de-header");
    expect(name.className).toContain("documents-text-name");
    expect(name.className).not.toContain("documents-text-button");
    expect(name.querySelector("svg, img, .language-flag, [class*='flag']")).not.toBeNull();
    expect(within(th).queryByRole("link")).toBeNull();
    fireEvent.click(name);
    expect(props.onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-107", language: "de" }), { opener: name });
  });

  it("no Open link per row", () => {
    const view = case107();
    view.rows[1] = { ...view.rows[1], own_open_assignment_id: 41 };
    renderTable(page([view]));
    expect(screen.queryByRole("link", { name: /^Open in editor/ })).toBeNull();
    expect(within(header("case-107 · de")).queryByRole("link")).toBeNull();
  });
});

describe("cells", () => {
  it("status cells are one line with the full text as title", () => {
    const progress = stagedRow("case-106", "de", {
      stages: {
        review: cell("accepted", "done", { note: "unchanged" }),
        annotation: cell("in_progress", "running", { people: [tom], submitted: 1, total: 2 }),
        final: cell("after_annotation", "waiting"),
      },
      steps: [stepOf("annotation_in_progress", { owner: { kind: "people", person: null, count: 2, people: [ana, tom] } })],
    });
    renderTable(page([group("case-106", [progress])]));
    for (const index of [2, 3, 4]) {
      const status = cellsOf("case-106 · de")[index].querySelector<HTMLElement>(".documents-status")!;
      expect(status).not.toBeNull();
      expect(status.querySelector("button, br, p, div")).toBeNull();
      const visible = (status.textContent ?? "").replace(/^\S+\s/, "");
      expect(status.getAttribute("title")).toBe(visible);
    }
    // The card's short states (cardModel), the "who" in grey.
    expect(cellsOf("case-106 · de")[2].querySelector(".documents-status")!.getAttribute("title")).toBe("accepted");
    expect(cellsOf("case-106 · de")[3].querySelector(".documents-status")!.getAttribute("title")).toBe("1 of 2 submitted (Tom Reis)");
    expect(cellsOf("case-106 · de")[3].querySelector(".documents-status-who")!.textContent).toBe(" (Tom Reis)");
    expect(cellsOf("case-106 · de")[4].querySelector(".documents-status")!.getAttribute("title")).toBe("waiting");
    expect(cellsOf("case-106 · de")[3].querySelector(".stage-cell-symbol")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("Waiting on keeps the full list", () => {
    const steps = [stepOf("annotation_in_progress", { owner: { kind: "people", person: null, count: 2, people: [ana, tom] } })];
    renderTable(page([group("case-106", [stagedRow("case-106", "de", { steps })])]));
    const waiting = cellsOf("case-106 · de")[5];
    expect(within(waiting).getByText("Ana Weber, Tom Reis").getAttribute("aria-hidden")).toBe("true");
    expect(waiting.querySelector("[title]")!.getAttribute("title")).toBe("Ana Weber (ann-0003), Tom Reis (ann-0004)");
  });

  it("at most one button per row and no +n", () => {
    const steps = [stepOf("decide_report"), stepOf("assign_annotation"), stepOf("choose_final")];
    const busy = stagedRow("case-109", "de", { steps });
    const { props } = renderTable(page([case107(), group("case-109", [busy])]));
    const action = within(cellsOf("case-107 · de")[6]).getByRole("button", { name: "Accept result…, case-107 · de" });
    fireEvent.click(action);
    expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-107", language: "de" }), expect.objectContaining({ code: "choose_final" }));
    const next = cellsOf("case-109 · de")[6];
    expect(within(next).getAllByRole("button").filter(button => button.getAttribute("aria-haspopup") !== "menu")).toHaveLength(1);
    expect(next.textContent).not.toMatch(/\+\d/);
  });

  it("the robot icon shows while nobody is assigned and names the proposals", () => {
    const fresh = withProposals(stagedRow("case-140", "de", { stages: { annotation: cell("unassigned", "waiting") } }), 17);
    renderTable(page([group("case-140", [fresh, withProposals(stagedRow("case-140", "fr"), 0)])]));
    const bot = cellsOf("case-140 · de")[3].querySelector(".documents-bot")!;
    const text = "17 tool proposals available; the annotation starts from them";
    expect(bot.getAttribute("role")).toBe("img");
    expect(bot.getAttribute("title")).toBe(text);
    expect(bot.getAttribute("aria-label")).toBe(text);
    expect(bot.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("img", { name: text })).toBe(bot);
    expect(cellsOf("case-140 · fr")[3].querySelector(".documents-bot")).toBeNull();
  });

  it("the robot icon is gone once someone is assigned", () => {
    const assigned = withProposals(stagedRow("case-141", "de", {
      overrides: { work: [work({ assignment_id: 7, document_id: "case-141-de", task: "annotate" })] },
    }), 17);
    const reviewing = withProposals(stagedRow("case-141", "fr", {
      overrides: { work: [work({ assignment_id: 8, document_id: "case-141-fr", task: "translation_review" })] },
    }), 5);
    renderTable(page([group("case-141", [assigned, reviewing])]));
    expect(cellsOf("case-141 · de")[3].querySelector(".documents-bot")).toBeNull();
    expect(cellsOf("case-141 · fr")[3].querySelector(".documents-bot")).not.toBeNull();
  });

  it("no robot icon on a text annotated from scratch or outside the plan", () => {
    const scratch = { ...withProposals(stagedRow("case-142", "de"), 9), annotation_mode: { mode: "scratch" } } as DocumentRowView;
    const muted = withProposals(notInPlanRow("case-142", "fr"), 9);
    const proposals = { ...withProposals(stagedRow("case-142", "it"), 9), annotation_mode: { mode: "proposals" } } as DocumentRowView;
    renderTable(page([group("case-142", [scratch, muted, proposals])]));
    expect(cellsOf("case-142 · de")[3].querySelector(".documents-bot")).toBeNull();
    expect(cellsOf("case-142 · fr")[3].querySelector(".documents-bot")).toBeNull();
    expect(cellsOf("case-142 · it")[3].querySelector(".documents-bot")).not.toBeNull();
  });

  it("a source-changed Translation cell reads Source changed; the version marker stays", () => {
    const de = stagedRow("case-115", "de", {
      stages: { review: cell("source_changed", "decision", { from_version: 1 }) },
      steps: [stepOf("assign_translation_review")],
      overrides: { version_marker: { kind: "corrected", version: 2 } },
    });
    const en = notInPlanRow("case-115", "en", { is_source: true });
    renderTable(page([group("case-115", [en, de])]));
    expect(cellsOf("case-115 · de")[2].querySelector(".documents-status")!.getAttribute("title")).toBe("Source changed");
    expect(within(header("case-115 · de")).getByText("v2 corrected").className).toBe("documents-version-marker");
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
