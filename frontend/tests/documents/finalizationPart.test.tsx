import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinalizationPart } from "../../src/documents/textCard/FinalizationPart";
import { row, stageCell, stages, work } from "./fixtures";

afterEach(cleanup);

const carla = { pseudonym: "ann-0007", display_name: "Carla Consolidator", is_me: false };
const consolidating = (extra = {}) => row({ case_id: "W07", language: "en", stages: stages({ annotation: stageCell("consolidating", "running", { people: [carla] }) }), ...extra });
const now = new Date("2026-10-27T12:00:00Z");

it("names who consolidates the text instead of an empty part (R-6)", () => {
  render(<FinalizationPart row={consolidating()} projectKey="p" query={{}} onNavigate={vi.fn()} now={now} />);
  expect(screen.getByText("Consolidating with Carla Consolidator")).toBeTruthy();
  expect(screen.queryByText("Open consolidation")).toBeNull();
});

it("shows the open groups and offers the lead only removal of someone else's running consolidation, no dead-end link (R-6)", () => {
  const onNavigate = vi.fn();
  const item = work({ assignment_id: 9, document_id: "doc-w07", author_label: "ann-0007", task: "review", status: "in_progress", person: carla });
  render(<FinalizationPart row={consolidating({ consolidation_progress: { round_id: "r-7", open: 2, total: 3 }, work: [item] })} projectKey="p" query={{}}
    onNavigate={onNavigate} now={now} canManage tools={{ assignments: [{ id: 9, task: "review", status: "in_progress", document_id: "doc-w07", pseudonym: "ann-0007", username: "carla" }], members: [], onAssignmentsChanged: vi.fn() } as never} />);
  // One row for the consolidator (#108): name, open groups, status, and the lead's one action naming her.
  const person = within(screen.getByRole("list", { name: "Consolidators" })).getByRole("listitem");
  expect(person.textContent).toBe("Carla Consolidator ann-00072 of 3 groups openConsolidatingRemove…");
  // The running round is Carla's draft: the lead gets no link to it (the server refuses it, U9).
  expect(screen.queryByText("Open consolidation")).toBeNull();
  // A consolidation is not reassigned (D1).
  expect(within(person).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Remove Carla Consolidator’s consolidation assignment"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Carla Consolidator’s consolidation assignment" }));
  expect(screen.getByRole("dialog", { name: /Remove assignment/ })).toBeTruthy();
});

it("opens the running consolidation for its consolidator", () => {
  const onNavigate = vi.fn();
  const me = { ...carla, is_me: true };
  render(<FinalizationPart row={row({ case_id: "W07", language: "en", stages: stages({ annotation: stageCell("consolidating", "running", { people: [me] }) }),
    consolidation_progress: { round_id: "r-7", open: 2, total: 3 } })} projectKey="p" query={{}} onNavigate={onNavigate} now={now} />);
  expect(screen.getByText("Consolidating with you · 2 of 3 groups open")).toBeTruthy();
  fireEvent.click(screen.getByText("Open consolidation"));
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectConsolidation", key: "p", roundId: "r-7" });
});

it("gives no link while someone else consolidates alongside the viewer (the round may be theirs)", () => {
  render(<FinalizationPart row={row({ case_id: "W07", language: "en", stages: stages({ annotation: stageCell("consolidating", "running", { people: [carla, { ...carla, pseudonym: "ann-0002", display_name: "Lena Lead", is_me: true }] }) }),
    consolidation_progress: { round_id: "r-7", open: 2, total: 3 } })} projectKey="p" query={{}} onNavigate={vi.fn()} now={now} />);
  expect(screen.getByText("Consolidating with Carla Consolidator, you · 2 of 3 groups open")).toBeTruthy();
  expect(screen.queryByText("Open consolidation")).toBeNull();
});

describe("one of two annotations submitted, one still open (issue 123)", () => {
  const tom = { pseudonym: "ann-0004", display_name: "Tom Reis", is_me: false };
  const early = () => row({ case_id: "W08", language: "en",
    stages: stages({ annotation: stageCell("in_progress", "running", { submitted: 1, total: 2 }), final: stageCell("after_annotation", "waiting") }),
    work: [
      work({ assignment_id: 1, document_id: "doc-w08", author_label: "ann-0003", status: "submitted" }),
      work({ assignment_id: 2, document_id: "doc-w08", author_label: "ann-0004", status: "in_progress", person: tom }),
    ] });
  const tools = { assignments: [{ id: 2, task: "annotate", status: "in_progress", document_id: "doc-w08", pseudonym: "ann-0004", username: "tom" }], members: [], onAssignmentsChanged: vi.fn() } as never;

  it("warns about the open annotation instead of waiting for it, and offers its removal to the lead", () => {
    render(<FinalizationPart row={early()} projectKey="p" query={{}} onNavigate={vi.fn()} now={now} canManage tools={tools} decision={<p>Decision block</p>} />);
    expect(screen.queryByText(/^Starts once/)).toBeNull();
    expect(screen.getByText("1 annotation still open: Tom Reis. You can accept a result now; open work stays assigned unless you remove it.")).toBeTruthy();
    expect(screen.getByText("Decision block")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove assignment…, Tom Reis" }));
    expect(screen.getByRole("dialog", { name: /Remove assignment/ })).toBeTruthy();
  });

  it("offers no removal without lead rights", () => {
    render(<FinalizationPart row={early()} projectKey="p" query={{}} onNavigate={vi.fn()} now={now} tools={tools} />);
    expect(screen.getByText(/1 annotation still open: Tom Reis/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove assignment/ })).toBeNull();
  });

  it("still says when finalization starts while nothing is submitted", () => {
    const waiting = row({ case_id: "W09", language: "en", stages: stages({ annotation: stageCell("in_progress", "running", { total: 2, target: 2 }) }),
      work: [work({ assignment_id: 3, document_id: "doc-w09", status: "in_progress" })] });
    render(<FinalizationPart row={waiting} projectKey="p" query={{}} onNavigate={vi.fn()} now={now} />);
    expect(screen.getByText("Starts once an annotation is submitted (up to 2 per text, fewer is fine): compare the results, consolidate the differences, then accept the result.")).toBeTruthy();
  });
});
