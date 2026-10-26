import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AnnotationSnapshot, type AssignmentSubmissionView, type RoundInputView, type Submission, type SubmissionHistoryDetail, type WorkRoundView } from "../src/api/client";
import { CaseScreen } from "../src/app/CaseScreen";
import { formatTime } from "../src/app/submissionLabels";
import { TaskEditor } from "../src/tasks/TaskEditor";
import { assigned, workspaceFixture } from "./assignments";
import { historical } from "./variantFixtures";

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_project, terms) => terms.map(term => ({ ...term, label: "Seizure" })) as never);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const at = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).toISOString();
const round1At = at(19, 0, 16), round2At = at(19, 0, 57);
const row = (id: string, ordinal: number | null, recorded: string, findings: number, roundId: string | null = `round-${ordinal}`): AssignmentSubmissionView =>
  ({ submission_id: id, round_id: roundId, round_ordinal: ordinal, recorded_at: recorded, finding_count: findings, document_id: "doc", language: "de", version: 1 });
// Newest first from the server; the list shows them oldest first.
const rows = [row("sub-2", 2, round2At, 2), row("sub-1", 1, round1At, 1)];

const snapshot = (id: string, term = "HP:old"): AnnotationSnapshot => {
  const copy = structuredClone(historical.annotations[0]);
  copy.annotation.annotation_id = id; copy.annotation.term_id = term; copy.document_id = "doc"; copy.annotation.document_id = "doc";
  return copy;
};
const carriedInput = (id: string, source: AnnotationSnapshot, target: AnnotationSnapshot | null): RoundInputView => ({
  input_id: id, source_submission_id: "sub-1", source_ref: { annotation_id: source.annotation.annotation_id, version: source.version },
  source_snapshot: source, target_snapshot: target, mapping_status: target ? "carried" : "needs_review", source_round_ordinal: 1,
});
const detail = (id: string, carried: boolean): SubmissionHistoryDetail => ({
  summary: { submission_id: id, document_id: "doc", author_label: "alice", created_at: carried ? round2At : round1At, mode: "independent", round_id: carried ? "round-2" : "round-1", guideline_withdrawn: false },
  annotations: [snapshot("kept")], evidence: [], decisions: [], checked_layer_ids: [], document_checked: true, reanchor_inputs: [], reanchor_resolutions: [],
  round_inputs: carried ? [carriedInput("in-1", snapshot("gone", "HP:gone"), null)] : [],
  round_input_resolutions: carried ? [{ input_id: "in-1", outcome: "dismissed", reason: "Not in this text" }] : [],
});

function renderAssignmentCase(props: Record<string, unknown> = {}) {
  const view = workspaceFixture().view;
  view.key.round_id = "round-3"; view.draft.key = view.key;
  return render(<CaseScreen view={view} workspaceId="ws-mine" onClose={vi.fn()} roundOrdinal={3}
    versionContext={{ canBrowseVersions: false, username: "alice", assignmentId: 7, onNavigate: vi.fn() }} {...props} />);
}
const mine = () => screen.getByRole("region", { name: "My submissions" });

describe("My submissions", () => {
  it("lists own submissions across rounds oldest first with the unsubmitted current round", async () => {
    const list = vi.spyOn(api, "listAssignmentSubmissions").mockResolvedValue(rows);
    renderAssignmentCase();
    expect(within(mine()).getByRole("heading", { name: "My submissions" })).toBeDefined();
    const first = await within(mine()).findByText(`Round 1, ${formatTime(round1At)}, 1 finding`);
    const items = within(mine()).getAllByRole("listitem").map(item => item.textContent);
    expect(items[0]).toContain(first.textContent);
    expect(items[1]).toContain(`Round 2, ${formatTime(round2At)}, 2 findings`);
    expect(items[2]).toBe("Round 3, not submitted yet");
    expect(within(mine()).getByRole("button", { name: `View Round 1, ${formatTime(round1At)}` })).toBeDefined();
    expect(within(mine()).getByRole("button", { name: `View Round 2, ${formatTime(round2At)}` })).toBeDefined();
    expect(screen.queryByText("No previous submissions yet.")).toBeNull();
    expect(screen.queryByRole("region", { name: "Submission history" })).toBeNull();
    expect(list).toHaveBeenCalledWith(7);
  });

  it("omits the not-submitted line once the current round has a submission", async () => {
    vi.spyOn(api, "listAssignmentSubmissions").mockResolvedValue([...rows, row("sub-3", 3, at(19, 1, 30), 0)]);
    renderAssignmentCase();
    await within(mine()).findByRole("button", { name: `View Round 3, ${formatTime(at(19, 1, 30))}` });
    expect(within(mine()).queryByText(/not submitted yet/)).toBeNull();
  });

  it("shows a load error with Retry", async () => {
    const list = vi.spyOn(api, "listAssignmentSubmissions").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(rows);
    renderAssignmentCase();
    expect(await within(mine()).findByText("Your submissions could not be loaded.")).toBeDefined();
    fireEvent.click(within(mine()).getByRole("button", { name: "Retry" }));
    await within(mine()).findByRole("button", { name: `View Round 1, ${formatTime(round1At)}` });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("entry point 1: View opens the submission detail with the round label and read-only carried states", async () => {
    vi.spyOn(api, "listAssignmentSubmissions").mockResolvedValue(rows);
    const history = vi.spyOn(api, "getSubmissionHistory").mockImplementation(async (_project, _doc, id) => detail(id, id === "sub-2"));
    renderAssignmentCase();
    fireEvent.click(await within(mine()).findByRole("button", { name: `View Round 1, ${formatTime(round1At)}` }));
    let dialog = await screen.findByRole("dialog", { name: "Historical submission" });
    expect(history).toHaveBeenCalledWith("pkg", "doc", "sub-1");
    expect(within(dialog).getByRole("heading", { name: `Round 1, ${formatTime(round1At)}` })).toBeDefined();
    expect(within(dialog).queryByRole("region", { name: "Carried findings" })).toBeNull();
    fireEvent.click(within(dialog.querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Historical submission" })).toBeNull();

    fireEvent.click(within(mine()).getByRole("button", { name: `View Round 2, ${formatTime(round2At)}` }));
    dialog = await screen.findByRole("dialog", { name: "Historical submission" });
    expect(within(dialog).getByRole("heading", { name: `Round 2, ${formatTime(round2At)}` })).toBeDefined();
    const carried = within(dialog).getByRole("region", { name: "Carried findings" });
    expect(within(carried).getByText("Dismissed")).toBeDefined();
    expect(within(carried).getByText("Dismissal reason: Not in this text")).toBeDefined();
    expect(within(carried).getByText("Carried from Round 1")).toBeDefined();
  });

  it("entry point 2: an editor without an assignment keeps the Submission history list on raw submissions", () => {
    const view = workspaceFixture().view;
    const base = { format_version: "ontocurator-submission/v2", origin_key: view.key, targets: view.targets!, draft_revision: 1,
      decisions: [], document_checked: true, created_at: new Date(2026, 9, 17, 9, 5).toISOString() };
    view.submissions = [{ ...base, submission_id: "raw-1", snapshots: [snapshot("raw-finding", "HP:0001250")] }];
    const list = vi.spyOn(api, "listAssignmentSubmissions");
    render(<CaseScreen view={view} workspaceId="ws-raw" onClose={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "My submissions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submission 1, 17 Oct 2026, 09:05" }));
    const dialog = screen.getByRole("dialog", { name: "Historical submission" });
    expect(within(dialog).getByRole("heading", { name: "Submission 1, 17 Oct 2026, 09:05" })).toBeDefined();
    fireEvent.click(within(dialog).getByText("Technical details"));
    expect(within(dialog).getByText("raw-1")).toBeDefined();
    expect(list).not.toHaveBeenCalled();
  });

  it("entry point 3: View submitted result opens the just-submitted submission and the list reloads", async () => {
    const list = vi.spyOn(api, "listAssignmentSubmissions").mockResolvedValue(rows);
    const view = workspaceFixture().view;
    view.key.round_id = "round-3"; view.draft.key = view.key;
    const submitted: Submission = { format_version: "ontocurator-submission/v2", origin_key: view.key, targets: view.targets!, draft_revision: 1,
      snapshots: [], decisions: [], document_checked: true, created_at: at(19, 2, 5), submission_id: "fresh-submission" };
    vi.spyOn(api, "submitWorkspace").mockResolvedValue(submitted);
    render(<CaseScreen view={view} workspaceId="ws-submit" onClose={vi.fn()} roundOrdinal={3}
      versionContext={{ canBrowseVersions: false, username: "alice", assignmentId: 7, onNavigate: vi.fn() }} />);
    await within(mine()).findByText("Round 3, not submitted yet");
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit/ }));
    const confirm = await screen.findByRole("dialog", { name: "Submit case" });
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Submit case" })); });
    const receipt = await screen.findByRole("dialog", { name: "Case submitted" });
    fireEvent.click(within(receipt).getByRole("button", { name: "View submitted result" }));
    const dialog = screen.getByRole("dialog", { name: "Historical submission" });
    expect(within(dialog).getByRole("heading", { name: `Round 3, ${formatTime(at(19, 2, 5))}` })).toBeDefined();
    fireEvent.click(within(dialog).getByText("Technical details"));
    expect(within(dialog).getByText("fresh-submission")).toBeDefined();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe("TaskEditor round identity wiring", () => {
  const round3: WorkRoundView = { round_id: "round-3", project_key: "pkg", assignment_id: 1, document_id: "doc", annotator_id: "alice", kind: "carry_forward",
    mode: "independent", state: "editable", workflow_revision: 3, input_manifest_sha256: "m", input_submission_ids: ["sub-2"], active: true,
    round_ordinal: 3, submission_count: 0, input_count: 1, source_round_ordinal: 2, source_submission_recorded_at: round2At,
    document_language: "de", document_version: 1, predecessor_round_id: "round-2" };

  it("passes the badge, identity title, Work rounds label and original evidence source name", async () => {
    const opened = assigned(workspaceFixture());
    opened.assignment.workflow_revision = 3;
    opened.view.key.round_id = "round-3"; opened.view.draft.key = opened.view.key;
    const carried = snapshot("carried");
    opened.view.draft.annotations = [carried];
    const source = snapshot("original");
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(opened.assignment);
    vi.spyOn(api, "openAssignment").mockResolvedValue(opened);
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    vi.spyOn(api, "listProjects").mockResolvedValue([]);
    vi.spyOn(api, "listWorkRounds").mockResolvedValue([round3]);
    vi.spyOn(api, "listRoundSources").mockResolvedValue([]);
    vi.spyOn(api, "listRoundInputs").mockResolvedValue([{ ...carriedInput("in-1", source, carried), source_round_ordinal: 2 }]);
    vi.spyOn(api, "listAssignmentSubmissions").mockResolvedValue([]);
    vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "doc", text: "Patient has seizures.", text_sha256: "text" } as never);
    const { container } = render(<TaskEditor assignmentId={1} user={{ username: "alice", display_name: "Alice", pseudonym: "alice", is_system_admin: false, csrf_token: "csrf" }}
      onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
    const badge = await screen.findByText("Round 3, continued from Round 2");
    expect(badge.getAttribute("title")).toBe(`Round 3, continued from Round 2 submission (${formatTime(round2At)}), de v1`);
    expect(await within(mine()).findByText("Round 3, not submitted yet")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Work rounds" }));
    const rounds = await screen.findByRole("dialog", { name: "Work rounds: doc de" });
    await within(rounds).findByText("You are here");
    fireEvent.click(within(rounds.querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));

    fireEvent.click(container.querySelector<HTMLElement>('[data-list-key="annotation:carried"]')!);
    fireEvent.click(within(screen.getByRole("region", { name: "Carried finding" })).getByRole("button", { name: "Show original evidence" }));
    expect(await screen.findByRole("dialog", { name: "Original finding from Round 2" })).toBeDefined();
  });
});
