import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { api, type BatchAssignRequest, type BatchPreview, type DocumentRowView } from "../src/api/client";
import type { ProjectDocumentsQuery } from "../src/app/router";
import { DocumentsPage } from "../src/admin/DocumentsPage";
import { assignment, deferred, documents, members } from "./assignmentFixtures";
import { group, page, row, submissions, version, work } from "./documents/fixtures";

const zRow = (overrides: Partial<DocumentRowView> = {}) =>
  row({ case_id: "z/doc", language: "en", versions: [version({ document_id: "z/doc" })], ...overrides });

/** Batch preview for the selection: one annotation per case; Alice reads en. */
function batchPreview(body: BatchAssignRequest): BatchPreview {
  const usernames = body.usernames ?? [];
  const targets = body.case_ids.map(caseId => ({ case_id: caseId, language: body.language, document_id: caseId, version: 1, remaining: 1, usernames: usernames.slice(0, 1) }));
  return {
    task: body.task, language: body.language, versions: targets.length, targets, skipped: [], per_text: 1, digest: "digest-1",
    people: [{
      username: "alice", person: { pseudonym: "ann-0001", display_name: "Alice", is_me: false }, reads: ["en"], open_before: 0,
      open_after: usernames.includes("alice") ? targets.length : 0, gets: usernames.includes("alice") ? targets.length : 0,
      first_case: targets[0]?.case_id ?? null, last_case: targets.at(-1)?.case_id ?? null, language_mismatch: false, unavailable: null, already_assigned: 0,
    }],
  };
}

beforeEach(() => {
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ languages: ["en", "de"] } as never);
  // Two texts in z/doc: the selection bar shows from two selected texts on.
  vi.spyOn(api, "listDocumentRows").mockImplementation(async () => page([group("z/doc", [zRow(), zRow({ language: "de" })])]));
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language));
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue(documents);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([assignment]);
  vi.spyOn(api, "listMembers").mockResolvedValue(members);
  vi.spyOn(api, "revokeAssignment").mockResolvedValue({ ...assignment, revoked_at: "2026-10-16T12:00:00Z" });
  vi.spyOn(api, "selectionSummary").mockResolvedValue({ cases: 1, steps: [{ task: "annotate", language: "en", versions: 1, cases: 1 }], skipped: {}, common: { task: "annotate", language: "en", versions: 1, cases: 1 }, not_shown: 0 });
  vi.spyOn(api, "previewAssignmentBatch").mockImplementation(async (_key, body) => batchPreview(body));
  vi.spyOn(api, "commitAssignmentBatch").mockResolvedValue({ created: [{ ...assignment, username: "alice" }] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps the same focused ID input while a controlled parent applies every typed query", async () => {
  function ControlledDocuments() {
    const [query, setQuery] = useState<ProjectDocumentsQuery>({});
    return <DocumentsPage projectKey="p/key" canManage query={query} onNavigate={route => { if (route.name === "projectDocuments") setQuery(route); }} />;
  }
  const user = userEvent.setup(); render(<ControlledDocuments />);
  await screen.findByRole("button", { name: "Open text card, z/doc en" });
  const input = screen.getByLabelText("Case ID or text");
  await user.type(input, "abc");
  expect(screen.getByLabelText("Case ID or text")).toBe(input);
  expect(input).toHaveProperty("value", "abc");
  expect(document.activeElement).toBe(input);
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p/key", { q: "abc" }));
  expect(api.getProjectSettings).toHaveBeenCalledOnce(); expect(api.listAssignments).toHaveBeenCalledOnce(); expect(api.listMembers).toHaveBeenCalledOnce();
});

it("assigns the selected cases from the selection bar and refreshes rows and inventories after success", async () => {
  render(<DocumentsPage projectKey="p/key" canManage query={{ language: "en" }} onNavigate={vi.fn()} />);
  await screen.findByRole("button", { name: "Open text card, z/doc en" });
  expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select z/doc (2 texts)" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Selection" })).getByRole("button", { name: "Assign…" }));
  const dialog = await screen.findByRole("dialog", { name: "Assign 1 case" });
  expect(api.selectionSummary).toHaveBeenCalledWith("p/key", ["z/doc"], { language: "en" });
  fireEvent.click(await within(dialog).findByRole("radio", { name: /Alice/ }));
  const assign = within(dialog).getByRole("button", { name: "Assign 1" });
  await waitFor(() => expect(assign.getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(assign);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign 1 case" })).toBeNull());
  expect(api.commitAssignmentBatch).toHaveBeenCalledWith("p/key", expect.objectContaining({ task: "annotate", language: "en", case_ids: ["z/doc"], mode: "one", usernames: ["alice"], sort: "case", filters: { language: "en" } }));
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
  expect(api.listAssignments).toHaveBeenCalledTimes(2);
  expect(api.listDocumentRows).toHaveBeenLastCalledWith("p/key", { language: "en" });
  expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
});

it("wires actual assignment IDs through the card's stage actions and refreshes after removal", async () => {
  vi.mocked(api.listDocumentRows).mockImplementation(async () => page([group("z/doc", [zRow({ work: [work({ assignment_id: 3, document_id: "z/doc", author_label: "A" })] })])]));
  render(<DocumentsPage projectKey="p/key" canManage query={{ panel: "z/doc:en", panel_stage: "annotation" }} onNavigate={vi.fn()} />);
  // Open work is a chip with its actions beside it, not a second line in Text versions.
  const card = await screen.findByRole("dialog", { name: "z/doc en" });
  fireEvent.click(await within(card).findByText("Assignment actions"));
  fireEvent.click(await within(card).findByRole("button", { name: "Remove assignment", hidden: true }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(api.listAssignments).toHaveBeenCalledTimes(2)); expect(api.revokeAssignment).toHaveBeenCalledWith(3);
});

it("closes an open assign dialog on project change and ignores its pending mutation", async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.commitAssignmentBatch>>>(); vi.mocked(api.commitAssignmentBatch).mockReturnValue(pending.promise);
  const view = render(<DocumentsPage projectKey="p/key" canManage query={{}} onNavigate={vi.fn()} />);
  await screen.findByRole("button", { name: "Open text card, z/doc en" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select z/doc (2 texts)" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Selection" })).getByRole("button", { name: "Assign…" }));
  const dialog = await screen.findByRole("dialog", { name: "Assign 1 case" });
  fireEvent.click(await within(dialog).findByRole("radio", { name: /Alice/ }));
  const assign = within(dialog).getByRole("button", { name: "Assign 1" });
  await waitFor(() => expect(assign.getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(assign);
  view.rerender(<DocumentsPage projectKey="other" canManage query={{}} onNavigate={vi.fn()} />);
  await screen.findByRole("button", { name: "Open text card, z/doc en" });
  await act(async () => { pending.resolve({ created: [assignment] }); });
  expect(screen.queryByRole("dialog", { name: "Assign 1 case" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
});
