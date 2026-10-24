/** A person on the text card (U3, M1 card v3): name, state, assignment date; the lead's chip is a menu (Reassign, Remove, Assign another person). */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView } from "../../src/api/client";
import { AssignmentChip, type ChipMenu } from "../../src/documents/textCard/AssignmentChip";
import type { TextVersionsTools } from "../../src/documents/TextVersions";
import { annotateItem } from "./cardFixtures";
import { tom } from "./tableFixtures";

const now = new Date("2026-10-21T12:00:00");
let removeAssignment: ReturnType<typeof spyRemove>;
const spyRemove = () => vi.spyOn(api, "removeAssignment");
beforeEach(() => { removeAssignment = spyRemove(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const tools = (id: number): TextVersionsTools => ({
  username: "lead", members: [], variants: new Map(), requiredLanguages: () => [], onAssignmentsChanged: vi.fn(), onShowTranslationReviews: vi.fn(),
  assignments: [{ id, project_key: "p", document_id: "case-200-de", username: "tom", pseudonym: "ann-0004", task: "annotate", status: "in_progress", revoked_at: null, updated_at: "2026-10-21T08:30:00" } as AssignmentView],
});

function renderChip(overrides: Parameters<typeof annotateItem>[0] = { assignment_id: 7 }, menu: ChipMenu | null = {}) {
  const onChanged = vi.fn();
  const item = annotateItem({ person: tom, assigned_at: "2026-10-21T08:30:00", ...overrides });
  render(<AssignmentChip item={item} caseId="case-200" menu={menu ?? undefined} onChanged={onChanged} now={now} />);
  return { onChanged };
}
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /^Tom Reis, .*: actions$/ }));

it("shows name, state and assigned date", () => {
  renderChip(undefined, null);
  const chip = screen.getByText("Tom Reis").closest(".assignment-chip")!;
  expect(chip.textContent).toContain("not started");
  expect(within(chip as HTMLElement).getByText("assigned today 08:30").tagName).toBe("TIME");
  cleanup();
  renderChip({ assignment_id: 8, status: "in_progress" });
  expect(screen.getByText("Tom Reis").closest(".assignment-chip")!.textContent).toContain("in progress");
});

it("the chip is a menu button: Reassign, Remove and Assign another person, each with one line", () => {
  const another = vi.fn();
  renderChip(undefined, { tools: tools(7), mode: "proposals", onAssignAnother: another });
  const button = screen.getByRole("button", { name: "Tom Reis, not started: actions" });
  expect(button.getAttribute("aria-haspopup")).toBe("menu");
  openMenu();
  const menu = screen.getByRole("menu");
  const items = within(menu).getAllByRole("menuitem");
  expect(items.map(item => item.getAttribute("aria-label") ?? item.textContent)).toEqual(["Reassign to someone else…", "Remove (draft is discarded)", "Assign another person (Tom Reis keeps working)"]);
  expect(within(menu).getByText("They start fresh from proposals. Tom Reis can no longer continue; the draft stays in the history.")).toBeTruthy();
  expect(within(menu).getByText("Frees the slot.")).toBeTruthy();
  fireEvent.keyDown(menu, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(button);
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: /^Assign another person/ }));
  expect(another).toHaveBeenCalledTimes(1);
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Reassign to someone else…" }));
  expect(screen.getByRole("dialog", { name: "Reassign case-200-de" })).toBeTruthy();
});

it("Remove asks first with the exact text; Cancel keeps the assignment", () => {
  const { onChanged } = renderChip();
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove (draft is discarded)" }));
  const dialog = screen.getByRole("dialog", { name: "Remove assignment?" });
  expect(within(dialog).getByText("Remove Tom Reis from the annotation of case-200? Their draft is discarded.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(removeAssignment).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});

it("Remove calls removeAssignment and reloads", async () => {
  removeAssignment.mockResolvedValue({} as Awaited<ReturnType<typeof api.removeAssignment>>);
  const { onChanged } = renderChip();
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove (draft is discarded)" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(removeAssignment).toHaveBeenCalledWith(7);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows a refused remove inline and keeps the dialog", async () => {
  removeAssignment.mockRejectedValue(new ApiError(409, "This assignment has already been submitted.", "ASSIGNMENT_SUBMITTED"));
  const { onChanged } = renderChip();
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove (draft is discarded)" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("This assignment is submitted. A lead must reopen it before further changes.");
  expect(screen.getByRole("dialog", { name: "Remove assignment?" })).toBeTruthy();
  expect(onChanged).not.toHaveBeenCalled();
});

it("submitted chips only open the history; without a menu the chip is plain", () => {
  const onHistory = vi.fn();
  renderChip({ assignment_id: 9, status: "submitted" }, { onHistory });
  openMenu();
  expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Open history"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Open history" }));
  expect(onHistory).toHaveBeenCalledTimes(1);
  cleanup();
  renderChip({ assignment_id: 10 }, null);
  expect(screen.queryByRole("button")).toBeNull();
});
