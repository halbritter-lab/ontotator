import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProblemReportForm } from "../src/tasks/ProblemReportForm";
import { ProblemReportDetail } from "../src/tasks/ProblemReportDetail";
import { api, type ProblemReportView } from "../src/api/client";
import { assigned, workspaceFixture } from "./assignments";
import { CaseScreen } from "../src/app/CaseScreen";
import { TaskProblemActions } from "../src/tasks/TaskProblemActions";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewWorkspace } from "./translationFixtures";
import type { RouteLeaveGuard } from "../src/app/router";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const assignment = { ...assigned(workspaceFixture()).assignment, workflow_revision: 4, active_round_id: "current-round", last_submission_id: "exact-result" };
const report: ProblemReportView = { report_id: "report-1", project_key: "pkg", assignment_id: 1, document_id: "doc", reporter_id: 1, round_id: "current-round", submission_id: "exact-result", reason: "Conflicting source evidence", state: "open", revision: 2, resolution: null, held_assignment_ids: [1], events: [] };

it("requires an explicit report and preserves unsaved work when saving fails", async () => {
  const create = vi.spyOn(api, "createProblemReport").mockResolvedValue(report);
  const flush = vi.fn().mockRejectedValue(new Error("Offline save")), reported = vi.fn();
  render(<ProblemReportForm assignment={assignment} onSaveBeforeReport={flush} onReported={reported} />);
  expect(screen.getByRole("button", { name: "Report and pause my task" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("textbox", { name: /Problem description/ }), { target: { value: "Conflicting source evidence" } });
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await screen.findByText("Offline save");
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: /Problem description/ })).toHaveProperty("value", "Conflicting source evidence");
  fireEvent.click(screen.getByRole("checkbox", { name: /Keep my unsaved input/ }));
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(1, { request_id: expect.any(String), expected_workflow_revision: 4, round_id: "current-round", submission_id: "exact-result", reason: "Conflicting source evidence" }));
  expect(reported).toHaveBeenCalledWith(report);
});

it("retries an unchanged report with the same request identity", async () => {
  const create = vi.spyOn(api, "createProblemReport").mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(report);
  render(<ProblemReportForm assignment={assignment} onSaveBeforeReport={vi.fn().mockResolvedValue(undefined)} onReported={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: /Problem description/ }), { target: { value: "Conflicting source evidence" } });
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await screen.findByText("Connection lost");
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
});

it("requires exact task selection for hold extension and lead agreement for restart", async () => {
  vi.spyOn(api, "listProblemReports").mockResolvedValue([report]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([assignment, { ...assignment, id: 2, display_name: "Reviewer", task: "review" }]);
  const action = vi.spyOn(api, "actOnProblemReport").mockResolvedValue({ ...report, revision: 3, held_assignment_ids: [1, 2] });
  render(<ProblemReportDetail projectKey="pkg" reportId="report-1" canManage onNavigate={vi.fn()} />);
  await screen.findByText("Conflicting source evidence");
  fireEvent.change(screen.getByRole("combobox", { name: "Report action" }), { target: { value: "extend_hold" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Action reason/ }), { target: { value: "Same conflict affects review" } });
  expect(screen.getByRole("button", { name: "Apply report action" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /Task 2/ }));
  fireEvent.click(screen.getByRole("button", { name: "Apply report action" }));
  await waitFor(() => expect(action).toHaveBeenCalledWith("report-1", expect.objectContaining({ expected_revision: 2, action: "extend_hold", assignment_ids: [2], reason: "Same conflict affects review" })));
  fireEvent.change(screen.getByRole("combobox", { name: "Report action" }), { target: { value: "restart" } });
  expect(screen.getByRole("button", { name: "Apply report action" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /agreed with the task owner/ }));
  fireEvent.click(screen.getByRole("button", { name: "Apply report action" }));
  await waitFor(() => expect(action).toHaveBeenLastCalledWith("report-1", expect.objectContaining({ expected_revision: 3, action: "restart", assignment_ids: [1] })));
});

it("does not fetch private reports when management access is unavailable", () => {
  const list = vi.spyOn(api, "listProblemReports");
  render(<ProblemReportDetail projectKey="pkg" reportId="report-1" canManage={false} onNavigate={vi.fn()} />);
  expect(list).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox", { name: "Report action" })).toBeNull();
});

it("offers only remaining pause releases after report resolution", async () => {
  vi.spyOn(api, "listProblemReports").mockResolvedValue([{ ...report, state: "resolved", resolution: "Clarified with owner" }]);
  vi.spyOn(api, "listAssignments").mockResolvedValue([assignment]);
  const action = vi.spyOn(api, "actOnProblemReport").mockResolvedValue({ ...report, state: "resolved", revision: 3, held_assignment_ids: [] });
  render(<ProblemReportDetail projectKey="pkg" reportId="report-1" canManage onNavigate={vi.fn()} />);
  const select = await screen.findByRole("combobox", { name: "Report action" });
  expect(Array.from(select.querySelectorAll("option")).map(option => option.value)).toEqual(["resume"]);
  expect(select).toHaveProperty("value", "resume");
  fireEvent.click(screen.getByRole("checkbox", { name: /Task 1/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /Action reason/ }), { target: { value: "Release the remaining pause" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply report action" }));
  await waitFor(() => expect(action).toHaveBeenCalledWith("report-1", expect.objectContaining({ action: "resume", expected_revision: 2, assignment_ids: [1] })));
  await screen.findByText("All pauses from this resolved report have been released.");
  expect(screen.queryByRole("button", { name: "Apply report action" })).toBeNull();
});

it("keeps a pending spanless finding in the mounted editor through pause and resume", async () => {
  const view = workspaceFixture().view; view.require_spanless_note = false;
  vi.spyOn(api, "resolveTermLabels").mockResolvedValue([]);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const props = { view, workspaceId: "ws", onClose: vi.fn(), routeLeaveRef };
  const rendered = render(<CaseScreen {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Add finding without a text span" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Reason for no text span/ }), { target: { value: "Local evidence explanation" } });
  rendered.rerender(<CaseScreen {...props} held holdReason="Evidence conflict" />);
  expect(screen.getByRole("textbox", { name: /Reason for no text span/ })).toHaveProperty("value", "Local evidence explanation");
  expect(screen.getByRole("textbox", { name: /Reason for no text span/ })).toHaveProperty("readOnly", true);
  expect(screen.getByRole("button", { name: /Finish & Submit Case/ })).toHaveProperty("disabled", true);
  let leaving!: Promise<boolean>;
  await act(async () => { leaving = routeLeaveRef.current!(); });
  const dialog = await screen.findByRole("dialog", { name: "Paused task has local input" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(await leaving).toBe(false);
  rendered.rerender(<CaseScreen {...props} held={false} />);
  expect(screen.getByRole("textbox", { name: /Reason for no text span/ })).toHaveProperty("value", "Local evidence explanation");
  expect(screen.getByRole("textbox", { name: /Reason for no text span/ })).toHaveProperty("readOnly", false);
});

it("keeps unsaved translation and review choices through a pause without reopening the workspace", async () => {
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  const open = vi.spyOn(api, "openTranslationReview").mockResolvedValue(reviewWorkspace());
  vi.spyOn(api, "saveTranslationReviewDraft").mockRejectedValue(new Error("Offline save"));
  const props = { assignmentId: 17, username: "alice", onNavigate: vi.fn(), routeLeaveRef: { current: null }, leaveGuardRef: { current: null } };
  const rendered = render(<TranslationReviewScreen {...props} />);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(screen.getByRole("radio", { name: "Accepted with corrections" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Local corrected translation" } });
  rendered.rerender(<TranslationReviewScreen {...props} held holdReason="Conflicting evidence" />);
  expect(screen.getByRole("textbox", { name: "Translation (de)" })).toHaveProperty("value", "Local corrected translation");
  expect(screen.getByRole("textbox", { name: "Translation (de)" })).toHaveProperty("readOnly", true);
  rendered.rerender(<TranslationReviewScreen {...props} held={false} />);
  expect(screen.getByRole("textbox", { name: "Translation (de)" })).toHaveProperty("value", "Local corrected translation");
  expect(screen.getByRole("radio", { name: "Accepted with corrections" })).toHaveProperty("checked", true);
  expect(open).toHaveBeenCalledTimes(1);
});

it("can resume a translation first opened while held without treating the hold as immutable submission", async () => {
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  const workspace = reviewWorkspace(); workspace.assignment.held = true; workspace.read_only = true;
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  const save = vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 7 });
  const props = { assignmentId: 17, username: "alice", onNavigate: vi.fn(), routeLeaveRef: { current: null }, leaveGuardRef: { current: null } };
  const rendered = render(<TranslationReviewScreen {...props} held />);
  expect(await screen.findByRole("textbox", { name: "Translation (de)" })).toHaveProperty("readOnly", true);
  const saveBeforeReportRef: { current: (() => Promise<void>) | null } = { current: null };
  rendered.rerender(<TranslationReviewScreen {...props} held={false} saveBeforeReportRef={saveBeforeReportRef} />);
  fireEvent.click(screen.getByRole("radio", { name: "Accepted with corrections" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Resumed correction" } });
  await act(async () => { await saveBeforeReportRef.current!(); });
  expect(save).toHaveBeenCalledWith(17, expect.objectContaining({ expected_revision: 6, text: "Resumed correction" }));
});

it("resumes only the selected own report pause and refreshes task metadata", async () => {
  vi.spyOn(api, "listProblemReports").mockResolvedValue([report]);
  const action = vi.spyOn(api, "actOnProblemReport").mockResolvedValue({ ...report, revision: 3, held_assignment_ids: [] });
  vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ ...assignment, held: false });
  const refresh = vi.fn();
  render(<TaskProblemActions assignment={{ ...assignment, held: true, hold_reason: report.reason }} onSaveBeforeReport={vi.fn()} onRefresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "My problem reports" }));
  fireEvent.change(await screen.findByRole("textbox", { name: /Reason to resume/ }), { target: { value: "Lead clarified the conflict" } });
  fireEvent.click(screen.getByRole("button", { name: "Resume my task" }));
  await waitFor(() => expect(action).toHaveBeenCalledWith("report-1", expect.objectContaining({ action: "resume", expected_revision: 2, assignment_ids: [1], reason: "Lead clarified the conflict" })));
  await waitFor(() => expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ held: false })));
});
