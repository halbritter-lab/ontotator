import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, type CurrentUser, type FinalPreflight, type JobView } from "../src/api/client";
import * as downloads from "../src/api/download";
import { ExportPage } from "../src/admin/ExportPage";
const user: CurrentUser = { username: "lead", display_name: "Lead", pseudonym: "L", csrf_token: "csrf", is_system_admin: false };
const job = (id: number, kind = "t1_export", status: JobView["status"] = "succeeded"): JobView => ({ id, kind, status, result: { path: "never-use-this-path" }, error: status === "failed" ? "EXPORT_FAILED: source missing" : null, created_at: "2026-10-16T10:00:00Z", finished_at: "2026-10-16T10:01:00Z" });
const storageKey = (username = "lead", project = "p", kind = "t1") => `ontocurator:export:${JSON.stringify([username, project, kind])}`;
const card = (title = "Annotation results") => within(screen.getByRole("region", { name: title }));
const finals = () => within(screen.getByRole("region", { name: "Selected final results" }));
const emptyPreflight: FinalPreflight = { project: "p", selections: [], warnings: [], omissions: [], state_digest: "0".repeat(64) };
const selection = { case_id: "case-1", language: "de", document_id: "d", submission_id: "s", revision: 1 };
const warning = { id: "w", code: "OPEN_PROBLEM_REPORT", cause_revision: 2, case_id: "case-1", language: "de", reason: "Wording under review", destination: "#/tasks/1" };
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(emptyPreflight);
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
  fireEvent.click(card("Edit log").getByRole("button", { name: "Create export" }));
  await card("Edit log").findByRole("button", { name: "Download" });
  expect(api.startExport).toHaveBeenCalledWith("p", "edit_log"); expect(sessionStorage.getItem(storageKey("lead", "p", "edit_log"))).toBe("22");
});
it("restores a persisted job without starting a new export and surfaces failed terminal data", async () => {
  sessionStorage.setItem(storageKey(), "11"); vi.mocked(api.getJob).mockResolvedValue(job(11, "t1_export", "failed"));
  render(<ExportPage projectKey="p" currentUser={user} />);
  await screen.findByText("EXPORT_FAILED: source missing"); expect(api.startExport).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
});
it.each([
  ["UNKNOWN_TERM", "The term is not in the project's pinned ontology."],
  ["OBSOLETE_TERM", "The term is obsolete in the project's pinned ontology."],
  ["INCOMPLETE_AXES", "Required clinical axis values are missing."],
])("explains historical unresolved export failure %s with its context and recovery", async (code, reason) => {
  sessionStorage.setItem(storageKey(), "11");
  vi.mocked(api.getJob).mockResolvedValue({ ...job(11, "t1_export", "failed"), result: {
    error: { code: "EXPORT_UNRESOLVED_INVALID", details: {
      document_id: "document-17", submission_id: "submission-21", annotation_id: "finding-42", version: "original-version",
      cause: { code, details: { term_id: "HP:9999999" } },
    } },
  } });
  render(<ExportPage projectKey="p" currentUser={user} />);
  await card().findByText(/A historical unresolved finding is invalid/);
  expect(card().getByText(/No export was created/)).toBeTruthy();
  expect(card().getByText(/Reopen the affected review assignment/)).toBeTruthy();
  expect(card().getByText(/submit the corrected review/)).toBeTruthy();
  expect(card().getByText(/Document: document-17/)).toBeTruthy();
  expect(card().getByText(/Submission: submission-21/)).toBeTruthy();
  expect(card().getByText(/Finding: finding-42/)).toBeTruthy();
  expect(card().getByText(/Version: original-version/)).toBeTruthy();
  expect(card().getByText(reason, { exact: false })).toBeTruthy();
  expect(card().getByText(/HP:9999999/)).toBeTruthy();
  expect(card().queryByText("EXPORT_FAILED: source missing")).toBeNull();
  expect(card().queryByRole("button", { name: "Download" })).toBeNull();
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
  expect(api.getJob).toHaveBeenCalledWith(11); expect(card("Edit log").queryByRole("button", { name: "Download" })).toBeNull();
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

it("explains reviewer flags without changing clinical uncertainty", () => {
  render(<ExportPage projectKey="p" currentUser={user} />);
  expect(card().getByText(/Unresolved proposals are included in exports with a separate reviewer flag and note\. Clinical axis values are unchanged\./)).toBeDefined();
});

it("explains included reviewer flags, omitted rejections and historical missing-note warnings", async () => {
  sessionStorage.setItem(storageKey(), "11");
  vi.mocked(api.getJob).mockResolvedValue({ ...job(11), result: { counts: { uncertain: 2, rejected: 3 }, warnings: [
    { code: "LEGACY_UNRESOLVED_NOTE_MISSING", annotation_id: "old-result", version: "original-version" },
  ] } });
  render(<ExportPage projectKey="p" currentUser={user} />);
  expect(card().getByText(/Clinical axis values are unchanged/)).toBeTruthy();
  expect(card().getByText(/cannot currently be re-imported into proposal storage/)).toBeTruthy();
  await card().findByText(/2 unresolved result\(s\) included with reviewer flags; 3 rejected result\(s\) omitted/);
  expect(card().getByText(/old-result \(original-version\) has no reviewer note/)).toBeTruthy();
  expect(card().queryByText(/excludes unresolved/)).toBeNull();
});
it("summarizes serializer errors and keeps raw diagnostics in a disclosure", async () => {
  sessionStorage.setItem(storageKey(), "11");
  vi.mocked(api.getJob).mockResolvedValue({ ...job(11, "t1_export", "failed"), error: "T1_INVALID: {'source_ref_syntax': 'internal'}" });
  render(<ExportPage projectKey="p" currentUser={user} />);
  await screen.findByText("Export could not be created. Open diagnostics for the technical details.");
  expect(screen.getByText("Technical diagnostics").closest("details")?.open).toBe(false);
  expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
});

it("links each preflight warning and omission to its Documents row", async () => {
  vi.mocked(api.finalExportPreflight).mockResolvedValue({ project: "p/a", selections: [{ case_id: "GSC17", language: "de", document_id: "d", submission_id: "s", revision: 1 }],
    warnings: [{ id: "held", code: "OPEN_PROBLEM_REPORT", cause_revision: 2, case_id: "GSC 17", language: "de", document_id: "old", reason: "Text wording needs review", destination: "#/tasks/7" }],
    omissions: [{ case_id: "GSC18", language: "en" }], state_digest: "a".repeat(64) });
  render(<ExportPage projectKey="p/a" currentUser={user} />);
  await screen.findByText("Text wording needs review");
  expect(screen.getByRole("link", { name: "Show GSC 17 de" }).getAttribute("href")).toBe("#/projects/p%2Fa/documents?language=de&case=GSC+17");
  expect(screen.getByRole("link", { name: "Show GSC18 en" }).getAttribute("href")).toBe("#/projects/p%2Fa/documents?language=en&case=GSC18");
  expect(screen.queryByRole("link", { name: "Review issue" })).toBeNull();
  expect(screen.getByText(/Omitted without a final selection/)).toBeTruthy();
});

it("runs the preflight on open", async () => {
  let resolve!: (value: FinalPreflight) => void;
  vi.mocked(api.finalExportPreflight).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  render(<ExportPage projectKey="p" currentUser={user} />);
  expect(finals().getByText("Checking final results…")).toBeTruthy();
  expect(api.finalExportPreflight).toHaveBeenCalledTimes(1);
  expect(api.finalExportPreflight).toHaveBeenCalledWith("p");
  expect(screen.queryByRole("button", { name: "Prepare final export" })).toBeNull();
  const create = finals().getByRole("button", { name: "Create final export" });
  expect(create.getAttribute("aria-disabled")).toBe("true");
  await act(async () => { resolve({ ...emptyPreflight, selections: [selection] }); });
  expect(finals().queryByText("Checking final results…")).toBeNull();
  expect(finals().getByRole("region", { name: "Export preflight" })).toBeTruthy();
  expect(create.getAttribute("aria-disabled")).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

it("Check again reruns it and final-selection changes rerun it while visible", async () => {
  const preflight = vi.mocked(api.finalExportPreflight).mockResolvedValue({ ...emptyPreflight, selections: [selection], warnings: [warning] });
  const changed = (projectKey = "p") => act(() => { window.dispatchEvent(new CustomEvent("ontocurator:final-selection-changed", { detail: { projectKey } })); });
  render(<ExportPage projectKey="p" currentUser={user} />);
  const ack = await finals().findByLabelText("Export these selected results with the listed warnings and omissions");
  fireEvent.click(ack);
  const again = finals().getByRole("button", { name: "Check again" });
  again.focus();
  fireEvent.click(again);
  await waitFor(() => expect(preflight).toHaveBeenCalledTimes(2));
  expect((await finals().findByLabelText("Export these selected results with the listed warnings and omissions") as HTMLInputElement).checked).toBe(false);
  expect(document.activeElement).toBe(again);

  changed("other");
  expect(preflight).toHaveBeenCalledTimes(2);
  changed();
  await waitFor(() => expect(preflight).toHaveBeenCalledTimes(3));
  expect(finals().getByText("Final selections changed. The check was run again.")).toBeTruthy();
  await finals().findByText("Wording under review");

  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  changed();
  expect(preflight).toHaveBeenCalledTimes(3);
  visibility.mockReturnValue("visible");
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await waitFor(() => expect(preflight).toHaveBeenCalledTimes(4));
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(preflight).toHaveBeenCalledTimes(4);
});

it("lists Not planned, not exported as information", async () => {
  vi.mocked(api.finalExportPreflight).mockResolvedValue({ ...emptyPreflight, project: "p", selections: [selection], not_in_plan: [{ case_id: "case-9", language: "fr" }] });
  render(<ExportPage projectKey="p" currentUser={user} />);
  const list = await finals().findByRole("list", { name: "Not planned, not exported" });
  expect(within(list).getByRole("link", { name: "Show case-9 fr" }).getAttribute("href")).toBe("#/projects/p/documents?language=fr&case=case-9");
  expect(finals().getByText("1 selected results, 0 warnings, 0 omitted, 1 not planned")).toBeTruthy();
  expect(finals().getByText(/Annotate is off in the work plan/)).toBeTruthy();
  expect(finals().queryByRole("checkbox")).toBeNull();
  expect(finals().getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBeNull();
});

it.each([
  ["without warnings", [], 3],
  ["with warnings", [warning], 4],
] as const)("Create final export is primary; Download stays an explicit click (%s)", async (_name, warnings, expected) => {
  vi.mocked(api.finalExportPreflight).mockResolvedValue({ ...emptyPreflight, selections: [selection], warnings: [...warnings] });
  const start = vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  vi.mocked(api.getJob).mockResolvedValue({ ...job(8, "final_t1_export"), result: null });
  let activations = 1; // opening Export
  const activate = (element: HTMLElement) => { activations += 1; fireEvent.click(element); };
  render(<ExportPage projectKey="p" currentUser={user} />);
  const primaries = () => [...screen.getByRole("region", { name: "Selected final results" }).querySelectorAll(".btn-primary")].map(b => b.textContent);
  await finals().findByRole("region", { name: "Export preflight" });
  expect(primaries()).toEqual(["Create final export"]);
  if (warnings.length) activate(finals().getByLabelText("Export these selected results with the listed warnings and omissions"));
  activate(finals().getByRole("button", { name: "Create final export" }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  const download = await finals().findByRole("button", { name: "Download final export" });
  await waitFor(() => expect(download.getAttribute("aria-disabled")).toBeNull());
  expect(primaries()).toEqual(["Download final export"]);
  expect(api.downloadJob).not.toHaveBeenCalled();
  expect(downloads.saveDownload).not.toHaveBeenCalled();
  activate(finals().getByRole("button", { name: "Download final export" }));
  await waitFor(() => expect(downloads.saveDownload).toHaveBeenCalledWith(expect.anything(), "p-final.zip"));
  expect(api.downloadJob).toHaveBeenCalledWith(8);
  expect(activations).toBe(expected);
});
