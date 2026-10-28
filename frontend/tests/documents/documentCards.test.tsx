import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type DocumentGroupView, type DocumentRowView, type DocumentRowsPage } from "../../src/api/client";
import { DocumentCards, type DocumentCardsProps } from "../../src/documents/DocumentCards";
import type { TableSelection } from "../../src/documents/DocumentsTable";
import { group, notInPlanRow, page, stepOf, submissions } from "./fixtures";
import { waitingOnText, type StageName } from "../../src/documents/stageLabels";
import { ana, cell, stagedRow, tom } from "./tableFixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language)); });

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
  const props: DocumentCardsProps = { page: view, projectKey: "p", query: {}, onOpenPanel: vi.fn(), onAction: vi.fn(), selection: selection(), ...overrides };
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
    expect(within(caseCard).getByRole("heading", { level: 3, name: "case-106, en source + 2 translations" })).toBeTruthy();
    expect(within(caseCard).getAllByRole("article")).toHaveLength(3);
    expect(cardOf("case-106 en").className).toContain("document-card--muted");
    const de = cardOf("case-106 de");
    expect(de.textContent).toContain("Translation: ✓ Accepted, unchanged");
    expect(de.textContent).toContain("Annotation:  Unassigned");
    expect(de.textContent).toContain("Finalization: —");
    expect(de.textContent).toContain("Waiting on: You");
    const action = within(de).getByRole("button", { name: "Assign annotation…, case-106 de" });
    expect(action.classList.contains("documents-action--block")).toBe(true);
    fireEvent.click(action);
    expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }), expect.objectContaining({ code: "assign_annotation" }));
    expect(within(de).getByRole("link", { name: "Open in editor, case-106 de" })).toBeTruthy();
    expect(cardOf("case-106 fr").textContent).toContain("Waiting on: Ana Weber, Tom Reis");
    expect(screen.queryByText(/not in plan ·/)).toBeNull();
  });

  it("selects texts and cases with mixed case state", () => {
    const view = page([case106()]);
    const chosen = selection(["case-106:de"]);
    renderCards(view, { selection: chosen });
    const caseBox = screen.getByRole("checkbox", { name: "Select case-106 (3 texts)" }) as HTMLInputElement;
    expect(caseBox.indeterminate).toBe(true);
    expect((within(cardOf("case-106 de")).getByRole("checkbox", { name: "Select case-106 de" }) as HTMLInputElement).checked).toBe(true);
    const order = ["case-106:en", "case-106:de", "case-106:fr"];
    fireEvent.click(caseBox);
    expect(chosen.selectCase).toHaveBeenCalledWith(order, "toggle", order);
    fireEvent.click(within(cardOf("case-106 fr")).getByRole("checkbox"), { shiftKey: true });
    expect(chosen.select).toHaveBeenCalledWith("case-106:fr", "range", order);
  });

  it("stacks the row notice inside the article; Details opens the row panel's sheet (X19) and marks the card", () => {
    const onOpenPanel = vi.fn();
    const { props } = renderCards(page([case106()]), { onOpenPanel, activeKey: "case-106:de", renderRowNotice: entry => (entry.language === "de" ? <p>notice</p> : null) });
    const card = cardOf("case-106 de");
    expect(within(card).getByText("notice")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "History" })).toBeNull();
    const details = within(card).getByRole("button", { name: "Details, case-106 de" });
    expect(details.textContent).toBe("Details");
    expect(details.id).toBe("documents-row-case-106-de-details");
    fireEvent.click(details);
    expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-106", language: "de" }), { opener: details });
    // Details opens the card like the text name in the table: the selection stays as it is.
    expect(props.selection!.select).not.toHaveBeenCalled();
    expect(card.getAttribute("aria-current")).toBe("true");
    expect(cardOf("case-106 fr").getAttribute("aria-current")).toBeNull();
  });

  it("one case card with checkbox and header, one article per text with three labelled stage lines", () => {
    renderCards(page([case106()]));
    const caseCard = within(screen.getByRole("list", { name: "Documents" })).getByRole("listitem");
    expect(within(caseCard).getByRole("checkbox", { name: "Select case-106 (3 texts)" })).toBeTruthy();
    const caseHeading = within(caseCard).getByRole("heading", { level: 3 });
    // The case heading is the focus fallback of plan saves (same id as the table's group label).
    expect(caseHeading.id).toBe("documents-group-case-106-toggle");
    expect(caseHeading.tabIndex).toBe(-1);
    const de = cardOf("case-106 de");
    const heading = within(de).getByRole("heading", { level: 4, name: "case-106 de" });
    // Deep links and the panel focus the card heading like the table's row header.
    expect(heading.id).toBe("documents-row-case-106-de-header");
    const lines = [...de.querySelectorAll<HTMLElement>(".document-card-stage")];
    expect(lines.map(line => line.textContent)).toEqual(["Translation: ✓ Accepted, unchanged", "Annotation:  Unassigned", "Finalization: —"]);
    // Glyphs are decorative: never read aloud.
    for (const line of lines) {
      const glyph = line.querySelector(".stage-cell-symbol");
      if (glyph) expect(glyph.getAttribute("aria-hidden")).toBe("true");
    }
    expect(lines[0].className).toContain("stage-cell--done");
  });

  it("Waiting on line, one full-width action ≥ 32 px (no More), Open and Details", () => {
    const people = [ana, tom, { pseudonym: "ann-0005", display_name: "Luc Martin", is_me: false }];
    const fr = stagedRow("case-108", "fr", {
      stages: { annotation: cell("in_progress", "running", { people }) },
      steps: [stepOf("annotation_in_progress", { owner: { kind: "people", person: null, count: 3, people } })],
    });
    const de = stagedRow("case-108", "de", { steps: [stepOf("assign_annotation"), stepOf("decide_report", { stage: "annotation" })] });
    renderCards(page([group("case-108", [de, fr])]));
    const deCard = cardOf("case-108 de");
    expect(within(deCard).getByText("You").tagName).toBe("STRONG");
    const action = within(deCard).getByRole("button", { name: "Assign annotation…, case-108 de" });
    expect(action.classList.contains("documents-action--block")).toBe(true);
    expect(within(deCard).queryByRole("button", { name: /^More/ })).toBeNull();
    expect(within(deCard).getByRole("link", { name: "Open in editor, case-108 de" })).toBeTruthy();
    expect(within(deCard).getByRole("button", { name: "Details, case-108 de" })).toBeTruthy();
    // More than two people: the visible "+n" line, the full list for assistive technology (not only in a title).
    const waiting = within(cardOf("case-108 fr")).getByText(/^Waiting on:/).closest(".document-card-owner")!;
    const { text, title } = waitingOnText(fr);
    expect(text).toContain("+1");
    expect(waiting.querySelector("[aria-hidden='true']")?.textContent).toBe(text);
    expect(waiting.querySelector(".visually-hidden")?.textContent).toBe(title);
  });

  it("decision edge is the article's left border; not-in-plan articles muted", () => {
    const decision = stagedRow("case-109", "de", {
      stages: { final: cell("choose", "decision", { submitted: 1 }) },
      steps: [stepOf("choose_final", { stage: "final" })],
    });
    const source = notInPlanRow("case-109", "en", { is_source: true });
    renderCards(page([group("case-109", [source, decision])]));
    const de = cardOf("case-109 de");
    expect(de.className).toContain("document-card--decision");
    // Status never by colour alone: the edge has hidden text outside the heading name.
    expect(within(de).getByText("Needs your decision").className).toBe("visually-hidden");
    const en = cardOf("case-109 en");
    expect(en.className).toContain("document-card--muted");
    expect(en.className).not.toContain("document-card--decision");
    expect(within(en).queryByText("Needs your decision")).toBeNull();
    expect(en.querySelector(".stage-cell--muted")).not.toBeNull();
  });

  it("shows the empty content when there are no rows", () => {
    renderCards(page([]), { empty: <p>No texts</p> });
    expect(screen.getByText("No texts")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("a stage line opens the stage popover with its admin actions; Open full details opens the sheet filtered to the stage", () => {
    const onOpenPanel = vi.fn();
    const stageActions = vi.fn((_row: DocumentRowView, stage: StageName) => (stage === "annotation" ? <button type="button">Reassign…</button> : null));
    renderCards(page([case106()]), { onOpenPanel, stageActions });
    const de = cardOf("case-106 de");
    const stageButton = within(de).getByRole("button", { name: "Annotation: Unassigned. Show history, case-106 de" });
    expect(stageButton.getAttribute("aria-haspopup")).toBe("dialog");
    expect(stageButton.getAttribute("aria-expanded")).toBe("false");
    // The status word is the button; the stage title and detail stay plain text.
    expect(stageButton.closest(".document-card-stage")?.textContent).toBe("Annotation:  Unassigned");
    fireEvent.click(stageButton);
    const dialog = screen.getByRole("dialog", { name: "Annotation activity, case-106 de" });
    expect(stageButton.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(stageButton.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(stageActions).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-106", language: "de" }), "annotation");
    expect(within(dialog).getByRole("button", { name: "Reassign…" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open full details" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-106", language: "de" }), { stage: "annotation", opener: stageButton });
  });

  it("Escape closes the stage popover and returns focus to the stage cell", () => {
    renderCards(page([case106()]));
    const stageButton = within(cardOf("case-106 de")).getByRole("button", { name: "Translation: Accepted. Show history, case-106 de" });
    fireEvent.click(stageButton);
    const dialog = screen.getByRole("dialog", { name: "Translation activity, case-106 de" });
    expect(within(dialog).getByText("No translation activity yet.")).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(stageButton);
  });

  it("the Final line shows 1 flagged, part of the stage button's description (X5)", () => {
    const flagged = stagedRow("case-120", "de", { stages: { final: cell("none", "none") }, overrides: { flagged_unclear: 1 } });
    renderCards(page([group("case-120", [flagged])]));
    const card = cardOf("case-120 de");
    expect(within(card).getByText(", 1 flagged")).toBeTruthy();
    const button = within(card).getByRole("button", { name: /^Finalization:/ });
    const described = (button.getAttribute("aria-describedby") ?? "").split(" ").map(id => document.getElementById(id)?.textContent).join(" ");
    expect(described).toContain("1 flagged");
    cleanup();
    renderCards(page([group("case-120", [{ ...flagged, flagged_unclear: 0 }])]));
    expect(within(cardOf("case-120 de")).queryByText(/flagged/)).toBeNull();
  });

  it("stage lines stay plain text without the row panel", () => {
    renderCards(page([case106()]), { onOpenPanel: undefined });
    expect(within(cardOf("case-106 de")).queryByRole("button", { name: /Show history/ })).toBeNull();
  });

  it("shows the visit badge next to the heading without changing its name", () => {
    renderCards(page([case106()]), { rowBadge: entry => (entry.language === "de" ? <span className="badge">Changed: Work plan changed</span> : null) });
    const card = cardOf("case-106 de");
    const heading = within(card).getByRole("heading", { name: "case-106 de" });
    expect(heading.contains(within(card).getByText("Changed: Work plan changed"))).toBe(false);
  });

  it("Open my task is the card's action; Open stays a link", () => {
    const mine = stagedRow("case-150", "de", { steps: [], overrides: { own_open_assignment_id: 41 } });
    renderCards(page([group("case-150", [mine])]));
    const card = cardOf("case-150 de");
    expect(within(card).getAllByRole("link", { name: "Open my task" })).toHaveLength(1);
    expect(within(card).getByRole("link", { name: "Open my task" }).id).toBe("documents-row-case-150-de-action");
    expect(within(card).getByRole("link", { name: "Open in editor, case-150 de" })).toBeTruthy();
  });
});
