import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProblemReportForm } from "../src/tasks/ProblemReportForm";
import { api, type ProblemReportView } from "../src/api/client";
import { assigned, workspaceFixture } from "./assignments";
import { CaseScreen } from "../src/app/CaseScreen";
import { TaskProblemActions } from "../src/tasks/TaskProblemActions";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewWorkspace } from "./translationFixtures";
import type { RouteLeaveGuard } from "../src/app/router";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const assignment = { ...assigned(workspaceFixture()).assignment, workflow_revision: 4, active_round_id: "current-round", last_submission_id: "exact-result" };
const report: ProblemReportView = { report_id: "report-1", answered: false, project_key: "pkg", assignment_id: 1, document_id: "doc", reporter_id: 1, round_id: "current-round", submission_id: "exact-result", reason: "Conflicting source evidence", state: "open", revision: 2, resolution: null, held_assignment_ids: [1], events: [], reporter_label: "Reporter", case_id: "doc", language: "en", withdrawable: false, viewer_label: "Reporter", viewer_is_lead: false };

it("requires an explicit report and preserves unsaved work when saving fails", async () => {
  const create = vi.spyOn(api, "createProblemReport").mockResolvedValue(report);
  const flush = vi.fn().mockRejectedValue(new Error("Offline save")), reported = vi.fn();
  render(<ProblemReportForm assignment={assignment} onSaveBeforeReport={flush} onReported={reported} />);
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await screen.findByText("Describe the problem.");
  expect(flush).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: /What is the problem\?/ }), { target: { value: "Conflicting source evidence" } });
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await screen.findByText("Your latest changes could not be saved. Nothing was reported.");
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: /What is the problem\?/ })).toHaveProperty("value", "Conflicting source evidence");
  fireEvent.click(screen.getByRole("checkbox", { name: /Report anyway/ }));
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(1, { request_id: expect.any(String), expected_workflow_revision: 4, round_id: "current-round", submission_id: "exact-result", reason: "Conflicting source evidence" }));
  expect(reported).toHaveBeenCalledWith(report);
});

it("retries an unchanged report with the same request identity", async () => {
  const create = vi.spyOn(api, "createProblemReport").mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(report);
  render(<ProblemReportForm assignment={assignment} onSaveBeforeReport={vi.fn().mockResolvedValue(undefined)} onReported={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: /What is the problem\?/ }), { target: { value: "Conflicting source evidence" } });
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await screen.findByText("Connection lost");
  fireEvent.click(screen.getByRole("button", { name: "Report and pause my task" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
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
  expect(screen.queryByRole("button", { name: /Finish & submit text/ })).toBeNull();
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

it("resumes only the selected own report pause, reuses the request identity on retry and refreshes task metadata", async () => {
  const paused = { ...assignment, held: true, hold_reason: report.reason, active_holds: [{ reason: report.reason, created_at: "2026-10-19T01:00:00Z", own_report_id: "report-1" }] };
  vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([report]);
  const action = vi.spyOn(api, "actOnProblemReport").mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue({ ...report, revision: 3, held_assignment_ids: [] });
  const metadata = vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(paused);
  const refresh = vi.fn();
  render(<TaskProblemActions assignment={paused} onSaveBeforeReport={vi.fn()} onRefresh={refresh} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Report a text problem Task paused, 1 open report$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Resume my task…" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Why can you continue\?/ }), { target: { value: "Lead clarified the conflict" } });
  fireEvent.click(screen.getByRole("button", { name: "Resume my task" }));
  await screen.findByText("Could not save. Nothing changed.");
  metadata.mockResolvedValue({ ...assignment, held: false, active_holds: [] });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[0]).toEqual(action.mock.calls[1]);
  expect(action).toHaveBeenCalledWith("report-1", expect.objectContaining({ action: "resume", expected_revision: 2, assignment_ids: [1], reason: "Lead clarified the conflict" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ held: false })));
});
