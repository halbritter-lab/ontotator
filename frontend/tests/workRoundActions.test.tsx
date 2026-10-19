import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkRoundsDialog } from "../src/tasks/WorkRoundsDialog";
import { api, type WorkRoundView } from "../src/api/client";
import { TaskEditor } from "../src/tasks/TaskEditor";
import { historical } from "./variantFixtures";
import { RoundInputEvidenceDialog } from "../src/tasks/RoundInputEvidenceDialog";
import { assigned, workspaceFixture } from "./assignments";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const assignment = { ...assigned(workspaceFixture()).assignment, workflow_revision: 3 };
const source = { submission_id: "exact-source", document_id: "old-document", language: "en", version: 1, created_at: "2026-10-18T12:00:00Z", round_id: null, finding_count: 0 };
const round: WorkRoundView = { round_id: "round-exact", project_key: "pkg", assignment_id: 1, document_id: "doc", annotator_id: "alice", kind: "carry_forward", mode: "independent", state: "submitted", workflow_revision: 3, input_manifest_sha256: "manifest", input_submission_ids: ["exact-source"], active: true, submission_count: 1, input_count: 1 };

function renderRounds(rounds: WorkRoundView[], sources: typeof source[], handlers: { onCreate?: ReturnType<typeof vi.fn>; onOpen?: ReturnType<typeof vi.fn>; assignment?: typeof assignment } = {}) {
  vi.spyOn(api, "listWorkRounds").mockResolvedValue(rounds);
  vi.spyOn(api, "listRoundSources").mockResolvedValue(sources);
  render(<WorkRoundsDialog assignment={handlers.assignment ?? assignment} onClose={vi.fn()} onCreate={handlers.onCreate ?? vi.fn()} onOpen={handlers.onOpen ?? vi.fn()} onReload={vi.fn()} />);
}

it("starts a continued round from one deliberately selected immutable own submission", async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  renderRounds([round], [source], { onCreate: create });
  const option = await screen.findByRole("radio", { name: /Earlier submission · .* · en v1 · 0 findings/ });
  const button = screen.getByRole("button", { name: "Continue from this submission" });
  // No preselection: the button stays focusable, names why it is unavailable and starts nothing.
  expect(option).toHaveProperty("checked", false);
  expect(button).toHaveProperty("disabled", false);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("Choose a submission to continue from.").id).toBe(button.getAttribute("aria-describedby"));
  fireEvent.click(button);
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(option);
  expect(button.getAttribute("aria-disabled")).toBeNull();
  expect(screen.queryByText("Choose a submission to continue from.")).toBeNull();
  fireEvent.click(button);
  await waitFor(() => expect(create).toHaveBeenCalledWith({ request_id: expect.any(String), expected_workflow_revision: 3, kind: "carry_forward", source_submission_ids: ["exact-source"] }));
  expect(screen.queryByRole("button", { name: /Consolidation|restart/i })).toBeNull();
});

it("preserves exact source selection and idempotency identity after a failed start", async () => {
  const create = vi.fn().mockRejectedValueOnce(new Error("The round could not be opened")).mockResolvedValue(undefined);
  renderRounds([], [source], { onCreate: create });
  fireEvent.click(await screen.findByRole("radio", { name: /Earlier submission/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue from this submission" }));
  await screen.findByText("The round could not be opened");
  expect(screen.getByRole("radio", { name: /Earlier submission/ })).toHaveProperty("checked", true);
  fireEvent.click(screen.getByRole("button", { name: "Continue from this submission" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
});

it("opens the exact selected historical round without creating another round", async () => {
  const open = vi.fn().mockResolvedValue(undefined), create = vi.fn();
  renderRounds([{ ...round, active: false }], [], { onCreate: create, onOpen: open });
  fireEvent.click(await screen.findByRole("button", { name: "Open Round 1" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("round-exact"));
  expect(create).not.toHaveBeenCalled();
});

it("serializes repeated start clicks while an ordinary round is opening", async () => {
  let finish!: () => void;
  const create = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  renderRounds([], [], { onCreate: create, assignment: { ...assignment, status: "open", last_submission_id: null } });
  const button = await screen.findByRole("button", { name: "Start empty round" });
  fireEvent.click(button); fireEvent.click(button);
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
});

it("opens the newly created exact round from the real task editor controls", async () => {
  const initial = assigned(workspaceFixture());
  initial.assignment.workflow_revision = 3;
  vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ ...initial.assignment, workflow_revision: 3 });
  vi.spyOn(api, "openAssignment").mockResolvedValue(initial);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  vi.spyOn(api, "resolveTermLabels").mockResolvedValue([]);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listWorkRounds").mockResolvedValue([]);
  vi.spyOn(api, "listRoundSources").mockResolvedValue([source]);
  vi.spyOn(api, "listRoundInputs").mockResolvedValue([]);
  const create = vi.spyOn(api, "startWorkRound").mockResolvedValue({ ...round, state: "editable", workflow_revision: 4 });
  const open = vi.spyOn(api, "openWorkRound").mockResolvedValue({ ...workspaceFixture(), workspace_id: "exact-workspace", view: { ...workspaceFixture().view, key: { ...workspaceFixture().view.key, round_id: "round-exact" } } });
  render(<TaskEditor assignmentId={1} user={{ username: "alice", display_name: "Alice", pseudonym: "alice", is_system_admin: false, csrf_token: "csrf" }} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Work rounds" }));
  fireEvent.click(await screen.findByRole("radio", { name: /Earlier submission/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue from this submission" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(1, expect.objectContaining({ kind: "carry_forward", source_submission_ids: ["exact-source"], expected_workflow_revision: 3 })));
  await waitFor(() => expect(open).toHaveBeenCalledWith("round-exact"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Work rounds" })).toBeNull());
});

function carriedInput() {
  const original = structuredClone(historical.annotations[0]);
  const target = structuredClone(original); target.annotation.annotation_id = "carried"; target.version = "current-version";
  return { input_id: "input", source_submission_id: "exact-submission", source_ref: { annotation_id: original.annotation.annotation_id, version: original.version }, source_snapshot: original, target_snapshot: target, mapping_status: "carried" as const };
}

it("refuses to display an original evidence text with the wrong immutable hash", async () => {
  vi.spyOn(api, "getVariantText").mockResolvedValue({ document_id: "old", text: "Wrong text", text_sha256: "wrong-hash" });
  render(<RoundInputEvidenceDialog projectKey="pkg" input={carriedInput()} onClose={vi.fn()} labelFor={() => null} />);
  await screen.findByText("The exact original evidence text is unavailable.");
  expect(document.querySelector('.text-container')).toBeNull();
});
