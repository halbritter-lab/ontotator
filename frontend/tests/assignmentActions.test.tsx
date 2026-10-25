import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { AssignmentActions } from "../src/admin/AssignmentActions";
import { assignment, deferred, members } from "./assignmentFixtures";
beforeEach(() => { vi.spyOn(api, "reassign").mockResolvedValue(assignment); vi.spyOn(api, "reopenAssignment").mockResolvedValue(assignment); vi.spyOn(api, "revokeAssignment").mockResolvedValue(assignment); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("asks before reassigning started work then separately confirms language with both flags", async () => {
  vi.mocked(api.reassign).mockRejectedValueOnce(new ApiError(422, "language", "LANGUAGE_CONFIRMATION_REQUIRED")).mockResolvedValueOnce(assignment);
  const changed = vi.fn(); render(<AssignmentActions assignment={{ ...assignment, status: "in_progress" }} members={members} onChanged={changed} />);
  fireEvent.click(screen.getByText("Assignment actions")); fireEvent.click(screen.getByRole("button", { name: "Reassign …" })); fireEvent.change(screen.getByLabelText("New assignee"), { target: { value: "bob" } }); fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
  expect(api.reassign).not.toHaveBeenCalled(); expect(screen.getByText(/Work has started. The previous draft stays/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Reassign started work" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reassign anyway" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(api.reassign).toHaveBeenNthCalledWith(1, 3, { username: "bob", confirm_started: true, confirm_language: false, confirm_unreviewed_translation: false });
  expect(api.reassign).toHaveBeenNthCalledWith(2, 3, { username: "bob", confirm_started: true, confirm_language: true, confirm_unreviewed_translation: false });
});
it("reassign asks before annotating an unreviewed translation", async () => {
  vi.mocked(api.reassign).mockRejectedValueOnce(new ApiError(422, "language", "LANGUAGE_CONFIRMATION_REQUIRED")).mockRejectedValueOnce(new ApiError(409, "unreviewed", "TRANSLATION_NOT_REVIEWED")).mockResolvedValueOnce(assignment);
  const changed = vi.fn(); render(<AssignmentActions assignment={assignment} members={members} onChanged={changed} />);
  fireEvent.click(screen.getByText("Assignment actions")); fireEvent.click(screen.getByRole("button", { name: "Reassign …" })); fireEvent.change(screen.getByLabelText("New assignee"), { target: { value: "bob" } }); fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reassign anyway" }));
  expect(await screen.findByText("Translation not reviewed yet.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Annotate before the review is accepted" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(api.reassign).toHaveBeenNthCalledWith(3, 3, { username: "bob", confirm_started: false, confirm_language: true, confirm_unreviewed_translation: true });
});
it("offers reopen only for submitted work and sends its optional reason", async () => {
  const view = render(<AssignmentActions assignment={assignment} members={members} onChanged={vi.fn()} />); expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  view.rerender(<AssignmentActions assignment={{ ...assignment, status: "submitted" }} members={members} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByText("Assignment actions")); fireEvent.click(screen.getByRole("button", { name: "Reopen" })); fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Correction" } }); fireEvent.click(screen.getByRole("button", { name: "Reopen assignment" }));
  await waitFor(() => expect(api.reopenAssignment).toHaveBeenCalledWith(3, "Correction"));
});
it("requires confirmation for removal, supports cancelling and shows actual server refusals", async () => {
  vi.mocked(api.revokeAssignment).mockRejectedValue(new ApiError(403, "refused", "NOT_ALLOWED")); render(<AssignmentActions assignment={assignment} members={members} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByText("Assignment actions")); fireEvent.click(screen.getByRole("button", { name: "Remove assignment" })); expect(api.revokeAssignment).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(api.revokeAssignment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove assignment" })); fireEvent.click(screen.getByRole("button", { name: "Confirm removal" })); expect(await screen.findByRole("alert")).toBeDefined();
});
it("blocks duplicate mutations and ignores completion for a replaced assignment identity", async () => {
  const pending = deferred<typeof assignment>(); vi.mocked(api.reopenAssignment).mockReturnValue(pending.promise); const changed = vi.fn();
  const view = render(<AssignmentActions assignment={{ ...assignment, status: "submitted" }} members={members} onChanged={changed} />); fireEvent.click(screen.getByText("Assignment actions")); fireEvent.click(screen.getByRole("button", { name: "Reopen" })); const button = screen.getByRole("button", { name: "Reopen assignment" }); fireEvent.click(button); fireEvent.click(button); expect(api.reopenAssignment).toHaveBeenCalledOnce();
  view.rerender(<AssignmentActions assignment={{ ...assignment, id: 4 }} members={members} onChanged={changed} />); await act(async () => { pending.resolve(assignment); }); expect(changed).not.toHaveBeenCalled();
});
it("lists other members in the identity format with open tasks", () => {
  render(<AssignmentActions assignment={assignment} members={members.map(member => ({ ...member, open_tasks: { translation_review: 0, annotate: 1, review: 0 } }))} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByText("Assignment actions")); fireEvent.click(screen.getByRole("button", { name: "Reassign …" }));
  expect(screen.getByRole("option", { name: "Bob (B) — en, de, 1 open task" })).toBeDefined();
});
it("offers no reassign for a consolidation task", () => {
  render(<><AssignmentActions assignment={{ ...assignment, task: "review" }} members={members} onChanged={vi.fn()} directReassign /><AssignmentActions assignment={{ ...assignment, id: 4, task: "review" }} members={members} onChanged={vi.fn()} /></>);
  expect(screen.queryByRole("button", { name: /^Reassign/ })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Remove assignment", hidden: true })).toHaveLength(2);
});
