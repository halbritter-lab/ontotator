import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView, type ProblemReportView } from "../../src/api/client";
import { TaskProblemActions } from "../../src/tasks/TaskProblemActions";
import { event, hold, report } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const OWN_REASON = "Text is cut off after the second paragraph\nMore detail";
const OWN_TITLE = "Text is cut off after the second paragraph";
const T1 = "2026-10-19T01:13:00Z";

function task(over: Partial<AssignmentView> = {}): AssignmentView {
  return { id: 4, workflow_revision: 3, held: false, hold_reason: null, active_holds: [], project_key: "p", document_id: "accepted-translation/de",
    user_id: 9, display_name: "Ann", username: "ann", pseudonym: "ann-0004", task: "annotate", status: "in_progress", created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z", revoked_at: null, last_submission_id: null, active_round_id: "round-2", ...over } as AssignmentView;
}
const pausedTask = (over: Partial<AssignmentView> = {}) => task({ held: true, hold_reason: OWN_REASON, workflow_revision: 4,
  active_holds: [{ reason: OWN_REASON, created_at: "2026-10-19T01:12:00Z", own_report_id: "r1" }], ...over });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const footer = () => {
  const actions = screen.getByRole("dialog").querySelector<HTMLElement>(":scope > .modal-actions");
  expect(actions).not.toBeNull();
  return within(actions!);
};
const entry = () => screen.getByRole("button", { name: /^Report a text problem/ });

function setup({ reports = [] as ProblemReportView[], assignment = task(), metadata }: { reports?: ProblemReportView[]; assignment?: AssignmentView; metadata?: AssignmentView } = {}) {
  const list = vi.spyOn(api, "listTaskProblemReports").mockResolvedValue(reports);
  const meta = vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(metadata ?? assignment);
  const onRefresh = vi.fn();
  const save = vi.fn().mockResolvedValue(undefined);
  const view = render(<TaskProblemActions assignment={assignment} onSaveBeforeReport={save} onRefresh={onRefresh} />);
  return { list, meta, onRefresh, save, view };
}

describe("reporter toolbar entry", () => {
  it("names the entry by its visible text plus the state", async () => {
    setup();
    await waitFor(() => expect(api.listTaskProblemReports).toHaveBeenCalledWith("p", 4));
    expect(entry().textContent).toContain("Report a text problem");
    expect(screen.getByRole("button", { name: "Report a text problem for this task" })).toBeTruthy();
    cleanup();
    setup({ reports: [report({ holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004", released_at: T1 })] })] });
    expect(await screen.findByRole("button", { name: "Report a text problem 1 open report" })).toBeTruthy();
    expect(screen.getByText("1 open")).toBeTruthy();
    cleanup();
    setup({ reports: [report()], assignment: pausedTask() });
    const button = await screen.findByRole("button", { name: "Report a text problem Task paused, 1 open report" });
    const badge = button.querySelector(".problem-badge")!;
    expect(badge.textContent).toBe("Paused, 1 open");
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("shows no badge when the count load fails", async () => {
    vi.spyOn(api, "listTaskProblemReports").mockRejectedValue(new Error("offline"));
    render(<TaskProblemActions assignment={task()} onSaveBeforeReport={vi.fn()} onRefresh={vi.fn()} />);
    await waitFor(() => expect(api.listTaskProblemReports).toHaveBeenCalled());
    await act(async () => undefined);
    expect(entry().querySelector(".problem-badge")).toBeNull();
    expect(entry().textContent).toContain("Report a text problem");
  });
});


describe("reporter dialog", () => {
  it("opens in the new report view when there is no report and focuses the textarea", async () => {
    setup();
    await waitFor(() => expect(api.listTaskProblemReports).toHaveBeenCalled());
    await act(async () => undefined);
    fireEvent.click(entry());
    expect(screen.getByRole("dialog", { name: "New problem report" })).toBeTruthy();
    const textarea = screen.getByRole("textbox", { name: /What is the problem\?/ });
    expect(textarea.getAttribute("rows")).toBe("6");
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(screen.getByText("Only you and project leads can read this.")).toBeTruthy();
    expect(screen.getByText("Reporting pauses this task: you cannot save or submit until the pause is released. Your saved work stays.")).toBeTruthy();
    expect(footer().getByRole("button", { name: "Report and pause my task" })).toBeTruthy();
    expect(footer().getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("loads the list on open without a Reload button and ignores an older slower response", async () => {
    const first = deferred<ProblemReportView[]>(), second = deferred<ProblemReportView[]>();
    const list = vi.spyOn(api, "listTaskProblemReports").mockReturnValueOnce(Promise.resolve([report()]))
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(pausedTask());
    render(<TaskProblemActions assignment={pausedTask()} onSaveBeforeReport={vi.fn()} onRefresh={vi.fn()} />);
    await screen.findByRole("button", { name: /1 open report/ });
    fireEvent.click(entry());
    expect(list).toHaveBeenCalledTimes(2);
    fireEvent.focus(window);
    expect(list).toHaveBeenCalledTimes(3);
    await act(async () => { second.resolve([report({ reason: "Newest view" })]); });
    await act(async () => { first.resolve([report({ reason: "Stale view" })]); });
    expect(screen.getByRole("heading", { name: "Newest view" })).toBeTruthy();
    expect(screen.queryByText("Stale view")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reload/ })).toBeNull();
  });

  it("refreshes reports and the task together on window focus after an external lead action", async () => {
    const released = report({ holds: [hold({ active: false, release_action: "resume", released_by_label: "lead-0002", released_at: T1 })], withdrawable: false });
    const list = vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([report()]);
    const meta = vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(pausedTask());
    const onRefresh = vi.fn();
    const view = render(<TaskProblemActions assignment={pausedTask()} onSaveBeforeReport={vi.fn()} onRefresh={onRefresh} />);
    await screen.findByRole("button", { name: /Task paused, 1 open report/ });
    fireEvent.click(entry());
    await screen.findByRole("heading", { name: OWN_TITLE });
    expect(screen.getByText("Your task: Paused")).toBeTruthy();
    expect(screen.getByText(`Paused by your report "${OWN_TITLE}".`)).toBeTruthy();
    expect(onRefresh).not.toHaveBeenCalled(); // nothing changed: no refresh loop

    // An older focus pair resolves after the newest one and is discarded as a whole.
    const staleList = deferred<ProblemReportView[]>(), staleMeta = deferred<AssignmentView>();
    list.mockReturnValueOnce(staleList.promise).mockResolvedValueOnce([released]);
    meta.mockReturnValueOnce(staleMeta.promise).mockResolvedValueOnce(task({ workflow_revision: 5 }));
    fireEvent.focus(window);
    fireEvent.focus(window);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({ held: false, workflow_revision: 5 }));
    await act(async () => { staleList.resolve([report()]); staleMeta.resolve(pausedTask({ workflow_revision: 9 })); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    view.rerender(<TaskProblemActions assignment={task({ workflow_revision: 5 })} onSaveBeforeReport={vi.fn()} onRefresh={onRefresh} />);
    expect(screen.getByText("Your task: Active")).toBeTruthy();
    expect(screen.getByText(/Resumed by lead-0002/)).toBeTruthy();

    // A lead pause added elsewhere.
    const leadPaused = task({ held: true, hold_reason: "Wait for the glossary", workflow_revision: 6,
      active_holds: [{ reason: "Wait for the glossary", created_at: "2026-10-19T02:00:00Z", own_report_id: null }] });
    meta.mockResolvedValue(leadPaused);
    fireEvent.focus(window);
    await waitFor(() => expect(onRefresh).toHaveBeenLastCalledWith(leadPaused));
    view.rerender(<TaskProblemActions assignment={leadPaused} onSaveBeforeReport={vi.fn()} onRefresh={onRefresh} />);
    expect(screen.getByText("Paused by a project lead: Wait for the glossary. Only a project lead can release this pause.")).toBeTruthy();
  });

  it("keeps footer actions in the footer: New report and Close only", async () => {
    setup({ reports: [report({ holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004", released_at: T1 })] })] });
    await screen.findByRole("button", { name: /1 open report/ });
    fireEvent.click(entry());
    const dialog = screen.getByRole("dialog", { name: "Problems with Task 4" });
    const buttons = within(dialog.querySelector<HTMLElement>(":scope > .modal-actions")!).getAllByRole("button").map(b => b.textContent);
    expect(buttons).toEqual(["New report", "Close"]);
    await waitFor(() => expect(document.activeElement).toBe(footer().getByRole("button", { name: "New report" })));
  });

  it("focuses the report heading whose own pause is active", async () => {
    setup({ reports: [report()], assignment: pausedTask() });
    await screen.findByRole("button", { name: /Task paused/ });
    fireEvent.click(entry());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: OWN_TITLE })));
    expect(screen.getByText("Your reports (1)")).toBeTruthy();
  });

  it("rejects an empty report and sends nothing", async () => {
    const create = vi.spyOn(api, "createProblemReport");
    setup();
    await act(async () => undefined);
    fireEvent.click(entry());
    fireEvent.click(footer().getByRole("button", { name: "Report and pause my task" }));
    expect(await screen.findByText("Describe the problem.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /What is the problem\?/ }));
    expect(create).not.toHaveBeenCalled();
  });

  it("requires the checkbox to report after a failed save", async () => {
    const create = vi.spyOn(api, "createProblemReport").mockResolvedValue(report());
    vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([]);
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(task());
    const save = vi.fn().mockRejectedValue(new Error("Offline save"));
    render(<TaskProblemActions assignment={task()} onSaveBeforeReport={save} onRefresh={vi.fn()} />);
    await act(async () => undefined);
    fireEvent.click(entry());
    fireEvent.change(screen.getByRole("textbox", { name: /What is the problem\?/ }), { target: { value: "Broken text" } });
    const primary = footer().getByRole("button", { name: "Report and pause my task" });
    fireEvent.click(primary);
    expect(await screen.findByText("Your latest changes could not be saved. Nothing was reported.")).toBeTruthy();
    expect(primary.getAttribute("aria-disabled")).toBe("true");
    expect(primary.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(primary.getAttribute("aria-describedby")!)?.textContent).toBe("Check the box to report without saving.");
    fireEvent.click(primary);
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Report anyway. My unsaved changes stay only in this open editor until I resume and save." }));
    expect(primary.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(primary);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding typed text and keeps it on Keep writing", async () => {
    setup({ reports: [report({ state: "resolved", holds: [hold({ active: false })] })] });
    await screen.findByRole("button", { name: /for this task/ });
    fireEvent.click(entry());
    await act(async () => undefined);
    fireEvent.click(footer().getByRole("button", { name: "New report" }));
    const textarea = screen.getByRole("textbox", { name: /What is the problem\?/ });
    fireEvent.change(textarea, { target: { value: "Half written" } });
    fireEvent.click(footer().getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard this report? Your text will be lost.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep writing" }));
    expect(screen.getByRole("textbox", { name: /What is the problem\?/ })).toHaveProperty("value", "Half written");
    fireEvent.keyDown(screen.getByRole("textbox", { name: /What is the problem\?/ }), { key: "Escape" });
    expect(screen.getByText("Discard this report? Your text will be lost.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("dialog", { name: "Problems with Task 4" })).toBeTruthy();
  });

  it("returns to the list with a success message and the new report focused", async () => {
    const created = report({ report_id: "r-new", reason: "Glossary term missing", revision: 1 });
    vi.spyOn(api, "createProblemReport").mockResolvedValue(created);
    const { onRefresh, list, meta } = setup();
    await act(async () => undefined);
    fireEvent.click(entry());
    list.mockResolvedValue([created]);
    meta.mockResolvedValue(pausedTask({ active_holds: [{ reason: "Glossary term missing", created_at: "2026-10-19T01:12:00Z", own_report_id: "r-new" }] }));
    fireEvent.change(screen.getByRole("textbox", { name: /What is the problem\?/ }), { target: { value: "Glossary term missing" } });
    fireEvent.click(footer().getByRole("button", { name: "Report and pause my task" }));
    expect(await screen.findByText("Reported. Your task is paused until you or a project lead resume it.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Problems with Task 4" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Glossary term missing" })));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({ held: true })));
  });

  it("maps a create conflict to a kept text and Try again with a reloaded task", async () => {
    const create = vi.spyOn(api, "createProblemReport").mockRejectedValueOnce(new ApiError(409, "conflict", "WORKFLOW_REVISION_CONFLICT")).mockResolvedValue(report());
    const { meta, onRefresh } = setup();
    await act(async () => undefined);
    fireEvent.click(entry());
    fireEvent.change(screen.getByRole("textbox", { name: /What is the problem\?/ }), { target: { value: "Broken" } });
    fireEvent.click(footer().getByRole("button", { name: "Report and pause my task" }));
    expect(await screen.findByText("Your task changed in another window or by a project lead. Nothing was reported. Your text is kept.")).toBeTruthy();
    meta.mockResolvedValue(task({ workflow_revision: 8 }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1]).toMatchObject({ expected_workflow_revision: 8, reason: "Broken" });
    expect(create.mock.calls[1][1].request_id).not.toBe(create.mock.calls[0][1].request_id);
    expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({ workflow_revision: 8 }));
  });

  it("states the remaining pauses in the resume confirm and after success", async () => {
    const assignment = pausedTask({ active_holds: [
      { reason: OWN_REASON, created_at: "2026-10-19T01:12:00Z", own_report_id: "r1" },
      { reason: "Wait for the glossary", created_at: "2026-10-19T01:20:00Z", own_report_id: null },
    ] });
    const resumed = report({ revision: 2, withdrawable: false, holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004", released_at: T1 })], events: [event()] });
    const action = vi.spyOn(api, "actOnProblemReport").mockResolvedValue(resumed);
    const { list } = setup({ reports: [report()], assignment });
    await screen.findByRole("button", { name: /Task paused/ });
    fireEvent.click(entry());
    fireEvent.click(await screen.findByRole("button", { name: "Resume my task…" }));
    const group = screen.getByRole("group", { name: "Resume Task 4" });
    expect(within(group).getByText("The report stays open. A project lead decides on it.")).toBeTruthy();
    expect(within(group).getByText("Your task stays paused by a project lead: Wait for the glossary.")).toBeTruthy();
    expect(within(group).getByRole("textbox", { name: /Why can you continue\?/ }).getAttribute("rows")).toBe("3");
    fireEvent.click(within(group).getByRole("button", { name: "Resume my task" }));
    expect(await within(group).findByText("Enter a reason.")).toBeTruthy();
    expect(document.activeElement).toBe(within(group).getByRole("textbox", { name: /Why can you continue\?/ }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(within(group).getByRole("textbox", { name: /Why can you continue\?/ }), { target: { value: "Clarified" } });
    list.mockResolvedValue([resumed]);
    fireEvent.click(within(group).getByRole("button", { name: "Resume my task" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("r1", expect.objectContaining({ action: "resume", expected_revision: 1, reason: "Clarified", assignment_ids: [4] })));
    expect(await screen.findByText("Resumed. Your task is still paused by a project lead.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: OWN_TITLE })));
  });

  it("resume confirm without another pause", async () => {
    vi.spyOn(api, "actOnProblemReport").mockResolvedValue(report({ revision: 2, holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004", released_at: T1 })] }));
    setup({ reports: [report()], assignment: pausedTask() });
    await screen.findByRole("button", { name: /Task paused/ });
    fireEvent.click(entry());
    fireEvent.click(await screen.findByRole("button", { name: "Resume my task…" }));
    const group = screen.getByRole("group", { name: "Resume Task 4" });
    expect(within(group).queryByText(/stays paused by a project lead/)).toBeNull();
    fireEvent.change(within(group).getByRole("textbox", { name: /Why can you continue\?/ }), { target: { value: "Fine now" } });
    fireEvent.click(within(group).getByRole("button", { name: "Resume my task" }));
    expect(await screen.findByText("Resumed. The report stays open.")).toBeTruthy();
  });

  it("offers withdrawal only while withdrawable and sends no task ids", async () => {
    const action = vi.spyOn(api, "actOnProblemReport").mockResolvedValue(report({ state: "withdrawn", revision: 2, withdrawable: false, holds: [hold({ active: false, release_action: "withdraw", released_by_label: "ann-0004", released_at: T1 })] }));
    setup({ reports: [report()], assignment: pausedTask() });
    await screen.findByRole("button", { name: /Task paused/ });
    fireEvent.click(entry());
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw report…" }));
    const group = screen.getByRole("group", { name: "Withdraw report" });
    expect(within(group).getByText("The report is marked Withdrawn. Project leads can still read it.")).toBeTruthy();
    expect(within(group).getByText("Your task's pause from this report is released.")).toBeTruthy();
    fireEvent.change(within(group).getByRole("textbox", { name: /Why are you withdrawing it\?/ }), { target: { value: "Reported by mistake" } });
    fireEvent.click(within(group).getByRole("button", { name: "Withdraw report" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("r1", expect.objectContaining({ action: "withdraw", assignment_ids: [], reason: "Reported by mistake", expected_revision: 1 })));
    expect(await screen.findByText("Withdrawn. Your task is no longer paused by this report.")).toBeTruthy();
  });

  it("does not offer withdrawal after a lead acted and explains the alternative", async () => {
    setup({ reports: [report({ withdrawable: false })], assignment: pausedTask() });
    await screen.findByRole("button", { name: /Task paused/ });
    fireEvent.click(entry());
    await screen.findByRole("heading", { name: OWN_TITLE });
    expect(screen.queryByRole("button", { name: "Withdraw report…" })).toBeNull();
    expect(screen.getByText("A project lead has acted on this report. Resume your task with a reason and ask a project lead to close it.")).toBeTruthy();
  });

  it("shows a conflict when a lead changed the report and reloads the list", async () => {
    vi.spyOn(api, "actOnProblemReport").mockRejectedValue(new ApiError(409, "conflict", "WORKFLOW_REVISION_CONFLICT", { reason: "REPORT_RESOLVED" }));
    const { list } = setup({ reports: [report()], assignment: pausedTask() });
    await screen.findByRole("button", { name: /Task paused/ });
    fireEvent.click(entry());
    fireEvent.click(await screen.findByRole("button", { name: "Resume my task…" }));
    const group = screen.getByRole("group", { name: "Resume Task 4" });
    fireEvent.change(within(group).getByRole("textbox", { name: /Why can you continue\?/ }), { target: { value: "Go" } });
    const before = list.mock.calls.length;
    fireEvent.click(within(group).getByRole("button", { name: "Resume my task" }));
    expect(await screen.findByText(/A project lead changed this report. Nothing was saved./)).toBeTruthy();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });

  it("never renders other tasks to the reporter", async () => {
    setup({ reports: [report({ events: [event()] })], assignment: pausedTask() });
    await screen.findByRole("button", { name: /Task paused/ });
    fireEvent.click(entry());
    await screen.findByRole("heading", { name: OWN_TITLE });
    expect(screen.getByText("Full report and history (2 events)")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).not.toMatch(/Task 7|ann-0005/);
  });
});

describe("reporter confirm discard rule", () => {
  async function openResumeWithText(text: string) {
    setup({ reports: [report()], assignment: pausedTask() });
    await screen.findByRole("button", { name: /Task paused/ });
    fireEvent.click(entry());
    fireEvent.click(await screen.findByRole("button", { name: "Resume my task…" }));
    const group = screen.getByRole("group", { name: "Resume Task 4" });
    const textarea = within(group).getByRole("textbox", { name: /Why can you continue\?/ });
    fireEvent.change(textarea, { target: { value: text } });
    return { group, textarea };
  }
  const discardQuestion = () => screen.queryByText("Discard your reason? Your text will be lost.");

  it("asks before the footer Close drops typed confirmation text", async () => {
    const { textarea } = await openResumeWithText("Clarified");
    fireEvent.click(footer().getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog", { name: "Problems with Task 4" })).toBeTruthy();
    expect(discardQuestion()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep writing" }));
    expect((textarea as HTMLTextAreaElement).value).toBe("Clarified");
    expect(discardQuestion()).toBeNull();
  });

  it("asks before New report drops typed confirmation text", async () => {
    const { textarea } = await openResumeWithText("Clarified");
    fireEvent.click(footer().getByRole("button", { name: "New report" }));
    expect(screen.getByRole("dialog", { name: "Problems with Task 4" })).toBeTruthy();
    expect(discardQuestion()).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe("Clarified");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("group", { name: "Resume Task 4" })).toBeNull();
    fireEvent.click(footer().getByRole("button", { name: "New report" }));
    expect(screen.getByRole("dialog", { name: "New problem report" })).toBeTruthy();
  });

  it("asks on Escape in the confirm textarea but discards on the explicit Cancel", async () => {
    const { group, textarea } = await openResumeWithText("Clarified");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Problems with Task 4" })).toBeTruthy();
    expect(discardQuestion()).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe("Clarified");
    fireEvent.click(screen.getByRole("button", { name: "Keep writing" }));
    expect(discardQuestion()).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(discardQuestion()).toBeNull();
    expect(screen.queryByRole("group", { name: "Resume Task 4" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Problems with Task 4" })).toBeTruthy();
  });
});
