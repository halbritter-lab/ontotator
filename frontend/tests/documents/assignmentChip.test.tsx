/** A person on the text card (U3): name, state, assignment date, and ✕ with "Remove assignment?". */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../../src/api/client";
import { AssignmentChip } from "../../src/documents/textCard/AssignmentChip";
import { annotateItem } from "./cardFixtures";
import { tom } from "./tableFixtures";

const now = new Date("2026-10-21T12:00:00");
let removeAssignment: ReturnType<typeof spyRemove>;
const spyRemove = () => vi.spyOn(api, "removeAssignment");
beforeEach(() => { removeAssignment = spyRemove(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderChip(overrides: Parameters<typeof annotateItem>[0] = { assignment_id: 7 }, canRemove = true) {
  const onChanged = vi.fn();
  const item = annotateItem({ person: tom, assigned_at: "2026-10-21T08:30:00", ...overrides });
  render(<AssignmentChip item={item} caseId="case-200" canRemove={canRemove} onChanged={onChanged} now={now} />);
  return { onChanged };
}

it("shows name, state and assigned date", () => {
  renderChip();
  const chip = screen.getByText("Tom Reis").closest(".assignment-chip")!;
  expect(chip.textContent).toContain("not started");
  expect(within(chip as HTMLElement).getByText("assigned today 08:30").tagName).toBe("TIME");
  cleanup();
  renderChip({ assignment_id: 8, status: "in_progress" });
  expect(screen.getByText("Tom Reis").closest(".assignment-chip")!.textContent).toContain("in progress");
});

it("the ✕ asks first with the exact text", () => {
  renderChip();
  fireEvent.click(screen.getByRole("button", { name: "Remove Tom Reis" }));
  const dialog = screen.getByRole("dialog", { name: "Remove assignment?" });
  expect(within(dialog).getByText("Remove Tom Reis from the annotation of case-200? Their draft is discarded.")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Remove" })).toBeTruthy();
});

it("Cancel keeps the assignment", () => {
  const { onChanged } = renderChip();
  fireEvent.click(screen.getByRole("button", { name: "Remove Tom Reis" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(removeAssignment).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});

it("Remove calls removeAssignment and reloads", async () => {
  removeAssignment.mockResolvedValue({} as Awaited<ReturnType<typeof api.removeAssignment>>);
  const { onChanged } = renderChip();
  fireEvent.click(screen.getByRole("button", { name: "Remove Tom Reis" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(removeAssignment).toHaveBeenCalledWith(7);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows a refused remove inline and keeps the dialog", async () => {
  removeAssignment.mockRejectedValue(new ApiError(409, "This assignment has already been submitted.", "ASSIGNMENT_SUBMITTED"));
  const { onChanged } = renderChip();
  fireEvent.click(screen.getByRole("button", { name: "Remove Tom Reis" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("This assignment is submitted. A lead must reopen it before further changes.");
  expect(screen.getByRole("dialog", { name: "Remove assignment?" })).toBeTruthy();
  expect(onChanged).not.toHaveBeenCalled();
});

it("submitted chips have no ✕", () => {
  renderChip({ assignment_id: 9, status: "submitted" });
  expect(screen.getByText("Tom Reis").closest(".assignment-chip")!.textContent).toContain("submitted");
  expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  cleanup();
  renderChip({ assignment_id: 10 }, false);
  expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
});
