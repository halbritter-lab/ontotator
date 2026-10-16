import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { DocumentsPage } from "../src/admin/DocumentsPage";
import { assignment, deferred, documents, members } from "./assignmentFixtures";
beforeEach(() => {
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ languages: ["en", "de"] } as never);
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue(documents);
  vi.spyOn(api, "listAssignments").mockResolvedValue([assignment]);
  vi.spyOn(api, "listMembers").mockResolvedValue(members);
  vi.spyOn(api, "createAssignments").mockResolvedValue({ created: [assignment], refused: [] });
  vi.spyOn(api, "revokeAssignment").mockResolvedValue({ ...assignment, revoked_at: "2026-10-16T12:00:00Z" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("sends only visible selected documents to assignment tools and refreshes both inventories after success", async () => {
  render(<DocumentsPage projectKey="p/key" query={{ language: "en" }} onNavigate={vi.fn()} />);
  await screen.findByText("z/doc"); expect(screen.getByRole("button", { name: "Assign …" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByLabelText("Select z/doc")); fireEvent.click(screen.getByRole("button", { name: "Assign …" }));
  fireEvent.click(await screen.findByLabelText(/Alice \(alice\)/)); fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  await waitFor(() => expect(api.listProjectDocuments).toHaveBeenCalledTimes(2));
  expect(api.listAssignments).toHaveBeenCalledTimes(2);
  expect(api.createAssignments).toHaveBeenCalledWith("p/key", expect.objectContaining({ rows: [{ document_id: "z/doc", username: "alice" }] }));
  expect(api.listProjectDocuments).toHaveBeenLastCalledWith("p/key", { language: "en", status: undefined, q: undefined });
});
it("wires actual assignment IDs through a row's actions and refreshes after removal", async () => {
  vi.mocked(api.listProjectDocuments).mockResolvedValue([{ ...documents[0], assignees: [{ assignment_id: 3, username: "alice", pseudonym: "A", task: "annotate", status: "open" }] }]);
  render(<DocumentsPage projectKey="p/key" query={{}} onNavigate={vi.fn()} />);
  const row = await screen.findByTestId("document-row");
  fireEvent.click(await within(row).findByText("Assignment actions")); const remove = await within(row).findByRole("button", { name: "Remove assignment", hidden: true });
  fireEvent.click(remove); fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(api.listAssignments).toHaveBeenCalledTimes(2)); expect(api.revokeAssignment).toHaveBeenCalledWith(3);
});
it("closes an old selection dialog on route identity change and ignores its pending mutation", async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.createAssignments>>>(); vi.mocked(api.createAssignments).mockReturnValue(pending.promise);
  const view = render(<DocumentsPage projectKey="p/key" query={{ select: "z/doc" }} onNavigate={vi.fn()} />);
  await screen.findByText("z/doc"); fireEvent.click(screen.getByRole("button", { name: "Assign …" })); fireEvent.click(await screen.findByLabelText(/Alice \(alice\)/)); fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  view.rerender(<DocumentsPage projectKey="other" query={{}} onNavigate={vi.fn()} />); await screen.findByText("z/doc");
  await act(async () => { pending.resolve({ created: [assignment], refused: [] }); });
  expect(screen.queryByRole("dialog", { name: "Assign documents" })).toBeNull(); expect(api.listProjectDocuments).toHaveBeenCalledTimes(2);
});
