import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { api, type DocumentRowView } from "../src/api/client";
import type { ProjectDocumentsQuery } from "../src/app/router";
import { DocumentsPage } from "../src/admin/DocumentsPage";
import { assignment, deferred, documents, members } from "./assignmentFixtures";
import { group, page, row, submissions, version, work } from "./documents/fixtures";

const zRow = (overrides: Partial<DocumentRowView> = {}) =>
  row({ case_id: "z/doc", language: "en", versions: [version({ document_id: "z/doc" })], ...overrides });

beforeEach(() => {
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ languages: ["en", "de"] } as never);
  vi.spyOn(api, "listDocumentRows").mockImplementation(async () => page([group("z/doc", [zRow()])]));
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language));
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue(documents);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([assignment]);
  vi.spyOn(api, "listMembers").mockResolvedValue(members);
  vi.spyOn(api, "createAssignments").mockResolvedValue({ created: [assignment], refused: [] });
  vi.spyOn(api, "revokeAssignment").mockResolvedValue({ ...assignment, revoked_at: "2026-10-16T12:00:00Z" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps the same focused ID input while a controlled parent applies every typed query", async () => {
  function ControlledDocuments() {
    const [query, setQuery] = useState<ProjectDocumentsQuery>({});
    return <DocumentsPage projectKey="p/key" canManage query={query} onNavigate={route => { if (route.name === "projectDocuments") setQuery(route); }} />;
  }
  const user = userEvent.setup(); render(<ControlledDocuments />);
  await screen.findByRole("link", { name: "Open z/doc · en" });
  const input = screen.getByLabelText("ID");
  await user.type(input, "abc");
  expect(screen.getByLabelText("ID")).toBe(input);
  expect(input).toHaveProperty("value", "abc");
  expect(document.activeElement).toBe(input);
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p/key", { q: "abc" }));
  expect(api.getProjectSettings).toHaveBeenCalledOnce(); expect(api.listAssignments).toHaveBeenCalledOnce(); expect(api.listMembers).toHaveBeenCalledOnce();
});

it("sends only the selected versions to assignment tools and refreshes rows and inventories after success", async () => {
  render(<DocumentsPage projectKey="p/key" canManage query={{ language: "en" }} onNavigate={vi.fn()} />);
  await screen.findByRole("link", { name: "Open z/doc · en" });
  expect(screen.getByRole("button", { name: "Assign …" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByLabelText("Select z/doc · en"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Assign …" }).getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Assign …" }));
  fireEvent.click(await screen.findByLabelText(/Alice \(alice\)/)); fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledTimes(2));
  expect(api.listAssignments).toHaveBeenCalledTimes(2);
  expect(api.createAssignments).toHaveBeenCalledWith("p/key", expect.objectContaining({ rows: [{ document_id: "z/doc", username: "alice" }] }));
  expect(api.listDocumentRows).toHaveBeenLastCalledWith("p/key", { language: "en" });
});

it("wires actual assignment IDs through the Text versions actions and refreshes after removal", async () => {
  vi.mocked(api.listDocumentRows).mockImplementation(async () => page([group("z/doc", [zRow({ work: [work({ assignment_id: 3, document_id: "z/doc", author_label: "A" })] })])]));
  render(<DocumentsPage projectKey="p/key" canManage query={{ open: ["z/doc:en"] }} onNavigate={vi.fn()} />);
  const versions = await screen.findByRole("list", { name: "Assignments on v1" });
  fireEvent.click(await within(versions).findByText("Assignment actions"));
  fireEvent.click(await within(versions).findByRole("button", { name: "Remove assignment", hidden: true }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(api.listAssignments).toHaveBeenCalledTimes(2)); expect(api.revokeAssignment).toHaveBeenCalledWith(3);
});

it.each(["project", "filter"] as const)("closes an old selection dialog on %s change and ignores its pending mutation", async change => {
  const pending = deferred<Awaited<ReturnType<typeof api.createAssignments>>>(); vi.mocked(api.createAssignments).mockReturnValue(pending.promise);
  const view = render(<DocumentsPage projectKey="p/key" canManage query={{ select: "z/doc" }} onNavigate={vi.fn()} />);
  await screen.findByRole("link", { name: "Open z/doc · en" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Assign …" }).getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Assign …" })); fireEvent.click(await screen.findByLabelText(/Alice \(alice\)/)); fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  view.rerender(<DocumentsPage projectKey={change === "project" ? "other" : "p/key"} canManage query={change === "filter" ? { q: "changed" } : {}} onNavigate={vi.fn()} />);
  await screen.findByRole("link", { name: "Open z/doc · en" });
  await act(async () => { pending.resolve({ created: [assignment], refused: [] }); });
  expect(screen.queryByRole("dialog", { name: "Assign documents" })).toBeNull(); expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
});
