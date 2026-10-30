import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, type BatchAssignRequest, type BatchPreview, type DocumentRowView, type ProjectSummary } from "../src/api/client";
import { testUser } from "./session";
import { assignment, documents, members } from "./assignmentFixtures";
import { settings } from "./projectFixtures";
import { group, page, row, submissions, version, work } from "./documents/fixtures";

const zRow = (overrides: Partial<DocumentRowView> = {}) =>
  row({ case_id: "z/doc", language: "en", position: 4, versions: [version({ document_id: "z/doc" })], ...overrides });
const aRow = row({ case_id: "a", language: "de", position: 9, versions: [version({ document_id: "a" })] });
// z/doc has two texts: the selection bar shows from two selected texts on.
const rowsPage = (z: DocumentRowView = zRow()) => page([group("z/doc", [z, zRow({ language: "de" })]), group("a", [aRow])]);

/** Batch preview for the selection: one annotation per case; Alice reads en. */
function batchPreview(body: BatchAssignRequest): BatchPreview {
  const usernames = body.usernames ?? [];
  const targets = body.case_ids.map(caseId => ({ case_id: caseId, language: body.language, document_id: caseId, version: 1, remaining: 1, usernames: usernames.slice(0, 1) }));
  const gets = usernames.includes("alice") ? targets.length : 0;
  return {
    task: body.task, language: body.language, versions: targets.length, targets, skipped: [], per_text: 1, digest: "digest-1",
    people: [{ username: "alice", person: { pseudonym: "ann-0001", display_name: "Alice", is_me: false }, reads: ["en"], open_before: 0, open_after: gets, gets,
      first_case: targets[0]?.case_id ?? null, last_case: targets.at(-1)?.case_id ?? null, language_mismatch: false, unavailable: null, already_assigned: 0, system_admin: false }],
  };
}

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
  await screen.findByRole("button", { name: "Text z/doc en" });
  const input = screen.getByLabelText("Search by case ID");
  await user.type(input, "abc");
  await waitFor(() => expect(window.location.hash).toBe("#/projects/p%2Fkey/documents?q=abc"));
  expect(screen.getByLabelText("Search by case ID")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input).toHaveProperty("value", "abc");
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p/key", { q: "abc" }));
  expect(api.getProjectSettings).toHaveBeenCalledOnce();
  expect(api.listMembers).toHaveBeenCalledOnce();
  expect(api.listAssignments).toHaveBeenCalledOnce();
});

it("assigns the selected case through the selection bar and refreshes actual inventories", async () => {
  vi.mocked(api.listAssignments).mockResolvedValueOnce([]).mockResolvedValue([assignment]);
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(rowsPage()).mockResolvedValue(rowsPage(zRow({ work: [work({ assignment_id: 3, document_id: "z/doc", author_label: "A" })] })));
  vi.spyOn(api, "selectionSummary").mockResolvedValue({ cases: 1, steps: [{ task: "annotate", language: "en", versions: 1, cases: 1 }], skipped: {}, common: { task: "annotate", language: "en", versions: 1, cases: 1 }, not_shown: 0 });
  vi.spyOn(api, "previewAssignmentBatch").mockImplementation(async (_key, body) => batchPreview(body));
  vi.spyOn(api, "commitAssignmentBatch").mockResolvedValue({ created: [{ ...assignment, username: "alice" }] });
  render(<App user={testUser("lead", { is_system_admin: false })} />);
  await screen.findByRole("button", { name: "Text z/doc en" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select z/doc en" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select z/doc de" }));
  const bar = screen.getByRole("region", { name: "Selection" });
  expect(within(bar).getByText("2 texts in 1 case selected")).toBeTruthy();
  fireEvent.click(within(bar).getByRole("button", { name: "Assign…" }));
  const dialog = await screen.findByRole("dialog", { name: "Assign 1 case" });
  fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Alice/ }));
  const assign = within(dialog).getByRole("button", { name: "Assign 1" });
  await waitFor(() => expect(assign.getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(assign);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign 1 case" })).toBeNull());
  expect(api.commitAssignmentBatch).toHaveBeenCalledWith("p/key", expect.objectContaining({ task: "annotate", language: "en", case_ids: ["z/doc"], mode: "each", usernames: ["alice"] }));
  await waitFor(() => expect(api.listAssignments).toHaveBeenCalledTimes(2));
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  expect(screen.getAllByRole("button", { name: /^Text / }).map(button => button.getAttribute("aria-label"))).toEqual(["Text z/doc en", "Text z/doc de", "Text a de"]);
  expect(window.location.hash).toBe("#/projects/p%2Fkey/documents");
});

it("reopens the submitted assignee from their person row in the card and reloads the assignment status", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/documents?panel=z%2Fdoc%3Aen&panel_stage=annotation");
  const submitted = { ...assignment, status: "submitted" as const };
  const reopened = { ...assignment, status: "reopened" as const };
  const z = (status: "submitted" | "reopened") => zRow({ work: [work({ assignment_id: 3, document_id: "z/doc", author_label: "A", status })] });
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(rowsPage(z("submitted"))).mockResolvedValue(rowsPage(z("reopened")));
  vi.mocked(api.listAssignments).mockResolvedValueOnce([submitted]).mockResolvedValue([reopened]);
  vi.spyOn(api, "reopenAssignment").mockResolvedValue(reopened);
  const user = userEvent.setup(); render(<App user={testUser("lead", { is_system_admin: false })} />);
  // The submitted annotation's actions live in its row of the Annotation part (#108).
  const people = await screen.findByRole("list", { name: "Annotators" });
  await user.click(await within(people).findByRole("button", { name: "Reopen A’s annotation" }));
  const dialog = await screen.findByRole("dialog", { name: "Reopen z/doc" });
  fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "Recheck evidence" } });
  await user.click(within(dialog).getByRole("button", { name: "Reopen assignment" }));
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
  expect(api.reopenAssignment).toHaveBeenCalledWith(3, "Recheck evidence");
  expect(api.listAssignments).toHaveBeenCalledTimes(2);
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog", { name: "Reopen z/doc" })).toBeNull();
});
