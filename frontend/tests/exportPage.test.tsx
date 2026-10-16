import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, type CurrentUser, type JobView } from "../src/api/client";
import * as downloads from "../src/api/download";
import { ExportPage } from "../src/admin/ExportPage";
const user: CurrentUser = { username: "lead", display_name: "Lead", pseudonym: "L", csrf_token: "csrf", is_system_admin: false };
const job = (id: number, kind = "t1_export", status: JobView["status"] = "succeeded"): JobView => ({ id, kind, status, result: { path: "never-use-this-path" }, error: status === "failed" ? "EXPORT_FAILED: source missing" : null, created_at: "2026-10-16T10:00:00Z", finished_at: "2026-10-16T10:01:00Z" });
const storageKey = (username = "lead", project = "p", kind = "t1") => `ontocurator:export:${JSON.stringify([username, project, kind])}`;
const card = (title = "Annotation results (T1 bundle)") => within(screen.getByRole("region", { name: title }));
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(api, "startExport").mockImplementation(async (_key, kind) => ({ job_id: kind === "t1" ? 11 : 22 }));
  vi.spyOn(api, "getJob").mockImplementation(async id => job(id, id === 22 ? "edit_log_export" : "t1_export"));
  vi.spyOn(api, "downloadJob").mockResolvedValue({ blob: new Blob(["result"]), filename: "actual-server.zip" });
  vi.spyOn(downloads, "saveDownload").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
it("starts actual export kinds, remembers namespaced IDs and downloads freshly authorized binary payloads", async () => {
  render(<ExportPage projectKey="p" currentUser={user} />);
  fireEvent.click(card().getByRole("button", { name: "Create export" }));
  fireEvent.click(await card().findByRole("button", { name: "Download" }));
  await waitFor(() => expect(downloads.saveDownload).toHaveBeenCalledWith(expect.objectContaining({ filename: "actual-server.zip" }), expect.stringMatching(/\.zip$/)));
  expect(api.startExport).toHaveBeenCalledWith("p", "t1"); expect(api.downloadJob).toHaveBeenCalledWith(11);
  expect(sessionStorage.getItem(storageKey())).toBe("11");
  fireEvent.click(card("Edit log (JSONL)").getByRole("button", { name: "Create export" }));
  await card("Edit log (JSONL)").findByRole("button", { name: "Download" });
  expect(api.startExport).toHaveBeenCalledWith("p", "edit_log"); expect(sessionStorage.getItem(storageKey("lead", "p", "edit_log"))).toBe("22");
});
it("restores a persisted job without starting a new export and surfaces failed terminal data", async () => {
  sessionStorage.setItem(storageKey(), "11"); vi.mocked(api.getJob).mockResolvedValue(job(11, "t1_export", "failed"));
  render(<ExportPage projectKey="p" currentUser={user} />);
  await screen.findByText("EXPORT_FAILED: source missing"); expect(api.startExport).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
});
it.each(["0", "-1", "NaN", "1e3", "1.5", "9007199254740992", "" ])("does not restore invalid stored job ID %s", value => {
  sessionStorage.setItem(storageKey(), value); render(<ExportPage projectKey="p" currentUser={user} />); expect(api.getJob).not.toHaveBeenCalled();
});
it.each([403, 404])("clears refused remembered jobs on HTTP %s and stops polling", async status => {
  sessionStorage.setItem(storageKey(), "11");
  vi.mocked(api.getJob).mockRejectedValue(status === 403 ? new AuthError("Forbidden") : new ApiError(404, "Job not found"));
  render(<ExportPage projectKey="p" currentUser={user} />);
  await screen.findByText(status === 403 ? "You do not have access to this page." : "Job not found");
  expect(sessionStorage.getItem(storageKey())).toBeNull(); expect(api.getJob).toHaveBeenCalledOnce();
});
it("shows current refusal at creation and at download without saving a stale file", async () => {
  vi.mocked(api.startExport).mockRejectedValueOnce(new AuthError("Forbidden"));
  render(<ExportPage projectKey="p" currentUser={user} />);
  fireEvent.click(card().getByRole("button", { name: "Create export" })); await screen.findByText("You do not have access to this page.");
  fireEvent.click(card().getByRole("button", { name: "Create export" })); await card().findByRole("button", { name: "Download" });
  vi.mocked(api.downloadJob).mockRejectedValueOnce(new AuthError("Revoked"));
  fireEvent.click(card().getByRole("button", { name: "Download" })); await screen.findByText("You do not have access to this page.");
  expect(downloads.saveDownload).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey())).toBeNull();
});
it("isolates remembered jobs across users, projects and kind, rejecting stale create replies", async () => {
  let resolve!: (value: { job_id: number }) => void;
  vi.mocked(api.startExport).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const { rerender } = render(<ExportPage projectKey="old" currentUser={user} />);
  fireEvent.click(card().getByRole("button", { name: "Create export" }));
  rerender(<ExportPage projectKey="new" currentUser={{ ...user, username: "other" }} />);
  await act(async () => { resolve({ job_id: 11 }); });
  expect(api.getJob).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey("lead", "old"))).toBeNull();
  sessionStorage.setItem(storageKey("lead", "old"), "11");
  rerender(<ExportPage projectKey="old" currentUser={user} />); await card().findByRole("button", { name: "Download" });
  expect(api.getJob).toHaveBeenCalledWith(11); expect(card("Edit log (JSONL)").queryByRole("button", { name: "Download" })).toBeNull();
});
it("blocks duplicate creates/downloads and ignores binary replies after unmount", async () => {
  let resolveCreate!: (value: { job_id: number }) => void;
  vi.mocked(api.startExport).mockImplementationOnce(() => new Promise(r => { resolveCreate = r; }));
  const { unmount } = render(<ExportPage projectKey="p" currentUser={user} />);
  const create = card().getByRole("button", { name: "Create export" }); fireEvent.click(create); fireEvent.click(create); expect(api.startExport).toHaveBeenCalledOnce();
  await act(async () => { resolveCreate({ job_id: 11 }); });
  let resolveDownload!: (value: downloads.DownloadPayload) => void;
  vi.mocked(api.downloadJob).mockImplementationOnce(() => new Promise(r => { resolveDownload = r; }));
  const download = await card().findByRole("button", { name: "Download" }); fireEvent.click(download); fireEvent.click(download); expect(api.downloadJob).toHaveBeenCalledOnce();
  unmount(); await act(async () => { resolveDownload({ blob: new Blob(["result"]), filename: "old.zip" }); }); expect(downloads.saveDownload).not.toHaveBeenCalled();
});
it("works when sessionStorage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  render(<ExportPage projectKey="p" currentUser={user} />);
  fireEvent.click(card().getByRole("button", { name: "Create export" })); await card().findByRole("button", { name: "Download" });
  expect(screen.getAllByText(/cannot remember export jobs/).length).toBeGreaterThan(0);
});
it("does not offer a download for a restored upload job", async () => {
  sessionStorage.setItem(storageKey(), "11"); vi.mocked(api.getJob).mockResolvedValue(job(11, "upload_preview"));
  render(<ExportPage projectKey="p" currentUser={user} />); await screen.findByText("This job is not an annotation results export.");
  expect(screen.queryByRole("button", { name: "Download" })).toBeNull(); expect(sessionStorage.getItem(storageKey())).toBeNull();
});
