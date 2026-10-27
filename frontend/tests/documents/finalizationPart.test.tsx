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

it("shows the open groups, opens the consolidation and offers the lead only removal of the consolidator (R-6)", () => {
  const onNavigate = vi.fn();
  const item = work({ assignment_id: 9, document_id: "doc-w07", author_label: "ann-0007", task: "review", status: "in_progress", person: carla });
  render(<FinalizationPart row={consolidating({ consolidation_progress: { round_id: "r-7", open: 2, total: 3 }, work: [item] })} projectKey="p" query={{}}
    onNavigate={onNavigate} now={now} canManage tools={{ assignments: [{ id: 9 }], members: [], onAssignmentsChanged: vi.fn() } as never} />);
  expect(screen.getByText("Consolidating with Carla Consolidator · 2 of 3 groups open")).toBeTruthy();
  fireEvent.click(screen.getByText("Open consolidation"));
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectConsolidation", key: "p", roundId: "r-7" });
  fireEvent.click(screen.getByRole("button", { name: /Carla Consolidator, in progress: actions/ }));
  expect(screen.getByText("Remove assignment…")).toBeTruthy();
  expect(screen.queryByText("Reassign to someone else…")).toBeNull();
});
