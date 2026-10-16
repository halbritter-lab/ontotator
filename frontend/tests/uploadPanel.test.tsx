import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ConflictError, type ImportPlan, type UploadView } from "../src/api/client";
import { UploadPanel } from "../src/admin/UploadPanel";
import { UploadPreview } from "../src/admin/UploadPreview";
const plan: ImportPlan = {
  documents: [], duplicates: [], collisions: [], proposal_sets: [], documents_only: ["doc"], normalised_count: 1,
  errors: [], warnings: [], counts: { documents_added: 8, documents_skipped: 2, documents_only: 1, sets_added: 2, proposals: 99 },
  state_sha256: "state", plan_sha256: "real-plan", committable: true,
};
const view: UploadView = { id: 7, kind: "text", language: "en", files: [], status: "ready", preview: plan, plan_sha256: "real-plan", commit_job_id: null, created_at: "2026-10-16T10:00:00Z" };
const job = (id: number, status: "succeeded" | "failed" = "succeeded", result: Record<string, unknown> | null = null, error: string | null = null) => ({ id, status, result, error, kind: "upload_preview", created_at: view.created_at, finished_at: view.created_at });
beforeEach(() => {
  vi.spyOn(api, "listUploads").mockResolvedValue([]);
  vi.spyOn(api, "createUpload").mockResolvedValue({ upload_id: 7, job_id: 11 });
  vi.spyOn(api, "getJob").mockResolvedValue(job(11));
  vi.spyOn(api, "getUpload").mockResolvedValue(view);
  vi.spyOn(api, "commitUpload").mockResolvedValue({ upload_id: 7, job_id: 12 });
  vi.spyOn(api, "discardUpload").mockResolvedValue({ ...view, status: "discarded" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function check() {
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  fireEvent.change(screen.getByLabelText(/^Upload language/), { target: { value: "en" } });
  const file = new File(["text"], "case.txt");
  await userEvent.upload(screen.getByLabelText(/^Files/), file);
  // jsdom's native file required-validity does not follow its synthetic FileList.
  // Submit the form after supplying real File objects; required attributes are
  // checked separately, and the handler also validates the language/selection.
  fireEvent.submit(screen.getByRole("button", { name: "Check" }).closest("form")!);
  await screen.findByRole("button", { name: "Import" });
  return file;
}
it("requires text language and obtains the persisted preview after the job", async () => {
  render(<UploadPanel projectKey="p" languages={["en", "de"]} onImported={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  expect(screen.getByLabelText(/^Upload language/)).toHaveProperty("required", true);
  expect(screen.queryByRole("option", { name: "fr" })).toBeNull();
  const file = await check();
  expect(api.createUpload).toHaveBeenCalledWith("p", "text", [file], "en");
  expect(api.getUpload).toHaveBeenCalledWith("p", 7);
  expect(screen.getByText(/8 added/)).toBeTruthy();
});
it("commits the exact persisted hash and reports actual final job counts", async () => {
  const imported = vi.fn(); render(<UploadPanel projectKey="p" languages={["en"]} onImported={imported} />);
  await check();
  vi.mocked(api.getJob).mockResolvedValueOnce(job(12, "succeeded", { documents_added: 3, proposals: 4 }));
  vi.mocked(api.getUpload).mockResolvedValueOnce({ ...view, status: "committed", commit_job_id: 12 });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await screen.findByText("Imported 3 documents and 4 proposals.");
  expect(api.commitUpload).toHaveBeenCalledWith("p", 7, "real-plan");
  expect(imported).toHaveBeenCalledOnce();
});
it.each(["immediate", "job"])("retains original files for Check again after %s UPLOAD_STALE", async (kind) => {
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />); const file = await check();
  if (kind === "immediate") vi.mocked(api.commitUpload).mockRejectedValueOnce(new ConflictError("Changed", "UPLOAD_STALE"));
  else vi.mocked(api.getJob).mockResolvedValueOnce(job(12, "failed", null, "UPLOAD_STALE: changed"));
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await screen.findByText("The project changed since this preview. Check again.");
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(api.createUpload).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.createUpload).mock.calls[1][2][0]).toBe(file);
});
it("resumes retained previews and discards ready or invalid uploads", async () => {
  vi.mocked(api.listUploads).mockResolvedValue([{ ...view, status: "invalid", preview: { ...plan, committable: false } }]);
  vi.mocked(api.getUpload).mockResolvedValue({ ...view, status: "invalid", preview: { ...plan, committable: false } });
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  expect(await screen.findByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(api.discardUpload).toHaveBeenCalledWith("p", 7));
});
it("shows failed jobs separately from request errors and never imports after failure", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job(11, "failed", null, "T1_INVALID: missing manifest"));
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  await userEvent.upload(screen.getByLabelText(/^Files/), new File(["{}"], "bad.json"));
  fireEvent.submit(screen.getByRole("button", { name: "Check" }).closest("form")!);
  await screen.findByText(/Job failed: T1_INVALID: missing manifest/);
  expect(api.commitUpload).not.toHaveBeenCalled();
});
it("blocks duplicate mutations while checking and ignores responses after unmount", async () => {
  let resolve!: (value: { upload_id: number; job_id: number }) => void;
  vi.mocked(api.createUpload).mockImplementation(() => new Promise(r => { resolve = r; }));
  const { unmount } = render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  await userEvent.upload(screen.getByLabelText(/^Files/), new File(["{}"], "x.json"));
  fireEvent.submit(screen.getByRole("button", { name: "Check" }).closest("form")!); fireEvent.submit(screen.getByRole("button", { name: /Checking/ }).closest("form")!);
  expect(api.createUpload).toHaveBeenCalledOnce(); unmount();
  await act(async () => { resolve({ upload_id: 7, job_id: 11 }); });
  expect(api.getJob).not.toHaveBeenCalled();
});
it("refuses missing language even when submitted programmatically", async () => {
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  await userEvent.upload(screen.getByLabelText(/^Files/), new File(["text"], "x.txt"));
  fireEvent.submit(screen.getByRole("button", { name: "Check" }).closest("form")!);
  expect(api.createUpload).not.toHaveBeenCalled();
});
it("does not report preview counts when final job counts are unavailable", async () => {
  const imported = vi.fn(); render(<UploadPanel projectKey="p" languages={["en"]} onImported={imported} />);
  await check();
  vi.mocked(api.getJob).mockResolvedValueOnce(job(12));
  vi.mocked(api.getUpload).mockResolvedValueOnce({ ...view, status: "committed", commit_job_id: 12 });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await screen.findByText(/final counts are unavailable/);
  expect(imported).not.toHaveBeenCalled(); expect(screen.queryByText(/^Imported \d/)).toBeNull();
});
it("resumes committed imports using persisted commit job result", async () => {
  const current = { ...view, status: "committed", commit_job_id: 12 };
  vi.mocked(api.listUploads).mockResolvedValue([current]); vi.mocked(api.getUpload).mockResolvedValue(current);
  vi.mocked(api.getJob).mockResolvedValue(job(12, "succeeded", { documents_added: 2, proposals: 0 }));
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  await screen.findByText("Imported 2 documents and 0 proposals.");
  expect(api.getJob).toHaveBeenCalledWith(12); expect(api.commitUpload).not.toHaveBeenCalled();
});
it("does not start polling for a create response from a previous project", async () => {
  let resolve!: (value: { upload_id: number; job_id: number }) => void;
  vi.mocked(api.createUpload).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const { rerender } = render(<UploadPanel projectKey="old" languages={[]} onImported={vi.fn()} />);
  await userEvent.upload(screen.getByLabelText(/^Files/), new File(["{}"], "x.json"));
  fireEvent.submit(screen.getByRole("button", { name: "Check" }).closest("form")!);
  rerender(<UploadPanel projectKey="new" languages={[]} onImported={vi.fn()} />);
  await act(async () => { resolve({ upload_id: 7, job_id: 11 }); });
  expect(api.getJob).not.toHaveBeenCalled();
});
it("renders blocking issues, collisions, duplicates, normalization, tool provenance and refusal details", () => {
  const detailed = { ...plan, committable: false,
    errors: [{ code: "T1_TOOL_PROVENANCE", unit: "x.json", annotation_id: "ann", message: "Tool missing", severity: "error" as const }],
    warnings: [{ code: "WARN", unit: "y.json", message: "Ontospan warning", severity: "warning" as const }],
    collisions: [{ document_id: "doc", existing_sha256: "a".repeat(64), new_sha256: "b".repeat(64) }],
    duplicates: [{ document_id: "doc", text_sha256: "a".repeat(64), same_text_as: ["other"] }],
    proposal_sets: [{ document_id: "doc", annotation_set_id: "set", bundle_id: "bundle", manifest_sha256: "c".repeat(64), set_kind: "tool", action: "already_imported" as const,
      actors: [{ kind: "tool", name: "Recognizer", version: "2", model: "M", run_id: "run" }], payload: {},
      proposals: { annotations: [], evidence: [], defaulted_axes: 0, notes: { ann: ["Imported note"] } },
      refused: [{ annotation_id: "r", rule: "hidden_axis_value" as const, detail: { axis: "certainty" } }],
    }],
  };
  render(<UploadPreview plan={detailed} />);
  expect(screen.getByRole("alert").textContent).toContain("T1_TOOL_PROVENANCE");
  for (const text of ["x.json", "ann", "aaaaaaaaaaaa", "bbbbbbbbbbbb", "other", "1 normalised", "Recognizer", "Already imported", "hidden_axis_value", "certainty", "Imported note", "Ontospan warning"]) expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
});


