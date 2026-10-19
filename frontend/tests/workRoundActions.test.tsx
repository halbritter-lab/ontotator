import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkRoundActions } from "../src/tasks/WorkRoundActions";
import { api, type WorkRoundView } from "../src/api/client";
import { TaskEditor } from "../src/tasks/TaskEditor";
import { historical } from "./variantFixtures";
import { RoundInputEvidenceDialog } from "../src/tasks/RoundInputEvidenceDialog";
import { assigned, workspaceFixture } from "./assignments";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const assignment = { ...assigned(workspaceFixture()).assignment, workflow_revision: 3 };
const source = { submission_id: "exact-source", document_id: "old-document", language: "en", version: 1, created_at: "2026-10-18T12:00:00Z", round_id: null };
const round: WorkRoundView = { round_id: "round-exact", project_key: "pkg", assignment_id: 1, document_id: "doc", annotator_id: "alice", kind: "carry_forward", mode: "independent", state: "submitted", workflow_revision: 3, input_manifest_sha256: "manifest", input_submission_ids: ["exact-source"], active: true };

it("starts carry-forward from one deliberately selected immutable own submission", async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  render(<WorkRoundActions assignment={assignment} rounds={[round]} sources={[source]} onCreate={create} onOpen={vi.fn()} onReload={vi.fn()} />);
  const button = screen.getByRole("button", { name: "Start carry-forward round" });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("combobox", { name: "My submitted work to carry forward" }), { target: { value: "exact-source" } });
  fireEvent.click(button);
  await waitFor(() => expect(create).toHaveBeenCalledWith({ request_id: expect.any(String), expected_workflow_revision: 3, kind: "carry_forward", source_submission_ids: ["exact-source"] }));
  expect(screen.queryByRole("button", { name: /Consolidation|restart/i })).toBeNull();
});

it("preserves exact source selection and idempotency identity after a failed start", async () => {
  const create = vi.fn().mockRejectedValueOnce(new Error("The round could not be opened")).mockResolvedValue(undefined);
  render(<WorkRoundActions assignment={assignment} rounds={[]} sources={[source]} onCreate={create} onOpen={vi.fn()} onReload={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", { name: "My submitted work to carry forward" }), { target: { value: "exact-source" } });
  fireEvent.click(screen.getByRole("button", { name: "Start carry-forward round" }));
  await screen.findByText("The round could not be opened");
  expect(screen.getByRole("combobox", { name: "My submitted work to carry forward" })).toHaveProperty("value", "exact-source");
  fireEvent.click(screen.getByRole("button", { name: "Start carry-forward round" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
});

it("opens the exact selected historical round without creating another round", async () => {
  const open = vi.fn().mockResolvedValue(undefined), create = vi.fn();
  render(<WorkRoundActions assignment={assignment} rounds={[{ ...round, active: false }]} sources={[]} onCreate={create} onOpen={open} onReload={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Open round 1" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("round-exact"));
  expect(create).not.toHaveBeenCalled();
});

it("serializes repeated start clicks while an ordinary round is opening", async () => {
  let finish!: () => void;
  const create = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<WorkRoundActions assignment={assignment} rounds={[]} sources={[]} onCreate={create} onOpen={vi.fn()} onReload={vi.fn()} />);
  const button = screen.getByRole("button", { name: "Start empty round" });
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
  fireEvent.change(await screen.findByRole("combobox", { name: "My submitted work to carry forward" }), { target: { value: "exact-source" } });
  fireEvent.click(screen.getByRole("button", { name: "Start carry-forward round" }));
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
