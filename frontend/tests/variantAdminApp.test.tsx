import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, ApiError, type ImportPlan, type ProjectSummary, type UploadView } from "../src/api/client";
import { deferred, documents } from "./assignmentFixtures";
import { settings } from "./projectFixtures";
import { testUser } from "./session";
import { group, page, row, version } from "./documents/fixtures";

const project: ProjectSummary = { project_key: "p/key", name: "Research", description: null, roles: ["lead"], can_manage: true, allowed_modes: ["independent"], document_count: 1 };
const ordinaryProject: ProjectSummary = { ...project, roles: ["annotator"], can_manage: false };
const plan: ImportPlan = { input_sha256: "input", state_sha256: "state", plan_sha256: "plan", committable: true, counts: {}, documents: [], documents_only: [], duplicates: [], collisions: [], proposal_sets: [], errors: [], warnings: [], normalised_count: 0, variants: [{ document_id: "opaque/internal", external_id: "external", case_id: "case", language: "de", version: 2, origin: "correction", derived_from: "actual-predecessor", derived_in_upload: false, translation: null, status: "ready_for_review", failed_checks: [], marked_in_package: false }] };
const upload: UploadView = { id: 7, kind: "t1", language: null, files: [], status: "ready", preview: plan, plan_sha256: "plan", commit_job_id: null, preview_job_id: null, created_at: "2026-10-16T00:00:00Z" };
const lead = testUser("lead", { is_system_admin: false });

beforeEach(() => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/documents");
  vi.spyOn(api, "listProjects").mockResolvedValue([project]);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "listDocumentRows").mockResolvedValue(page([group("z/doc", [row({ case_id: "z/doc", language: "en", versions: [version({ document_id: "z/doc" })] })])]));
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue(documents);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listUploads").mockResolvedValue([upload]);
  vi.spyOn(api, "getUpload").mockResolvedValue(upload);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/"); });

async function preview() {
  const upload = await screen.findByRole("button", { name: "Upload texts…" });
  // Upload is unavailable until the project settings are loaded.
  await waitFor(() => expect(upload.getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(upload);
  const dialog = within(await screen.findByRole("dialog", { name: "Upload texts" }));
  fireEvent.click(await dialog.findByRole("button", { name: "Resume upload 7" }));
  await dialog.findByRole("table", { name: "Variants" });
  return dialog;
}

/** Non-leads get the lead-only notice: no upload controls (and so no override) at all. */
async function leadOnlyNotice() {
  expect(await screen.findByRole("heading", { name: "Documents is for project leads" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Upload texts…" })).toBeNull();
  expect(screen.queryByLabelText(/^Accept without review:/)).toBeNull();
}

it("wires the actual current project lead into real upload override controls", async () => {
  render(<App user={lead} />);
  const dialog = await preview();
  fireEvent.click(await dialog.findByLabelText(/^Accept without review:/));
  expect(dialog.getByLabelText(/^Reason:/)).toBeTruthy();
});

it("wires the system administrator exception only after the current project is known", async () => {
  vi.mocked(api.listProjects).mockResolvedValue([{ ...project, roles: [] }]);
  render(<App user={testUser("root", { is_system_admin: true })} />);
  expect(await (await preview()).findByLabelText(/^Accept without review:/)).toBeTruthy();
});

it("does not adopt a lead role from another project for an ordinary current member", async () => {
  vi.mocked(api.listProjects).mockResolvedValue([{ ...project, project_key: "other" }, ordinaryProject]);
  render(<App user={testUser("reader", { is_system_admin: false })} />);
  await leadOnlyNotice();
});

it("does not grant override when no current project was returned, even to an admin", async () => {
  vi.mocked(api.listProjects).mockResolvedValue([]);
  render(<App user={testUser("root", { is_system_admin: true })} />);
  await leadOnlyNotice();
});

it("keeps controls absent while current project inventory is loading", async () => {
  const pending = deferred<ProjectSummary[]>();
  vi.mocked(api.listProjects).mockReturnValue(pending.promise);
  render(<App user={lead} />);
  expect(await screen.findByText("Loading project access…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Upload texts…" })).toBeNull();
  await act(async () => pending.resolve([project]));
  expect(await (await preview()).findByLabelText(/^Accept without review:/)).toBeTruthy();
});

it("clears sysadmin-only override choices immediately when current user loses that flag", async () => {
  vi.mocked(api.listProjects).mockResolvedValue([{ ...project, roles: [] }]);
  const view = render(<App user={testUser("root", { is_system_admin: true })} />);
  const dialog = await preview();
  fireEvent.click(await dialog.findByLabelText(/^Accept without review:/));
  fireEvent.change(dialog.getByLabelText(/^Reason:/), { target: { value: "No longer authorized" } });
  view.rerender(<App user={testUser("root", { is_system_admin: false })} />);
  expect(dialog.queryByLabelText(/^Accept without review:/)).toBeNull();
  expect(dialog.queryByLabelText(/^Reason:/)).toBeNull();
  await act(async () => {});
});

it("replaces session identity without carrying former user's project rights or upload choices", async () => {
  const pending = deferred<ProjectSummary[]>();
  vi.mocked(api.listProjects).mockResolvedValueOnce([project]).mockReturnValueOnce(pending.promise);
  const view = render(<App user={lead} />);
  const dialog = await preview();
  fireEvent.click(await dialog.findByLabelText(/^Accept without review:/));
  view.rerender(<App user={testUser("reader", { is_system_admin: false })} />);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Upload texts" })).toBeNull());
  expect(screen.queryByRole("button", { name: "Upload texts…" })).toBeNull();
  expect(dialog.queryByLabelText(/^Accept without review:/)).toBeNull();
  await act(async () => pending.resolve([ordinaryProject]));
  await leadOnlyNotice();
});

it("rejects a late former-user project response while the new session inventory is pending", async () => {
  const previous = deferred<ProjectSummary[]>(), current = deferred<ProjectSummary[]>();
  vi.mocked(api.listProjects).mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const view = render(<App user={lead} />);
  view.rerender(<App user={testUser("reader", { is_system_admin: false })} />);
  await act(async () => previous.resolve([project]));
  expect(screen.queryByRole("button", { name: "Upload texts…" })).toBeNull();
  expect(screen.queryByLabelText(/^Accept without review:/)).toBeNull();
  expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  await act(async () => current.resolve([ordinaryProject]));
  await leadOnlyNotice();
});

it("uses the refreshed current role after an existing settings save reloads project context", async () => {
  vi.mocked(api.listProjects).mockResolvedValueOnce([project]).mockResolvedValueOnce([ordinaryProject]);
  vi.spyOn(api, "listOntologies").mockResolvedValue([]);
  vi.spyOn(api, "updateProjectSettings").mockResolvedValue(settings);
  render(<App user={lead} />);
  fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save general" }));
  await waitFor(() => expect(api.listProjects).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("link", { name: "Documents" })).toBeNull());
  act(() => { window.location.hash = "#/projects/p%2Fkey/documents"; });
  await leadOnlyNotice();
});

it("retains controlled variant filters through real App navigation", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/documents?origin=correction&translation_status=accepted&status=submitted");
  render(<App user={lead} />);
  await screen.findByRole("link", { name: "Open in editor, z/doc en" });
  expect(api.listDocumentRows).toHaveBeenLastCalledWith("p/key", { origin: "correction", translation_status: "accepted", status: "submitted" });
  const prefix = screen.getByLabelText("Case ID or text"); prefix.focus();
  fireEvent.change(prefix, { target: { value: "ID +/ß" } });
  await waitFor(() => expect(api.listDocumentRows).toHaveBeenLastCalledWith("p/key", { origin: "correction", translation_status: "accepted", status: "submitted", q: "ID +/ß" }));
  expect(window.location.hash).toBe("#/projects/p%2Fkey/documents?status=submitted&q=ID+%2B%2F%C3%9F&origin=correction&translation_status=accepted");
  expect(screen.getByLabelText("Case ID or text")).toBe(prefix);
  expect(document.activeElement).toBe(prefix);
  expect(api.listProjects).toHaveBeenCalledTimes(1);
});

it("does not treat a failed current-project request as override authority and can retry safely", async () => {
  vi.mocked(api.listProjects).mockRejectedValueOnce(new ApiError(403, "Project rights changed", "NOT_ALLOWED")).mockResolvedValueOnce([project]);
  render(<App user={lead} />);
  const retry = await screen.findByRole("button", { name: "Retry projects" });
  expect(screen.queryByRole("button", { name: "Upload texts…" })).toBeNull();
  expect(screen.queryByLabelText(/^Accept without review:/)).toBeNull();
  fireEvent.click(retry);
  expect(await (await preview()).findByLabelText(/^Accept without review:/)).toBeTruthy();
});
