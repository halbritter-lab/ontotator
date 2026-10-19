import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, type DocumentRowView, type ProjectSummary } from "../src/api/client";
import { testUser } from "./session";
import { assignment, documents, members } from "./assignmentFixtures";
import { settings } from "./projectFixtures";
import { group, page, row, submissions, version, work } from "./documents/fixtures";

const zRow = (overrides: Partial<DocumentRowView> = {}) =>
  row({ case_id: "z/doc", language: "en", position: 4, versions: [version({ document_id: "z/doc" })], ...overrides });
const aRow = row({ case_id: "a", language: "de", position: 9, versions: [version({ document_id: "a" })] });
const rowsPage = (z: DocumentRowView = zRow()) => page([group("z/doc", [z]), group("a", [aRow])]);

const project: ProjectSummary = { project_key: "p/key", name: "Research", description: null, roles: ["lead"], allowed_modes: ["independent"], document_count: 2, can_manage: true };
beforeEach(() => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/documents");
  vi.spyOn(api, "listProjects").mockResolvedValue([project]);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "listDocumentRows").mockResolvedValue(rowsPage());
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language));
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue(documents);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listMembers").mockResolvedValue(members);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/"); });

it("keeps the SAME focused ID input while actual App navigation controls every typed query", async () => {
  const user = userEvent.setup();
  render(<App user={testUser("lead", { is_system_admin: false })} />);
  await screen.findByRole("link", { name: "Open z/doc · en" });
  const input = screen.getByLabelText("ID");
  await user.type(input, "abc");
  await waitFor(() => expect(window.location.hash).toBe("#/projects/p%2Fkey/documents?q=abc"));
  expect(screen.getByLabelText("ID")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input).toHaveProperty("value", "abc");
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p/key", { q: "abc" }));
  expect(api.getProjectSettings).toHaveBeenCalledOnce();
  expect(api.listMembers).toHaveBeenCalledOnce();
  expect(api.listAssignments).toHaveBeenCalledOnce();
});

it("assigns only the selected document through real role-filtered controls and refreshes actual inventories", async () => {
  const assignedDocument = { ...documents[0], assignees: [{ assignment_id: 3, workflow_revision: 0, held: false, username: "alice", pseudonym: "A", task: "annotate" as const, status: "open" as const }] };
  vi.mocked(api.listProjectDocuments).mockResolvedValueOnce(documents).mockResolvedValue([assignedDocument, documents[1]]);
  vi.mocked(api.listAssignments).mockResolvedValueOnce([]).mockResolvedValue([assignment]);
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(rowsPage()).mockResolvedValue(rowsPage(zRow({ work: [work({ assignment_id: 3, document_id: "z/doc", author_label: "A" })] })));
  vi.spyOn(api, "createAssignments").mockResolvedValue({ created: [assignment], refused: [] });
  render(<App user={testUser("lead", { is_system_admin: false })} />);
  await screen.findByRole("link", { name: "Open z/doc · en" });
  fireEvent.click(screen.getByLabelText("Select z/doc · en"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Assign …" }).getAttribute("aria-disabled")).toBeNull());
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
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
  fireEvent.click(within(dialog.querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
  await screen.findByText("A annotating", { selector: ".documents-work span" });
  expect(screen.getAllByRole("link", { name: /^Open \S+ · \S+$/ }).map(link => link.getAttribute("aria-label") ?? link.textContent)).toEqual(["Open z/doc · en", "Open a · de"]);
  expect(window.location.hash).toBe("#/projects/p%2Fkey/documents");
});

it("reopens the submitted assignee from its real Text versions menu and reloads the assignment status", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/documents?open=z%2Fdoc%3Aen");
  const submitted = { ...assignment, status: "submitted" as const };
  const reopened = { ...assignment, status: "reopened" as const };
  const z = (status: "submitted" | "reopened") => zRow({ work: [work({ assignment_id: 3, document_id: "z/doc", author_label: "A", status })] });
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(rowsPage(z("submitted"))).mockResolvedValue(rowsPage(z("reopened")));
  vi.mocked(api.listAssignments).mockResolvedValueOnce([submitted]).mockResolvedValue([reopened]);
  vi.spyOn(api, "reopenAssignment").mockResolvedValue(reopened);
  const user = userEvent.setup(); render(<App user={testUser("lead", { is_system_admin: false })} />);
  const versions = await screen.findByRole("list", { name: "Assignments on v1" });
  await user.click(await within(versions).findByText("Assignment actions"));
  await user.click(await within(versions).findByRole("button", { name: "Reopen", hidden: true }));
  const dialog = await screen.findByRole("dialog", { name: "Reopen z/doc" });
  fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "Recheck evidence" } });
  await user.click(within(dialog).getByRole("button", { name: "Reopen assignment" }));
  await screen.findByText("Reopened", { selector: ".documents-work span" });
  expect(api.reopenAssignment).toHaveBeenCalledWith(3, "Recheck evidence");
  expect(api.listAssignments).toHaveBeenCalledTimes(2);
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog", { name: "Reopen z/doc" })).toBeNull();
});
