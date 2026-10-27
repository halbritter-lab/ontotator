import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, ApiError, type JobView, type ProjectProgress, type ProjectSummary } from "../src/api/client";
import * as downloads from "../src/api/download";
import { testUser } from "./session";
import { settings } from "./projectFixtures";
import { group, page, row, version } from "./documents/fixtures";

const user = testUser("lead", { username: "real-lead", is_system_admin: false });
const project: ProjectSummary = { project_key: "p/key", name: "Research", description: null, roles: ["lead"], allowed_modes: ["independent"], document_count: 1, can_manage: true };
const document = { document_id: "ID +/#ß", language: "de", position: null, assignees: [] };
const progress: ProjectProgress = {
  totals: { documents: 1, unassigned: 1, open: 0, in_progress: 0, submitted: 0, reopened: 0 }, people: [], documents: [document],
  lede: { cases: 1, translations_to_review: 3, versions_to_annotate: 1, not_in_plan: 0, needs_decision: 0, to_assign: 3 },
  stages: {
    translation_review: { scope: "review", done: 0, total: 3, counts: { to_assign: 3, in_review: 0, check_failed: 0, check_failed_with_reviewer: 0, rejected_or_queried: 0, accepted: 0 }, links: { to_assign: { plan: ["review", "review_and_annotate"], step: ["assign_translation_review"] } } },
    annotation: { scope: "annotate", done: 0, total: 1, counts: { waiting_for_review: 1, to_assign: 0, in_progress: 0, paused: 0, submitted: 0 } },
    final: { scope: "annotate", done: 0, total: 1, counts: { not_ready: 1, to_choose: 0, to_confirm: 0, final: 0, would_be_omitted: 1 } },
  },
  workload: [],
};
const job = (id: number): JobView => ({ id, kind: "t1_export", status: "succeeded", result: { path: "never-use-server-path" }, error: null, created_at: "2026-10-16T10:00:00Z", finished_at: "2026-10-16T10:01:00Z" });
const storageKey = (username: string, key = "p/key") => `ontotator:export:${JSON.stringify([username, key, "t1"])}`;
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(api, "listProjects").mockResolvedValue([project]);
  vi.spyOn(api, "getProgress").mockResolvedValue(progress);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ project: "p/key", selections: [], warnings: [], omissions: [], state_digest: "0".repeat(64) });
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue([{ ...document, status: "not_started", text_length: 4 }] as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); window.history.replaceState(null, "", "#/"); });

it("follows a Progress stage count to filtered Documents through App", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/progress");
  vi.spyOn(api, "listDocumentRows").mockResolvedValue(page([group("case-1", [row({ case_id: "case-1", language: "de", versions: [version({ document_id: "ID +/#ß" })] })])]));
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  render(<App user={user} />);
  const card = await screen.findByRole("region", { name: "Translation review" });
  expect(api.getProgress).toHaveBeenCalledWith("p/key");
  const link = within(card).getByRole("link", { name: "To assign: 3" });
  expect(link.getAttribute("href")).toBe("#/projects/p%2Fkey/documents?step=assign_translation_review&plan=review,review_and_annotate");
  fireEvent.click(link);
  await screen.findByRole("heading", { name: "Documents" });
  expect(window.location.hash).toBe(link.getAttribute("href"));
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenCalledWith("p/key", expect.objectContaining({ step: "assign_translation_review" })));
  expect(screen.getByRole("link", { name: "Documents" }).getAttribute("aria-current")).toBe("page");
});

it("passes the actual session user to Export and keeps authorized downloads binary", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/export");
  sessionStorage.setItem(storageKey("someone-else"), "90");
  sessionStorage.setItem(storageKey(user.username, "other-project"), "91");
  sessionStorage.setItem(storageKey(user.username), "11");
  vi.spyOn(api, "getJob").mockImplementation(async id => job(id));
  // The navigation counter has its own endpoint; the fetch stub below serves only the download.
  vi.spyOn(api, "documentsSummary").mockResolvedValue({ needs_decision: 0 });
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
  expect(screen.queryByRole("list", { name: "Pipeline" })).toBeNull();
});

it("uses the real Export create request and displays its server denial", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/export");
  vi.spyOn(api, "startExport").mockRejectedValue(new ApiError(403, "private", "NOT_ALLOWED"));
  render(<App user={user} />);
  const card = await screen.findByRole("row", { name: "Annotation results" });
  fireEvent.click(within(card).getByRole("button", { name: "Create" }));
  await screen.findByText("You do not have access to this page.");
  expect(api.startExport).toHaveBeenCalledWith("p/key", "t1");
  expect(api.finalExportPreflight).toHaveBeenCalledWith("p/key");
  expect(sessionStorage.getItem(storageKey(user.username))).toBeNull();
});
