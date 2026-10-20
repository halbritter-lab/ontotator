import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentGroupView, DocumentRowsPage } from "../../src/api/client";
import { DocumentCards, type DocumentCardsProps } from "../../src/documents/DocumentCards";
import { group, notInPlanRow, page, planRow, stepOf } from "./fixtures";

afterEach(cleanup);

function renderCards(view: DocumentRowsPage, overrides: Partial<DocumentCardsProps> = {}) {
  const props: DocumentCardsProps = {
    page: view,
    projectKey: "p",
    query: {},
    onToggleRow: vi.fn(),
    shownNotInPlan: new Set(),
    onToggleNotInPlan: vi.fn(),
    onAction: vi.fn(),
    renderPlan: entry => <span>{`chips ${entry.language}`}</span>,
    ...overrides,
  };
  const result = render(<DocumentCards {...props} />);
  return { ...result, props };
}

const cardOf = (name: string) => screen.getByRole("article", { name });

function case0101(): DocumentGroupView {
  return group("case-0101", [
    notInPlanRow("case-0101", "en", { is_source: true }),
    planRow("case-0101", "de", stepOf("assign_translation_review", { badges: ["check_failed"], detail: { kind: "version", version: 1, origin: "machine_translation", translation_status: "automatic_check_failed", task_paused: false } })),
    planRow("case-0101", "fr", stepOf("annotation_in_progress", { stage: "annotation", owner: { kind: "people", person: null, count: 2 } })),
  ]);
}

describe("cards", () => {
  it("renders one article per language row with chips, next step, owner and a full-width action", () => {
    const { props } = renderCards(page([case0101()]));
    const list = screen.getByRole("list", { name: "Documents" });
    const caseCard = within(list).getByRole("listitem");
    expect(within(caseCard).getByRole("heading", { level: 2, name: "case-0101 · en source + 2 translations" })).toBeTruthy();
    expect(within(caseCard).queryByText(/decision/)).toBeNull();
    expect(within(caseCard).getAllByRole("article")).toHaveLength(2);
    const de = cardOf("case-0101 · de");
    expect(within(de).getByRole("heading", { name: "case-0101 · de" })).toBeTruthy();
    expect(within(de).getByText("chips de")).toBeTruthy();
    const step = within(de).getByText("Assign translation review");
    expect(step.classList.contains("documents-step--strong")).toBe(true);
    expect(within(de).getByText("Check failed")).toBeTruthy();
    expect(within(de).getByText("v1 machine translation · check failed")).toBeTruthy();
    expect(de.textContent).toContain("Owner: You");
    const action = within(de).getByRole("button", { name: "Assign translation review…, case-0101 · de" });
    expect(action.classList.contains("documents-action--block")).toBe(true);
    fireEvent.click(action);
    expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), expect.objectContaining({ code: "assign_translation_review" }));
    expect(within(de).getByRole("link", { name: "Open case-0101 · de" })).toBeTruthy();
    expect(within(de).getByRole("button", { name: "Show details, case-0101 · de" }).textContent).toBe("Details");
    const fr = cardOf("case-0101 · fr");
    expect(fr.textContent).toContain("Owner: 2 annotators");
    expect(within(fr).queryByRole("button", { name: /…, case-0101 · fr/ })).toBeNull();
  });

  it("collapses not-in-plan rows of a case card into one line with show", () => {
    const onToggleNotInPlan = vi.fn();
    const { unmount } = renderCards(page([case0101()]), { onToggleNotInPlan });
    expect(screen.queryByRole("article", { name: "case-0101 · en" })).toBeNull();
    const line = screen.getByText(/not in plan ·/);
    expect(line.textContent).toBe("en not in plan · show");
    fireEvent.click(within(line).getByRole("button", { name: "Show en not in plan, case-0101" }));
    expect(onToggleNotInPlan).toHaveBeenCalledWith("case-0101");
    unmount();
    renderCards(page([case0101()]), { shownNotInPlan: new Set(["case-0101"]) });
    expect(cardOf("case-0101 · en").textContent).toContain("Not in plan");
  });

  it("shows the case's decision count next to the case card heading", () => {
    renderCards(page([group("case-0102", [
      planRow("case-0102", "de", stepOf("decide_report")),
      planRow("case-0102", "fr", stepOf("choose_final")),
    ])]));
    const heading = screen.getByRole("heading", { level: 2, name: "case-0102 · 2 languages" });
    expect(heading.parentElement!.textContent).toContain("2 decisions");
  });

  it("stacks the row notice and expanded content inside the article and toggles the row", () => {
    const onToggleRow = vi.fn();
    const renderExpanded = vi.fn(() => <section aria-label="Expanded">content</section>);
    renderCards(page([case0101()]), { query: { open: ["case-0101:de"] }, onToggleRow, renderExpanded, renderRowNotice: entry => (entry.language === "de" ? <p>notice</p> : null) });
    const card = cardOf("case-0101 · de");
    const toggle = within(card).getByRole("button", { name: "Show details, case-0101 · de" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(card.contains(region)).toBe(true);
    expect(within(card).getByText("notice")).toBeTruthy();
    expect(renderExpanded).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-0101", language: "de" }), { layout: "list" });
    expect(toggle.id).toBe("documents-row-case-0101-de-disclosure");
    fireEvent.click(toggle);
    expect(onToggleRow).toHaveBeenCalledWith("case-0101:de");
  });

  it("shows the empty content when there are no rows", () => {
    renderCards(page([]), { empty: <p>No texts</p> });
    expect(screen.getByText("No texts")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the visit badge next to the heading without changing its name", () => {
    renderCards(page([case0101()]), { rowBadge: entry => (entry.language === "de" ? <span className="badge">Changed: Work plan changed</span> : null) });
    const card = cardOf("case-0101 · de");
    const heading = within(card).getByRole("heading", { name: "case-0101 · de" });
    expect(heading.contains(within(card).getByText("Changed: Work plan changed"))).toBe(false);
  });
});
