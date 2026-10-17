import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, type ProjectSummary } from "../src/api/client";
import { testUser } from "./session";
import { assignment, documents, members } from "./assignmentFixtures";
import { settings } from "./projectFixtures";

const project: ProjectSummary = { project_key: "p/key", name: "Research", description: null, roles: ["lead"], allowed_modes: ["independent"], document_count: 2, can_manage: true };
beforeEach(() => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/documents");
  vi.spyOn(api, "listProjects").mockResolvedValue([project]);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue(documents);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listMembers").mockResolvedValue(members);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/"); });

it("keeps the SAME focused prefix input while actual App navigation controls every typed query", async () => {
  const user = userEvent.setup();
  render(<App user={testUser("lead", { is_system_admin: false })} />);
  await screen.findByRole("link", { name: "View case for z/doc" });
  const input = screen.getByLabelText("ID prefix");
  await user.type(input, "abc");
  await waitFor(() => expect(window.location.hash).toBe("#/projects/p%2Fkey/documents?q=abc"));
  expect(screen.getByLabelText("ID prefix")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input).toHaveProperty("value", "abc");
  expect(api.listProjectDocuments).toHaveBeenLastCalledWith("p/key", { language: undefined, status: undefined, q: "abc" });
  expect(api.getProjectSettings).toHaveBeenCalledOnce();
  expect(api.listMembers).toHaveBeenCalledOnce();
  expect(api.listAssignments).toHaveBeenCalledOnce();
});

it("assigns only the selected document through real role-filtered controls and refreshes actual inventories", async () => {
  const assignedDocument = { ...documents[0], assignees: [{ assignment_id: 3, username: "alice", pseudonym: "A", task: "annotate" as const, status: "open" as const }] };
  vi.mocked(api.listProjectDocuments).mockResolvedValueOnce(documents).mockResolvedValue([assignedDocument, documents[1]]);
  vi.mocked(api.listAssignments).mockResolvedValueOnce([]).mockResolvedValue([assignment]);
  vi.spyOn(api, "createAssignments").mockResolvedValue({ created: [assignment], refused: [] });
  render(<App user={testUser("lead", { is_system_admin: false })} />);
  await screen.findByRole("link", { name: "View case for z/doc" });
  fireEvent.click(screen.getByLabelText("Select z/doc"));
  fireEvent.click(screen.getByRole("button", { name: "Assign …" }));
  const dialog = await screen.findByRole("dialog", { name: "Assign documents" });
  await within(dialog).findByLabelText(/Alice \(alice\)/);
  expect(within(dialog).queryByLabelText(/Lead \(lead\)/)).toBeNull();
  fireEvent.change(within(dialog).getByLabelText("Task"), { target: { value: "review" } });
  expect(within(dialog).queryByLabelText(/Alice \(alice\)/)).toBeNull();
  expect(within(dialog).getByLabelText(/Bob \(bob\)/)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Task"), { target: { value: "annotate" } });
  fireEvent.click(within(dialog).getByLabelText(/Alice \(alice\)/));
  fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
  await waitFor(() => expect(api.listProjectDocuments).toHaveBeenCalledTimes(2));
  expect(api.createAssignments).toHaveBeenCalledWith("p/key", { task: "annotate", confirm_language: false, rows: [{ document_id: "z/doc", username: "alice" }] });
  expect(api.listAssignments).toHaveBeenCalledTimes(2);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await screen.findByText("Open", { selector: ".assignee .status-pill" });
  expect(screen.getAllByTestId("document-row").map(row => within(row).getAllByRole("cell")[1].textContent)).toEqual(["z/doc", "a"]);
  expect(window.location.hash).toBe("#/projects/p%2Fkey/documents");
});

it("reopens the submitted assignee from its real row menu and reloads the assignment status", async () => {
  const submitted = { ...assignment, status: "submitted" as const };
  const reopened = { ...assignment, status: "reopened" as const };
  const doc = (status: "submitted" | "reopened") => ({ ...documents[0], assignees: [{ assignment_id: 3, username: "alice", pseudonym: "A", task: "annotate" as const, status }] });
  vi.mocked(api.listProjectDocuments).mockResolvedValueOnce([doc("submitted")]).mockResolvedValue([doc("reopened")]);
  vi.mocked(api.listAssignments).mockResolvedValueOnce([submitted]).mockResolvedValue([reopened]);
  vi.spyOn(api, "reopenAssignment").mockResolvedValue(reopened);
  const user = userEvent.setup(); render(<App user={testUser("lead", { is_system_admin: false })} />);
  const row = await screen.findByTestId("document-row");
  await user.click(await within(row).findByText("Assignment actions"));
  await user.click(within(row).getByRole("button", { name: "Reopen" }));
  const dialog = await screen.findByRole("dialog", { name: "Reopen z/doc" });
  fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "Recheck evidence" } });
  await user.click(within(dialog).getByRole("button", { name: "Reopen assignment" }));
  await screen.findByText("Reopened", { selector: ".assignee .status-pill" });
  expect(api.reopenAssignment).toHaveBeenCalledWith(3, "Recheck evidence");
  expect(api.listAssignments).toHaveBeenCalledTimes(2);
  expect(api.listProjectDocuments).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog", { name: "Reopen z/doc" })).toBeNull();
});
