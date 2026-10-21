import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentGroupView, DocumentRowsPage } from "../../src/api/client";
import { DocumentCards, type DocumentCardsProps } from "../../src/documents/DocumentCards";
import type { TableSelection } from "../../src/documents/DocumentsTable";
import { group, notInPlanRow, page, stepOf } from "./fixtures";
import { ana, cell, stagedRow, tom } from "./tableFixtures";

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

function renderCards(view: DocumentRowsPage, overrides: Partial<DocumentCardsProps> = {}) {
  const props: DocumentCardsProps = { page: view, projectKey: "p", query: {}, onToggleRow: vi.fn(), onAction: vi.fn(), selection: selection(), ...overrides };
  const result = render(<DocumentCards {...props} />);
  return { ...result, props };
}

const cardOf = (name: string) => screen.getByRole("article", { name });

function case106(): DocumentGroupView {
  return group("case-106", [
    notInPlanRow("case-106", "en", { is_source: true, stages: { review: cell("source", "none"), annotation: cell("not_planned", "none"), final: cell("none", "none") } }),
    stagedRow("case-106", "de", {
      stages: {
        review: cell("accepted", "done", { note: "unchanged" }),
        annotation: cell("unassigned", "todo", { assigned: 0, target: 2 }),
        final: cell("none", "none"),
      },
      steps: [stepOf("assign_annotation")],
    }),
    stagedRow("case-106", "fr", {
      stages: { annotation: cell("in_progress", "running", { people: [tom], submitted: 1, total: 2 }) },
      steps: [stepOf("annotation_in_progress", { owner: { kind: "people", person: null, count: 2, people: [ana, tom] } })],
    }),
  ]);
}

describe("cards", () => {
  it("renders one article per text with stage lines, Waiting on and a full-width action; not-in-plan texts are muted, never collapsed", () => {
    const { props } = renderCards(page([case106()]));
    const caseCard = within(screen.getByRole("list", { name: "Documents" })).getByRole("listitem");
    expect(within(caseCard).getByRole("heading", { level: 2, name: "case-106 · en source + 2 translations" })).toBeTruthy();
    expect(within(caseCard).getAllByRole("article")).toHaveLength(3);
    expect(cardOf("case-106 · en").className).toContain("document-card--muted");
    const de = cardOf("case-106 · de");
    expect(de.textContent).toContain("Review: ✓ Accepted · unchanged");
    expect(de.textContent).toContain("Annotation: ○ 0 of 2 assigned");
    expect(de.textContent).toContain("Final: —");
    expect(de.textContent).toContain("Waiting on: You");
    const action = within(de).getByRole("button", { name: "Assign annotation…, case-106 · de" });
    expect(action.classList.contains("documents-action--block")).toBe(true);
    fireEvent.click(action);
    expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), expect.objectContaining({ code: "assign_annotation" }));
    expect(within(de).getByRole("link", { name: "Open case-106 · de" })).toBeTruthy();
    expect(cardOf("case-106 · fr").textContent).toContain("Waiting on: Ana Weber, Tom Reis");
    expect(screen.queryByText(/not in plan ·/)).toBeNull();
  });

  it("selects texts and cases with mixed case state", () => {
    const view = page([case106()]);
    const chosen = selection(["case-106:de"]);
    renderCards(view, { selection: chosen });
    const caseBox = screen.getByRole("checkbox", { name: "Select case-106 (3 texts)" }) as HTMLInputElement;
    expect(caseBox.indeterminate).toBe(true);
    expect((within(cardOf("case-106 · de")).getByRole("checkbox", { name: "Select case-106 · de" }) as HTMLInputElement).checked).toBe(true);
    const order = ["case-106:en", "case-106:de", "case-106:fr"];
    fireEvent.click(caseBox);
    expect(chosen.selectCase).toHaveBeenCalledWith(order, "toggle", order);
    fireEvent.click(within(cardOf("case-106 · fr")).getByRole("checkbox"), { shiftKey: true });
    expect(chosen.select).toHaveBeenCalledWith("case-106:fr", "range", order);
  });

  it("stacks the row notice and expanded content inside the article and toggles History", () => {
    const onToggleRow = vi.fn();
    const renderExpanded = vi.fn(() => <section aria-label="Expanded">content</section>);
    renderCards(page([case106()]), { query: { open: ["case-106:de"] }, onToggleRow, renderExpanded, renderRowNotice: entry => (entry.language === "de" ? <p>notice</p> : null) });
    const card = cardOf("case-106 · de");
    const toggle = within(card).getByRole("button", { name: "History" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(card.contains(document.getElementById(toggle.getAttribute("aria-controls")!)!)).toBe(true);
    expect(within(card).getByText("notice")).toBeTruthy();
    expect(renderExpanded).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-106", language: "de" }), { layout: "list" });
    expect(toggle.id).toBe("documents-row-case-106-de-disclosure");
    fireEvent.click(toggle);
    expect(onToggleRow).toHaveBeenCalledWith("case-106:de");
  });

  it("shows the empty content when there are no rows", () => {
    renderCards(page([]), { empty: <p>No texts</p> });
    expect(screen.getByText("No texts")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the visit badge next to the heading without changing its name", () => {
    renderCards(page([case106()]), { rowBadge: entry => (entry.language === "de" ? <span className="badge">Changed: Work plan changed</span> : null) });
    const card = cardOf("case-106 · de");
    const heading = within(card).getByRole("heading", { name: "case-106 · de" });
    expect(heading.contains(within(card).getByText("Changed: Work plan changed"))).toBe(false);
  });
});
