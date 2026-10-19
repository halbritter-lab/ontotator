import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentRowsPage } from "../../src/api/client";
import { DocumentCards, type DocumentCardsProps } from "../../src/documents/DocumentCards";
import { formatTime, issueAriaLabel } from "../../src/documents/labels";
import { group, page, row, scenarioS0, scenarioS3, scenarioS4 } from "./fixtures";

afterEach(cleanup);

function renderCards(view: DocumentRowsPage, overrides: Partial<DocumentCardsProps> = {}) {
  const props: DocumentCardsProps = {
    page: view,
    projectKey: "p",
    query: {},
    onToggleRow: vi.fn(),
    selected: new Set(),
    onToggleSelect: vi.fn(),
    ...overrides,
  };
  const result = render(<DocumentCards {...props} />);
  return { ...result, props };
}

const cardOf = (name: string) => screen.getByRole("article", { name });
const linesOf = (name: string) => Array.from(cardOf(name).querySelectorAll(":scope > .document-card-line")) as HTMLElement[];

describe("structure", () => {
  it("renders one labelled article per row inside a list", () => {
    renderCards(scenarioS0().page);
    const list = screen.getByRole("list", { name: "Documents" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const card = cardOf("synthetic-accepted · de");
    const heading = within(card).getByRole("heading", { name: "synthetic-accepted · de" });
    expect(card.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(cardOf("synthetic-accepted · en")).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
  });

  it("orders the lines: select, heading and issues / version / final / work and activity / actions", () => {
    renderCards(scenarioS0().page);
    const lines = linesOf("synthetic-accepted · de");
    expect(lines).toHaveLength(5);
    const [first, second, third, fourth, last] = lines;

    const firstChildren = Array.from(first.children);
    expect(firstChildren[0].querySelector("input[type=checkbox]") ?? firstChildren[0]).toBe(within(first).getByRole("checkbox", { name: "Select synthetic-accepted · de" }));
    expect(firstChildren[1].tagName).toBe("H3");
    expect(firstChildren[2].getAttribute("role")).toBe("img");
    expect(firstChildren[2].getAttribute("aria-label")).toBe(issueAriaLabel({ "confirm-final": 1 }, {}));

    expect(second.textContent).toBe("v2 · Correction of v1 · Ready for review");
    expect(third.textContent).toContain(`Annotation · Round 1 · ann-0004 · ${formatTime("2026-10-18T10:00:00Z")} · v1`);
    expect(third.querySelector("svg.icon")).not.toBeNull();
    expect(fourth.textContent).toContain("ann-0004");
    expect(fourth.querySelector("time")?.getAttribute("title")).toBeTruthy();

    const actions = Array.from(last.querySelectorAll("a, button"));
    expect(actions.map(entry => entry.textContent)).toEqual(["Open", "Show submissions"]);
  });

  it("uses the same accessible names as the table", () => {
    renderCards(scenarioS0().page);
    const card = cardOf("synthetic-accepted · de");
    const open = within(card).getByRole("link", { name: "Open synthetic-accepted · de" });
    expect(open.getAttribute("href")).toContain("variant=synthetic-accepted-de");
    const toggle = within(card).getByRole("button", { name: "Show submissions, synthetic-accepted · de" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.hasAttribute("aria-controls")).toBe(false);
    expect(within(card).getByRole("checkbox", { name: "Select synthetic-accepted · de" })).toBeTruthy();
    expect(within(card).queryByRole("link", { name: "Open my task" })).toBeNull();
  });

  it("offers Open my task and passes the Documents query with Open", () => {
    const s0 = scenarioS0();
    s0.group.rows[1] = { ...s0.group.rows[1], own_open_assignment_id: 41 };
    renderCards(page([s0.group]), { query: { language: "de", decision: "all" } });
    const card = cardOf("synthetic-accepted · de");
    expect(within(card).getByRole("link", { name: "Open my task" }).getAttribute("href")).toBe("#/tasks/41");
    const href = within(card).getByRole("link", { name: "Open synthetic-accepted · de" }).getAttribute("href")!;
    expect(href).toContain("documents_language=de");
    expect(href).toContain("documents_decision=all");
  });

  it("stacks expanded content inside the article and toggles the row", () => {
    const onToggleRow = vi.fn();
    const renderExpanded = vi.fn(() => <section aria-label="Expanded">content</section>);
    renderCards(scenarioS0().page, { query: { open: ["synthetic-accepted:de"] }, onToggleRow, renderExpanded });
    const card = cardOf("synthetic-accepted · de");
    const toggle = within(card).getByRole("button", { name: "Show submissions, synthetic-accepted · de" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(card.contains(region)).toBe(true);
    expect(card.lastElementChild).toBe(region);
    expect(region.textContent).toBe("content");
    expect(renderExpanded).toHaveBeenCalledTimes(1);
    // Narrow cards ask for the list layout of Submissions.
    expect(renderExpanded).toHaveBeenCalledWith(expect.objectContaining({ case_id: "synthetic-accepted", language: "de" }), { layout: "list" });
    expect(toggle.id).toBe("documents-row-synthetic-accepted-de-disclosure");
    expect(within(cardOf("synthetic-accepted · en")).getByRole("button", { name: /Show submissions/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggleRow).toHaveBeenCalledWith("synthetic-accepted:de");
  });

  it("selects the bulk version with the checkbox", () => {
    const onToggleSelect = vi.fn();
    renderCards(scenarioS0().page, { onToggleSelect });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select synthetic-accepted · de" }));
    expect(onToggleSelect).toHaveBeenCalledWith("synthetic-accepted-de-v2", true);
  });

  it("shows the empty content when there are no rows", () => {
    renderCards(page([]), { empty: <p>No texts</p> });
    expect(screen.getByText("No texts")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("cells", () => {
  it("S3: version, final with version marker and confirm issues", () => {
    renderCards(scenarioS3().page);
    const [first, versions, finalLine] = linesOf("case-0211 · de");
    expect(versions.textContent).toBe("v3 · Correction of v2 · Ready for review");
    expect(finalLine.textContent).toContain(`Annotation · Round 2 · ann-0004 · ${formatTime("2026-10-18T10:00:00Z")} · v1`);
    const badge = within(first).getByRole("img", { name: issueAriaLabel({ "confirm-final": 2 }, {}) });
    expect(badge.textContent).toBe("2");
  });

  it("S4: parallel roots, choose in versions and the Open description", () => {
    renderCards(scenarioS4().page);
    const [first, versions] = linesOf("case-0305 · fr");
    expect(within(first).queryByRole("checkbox")).toBeNull();
    expect(first.textContent).toContain("Choose in Text versions");
    expect(versions.textContent).toBe("2 independent translations: Provider A, Provider B");
    const open = screen.getByRole("link", { name: "Open case-0305 · fr" });
    expect(document.getElementById(open.getAttribute("aria-describedby")!)?.textContent).toBe("Opens Provider B v1, the most recent translation");
    expect(open.getAttribute("href")).toContain("variant=case-0305-fr-b");
  });

  it("middle-truncates long IDs in the heading with the full value in title", () => {
    const longId = "case-2026-10-19-0211-imported-batch";
    renderCards(page([group(longId, [row({ case_id: longId, language: "de" })])]));
    const card = cardOf(`${longId} · de`);
    const heading = within(card).getByRole("heading", { name: `${longId} · de` });
    const short = heading.querySelector("[title]")!;
    expect(short.getAttribute("title")).toBe(longId);
    expect(short.textContent).toContain("…");
    expect(within(card).getByRole("link", { name: `Open ${longId} · de` })).toBeTruthy();
  });
});

describe("row badge", () => {
  it("shows the visit badge next to the heading of a collapsed card without changing its name", () => {
    renderCards(scenarioS0().page, { rowBadge: entry => (entry.language === "de" ? <span className="badge">Changed: Work assigned</span> : null) });
    const card = cardOf("synthetic-accepted · de");
    expect(within(card).getByRole("button", { name: "Show submissions, synthetic-accepted · de" }).getAttribute("aria-expanded")).toBe("false");
    const heading = within(card).getByRole("heading", { name: "synthetic-accepted · de" });
    const badge = within(card).getByText("Changed: Work assigned");
    expect(heading.contains(badge)).toBe(false);
    expect(badge.closest(".document-card-head")).toBe(heading.parentElement);
    expect(cardOf("synthetic-accepted · en").textContent).not.toContain("Changed");
  });
});
