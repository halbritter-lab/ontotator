import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
  expect(screen.getByText("Consolidating with Carla Consolidator · 2 of 3 groups open")).toBeTruthy();
  // The running round is Carla's draft: the lead gets no link to it (the server refuses it, U9).
  expect(screen.queryByText("Open consolidation")).toBeNull();
  // The consolidator is named in plain text only; the lead's one action is a button of its own (no chip, no Reassign).
  expect(screen.queryByRole("button", { name: /Carla Consolidator/ })).toBeNull();
  expect(screen.queryByText("Reassign to someone else…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove assignment…" }));
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
