import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { DistributionDialog } from "../src/admin/DistributionDialog";
import { assignment, deferred, documents, members, proposal } from "./assignmentFixtures";
beforeEach(() => { vi.spyOn(api, "listCases").mockResolvedValue([]); vi.spyOn(api, "listMembers").mockResolvedValue(members); vi.spyOn(api, "listAssignments").mockResolvedValue([]); vi.spyOn(api, "proposeDistribution").mockResolvedValue(proposal); vi.spyOn(api, "createAssignments").mockResolvedValue({ created: [assignment], refused: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const props = () => ({ projectKey: "p/key", documents, onClose: vi.fn(), onChanged: vi.fn() });
async function propose() { fireEvent.change(await screen.findByLabelText(/^People per document/), { target: { value: "2" } }); await waitFor(() => expect(screen.getByRole("button", { name: "Propose" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Propose" })); await screen.findByText("Proposal"); }
it("shows distinct slots, every unassignable and actual original load before confirmation", async () => {
  render(<DistributionDialog {...props()} />); await propose();
  expect(api.proposeDistribution).toHaveBeenCalledWith("p/key", { document_ids: ["z/doc", "a"], task: "annotate", per_document: 2 });
  expect(screen.getByLabelText("z/doc, person 1")).toHaveProperty("value", "alice"); expect(screen.getByLabelText("z/doc, person 2")).toHaveProperty("value", "bob");
  expect(screen.getByText(/Only 1 reader.*2 places/)).toBeDefined(); expect(screen.getByText(/Alice.*4.*5/)).toBeDefined();
});
it("omits nobody, prevents duplicate document/person and preserves exact server context with edits", async () => {
  const options = props(); render(<DistributionDialog {...options} />); await propose();
  const second = screen.getByLabelText("z/doc, person 2");
  expect(Array.from((second as HTMLSelectElement).options).find(option => option.value === "alice")?.disabled).toBe(true);
  fireEvent.change(second, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(api.createAssignments).toHaveBeenCalled());
  expect(api.createAssignments).toHaveBeenCalledWith("p/key", { task: "annotate", seed: 123, context: proposal.context, confirm_language: false, rows: [{ document_id: "z/doc", username: "alice" }] });
  // A clean save closes the dialog; the caller reports it (#195).
  await waitFor(() => expect(options.onClose).toHaveBeenCalledOnce());
});
it("retries only language refusals with the exact original context and retains unassignables", async () => {
  vi.mocked(api.createAssignments).mockResolvedValueOnce({ created: [assignment], refused: [{ document_id: "a", username: "alice", code: "LANGUAGE_CONFIRMATION_REQUIRED" }] }).mockRejectedValueOnce(new ApiError(409, "Changed after partial success", "DISTRIBUTION_STALE"));
  const options = props(); render(<DistributionDialog {...options} />); await propose(); fireEvent.change(screen.getByLabelText("a, person 1"), { target: { value: "alice" } }); fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.click(await screen.findByRole("button", { name: "Assign anyway" }));
  await waitFor(() => expect(api.createAssignments).toHaveBeenCalledTimes(2));
  expect(api.createAssignments).toHaveBeenLastCalledWith("p/key", { task: "annotate", seed: 123, context: proposal.context, confirm_language: true, rows: [{ document_id: "a", username: "alice" }] });
  expect(vi.mocked(api.createAssignments).mock.calls[1][1].context).toBe(proposal.context);
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Assign anyway" })).toHaveProperty("disabled", true);
  expect(options.onChanged).toHaveBeenCalledOnce();
  expect(screen.getByText(/Only 1 reader.*2 places/)).toBeDefined();
});
it("refreshes all-task project load on each proposal for people chosen as overrides", async () => {
  const charlie = { ...members[0], username: "charlie", display_name: "Charlie" };
  vi.mocked(api.listMembers).mockResolvedValue([...members, charlie]);
  vi.mocked(api.listAssignments).mockResolvedValueOnce([
    { ...assignment, document_id: "previous-open", username: "charlie", task: "review", status: "open" },
    { ...assignment, document_id: "previous-reopened", username: "charlie", status: "reopened" },
    { ...assignment, document_id: "previous-submitted", username: "charlie", status: "submitted" },
    { ...assignment, document_id: "previous-revoked", username: "charlie", status: "in_progress", revoked_at: "2026-10-16T12:00:00Z" },
  ]).mockResolvedValueOnce([]);
  render(<DistributionDialog {...props()} />); await propose();
  fireEvent.change(screen.getByLabelText("z/doc, person 1"), { target: { value: "charlie" } });
  expect(screen.getByText(/Charlie.*2.*3/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Propose again" }));
  await waitFor(() => expect(api.listAssignments).toHaveBeenCalledTimes(2));
  await screen.findByText("Proposal");
  expect(screen.getByText(/Charlie.*0.*0/)).toBeDefined();
});
it.each([
  { label: "open", existing: { ...assignment, status: "open" as const }, before: 1, after: 1 },
  { label: "reopened", existing: { ...assignment, status: "reopened" as const }, before: 1, after: 1 },
  { label: "submitted", existing: { ...assignment, status: "submitted" as const }, before: 0, after: 0 },
  { label: "revoked", existing: { ...assignment, revoked_at: "2026-10-16T12:00:00Z" }, before: 0, after: 1 },
  { label: "other task", existing: { ...assignment, task: "review" as const }, before: 1, after: 2 },
  { label: "other project", existing: { ...assignment, project_key: "another-project" }, before: 0, after: 1 },
])("projects override load using existing $label assignment identity", async ({ existing, before, after }) => {
  vi.mocked(api.listAssignments).mockResolvedValue([existing]);
  vi.mocked(api.proposeDistribution).mockResolvedValue({ ...proposal, rows: [{ ...proposal.rows[1], load_before: 0 }], unassignable: [], per_document: 1, context: { ...proposal.context, document_ids: ["z/doc"], per_document: 1 } });
  render(<DistributionDialog {...props()} documents={[documents[0]]} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Propose" })).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: "Propose" })); await screen.findByText("Proposal");
  fireEvent.change(screen.getByLabelText("z/doc, person 1"), { target: { value: "alice" } });
  expect(screen.getByText(`Alice (A): ${before} now, ${after} after`)).toBeDefined();
  expect(api.listAssignments).toHaveBeenCalledOnce();
  expect(api.createAssignments).not.toHaveBeenCalled();
});
it("requires a fresh server proposal on stale and never submits the previous context again", async () => {
  vi.mocked(api.createAssignments).mockRejectedValue(new ApiError(409, "stale", "DISTRIBUTION_STALE"));
  render(<DistributionDialog {...props()} />); await propose(); fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await screen.findByRole("alert"); expect(screen.getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", true);
  vi.mocked(api.proposeDistribution).mockResolvedValue({ ...proposal, seed: 456, context: { ...proposal.context, seed: 456 } });
  fireEvent.click(screen.getByRole("button", { name: "Propose again" })); await screen.findByText("Proposal");
  expect(vi.mocked(api.proposeDistribution).mock.calls[1][1]).not.toHaveProperty("seed"); expect(api.createAssignments).toHaveBeenCalledOnce();
});
it("prevents duplicate proposals and ignores replies after unmount", async () => {
  const pending = deferred<typeof proposal>(); vi.mocked(api.proposeDistribution).mockReturnValue(pending.promise);
  const options = props(); const view = render(<DistributionDialog {...options} />); const button = await screen.findByRole("button", { name: "Propose" }); fireEvent.click(button); fireEvent.click(button); expect(api.proposeDistribution).toHaveBeenCalledOnce(); view.unmount(); await act(async () => { pending.resolve(proposal); }); expect(options.onChanged).not.toHaveBeenCalled();
});
it("labels people in the identity format with open tasks and accepts a preset task", async () => {
  vi.mocked(api.listMembers).mockResolvedValue(members.map(member => member.username === "bob" ? { ...member, open_tasks: { translation_review: 1, annotate: 2, review: 0 } } : member));
  render(<DistributionDialog projectKey="p/key" documents={[{ document_id: "z/doc", language: "en" }]} task="annotate" onClose={vi.fn()} onChanged={vi.fn()} />);
  expect((await screen.findByLabelText("Task") as HTMLSelectElement).value).toBe("annotate");
  await waitFor(() => expect(screen.getByRole("button", { name: "Propose" })).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: "Propose" })); await screen.findByText("Proposal");
  expect(screen.getAllByRole("option", { name: "Bob (B) — en, de, 3 open tasks" }).length).toBeGreaterThan(0);
  expect(screen.queryByText(/\(bob\)/)).toBeNull();
});
