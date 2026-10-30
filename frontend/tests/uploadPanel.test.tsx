import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ConflictError, type ImportPlan, type UploadView } from "../src/api/client";
import { UploadPanel, UNFINISHED_STATUSES } from "../src/admin/UploadPanel";
import { UploadPreview } from "../src/admin/UploadPreview";
import { TEXT_PAGE_SIZE } from "../src/admin/UploadTextList";

const doc = (id: string, language = "en", extra: Partial<NonNullable<ImportPlan["documents"]>[number]> = {}) => ({ document_id: id, language, text_sha256: "f".repeat(64), action: "add" as const, normalised: false, label: `${id}.txt`, ...extra });
const plan: ImportPlan = { input_sha256: "input-hash",
  documents: [doc("case"), doc("other", "en", { normalised: true })], duplicates: [], collisions: [], proposal_sets: [], documents_only: ["doc"], normalised_count: 1,
  errors: [], warnings: [], counts: { documents_added: 2, documents_skipped: 0, documents_only: 1, sets_added: 0, proposals: 0 },
  state_sha256: "state", plan_sha256: "real-plan", committable: true,
};
const files = [{ filename: "case.txt", sha256: "a".repeat(64), size: 4 }];
const view: UploadView = { id: 7, kind: "text", language: "en", files, status: "ready", preview: plan, plan_sha256: "real-plan", commit_job_id: null, created_at: "2026-10-16T10:00:00Z" };
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
const footer = () => within(document.querySelector(".modal-actions") as HTMLElement);
async function choose(name = "case.txt", content = "text") {
  const file = new File([content], name);
  await userEvent.upload(screen.getByLabelText("Files"), file);
  return file;
}
async function check() {
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  fireEvent.change(screen.getByLabelText(/^Upload language/), { target: { value: "en" } });
  const file = await choose();
  fireEvent.click(footer().getByRole("button", { name: "Check" }));
  await screen.findByRole("button", { name: "Import 2 texts" });
  return file;
}
/** Open the first unfinished upload ("Unfinished uploads (n)" is collapsed). */
async function openUnfinished(name: "Open preview" | "Show progress" = "Open preview") {
  fireEvent.click(await screen.findByText(/^Unfinished uploads \(\d+\)$/));
  fireEvent.click((await screen.findAllByRole("button", { name }))[0]);
}

it("is the Upload texts dialog with Format and Language side by side and a fixed footer", async () => {
  const close = vi.fn();
  render(<UploadPanel projectKey="p" languages={["en", "de"]} onImported={vi.fn()} onClose={close} />);
  const dialog = screen.getByRole("dialog", { name: "Upload texts" });
  expect(dialog.className).toContain("ui-dialog--lg");
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  expect(screen.getByLabelText("Format").closest(".upload-fields")).toBe(screen.getByLabelText(/^Upload language/).closest(".upload-fields"));
  // #174: the hint names the file-name rule before files are chosen.
  expect(screen.getByText(/Each file name without \.txt becomes the text ID: letters, digits/)).toBeTruthy();
  expect(footer().getAllByRole("button").map(button => button.textContent)).toEqual(["Cancel", "Check"]);
  fireEvent.click(footer().getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
});

it("explains in the footer why Check is unavailable, with aria-disabled", async () => {
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  const button = footer().getByRole("button", { name: "Check" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe("Choose at least one file.");
  fireEvent.click(button);
  expect(api.createUpload).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  await choose();
  expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe("Choose the upload language.");
  fireEvent.click(button);
  expect(api.createUpload).not.toHaveBeenCalled();
});

it("shows chosen files as removable chips and keeps adding to the selection", async () => {
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  await choose("a.json"); await choose("b.json");
  const chips = screen.getByRole("list", { name: "Chosen files" });
  expect(within(chips).getAllByRole("listitem").map(item => item.textContent)).toEqual(["a.json", "b.json"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove a.json" }));
  expect(within(chips).getAllByRole("listitem").map(item => item.textContent)).toEqual(["b.json"]);
});

it("requires text language and obtains the persisted preview after the job", async () => {
  render(<UploadPanel projectKey="p" languages={["en", "de"]} onImported={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  expect(screen.getByLabelText(/^Upload language/)).toHaveProperty("required", true);
  expect(screen.queryByRole("option", { name: "fr" })).toBeNull();
  const file = await check();
  expect(api.createUpload).toHaveBeenCalledWith("p", "text", [file], "en");
  expect(api.getUpload).toHaveBeenCalledWith("p", 7);
  const summary = screen.getByRole("region", { name: "Upload preview" }).querySelector(".upload-summary")!;
  expect(summary.textContent).toContain("Texts2 (en 2)");
  expect(summary.textContent).not.toMatch(/Proposals/);
});

it("focuses the result line (role=status) after Check and keeps the loading button focusable", async () => {
  let finish!: (value: ReturnType<typeof job>) => void;
  vi.mocked(api.getJob).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  await choose("bundle.json", "{}");
  const button = footer().getByRole("button", { name: "Check" });
  button.focus();
  fireEvent.click(button);
  expect(await screen.findByText("Checking 1 file …")).toBeTruthy();
  await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
  expect(button.hasAttribute("disabled")).toBe(false);
  await act(async () => finish(job(11)));
  const line = await screen.findByText("Checked 1 file: ready to import.");
  expect(line.getAttribute("role")).toBe("status");
  await waitFor(() => expect(document.activeElement).toBe(line));
  expect(footer().getAllByRole("button").map(item => item.textContent)).toEqual(["Cancel", "Discard", "Import 2 texts"]);
});

it("takes a language code, not a name, while the project has no languages (#47 A-22)", () => {
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  const input = screen.getByLabelText(/^Upload language/) as HTMLInputElement;
  const valid = (value: string) => { fireEvent.change(input, { target: { value } }); return input.checkValidity(); };
  expect(valid("english")).toBe(false);
  expect(valid("en")).toBe(true);
  expect(valid("pt-BR")).toBe(true);
  expect(() => new RegExp(input.pattern, "v")).not.toThrow();
});

it("commits the exact persisted hash and hands the final counts to the page (Q5)", async () => {
  const imported = vi.fn(); render(<UploadPanel projectKey="p" languages={["en"]} onImported={imported} />);
  await check();
  vi.mocked(api.getJob).mockResolvedValueOnce(job(12, "succeeded", { documents_added: 3, proposals: 4 }));
  vi.mocked(api.getUpload).mockResolvedValueOnce({ ...view, status: "committed", commit_job_id: 12 });
  fireEvent.click(screen.getByRole("button", { name: "Import 2 texts" }));
  await waitFor(() => expect(imported).toHaveBeenCalledWith("Imported 3 documents and 4 proposals."));
  expect(api.commitUpload).toHaveBeenCalledWith("p", 7, "real-plan");
  expect(imported).toHaveBeenCalledOnce();
});

it("shows the import progress with only Close in the footer", async () => {
  vi.mocked(api.getJob).mockResolvedValueOnce(job(11)).mockReturnValue(new Promise(() => undefined));
  const close = vi.fn();
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} onClose={close} />);
  await check();
  fireEvent.click(screen.getByRole("button", { name: "Import 2 texts" }));
  const line = await screen.findByText(/^Importing 2 texts …/);
  expect(line.textContent).toContain("You can close this dialog");
  await waitFor(() => expect(document.activeElement).toBe(line));
  expect(footer().getAllByRole("button").map(item => item.textContent)).toEqual(["Close"]);
  fireEvent.click(footer().getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledOnce();
});

it.each(["immediate", "job"])("retains original files for Check again after %s UPLOAD_STALE", async (kind) => {
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />); const file = await check();
  if (kind === "immediate") vi.mocked(api.commitUpload).mockRejectedValueOnce(new ConflictError("Changed", "UPLOAD_STALE"));
  else {
    vi.mocked(api.getJob).mockResolvedValueOnce(job(12, "failed", null, "UPLOAD_STALE: changed"));
    vi.mocked(api.getUpload).mockResolvedValueOnce({ ...view, status: "failed", commit_job_id: 12 });
  }
  fireEvent.click(screen.getByRole("button", { name: "Import 2 texts" }));
  await screen.findByText("The project changed since this check. Nothing was imported.");
  fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
  await waitFor(() => expect(api.createUpload).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.createUpload).mock.calls[1][2][0]).toBe(file);
});

it("lists only unfinished uploads, by start time and file names", async () => {
  vi.mocked(api.listUploads).mockResolvedValue([{ ...view, id: 3, status: "committing", commit_job_id: 9 }, { ...view, id: 4 }]);
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  expect(api.listUploads).toHaveBeenCalledWith("p", UNFINISHED_STATUSES);
  expect(UNFINISHED_STATUSES).toEqual(["previewing", "ready", "committing"]);
  const summary = await screen.findByText("Unfinished uploads (2)");
  // Collapsed: the list is rendered only when open.
  expect(screen.queryByRole("button", { name: "Open preview" })).toBeNull();
  fireEvent.click(summary);
  const items = screen.getAllByRole("listitem").filter(item => item.closest(".upload-unfinished-list"));
  const texts = items.map(item => item.querySelector(".upload-unfinished-text")!.textContent);
  expect(texts[0]).toMatch(/^Started 16 Oct 2026, \d{2}:\d{2}: case\.txt · Plain text, en · Importing$/);
  expect(texts[1]).toMatch(/^Started 16 Oct 2026, \d{2}:\d{2}: case\.txt · Plain text, en · Ready to import$/);
  expect(within(items[0]).getByRole("button").textContent).toBe("Show progress");
  expect(within(items[1]).getByRole("button").textContent).toBe("Open preview");
  expect(document.body.textContent).not.toMatch(/Upload 3|Upload 4/);
});

it("opens an unfinished preview and returns to step 1 with the files kept after Discard", async () => {
  vi.mocked(api.listUploads).mockResolvedValue([view]);
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  await openUnfinished();
  const line = await screen.findByText("Checked 1 file: ready to import.");
  await waitFor(() => expect(document.activeElement).toBe(line));
  fireEvent.click(footer().getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(api.discardUpload).toHaveBeenCalledWith("p", 7));
  expect(await screen.findByText("Upload discarded. Nothing was imported.")).toBeTruthy();
  expect(screen.getByLabelText("Format")).toBeTruthy();
});

it("keeps the chosen files after Discard", async () => {
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  await check();
  fireEvent.click(footer().getByRole("button", { name: "Discard" }));
  await screen.findByText("Upload discarded. Nothing was imported.");
  expect(within(screen.getByRole("list", { name: "Chosen files" })).getByText("case.txt")).toBeTruthy();
  expect((screen.getByLabelText("Format") as HTMLSelectElement).value).toBe("text");
});

it("shows failed jobs separately from request errors and never imports after failure", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job(11, "failed", null, "T1_INVALID: missing manifest"));
  vi.mocked(api.getUpload).mockResolvedValue({ ...view, kind: "t1", status: "failed", preview: null, plan_sha256: null, preview_job_id: 11 });
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  await choose("bad.json", "{}");
  fireEvent.click(footer().getByRole("button", { name: "Check" }));
  const line = await screen.findByText(/The check failed: T1_INVALID: missing manifest/);
  expect(line.getAttribute("role")).toBe("alert");
  expect(api.commitUpload).not.toHaveBeenCalled();
  expect(footer().getAllByRole("button").map(item => item.textContent)).toEqual(["Cancel", "Discard"]);
});

it("blocks duplicate mutations while checking and ignores responses after unmount", async () => {
  let resolve!: (value: { upload_id: number; job_id: number }) => void;
  vi.mocked(api.createUpload).mockImplementation(() => new Promise(r => { resolve = r; }));
  const { unmount } = render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  await choose("x.json", "{}");
  fireEvent.click(footer().getByRole("button", { name: "Check" })); fireEvent.click(footer().getByRole("button", { name: "Check" }));
  expect(api.createUpload).toHaveBeenCalledOnce(); unmount();
  await act(async () => { resolve({ upload_id: 7, job_id: 11 }); });
  expect(api.getJob).not.toHaveBeenCalled();
});

it("refuses missing language even when submitted programmatically", async () => {
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "text" } });
  await choose("x.txt");
  fireEvent.submit(screen.getByLabelText("Format").closest("form")!);
  expect(api.createUpload).not.toHaveBeenCalled();
});

it("does not report preview counts when final job counts are unavailable", async () => {
  const imported = vi.fn(); render(<UploadPanel projectKey="p" languages={["en"]} onImported={imported} />);
  await check();
  vi.mocked(api.getJob).mockResolvedValueOnce(job(12));
  vi.mocked(api.getUpload).mockResolvedValueOnce({ ...view, status: "committed", commit_job_id: 12 });
  fireEvent.click(screen.getByRole("button", { name: "Import 2 texts" }));
  await screen.findByText(/final counts are unavailable/);
  expect(imported).not.toHaveBeenCalled();
});

it("opening an upload committed meanwhile shows an info line and never replays the import toast", async () => {
  const imported = vi.fn();
  vi.mocked(api.listUploads).mockResolvedValue([{ ...view, status: "committing", commit_job_id: 12 }]);
  vi.mocked(api.getUpload).mockResolvedValue({ ...view, status: "committed", commit_job_id: 12 });
  vi.mocked(api.getJob).mockResolvedValue(job(12, "succeeded", { documents_added: 2, proposals: 0 }));
  render(<UploadPanel projectKey="p" languages={[]} onImported={imported} />);
  await openUnfinished("Show progress");
  expect(await screen.findByText("This upload was already imported. Its texts are in the project.")).toBeTruthy();
  await act(async () => {});
  expect(imported).not.toHaveBeenCalled();
  expect(api.getJob).not.toHaveBeenCalled();
  expect(api.commitUpload).not.toHaveBeenCalled();
  expect(footer().getAllByRole("button").map(item => item.textContent)).toEqual(["Close"]);
});

it("restores a previewing upload using its persisted job ID and then reads the ready preview", async () => {
  const previewing: UploadView = { ...view, status: "previewing", preview: null, plan_sha256: null, preview_job_id: 31 };
  vi.mocked(api.listUploads).mockResolvedValue([previewing]);
  vi.mocked(api.getUpload).mockResolvedValueOnce(previewing).mockResolvedValueOnce(view);
  vi.mocked(api.getJob).mockResolvedValue(job(31));
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  await openUnfinished();
  await screen.findByRole("button", { name: "Import 2 texts" });
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
  await openUnfinished();
  await screen.findByText("The check failed: T1_INVALID: invalid source");
  expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull();
  // A failed upload can still be discarded, which deletes its files.
  await screen.findByRole("button", { name: "Discard" });
});

it("keeps a safe manual refresh for legacy previewing uploads without a job ID", async () => {
  const legacy: UploadView = { ...view, status: "previewing", preview: null, plan_sha256: null, preview_job_id: null };
  vi.mocked(api.listUploads).mockResolvedValue([legacy]);
  vi.mocked(api.getUpload).mockResolvedValueOnce(legacy).mockResolvedValueOnce(view);
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  await openUnfinished();
  fireEvent.click(await screen.findByRole("button", { name: "Refresh status" }));
  await screen.findByRole("button", { name: "Import 2 texts" });
  expect(api.getJob).not.toHaveBeenCalled();
});

it("reloads a persisted running preview through a fresh hook and ignores its unmounted request", async () => {
  const previewing: UploadView = { ...view, status: "previewing", preview: null, plan_sha256: null, preview_job_id: 31 };
  let resolve!: (value: ReturnType<typeof job>) => void;
  vi.mocked(api.listUploads).mockResolvedValue([previewing]);
  vi.mocked(api.getUpload).mockResolvedValue(previewing);
  vi.mocked(api.getJob).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(job(31));
  const first = render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  await openUnfinished();
  await waitFor(() => expect(api.getJob).toHaveBeenCalledWith(31)); first.unmount();
  vi.mocked(api.getUpload).mockResolvedValueOnce(previewing).mockResolvedValue(view);
  render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} />);
  await openUnfinished();
  await screen.findByRole("button", { name: "Import 2 texts" });
  await act(async () => { resolve(job(31, "failed", null, "old reply")); });
  expect(screen.queryByText(/old reply/)).toBeNull();
});

it("does not start polling for a create response from a previous project", async () => {
  let resolve!: (value: { upload_id: number; job_id: number }) => void;
  vi.mocked(api.createUpload).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const { rerender } = render(<UploadPanel projectKey="old" languages={[]} onImported={vi.fn()} />);
  await choose("x.json", "{}");
  fireEvent.click(footer().getByRole("button", { name: "Check" }));
  rerender(<UploadPanel projectKey="new" languages={[]} onImported={vi.fn()} />);
  await act(async () => { resolve({ upload_id: 7, job_id: 11 }); });
  expect(api.getJob).not.toHaveBeenCalled();
});

const bundleFiles = [{ filename: "first.zip", sha256: "1".repeat(64), size: 10 }, { filename: "second.zip", sha256: "2".repeat(64), size: 10 }];

it("groups problems per uploaded file with counts and at most three examples", () => {
  const issue = (unit: string, code = "TEXT_EMPTY", message = "Text is empty") => ({ code, unit, message, severity: "error" as const });
  render(<UploadPreview kind="t1" files={bundleFiles} plan={{ ...plan, committable: false, documents: [doc("doc-9", "de", { label: "second.zip/documents/9.json" })],
    errors: [issue("first.zip/a.json"), issue("first.zip/b.json"), issue("first.zip/c.json"), issue("first.zip/d.json"), issue("doc-9", "PIN_MISMATCH", "Other pin"), issue("", "LANGUAGE_NOT_IN_PROJECT", "Language is not enabled")] }} />);
  const first = screen.getByRole("region", { name: "Problems in first.zip" });
  expect(within(first).getByRole("heading").textContent).toBe("first.zip: 4 problems");
  expect(within(first).getByText("The uploaded text is empty.")).toBeTruthy();
  expect(within(first).getAllByText(/: Text is empty$/).map(item => item.textContent)).toEqual(["a.json: Text is empty", "b.json: Text is empty", "c.json: Text is empty"]);
  expect(within(first).getByText("and 1 more")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Problems in second.zip" })).getByText("doc-9: Other pin")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Problems in Whole upload" })).toBeTruthy();
  // Hashes only behind "Technical details".
  expect(document.body.textContent).not.toContain("1".repeat(12));
});

it("offers to switch the format when plain text was uploaded as a bundle, and the other way round", () => {
  const onSwitch = vi.fn();
  const { unmount } = render(<UploadPreview kind="t1" files={[{ filename: "note.txt", sha256: "1".repeat(64), size: 3 }]} onSwitchFormat={onSwitch}
    plan={{ ...plan, committable: false, errors: [{ code: "schema_version", unit: "note.txt", message: "invalid None", severity: "error" }] }} />);
  expect(screen.getByText(/look like plain text/)).toBeTruthy();
  expect(screen.getByText("The file has no valid ontospan schema version. Is it an ontospan file, or plain text?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Switch to Plain text" }));
  expect(onSwitch).toHaveBeenCalledWith("text");
  unmount();
  render(<UploadPreview kind="text" files={[{ filename: "bundle.zip", sha256: "1".repeat(64), size: 3 }]} onSwitchFormat={onSwitch}
    plan={{ ...plan, committable: false, errors: [{ code: "UNSUPPORTED_FILE", unit: "bundle.zip/manifest.json", message: "Expected a .txt file", severity: "error" }] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch to Ontospan bundle" }));
  expect(onSwitch).toHaveBeenLastCalledWith("t1");
});

it("switching the format discards the upload and returns to step 1 with the files kept", async () => {
  vi.mocked(api.getUpload).mockResolvedValue({ ...view, kind: "t1", status: "invalid", preview: { ...plan, committable: false, errors: [{ code: "schema_version", unit: "case.txt", message: "invalid None", severity: "error" }] } });
  render(<UploadPanel projectKey="p" languages={["en"]} onImported={vi.fn()} />);
  // A .txt file chosen while the format is still "Ontospan bundle" (the file picker filter can be bypassed).
  fireEvent.change(screen.getByLabelText("Files"), { target: { files: [new File(["text"], "case.txt")] } });
  fireEvent.click(footer().getByRole("button", { name: "Check" }));
  const line = await screen.findByText("Checked 1 file: problems found. Nothing can be imported.");
  expect(line.getAttribute("role")).toBe("alert");
  fireEvent.click(screen.getByRole("button", { name: "Switch to Plain text" }));
  await waitFor(() => expect(api.discardUpload).toHaveBeenCalledWith("p", 7));
  expect((await screen.findByLabelText("Format") as HTMLSelectElement).value).toBe("text");
  expect(within(screen.getByRole("list", { name: "Chosen files" })).getByText("case.txt")).toBeTruthy();
});

it("keeps hashes, upload numbers and set IDs inside Technical details and shows no None cells", () => {
  const detailed: ImportPlan = { ...plan,
    warnings: [{ code: "WARN", unit: "y.json", message: "Ontospan warning", severity: "warning" }],
    duplicates: [{ document_id: "case", text_sha256: "a".repeat(64), same_text_as: ["other"] }],
    proposal_sets: [{ document_id: "case", annotation_set_id: "set-internal-id", bundle_id: "bundle-internal-id", manifest_sha256: "c".repeat(64), set_kind: "tool", action: "already_imported",
      actors: [{ kind: "tool", name: "Recognizer", version: "2", model: "M", run_id: "run-internal" }], payload: {},
      proposals: { annotations: [], evidence: [], defaulted_axes: 0, notes: { ann: ["Imported note"] } },
      refused: [{ annotation_id: "r", rule: "hidden_axis_value", detail: { axis: "certainty" } }],
    }],
  };
  render(<UploadPreview plan={detailed} files={files} uploadId={7} />);
  const text = () => document.body.textContent ?? "";
  for (const hidden of ["set-internal-id", "bundle-internal-id", "run-internal", "c".repeat(12), "real-plan", "input-hash", "Upload7"]) expect(text()).not.toContain(hidden);
  expect(text()).not.toMatch(/\bNone\b/);
  expect(screen.getByText("Recognizer 2 model M: 0 proposals in 1 text, 1 refused, 1 set already imported")).toBeTruthy();
  expect(screen.getByText("1 proposal refused by the project rules.")).toBeTruthy();
  expect(screen.getByText("1 text with the same text as another text.")).toBeTruthy();
  fireEvent.click(screen.getByText("Technical details"));
  for (const shown of ["set-internal-id", "bundle-internal-id", "run-internal", "c".repeat(64), "real-plan", "input-hash", "hidden_axis_value", "certainty", "Imported note"]) expect(text()).toContain(shown);
});

it("shows notes one line each with a Show disclosure", () => {
  render(<UploadPreview plan={plan} kind="text" />);
  const note = screen.getByText("1 text normalized to Unicode NFC.").closest("li")!;
  const show = within(note).getByRole("button", { name: "Show: 1 text normalized to Unicode NFC." });
  expect(show.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(show);
  expect(within(note).getByText("other en")).toBeTruthy();
  expect(within(note).getByRole("button", { name: /^Hide/ }).getAttribute("aria-expanded")).toBe("true");
});

it("plain text: a note maps each file name to its text ID, a bundle has none (#174)", () => {
  const view = render(<UploadPreview kind="text" plan={{ ...plan, documents: [doc("case-1"), doc("case-2", "en", { label: "texts.zip/case-2.txt" })] }} />);
  const note = screen.getByText("Text IDs are the file names without .txt, for example case-1.txt → case-1.").closest("li")!;
  fireEvent.click(within(note).getByRole("button", { name: /^Show: Text IDs/ }));
  expect(within(note).getByText("texts.zip/case-2.txt → case-2")).toBeTruthy();
  view.unmount();
  render(<UploadPreview kind="t1" plan={{ ...plan, documents: [doc("case-1")] }} />);
  expect(screen.queryByText(/^Text IDs are the file names/)).toBeNull();
});

it("warns about bundle languages the project does not list but still allows the import (OQ1)", () => {
  render(<UploadPreview kind="t1" projectLanguages={["de"]} plan={{ ...plan, documents: [doc("a", "de"), doc("b", "es"), doc("c", "fr")] }} />);
  expect(screen.getByText("es, fr are not a project language: 2 texts will be imported anyway.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("pages the collapsed text list by 25 rows with case-ID and kind filters", () => {
  const documents = Array.from({ length: 60 }, (_, index) => doc(`case-${String(index + 1).padStart(3, "0")}`, "en", { action: index < 5 ? "unchanged" : "add" }));
  render(<UploadPreview kind="text" plan={{ ...plan, documents }} />);
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(screen.getByText("Texts in this upload (60)"));
  const table = () => screen.getByRole("table", { name: "Texts in this upload" });
  expect(within(table()).getAllByRole("row")).toHaveLength(TEXT_PAGE_SIZE + 1);
  expect(screen.getByText("1–25 of 60 texts")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("26–50 of 60 texts")).toBeTruthy();
  expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Text ID"), { target: { value: "case-01" } });
  expect(screen.getByText("1–10 of 10 texts")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Text ID"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Show"), { target: { value: "existing" } });
  expect(screen.getByText("1–5 of 5 texts")).toBeTruthy();
  expect(within(table()).getAllByText("Already in the project")).toHaveLength(5);
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
  await choose();
  fireEvent.click(footer().getByRole("button", { name: "Check" }));
  fireEvent.click(await screen.findByRole("button", { name: "Annotate, de" }));
  expect(screen.getByRole("columnheader", { name: "Versions in upload" })).toBeTruthy();
  fireEvent.click(screen.getByText("Adjust per case…"));
  fireEvent.click(screen.getByRole("button", { name: "Translation review, case-1 de" }));
  fireEvent.click(screen.getByRole("button", { name: "Import 1 text" }));
  await waitFor(() => expect(api.commitUpload).toHaveBeenCalledWith("p", 7, "real-plan", undefined, {
    plan_languages: { de: { review: true, annotate: false } },
    plan_cases: [{ case_id: "case-1", language: "de", review: false, annotate: false }],
  }));
});

it("explains an unreadable archive in words and hides the preview summary", () => {
  render(<UploadPreview plan={{ ...plan, committable: false, errors: [{ code: "invalid_archive", unit: "bad.pdf", message: "cannot decode ZIP archive: File is not a zip file", severity: "error" }] }} files={[{ filename: "bad.pdf", sha256: "1".repeat(64), size: 1 }]} />);
  expect(screen.getByText("The archive could not be read. Check the ZIP file.")).toBeTruthy();
  expect(document.querySelector(".upload-summary")).toBeNull();
});
