import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, ApiError, type JobView, type ProjectProgress, type ProjectSummary } from "../src/api/client";
import * as downloads from "../src/api/download";
import { testUser } from "./session";
import { settings } from "./projectFixtures";

const user = testUser("lead", { username: "real-lead", is_system_admin: false });
const project: ProjectSummary = { project_key: "p/key", name: "Research", description: null, roles: ["lead"], allowed_modes: ["independent"], document_count: 1, can_manage: true };
const document = { document_id: "ID +/#ß", language: "de", position: null, assignees: [] };
const progress: ProjectProgress = { totals: { documents: 1, unassigned: 1, open: 0, in_progress: 0, submitted: 0, reopened: 0 }, people: [], documents: [document] };
const job = (id: number): JobView => ({ id, kind: "t1_export", status: "succeeded", result: { path: "never-use-server-path" }, error: null, created_at: "2026-10-16T10:00:00Z", finished_at: "2026-10-16T10:01:00Z" });
const storageKey = (username: string, key = "p/key") => `ontocurator:export:${JSON.stringify([username, key, "t1"])}`;
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(api, "listProjects").mockResolvedValue([project]);
  vi.spyOn(api, "getProgress").mockResolvedValue(progress);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue([{ ...document, status: "not_started", text_length: 4 }] as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); window.history.replaceState(null, "", "#/"); });

it("follows the real Progress Assign link to an encoded document selection through App", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/progress");
  render(<App user={user} />);
  const table = await screen.findByRole("table", { name: "Progress documents" });
  expect(api.getProgress).toHaveBeenCalledWith("p/key");
  const assign = within(table).getByRole("link", { name: "Assign" });
  expect(assign.getAttribute("href")).toBe("#/projects/p%2Fkey/documents?select=ID+%2B%2F%23%C3%9F");
  fireEvent.click(assign);
  await screen.findByRole("heading", { name: "Documents" });
  await waitFor(() => expect(screen.getByLabelText("Select ID +/#ß")).toHaveProperty("checked", true));
  expect(window.location.hash).toBe(assign.getAttribute("href"));
  expect(api.listProjectDocuments).toHaveBeenCalledWith("p/key", { language: undefined, status: undefined, q: undefined });
  expect(screen.getByRole("link", { name: "Documents" }).getAttribute("aria-current")).toBe("page");
});

it("passes the actual session user to Export and keeps authorized downloads binary", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/export");
  sessionStorage.setItem(storageKey("someone-else"), "90");
  sessionStorage.setItem(storageKey(user.username, "other-project"), "91");
  sessionStorage.setItem(storageKey(user.username), "11");
  vi.spyOn(api, "getJob").mockImplementation(async id => job(id));
  const save = vi.spyOn(downloads, "saveDownload").mockImplementation(() => {});
  const blob = new Blob([new Uint8Array([0, 255, 7])], { type: "application/zip" });
  const json = vi.fn();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ "Content-Disposition": 'attachment; filename="results.zip"' }), blob: async () => blob, json });
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(<App user={user} />);
  fireEvent.click(await screen.findByRole("button", { name: "Download" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ blob, filename: "results.zip" }, "p/key-t1.zip"));
  expect(api.getJob).toHaveBeenCalledOnce();
  expect(api.getJob).toHaveBeenCalledWith(11);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/jobs/11/download", expect.objectContaining({ method: "GET", credentials: "same-origin" }));
  expect(json).not.toHaveBeenCalled();
  rerender(<App user={{ ...user, username: "new-session-user" }} />);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Download" })).toBeNull());
  expect(api.getJob).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(storageKey(user.username))).toBe("11");
});

it.each([403, 404])("shows actual Progress access denial from its server (%s)", async status => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/progress");
  vi.mocked(api.getProgress).mockRejectedValue(new ApiError(status, "private", "NOT_ALLOWED"));
  render(<App user={user} />);
  await screen.findByText("You do not have access to this page.");
  expect(screen.queryByRole("link", { name: "Assign" })).toBeNull();
});

it("uses the real Export create request and displays its server denial", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/export");
  vi.spyOn(api, "startExport").mockRejectedValue(new ApiError(403, "private", "NOT_ALLOWED"));
  render(<App user={user} />);
  const card = await screen.findByRole("region", { name: "Annotation results" });
  fireEvent.click(within(card).getByRole("button", { name: "Create export" }));
  await screen.findByText("You do not have access to this page.");
  expect(api.startExport).toHaveBeenCalledWith("p/key", "t1");
  expect(sessionStorage.getItem(storageKey(user.username))).toBeNull();
});
