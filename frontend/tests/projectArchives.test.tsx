import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type ArchiveJobView, type ProjectSummary } from "../src/api/client";
import * as downloads from "../src/api/download";
import { ProjectArchives } from "../src/admin/ProjectArchives";

const at = "2026-11-03T10:00:00Z";
const job = (id: number, kind: ArchiveJobView["kind"], result: Record<string, unknown> | null, status: ArchiveJobView["status"] = "succeeded", error: string | null = null): ArchiveJobView =>
  ({ id, kind, status, result, error, created_at: at, finished_at: at });
const projects = [
  { project_key: "ward-7", name: "Ward 7" },
  { project_key: "neuro-demo", name: "Neurology demo" },
] as ProjectSummary[];

beforeEach(() => {
  vi.spyOn(api, "adminExportArchive").mockResolvedValue({ job_id: 5 });
  vi.spyOn(api, "adminImportArchive").mockResolvedValue({ job_id: 6 });
  vi.spyOn(api, "adminGetArchiveJob").mockImplementation(async id => id === 5
    ? job(5, "project_archive_export", { sha256: "a".repeat(64), rows: 120, blobs: 3, project: "neuro-demo" })
    : job(6, "project_archive_import", {
      project: "neuro-demo-2", name: "Neurology demo (2)", renamed: true, archived_project: "neuro-demo", rows: 120,
      people: { mapped: [{ pseudonym: "ann-0001", username: "ana" }], pseudonym_only: [{ pseudonym: "ann-0002", archived_pseudonym: "ann-0002" }] },
      verification: { ok: true, rows_checked: 120, files_checked: 60 },
    }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("exports the chosen project with or without its ontology files", async () => {
  render(<ProjectArchives projects={projects} />);
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "neuro-demo" } });
  await userEvent.click(screen.getByLabelText(/Include ontology files/));
  await userEvent.click(screen.getByRole("button", { name: "Export archive" }));
  expect(api.adminExportArchive).toHaveBeenCalledWith("neuro-demo", false);
  expect(await screen.findByText("Archive ready")).toBeTruthy();
  expect(screen.getByText(/neuro-demo: 120 rows and 3 files/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download archive" })).toBeTruthy();
});

it("names the download after the exported project, not the one chosen since", async () => {
  vi.spyOn(api, "adminDownloadArchive").mockResolvedValue({ blob: new Blob(["zip"]), filename: null });
  vi.spyOn(downloads, "saveDownload").mockImplementation(() => {});
  render(<ProjectArchives projects={projects} />);
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "neuro-demo" } });
  await userEvent.click(screen.getByRole("button", { name: "Export archive" }));
  await screen.findByText("Archive ready");
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "ward-7" } });
  await userEvent.click(screen.getByRole("button", { name: "Download archive" }));
  await vi.waitFor(() => expect(downloads.saveDownload).toHaveBeenCalledWith(expect.anything(), "neuro-demo-archive.zip"));
});

it("reloads the project list after an import", async () => {
  const onImported = vi.fn();
  render(<ProjectArchives projects={projects} onImported={onImported} />);
  await userEvent.upload(screen.getByLabelText("Archive file (.zip)"), new File(["zip"], "neuro.zip"));
  await userEvent.click(screen.getByRole("button", { name: "Import archive" }));
  expect(await screen.findByText("Project imported")).toBeTruthy();
  expect(onImported).toHaveBeenCalledTimes(1);
});

it("imports an archive and reports the new key, the verification and the people", async () => {
  render(<ProjectArchives projects={projects} />);
  const button = screen.getByRole("button", { name: "Import archive" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await userEvent.upload(screen.getByLabelText("Archive file (.zip)"), new File(["zip"], "neuro.zip"));
  await userEvent.click(screen.getByLabelText(/Give people new pseudonyms/));
  await userEvent.click(screen.getByRole("button", { name: "Import archive" }));
  expect(api.adminImportArchive).toHaveBeenCalledWith(expect.any(File), true);
  expect(await screen.findByText("Project imported")).toBeTruthy();
  expect(screen.getByText(/Neurology demo \(2\) \(neuro-demo-2\), renamed from neuro-demo: 120 rows, verified against the manifest/)).toBeTruthy();
  expect(screen.getByText(/Matched to people here: ana/)).toBeTruthy();
  expect(screen.getByText(/Pseudonym-only people: ann-0002/)).toBeTruthy();
});

it("shows why an import was refused", async () => {
  vi.mocked(api.adminGetArchiveJob).mockResolvedValue(job(6, "project_archive_import", null, "failed", "DomainError: [ARCHIVE_TAMPERED] The archive does not match its manifest."));
  render(<ProjectArchives projects={projects} />);
  await userEvent.upload(screen.getByLabelText("Archive file (.zip)"), new File(["zip"], "neuro.zip"));
  await userEvent.click(screen.getByRole("button", { name: "Import archive" }));
  expect(await screen.findByText("Import failed")).toBeTruthy();
  expect(screen.getByText(/\[ARCHIVE_TAMPERED\] The archive does not match its manifest/)).toBeTruthy();
});
