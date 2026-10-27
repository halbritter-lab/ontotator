import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ConflictError, type ImportPlan, type UploadView } from "../src/api/client";
import { UploadPanel } from "../src/admin/UploadPanel";
import { UploadPreview } from "../src/admin/UploadPreview";
const plan: ImportPlan = { input_sha256: "input-hash",
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
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
  expect(screen.getByText(/8 documents added/)).toBeTruthy();
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
  expect(imported).toHaveBeenCalledWith("Imported 3 documents and 4 proposals.");
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
it("restores a previewing upload using its persisted job ID and then reads the ready preview", async () => {
  const previewing: UploadView = { ...view, status: "previewing", preview: null, plan_sha256: null, preview_job_id: 31 };
  vi.mocked(api.listUploads).mockResolvedValue([previewing]);
  vi.mocked(api.getUpload).mockResolvedValueOnce(previewing).mockResolvedValueOnce(view);
  vi.mocked(api.getJob).mockResolvedValue(job(31));
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  await screen.findByRole("button", { name: "Import" });
  expect(api.getJob).toHaveBeenCalledWith(31);
  expect(api.getUpload).toHaveBeenCalledTimes(2);
  expect(api.createUpload).not.toHaveBeenCalled();
});
it("surfaces a failed restored preview job without offering import", async () => {
  const previewing: UploadView = { ...view, status: "previewing", preview: null, plan_sha256: null, preview_job_id: 31 };
  vi.mocked(api.listUploads).mockResolvedValue([previewing]);
  vi.mocked(api.getUpload).mockResolvedValueOnce(previewing).mockResolvedValueOnce({ ...previewing, status: "failed" });
  vi.mocked(api.getJob).mockResolvedValue(job(31, "failed", null, "T1_INVALID: invalid source"));
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  await screen.findByText("Job failed: T1_INVALID: invalid source");
  expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
});
it("keeps a safe manual refresh for legacy previewing uploads without a job ID", async () => {
  const legacy: UploadView = { ...view, status: "previewing", preview: null, plan_sha256: null, preview_job_id: null };
  vi.mocked(api.listUploads).mockResolvedValue([legacy]);
  vi.mocked(api.getUpload).mockResolvedValueOnce(legacy).mockResolvedValueOnce(view);
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  fireEvent.click(await screen.findByRole("button", { name: "Refresh status" }));
  await screen.findByRole("button", { name: "Import" });
  expect(api.getJob).not.toHaveBeenCalled();
});
it("reloads a persisted running preview through a fresh hook and ignores its unmounted request", async () => {
  const previewing: UploadView = { ...view, status: "previewing", preview: null, plan_sha256: null, preview_job_id: 31 };
  let resolve!: (value: ReturnType<typeof job>) => void;
  vi.mocked(api.listUploads).mockResolvedValue([previewing]);
  vi.mocked(api.getUpload).mockResolvedValue(previewing);
  vi.mocked(api.getJob).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(job(31));
  const first = render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  await waitFor(() => expect(api.getJob).toHaveBeenCalledWith(31)); first.unmount();
  vi.mocked(api.getUpload).mockResolvedValueOnce(previewing).mockResolvedValue(view);
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  await screen.findByRole("button", { name: "Import" });
  await act(async () => { resolve(job(31, "failed", null, "old reply")); });
  expect(screen.queryByText(/old reply/)).toBeNull();
});
it("ignores a failed job's persisted-view reply after a new source selection", async () => {
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  await check();
  let resolve!: (value: UploadView) => void;
  vi.mocked(api.getUpload).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  vi.mocked(api.getJob).mockResolvedValue(job(12, "failed", null, "T1_INVALID: failed"));
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await screen.findByText("Job failed: T1_INVALID: failed");
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "t1" } });
  await act(async () => { resolve(view); });
  expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
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
  expect(screen.getByRole("alert").textContent).toContain("The imported tool provenance is incomplete or invalid.");
  for (const text of ["x.json", "ann", "aaaaaaaaaaaa", "bbbbbbbbbbbb", "other", "Recognizer", "Already imported", "hidden_axis_value", "certainty", "Imported note", "Ontospan warning"]) expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
});
it("counts distinct refused proposals per set while retaining every violated rule", () => {
  const proposalSet: NonNullable<ImportPlan["proposal_sets"]>[number] = {
    document_id: "doc", annotation_set_id: "set", bundle_id: null, manifest_sha256: null,
    set_kind: "tool", action: "add" as const, actors: [], payload: {},
    proposals: { annotations: [], evidence: [], defaulted_axes: 0 },
    refused: [
      { annotation_id: "first", rule: "discontinuous_mention" as const, detail: { reason: "Multiple spans" } },
      { annotation_id: "first", rule: "hidden_axis_value" as const, detail: { axis: "certainty" } },
      { annotation_id: "second", rule: "axis_not_chosen" as const, detail: { axis: "temporality" } },
    ],
  };
  render(<UploadPreview plan={{ ...plan, proposal_sets: [proposalSet] }} />);
  expect(screen.getByText(/0 proposed, 2 refused/)).toBeTruthy();
  expect(screen.getByText("Refusal rules (3)")).toBeTruthy();
  expect(screen.getByText("first: discontinuous_mention, reason: Multiple spans")).toBeTruthy();
  expect(screen.getByText("first: hidden_axis_value, axis: certainty")).toBeTruthy();
  expect(screen.getByText("second: axis_not_chosen, axis: temporality")).toBeTruthy();
});
it("commits the chosen plan with the upload", async () => {
  const workPlan: NonNullable<ImportPlan["work_plan"]> = {
    setting: "review_and_annotate_translations", existing_rows_kept: 0,
    languages: [{ key: "de", source_languages: [], rows: 1, versions: 1, review: true, annotate: true, source_rule: null, marked_in_package: 0, not_accepted: 1 }],
    cases: [{ case_id: "case-1", language: "de", review: true, annotate: true, new_row: true, accepted: false, marked_in_package: false }],
  };
  vi.mocked(api.getUpload).mockResolvedValue({ ...view, preview: { ...plan, work_plan: workPlan } });
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  fireEvent.change(screen.getByLabelText(/^Upload language/), { target: { value: "en" } });
  await userEvent.upload(screen.getByLabelText(/^Files/), new File(["text"], "case.txt"));
  fireEvent.submit(screen.getByRole("button", { name: "Check" }).closest("form")!);
  fireEvent.click(await screen.findByRole("button", { name: "Annotate, de" }));
  fireEvent.click(screen.getByText("Adjust per case…"));
  fireEvent.click(screen.getByRole("button", { name: "Translation review, case-1 de" }));
  fireEvent.click(screen.getByRole("button", { name: "Import 1 text" }));
  await waitFor(() => expect(api.commitUpload).toHaveBeenCalledWith("p", 7, "real-plan", undefined, {
    plan_languages: { de: { review: true, annotate: false } },
    plan_cases: [{ case_id: "case-1", language: "de", review: false, annotate: false }],
  }));
});
it("explains an unreadable archive in words and hides the preview counts", () => {
  render(<UploadPreview plan={{ ...plan, committable: false, errors: [{ code: "invalid_archive", unit: "bad.pdf", message: "cannot decode ZIP archive: File is not a zip file", severity: "error" }] }} />);
  expect(screen.getByRole("heading", { name: "The archive could not be read. Check the ZIP file." })).toBeTruthy();
  expect(screen.queryByText(/documents added/)).toBeNull();
});
