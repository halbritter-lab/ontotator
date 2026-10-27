import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, ConflictError, type DocumentRowsPage, type FinalSelectionSummary, type PauseCandidate, type ProblemReportView } from "../../src/api/client";
import { routeHref } from "../../src/app/router";
import { recordDecision } from "../../src/documents/visitState";
import { ProblemReportDetail } from "../../src/tasks/ProblemReportDetail";
import { event, hold, report } from "./fixtures";

vi.mock("../../src/documents/visitState", async original => ({ ...(await original<typeof import("../../src/documents/visitState")>()), recordDecision: vi.fn() }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.mocked(recordDecision).mockClear(); });

const T1 = "2026-10-19T01:13:00Z", T2 = "2026-10-19T01:20:00Z";
const LEAD = { viewer_label: "lead-0002", viewer_is_lead: true, withdrawable: false };
const leadReport = (over: Partial<ProblemReportView> = {}): ProblemReportView => report({ ...LEAD, ...over });

function rowsPage(final: FinalSelectionSummary | null): DocumentRowsPage {
  return { groups: [{ case_id: "accepted-translation", rows: [{ case_id: "accepted-translation", language: "de", final }] }] } as unknown as DocumentRowsPage;
}

function candidate(over: Partial<PauseCandidate> = {}): PauseCandidate {
  return { assignment_id: 7, owner_label: "ann-0005", case_id: "accepted-translation", language: "en", task: "annotate", same_text: true,
    paused_by_this_report: false, reporter_task: false, ...over };
}

async function setup({ view = leadReport(), documents, action, candidates = [], final = null }: {
  view?: ProblemReportView; documents?: { decision?: string; open?: string[] }; action?: "resume"; candidates?: PauseCandidate[]; final?: FinalSelectionSummary | null;
} = {}) {
  const get = vi.spyOn(api, "getProblemReport").mockResolvedValue(view);
  const act = vi.spyOn(api, "actOnProblemReport");
  const listCandidates = vi.spyOn(api, "listPauseCandidates").mockResolvedValue(candidates);
  vi.spyOn(api, "listDocumentRows").mockResolvedValue(rowsPage(final));
  const navigate = vi.fn();
  render(<ProblemReportDetail projectKey="p" reportId="r1" canManage documents={documents} action={action} onNavigate={navigate} />);
  await screen.findByRole("heading", { level: 1, name: "Problem report" });
  return { get, act, listCandidates, navigate };
}

const intent = (name: RegExp | string) => within(screen.getByRole("group", { name: "Decide on this report" })).getAllByRole("button", { name })
  .find(button => button.hasAttribute("aria-controls"))!;
const confirmBox = (title: string) => screen.getByRole("group", { name: title });
const stateSection = () => screen.getByRole("region", { name: "Current state" });

describe("lead report page structure", () => {
  it("has one h1, the sections and the back link first with the documents query", async () => {
    const documents = { decision: "all", open: ["accepted-translation:de"] };
    const { navigate } = await setup({ documents });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).map(h => h.textContent)).toEqual(["Current state", "Decide", "History"]);
    const back = screen.getAllByRole("link")[0]!;
    expect(back.textContent).toContain("Back to Documents");
    expect(back.getAttribute("href")).toContain("decision=all");
    expect(back.getAttribute("href")).toBe(routeHref({ name: "projectDocuments", key: "p", ...documents }));
    fireEvent.click(back);
    expect(navigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", ...documents });
    expect(screen.getByText("accepted-translation de, Task 4 (ann-0004), Annotation, Round 2", { exact: false })).toBeTruthy();
    expect(screen.getByText("Technical details")).toBeTruthy();
  });

  it("links back to the report's text and language when entered directly", async () => {
    await setup();
    const back = screen.getAllByRole("link")[0]!;
    expect(back.getAttribute("href")).toBe(routeHref({ name: "projectDocuments", key: "p", case: "accepted-translation", language: "de" }));
  });

  it("does not fetch private reports when management access is unavailable", () => {
    const get = vi.spyOn(api, "getProblemReport");
    render(<ProblemReportDetail projectKey="p" reportId="r1" canManage={false} onNavigate={vi.fn()} />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Decide on this report" })).toBeNull();
  });

  it("shows not found and a retryable load failure with the back link", async () => {
    vi.spyOn(api, "getProblemReport").mockRejectedValueOnce(new ApiError(404, "missing", "REPORT_NOT_FOUND"));
    render(<ProblemReportDetail projectKey="p" reportId="r1" canManage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Problem report not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to Documents/ })).toBeTruthy();
    cleanup();
    const get = vi.spyOn(api, "getProblemReport").mockRejectedValueOnce(new ApiError(500, "Server down")).mockResolvedValueOnce(leadReport());
    vi.spyOn(api, "listDocumentRows").mockResolvedValue(rowsPage(null));
    render(<ProblemReportDetail projectKey="p" reportId="r1" canManage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { level: 1, name: "Problem report" });
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("current state panel", () => {
  it("lists active and released pauses with their facts", async () => {
    await setup({ view: leadReport({
      holds: [
        hold({ hold_id: "h-res", assignment_id: 4, active: false, release_action: "resume", released_by_label: "ann-0004", released_at: T1, release_event_id: "e1" }),
        hold({ hold_id: "h-lead", assignment_id: 7, owner_label: "ann-0005", language: "en", active: false, release_action: "resume", released_by_label: "lead-0002", released_at: T2, release_event_id: "e2" }),
        hold({ hold_id: "h-rst", assignment_id: 8, owner_label: "ann-0006", active: false, release_action: "restart", released_by_label: "lead-0002", released_at: T2, release_event_id: "e3" }),
        hold({ hold_id: "h-old", assignment_id: 9, owner_label: "ann-0007", active: false }),
        hold({ hold_id: "h-act", assignment_id: 10, owner_label: "ann-0008", other_active_holds: [{ report_id: "r2" }] }),
      ],
      events: [event({ event_id: "e1", reason: "upsi" }), event({ event_id: "e2", actor_label: "lead-0002", own_task: false, created_at: T2 }),
        event({ event_id: "e3", action: "restart", actor_label: "lead-0002", round_ordinal: 3, abandoned_round_ordinal: 2, created_at: T2 })],
    }) });
    const panel = within(stateSection());
    const items = panel.getAllByRole("listitem").map(li => li.textContent);
    expect(items[0]).toContain("Task 10, ann-0008, accepted-translation de");
    expect(items[0]).toMatch(/Paused since/);
    expect(items[0]).toContain("Also paused by another report");
    expect(items[1]).toMatch(/Resumed by reporter \(ann-0004\), .*, "upsi"/);
    expect(items[2]).toMatch(/Resumed by lead-0002 \(you\), /);
    expect(items[3]).toMatch(/Restarted Round 3 started empty/);
    expect(items[4]).toContain("Released (no record of who released it)");
    expect(panel.getByRole("link", { name: "Open report" }).getAttribute("href")).toBe(routeHref({ name: "projectProblemReport", key: "p", reportId: "r2" }));
    expect(panel.queryByText("None paused now")).toBeNull();
    expect(panel.getByText("Actions on this page never change it.")).toBeTruthy();
  });

  it("says none paused now above released lines and shows the final result", async () => {
    await setup({
      view: leadReport({ holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004", released_at: T1 })] }),
      final: { kind: "annotation", round_ordinal: 1, author_label: "ann-0003", is_mine: false, language: "de", recorded_at: T1 } as FinalSelectionSummary,
    });
    const panel = within(stateSection());
    expect(panel.getByText("None paused now")).toBeTruthy();
    await waitFor(() => expect(stateSection().textContent).toMatch(/Annotation, from scratch, Round 1, ann-0003, /));
    expect(screen.getByText("Nothing is paused by this report. The report is open until you close it.")).toBeTruthy();
  });
});

describe("intents", () => {
  const cases: [string, Partial<ProblemReportView>, Record<string, string | null>][] = [
    ["open with pause", {}, { close: null, release: null, pause: null, restart: null, reopen: "The report is open." }],
    ["open without pause", { holds: [hold({ active: false })] }, { close: null, release: "No task is paused by this report.", pause: null, restart: null, reopen: "The report is open." }],
    ["closed with pause", { state: "resolved" }, { close: "The report is closed.", release: null, pause: "The report is closed.", restart: "The report is closed.", reopen: null }],
    ["withdrawn", { state: "withdrawn", holds: [hold({ active: false })] }, { close: "The report is withdrawn.", release: "No task is paused by this report.", pause: "The report is withdrawn.", restart: "The report is withdrawn.", reopen: null }],
  ];
  it.each(cases)("availability: %s", async (_name, over, expected) => {
    await setup({ view: leadReport(over) });
    const all = within(screen.getByRole("group", { name: "Decide on this report" })).getAllByRole("button");
    // R-16: an open report that pauses a task leads with one primary "Close and resume …"; the rest are "Other decisions".
    const primary = !over.state && !over.holds;
    expect(all[0]!.className.includes("btn-primary")).toBe(primary);
    if (primary) expect(all[0]!.textContent).toBe("Close and resume Task 4…");
    expect(screen.queryByText("Other decisions") !== null).toBe(primary);
    const buttons = primary ? all.slice(1) : all;
    expect(buttons.map(b => b.textContent)).toEqual([over.holds ? "Close report" : "Close report (pauses stay)", "Release pause…", "Pause other tasks…", "Agree empty restart…", "Reopen report…"]);
    const names = ["close", "release", "pause", "restart", "reopen"];
    buttons.forEach((button, index) => {
      const reason = expected[names[index]!];
      expect(button.getAttribute("aria-disabled")).toBe(reason ? "true" : null);
      expect(button.className).not.toContain("btn-primary");
      const line = document.getElementById(button.getAttribute("aria-describedby")!)!;
      if (reason) expect(line.textContent).toContain(reason);
    });
  });

  it("announces an unavailable intent and opens nothing", async () => {
    await setup();
    fireEvent.click(intent("Reopen report…"));
    await waitFor(() => expect(document.querySelector(".problem-report-detail > [role=status]")?.textContent).toBe("The report is open."));
    expect(intent("Reopen report…").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Reopen report" })).toBeNull();
  });

  it("keeps one confirm open at a time and returns focus on Cancel and Escape", async () => {
    await setup();
    fireEvent.click(intent(/^Close report/));
    expect(confirmBox("Close report")).toBeTruthy();
    expect(intent(/^Close report/).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(intent("Pause other tasks…"));
    expect(screen.queryByRole("group", { name: "Close report" })).toBeNull();
    expect(confirmBox("Pause other tasks")).toBeTruthy();
    fireEvent.click(within(confirmBox("Pause other tasks")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(intent("Pause other tasks…")));
    fireEvent.click(intent(/^Close report/));
    fireEvent.keyDown(within(confirmBox("Close report")).getByRole("textbox"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(intent(/^Close report/)));
    expect(screen.queryByRole("group", { name: "Close report" })).toBeNull();
  });
});

describe("confirmations", () => {
  it("close sends resolve with the outcome and says the pause stays", async () => {
    const { act } = await setup();
    act.mockResolvedValue(leadReport({ state: "resolved", revision: 2, resolution: "Fixed text" }));
    fireEvent.click(intent("Close report (pauses stay)"));
    const box = within(confirmBox("Close report"));
    expect(box.getByText("Task 4 stays paused. Release it separately with Release pause.")).toBeTruthy();
    fireEvent.click(box.getByRole("button", { name: "Close report" }));
    expect(await box.findByText("Enter a reason.")).toBeTruthy();
    expect(act).not.toHaveBeenCalled();
    fireEvent.change(box.getByRole("textbox", { name: /Outcome for ann-0004/ }), { target: { value: "Fixed text" } });
    fireEvent.click(box.getByRole("button", { name: "Close report" }));
    const message = await screen.findByText("Report closed. Task 4 is still paused by this report; release it when work can continue.");
    expect(act).toHaveBeenCalledWith("r1", expect.objectContaining({ action: "resolve", reason: "Fixed text", expected_revision: 1, assignment_ids: [] }));
    await waitFor(() => expect(document.activeElement?.contains(message)).toBe(true));
    expect(screen.getAllByRole("link", { name: /Back to Documents/ })).toHaveLength(2);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("close and resume releases the pause, then closes with the same outcome text (R-16)", async () => {
    const { act } = await setup();
    act.mockResolvedValueOnce(leadReport({ revision: 2, holds: [hold({ active: false, release_action: "resume", released_by_label: "lead-0002" })] }))
      .mockResolvedValueOnce(leadReport({ state: "resolved", revision: 3, resolution: "Text is fine", holds: [hold({ active: false, release_action: "resume", released_by_label: "lead-0002" })] }));
    fireEvent.click(intent("Close and resume Task 4…"));
    const box = within(confirmBox("Close and resume Task 4"));
    fireEvent.change(box.getByRole("textbox", { name: /Outcome for ann-0004/ }), { target: { value: "Text is fine" } });
    fireEvent.click(box.getByRole("button", { name: "Close and resume" }));
    expect(await screen.findByText(/^Report closed\. Released the pause on .*Task 4.*\. The final result did not change\.$/)).toBeTruthy();
    expect(act).toHaveBeenNthCalledWith(1, "r1", expect.objectContaining({ action: "resume", reason: "Text is fine", expected_revision: 1, assignment_ids: [4] }));
    expect(act).toHaveBeenNthCalledWith(2, "r1", expect.objectContaining({ action: "resolve", reason: "Text is fine", expected_revision: 2, assignment_ids: [] }));
  });

  it("close and resume: a failed close after the release shows the release outcome, the report still open", async () => {
    const { act } = await setup();
    act.mockResolvedValueOnce(leadReport({ revision: 2, holds: [hold({ active: false, release_action: "resume", released_by_label: "lead-0002" })] }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(intent("Close and resume Task 4…"));
    const box = within(confirmBox("Close and resume Task 4"));
    fireEvent.change(box.getByRole("textbox", { name: /Outcome for ann-0004/ }), { target: { value: "Text is fine" } });
    fireEvent.click(box.getByRole("button", { name: "Close and resume" }));
    expect(await screen.findByText(/^Released the pause on .*Task 4.*\. The report is still open\.$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close and resume Task 4…" })).toBeNull();
  });

  it("close and resume: a conflict keeps its confirmation even when the pause is gone", async () => {
    const { act, get } = await setup();
    act.mockRejectedValue(new ConflictError("changed", "WORKFLOW_REVISION_CONFLICT", { reason: "REPORT_RESOLVED" }));
    get.mockResolvedValue(leadReport({ revision: 2, holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004" })] }));
    fireEvent.click(intent("Close and resume Task 4…"));
    const box = within(confirmBox("Close and resume Task 4"));
    fireEvent.change(box.getByRole("textbox", { name: /Outcome for ann-0004/ }), { target: { value: "Text is fine" } });
    fireEvent.click(box.getByRole("button", { name: "Close and resume" }));
    expect(await box.findByText(/This report changed since you opened it/)).toBeTruthy();
  });

  it("release preselects a single pause, counts the selection and requires one", async () => {
    const two = [hold(), hold({ hold_id: "h2", assignment_id: 7, owner_label: "ann-0005", language: "en", other_active_holds: [{ report_id: "r2" }] })];
    const { act } = await setup({ view: leadReport({ holds: two }) });
    act.mockResolvedValue(leadReport({ revision: 2, holds: [hold({ active: false, release_action: "resume", released_by_label: "lead-0002" }), two[1]!] }));
    fireEvent.click(intent("Release pause…"));
    let box = within(confirmBox("Release pause"));
    expect(box.getByRole("checkbox", { name: /Task 4/ })).toHaveProperty("checked", false);
    expect(box.getByText(/Also paused by another report: stays paused/)).toBeTruthy();
    fireEvent.change(box.getByRole("textbox", { name: /Reason/ }), { target: { value: "Fixed" } });
    fireEvent.click(box.getByRole("button", { name: "Release pause" }));
    expect(await box.findByText("Choose at least one task.")).toBeTruthy();
    fireEvent.click(box.getByRole("checkbox", { name: /Task 4/ }));
    fireEvent.click(box.getByRole("checkbox", { name: /Task 7/ }));
    expect(box.getByRole("button", { name: "Release 2 pauses" })).toBeTruthy();
    fireEvent.click(box.getByRole("checkbox", { name: /Task 7/ }));
    fireEvent.click(box.getByRole("button", { name: "Release pause" }));
    await screen.findByText(/Released the pause on Task 4 \(ann-0004\)\. The report is still open\./);
    expect(act).toHaveBeenCalledWith("r1", expect.objectContaining({ action: "resume", assignment_ids: [4] }));
    cleanup(); vi.restoreAllMocks();

    await setup();
    fireEvent.click(intent("Release pause…"));
    box = within(confirmBox("Release pause"));
    expect(box.getByRole("checkbox", { name: /Task 4/ })).toHaveProperty("checked", true);
  });

  it("action=resume opens Release pause with the reporter's task preselected and sends nothing", async () => {
    const two = [hold({ hold_id: "h2", assignment_id: 7, owner_label: "ann-0005" }), hold()];
    const { act } = await setup({ view: leadReport({ holds: two }), action: "resume" });
    const box = within(await screen.findByRole("group", { name: "Release pause" }));
    expect(box.getByRole("checkbox", { name: /Task 4/ })).toHaveProperty("checked", true);
    expect(box.getByRole("checkbox", { name: /Task 7/ })).toHaveProperty("checked", false);
    expect(act).not.toHaveBeenCalled();
  });

  it("pause lists the same text first, finds others by search and blocks already paused tasks", async () => {
    const candidates = [
      candidate(),
      candidate({ assignment_id: 4, owner_label: "ann-0004", language: "de", paused_by_this_report: true, reporter_task: true }),
      candidate({ assignment_id: 12, owner_label: "ann-0009", case_id: "other-text", same_text: false }),
      candidate({ assignment_id: 13, owner_label: "rev-0001", case_id: "third-text", same_text: false }),
    ];
    const { act, listCandidates } = await setup({ candidates });
    act.mockResolvedValue(leadReport({ revision: 2, holds: [hold(), hold({ hold_id: "h7", assignment_id: 7, owner_label: "ann-0005" }), hold({ hold_id: "h12", assignment_id: 12, owner_label: "ann-0009" })] }));
    fireEvent.click(intent("Pause other tasks…"));
    const box = within(confirmBox("Pause other tasks"));
    const same = await box.findByRole("group", { name: "Same text: accepted-translation" });
    expect(listCandidates).toHaveBeenCalledTimes(1);
    const paused = within(same).getByRole("checkbox", { name: /Task 4/ });
    expect(paused.getAttribute("aria-disabled")).toBe("true");
    expect(within(same).getByText("Already paused by this report")).toBeTruthy();
    fireEvent.click(paused);
    expect(paused).toHaveProperty("checked", false);
    expect(box.queryByRole("checkbox", { name: /Task 12/ })).toBeNull();
    fireEvent.change(box.getByRole("textbox", { name: "Search other tasks" }), { target: { value: "other" } });
    expect(box.queryByRole("checkbox", { name: /Task 13/ })).toBeNull();
    fireEvent.click(within(same).getByRole("checkbox", { name: /Task 7/ }));
    fireEvent.click(box.getByRole("checkbox", { name: /Task 12/ }));
    fireEvent.change(box.getByRole("textbox", { name: /Reason shown to the task owners/ }), { target: { value: "Same source" } });
    fireEvent.click(box.getByRole("button", { name: "Pause 2 tasks" }));
    await screen.findByText("Paused Task 7 (ann-0005) and Task 12 (ann-0009). Their owners see your reason. The report is still open.");
    expect(act).toHaveBeenCalledWith("r1", expect.objectContaining({ action: "extend_hold", assignment_ids: [7, 12] }));
  });

  it("restart names the current round, requires the agreement and maps TASK_HELD", async () => {
    const view = leadReport({ round_ordinal: 2, current_round_ordinal: 3, holds: [hold({ other_active_holds: [{ report_id: "r9" }] })] });
    const { act, get } = await setup({ view: { ...view, holds: [hold()] } });
    act.mockRejectedValue(new ConflictError("held", "TASK_HELD", { assignment_id: 4 }));
    get.mockResolvedValue(view);
    fireEvent.click(intent("Agree empty restart…"));
    const box = within(confirmBox("Agree empty restart of Task 4"));
    expect(box.getByText("Round 3 is abandoned and kept; Round 4 starts empty.")).toBeTruthy();
    expect(box.getByText("Final result stays: None.")).toBeTruthy();
    const confirm = box.getByRole("button", { name: "Restart with empty round" });
    expect(confirm.className).toContain("btn-danger");
    fireEvent.change(box.getByRole("textbox", { name: /Reason \(becomes the outcome ann-0004 sees\)/ }), { target: { value: "Start over" } });
    fireEvent.click(confirm);
    expect(await box.findByText("Confirm that you agreed the restart with ann-0004.")).toBeTruthy();
    expect(act).not.toHaveBeenCalled();
    fireEvent.click(box.getByRole("checkbox", { name: /I agreed this restart with ann-0004/ }));
    fireEvent.click(confirm);
    expect(await box.findByText(/Task 4 is also paused by another report\. Nothing changed\. Release that pause first\./)).toBeTruthy();
    expect(act).toHaveBeenCalledWith("r1", expect.objectContaining({ action: "restart", assignment_ids: [4] }));
    expect(box.getByRole("link", { name: "Open report" }).getAttribute("href")).toBe(routeHref({ name: "projectProblemReport", key: "p", reportId: "r9" }));
  });

  it("reopen is offered only for closed or withdrawn reports and sends reopen", async () => {
    const { act } = await setup({ view: leadReport({ state: "resolved", resolution: "Done" }) });
    act.mockResolvedValue(leadReport({ revision: 2 }));
    fireEvent.click(intent("Reopen report…"));
    const box = within(confirmBox("Reopen report"));
    expect(box.getByText("The report becomes open again. No task is paused again.")).toBeTruthy();
    fireEvent.change(box.getByRole("textbox", { name: /Reason/ }), { target: { value: "Not fixed" } });
    fireEvent.click(box.getByRole("button", { name: "Reopen report" }));
    await screen.findByText("Report reopened. No task was paused again.");
    expect(act).toHaveBeenCalledWith("r1", expect.objectContaining({ action: "reopen", reason: "Not fixed" }));
  });

  it("a conflict keeps the typed reason after Review again and reuses no stale request", async () => {
    const { act, get } = await setup();
    act.mockRejectedValue(new ConflictError("changed", "WORKFLOW_REVISION_CONFLICT", { reason: "REPORT_RESOLVED" }));
    const fresh = leadReport({ revision: 2, events: [event({ event_id: "e9", actor_label: "ann-0004", created_at: T1, reason: "upsi" })], holds: [hold({ active: false, release_action: "resume", released_by_label: "ann-0004", released_at: T1, release_event_id: "e9" })] });
    get.mockResolvedValue(fresh);
    fireEvent.click(intent(/^Close report/));
    let box = within(confirmBox("Close report"));
    fireEvent.change(box.getByRole("textbox", { name: /Outcome for/ }), { target: { value: "My outcome" } });
    fireEvent.click(box.getByRole("button", { name: "Close report" }));
    expect(await box.findByText(/This report changed since you opened it\. Nothing was saved\. ann-0004 resumed Task 4 \(ann-0004\)\./)).toBeTruthy();
    expect(box.getByText(/Changed by ann-0004 at/)).toBeTruthy();
    fireEvent.click(box.getByRole("button", { name: "Review again" }));
    box = within(confirmBox("Close report"));
    expect(box.getByRole("textbox", { name: /Outcome for/ })).toHaveProperty("value", "My outcome");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });

  it("network failure offers Retry with the same request id", async () => {
    const { act } = await setup();
    act.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(leadReport({ state: "resolved", revision: 2 }));
    fireEvent.click(intent(/^Close report/));
    const box = within(confirmBox("Close report"));
    fireEvent.change(box.getByRole("textbox", { name: /Outcome for/ }), { target: { value: "Done" } });
    fireEvent.click(box.getByRole("button", { name: "Close report" }));
    fireEvent.click(await box.findByRole("button", { name: "Retry" }));
    await screen.findByText(/^Report closed\./);
    expect(act.mock.calls[0]![1].request_id).toBe(act.mock.calls[1]![1].request_id);
  });

  it("records a decision after success only when entered from Documents", async () => {
    const documents = { decision: "all" };
    const { act } = await setup({ documents });
    act.mockResolvedValue(leadReport({ revision: 2, holds: [hold({ active: false, release_action: "resume", released_by_label: "lead-0002" })] }));
    fireEvent.click(intent("Release pause…"));
    const box = within(confirmBox("Release pause"));
    fireEvent.change(box.getByRole("textbox", { name: /Reason/ }), { target: { value: "Go on" } });
    fireEvent.click(box.getByRole("button", { name: "Release pause" }));
    await screen.findByText(/Released the pause/);
    expect(recordDecision).toHaveBeenCalledWith("p", "accepted-translation:de");
  });

  it("history shows the abandoned round of a restart event", async () => {
    await setup({ view: leadReport({ state: "resolved", round_ordinal: 2, current_round_ordinal: 4,
      holds: [hold({ active: false, release_action: "restart", released_by_label: "lead-0002", released_at: T2, release_event_id: "e5" })],
      events: [event({ event_id: "e5", action: "restart", actor_label: "lead-0002", round_ordinal: 4, abandoned_round_ordinal: 3, created_at: T2 })] }) });
    const history = within(screen.getByRole("region", { name: "History" }));
    expect(history.getByText(/Round 3 abandoned and kept; Round 4 started empty\./)).toBeTruthy();
  });
});

describe("display names for leads", () => {
  const ANA = { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false };
  const BEN = { pseudonym: "ann-0005", display_name: "Ben Ito", is_me: false };
  const ME = { pseudonym: "lead-0002", display_name: "Lea Lang", is_me: true };

  it("shows Name (ann-…) for reporter, pauses and candidates to a lead", async () => {
    await setup({
      view: leadReport({ reporter: ANA, holds: [
        hold({ owner: ANA, created_by: ANA }),
        hold({ hold_id: "h7", assignment_id: 7, owner_label: "ann-0005", owner: BEN, active: false, release_action: "resume", released_by_label: "lead-0002", released_by: ME, released_at: T2 }),
        hold({ hold_id: "h8", assignment_id: 8, owner_label: "ann-0006", owner: { pseudonym: "ann-0006", display_name: "Cleo Park", is_me: false }, active: false, release_action: "resume", released_by_label: "ann-0004", released_by: ANA, released_at: T1 }),
      ] }),
      candidates: [candidate({ owner: BEN })],
    });
    expect(screen.getByText("accepted-translation de, Task 4, Ana Weber (ann-0004), Annotation, Round 2", { exact: false })).toBeTruthy();
    expect(screen.getByText(/^Reported by Ana Weber \(ann-0004\)/)).toBeTruthy();
    const items = within(stateSection()).getAllByRole("listitem").map(li => li.textContent);
    expect(items[0]).toContain("Task 4, Ana Weber (ann-0004), accepted-translation de");
    expect(items[1]).toContain("Task 7, Ben Ito (ann-0005), accepted-translation de");
    expect(items[1]).toContain("Resumed by Lea Lang (lead-0002, you)");
    expect(items[2]).toContain("Task 8, Cleo Park (ann-0006)");
    expect(items[2]).toContain("Resumed by reporter Ana Weber (ann-0004)");
    expect(within(screen.getByRole("region", { name: "History" })).getByText(/^Ana Weber \(ann-0004\) reported the problem\./)).toBeTruthy();
    fireEvent.click(intent("Pause other tasks…"));
    const same = await within(confirmBox("Pause other tasks")).findByRole("group", { name: "Same text: accepted-translation" });
    expect(within(same).getByRole("checkbox", { name: /Task 7, Ben Ito \(ann-0005\), accepted-translation en/ })).toBeTruthy();
    cleanup(); vi.restoreAllMocks();

    await setup({ view: leadReport({ state: "resolved", resolution: "Done", state_changed_by_label: "lead-0002", state_changed_by: ME, state_changed_at: T2 }) });
    expect(stateSection().textContent).toContain("Closed by Lea Lang (lead-0002, you)");
  });

  it("Pause other tasks search matches display names", async () => {
    await setup({ candidates: [
      candidate({ assignment_id: 12, owner_label: "ann-0009", owner: { pseudonym: "ann-0009", display_name: "Dora Diaz", is_me: false }, case_id: "other-text", same_text: false }),
      candidate({ assignment_id: 13, owner_label: "rev-0001", case_id: "third-text", same_text: false }),
    ] });
    fireEvent.click(intent("Pause other tasks…"));
    const box = within(confirmBox("Pause other tasks"));
    const search = await box.findByRole("textbox", { name: "Search other tasks" });
    fireEvent.change(search, { target: { value: "dora" } });
    expect(box.getByRole("checkbox", { name: /Task 12, Dora Diaz \(ann-0009\), other-text en/ })).toBeTruthy();
    expect(box.queryByRole("checkbox", { name: /Task 13/ })).toBeNull();
    fireEvent.change(search, { target: { value: "ann-0009" } });
    expect(box.getByRole("checkbox", { name: /Task 12/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: "rev-0001" } });
    expect(box.getByRole("checkbox", { name: /Task 13, rev-0001, third-text/ })).toBeTruthy();
  });

  it("confirmation copy names the reporter as Name (ann-…)", async () => {
    const { act } = await setup({ view: leadReport({ reporter: ANA, holds: [hold({ owner: ANA })] }) });
    expect(screen.getByText(/Records your outcome for Ana Weber \(ann-0004\)\./)).toBeTruthy();
    fireEvent.click(intent(/^Close report/));
    let box = within(confirmBox("Close report"));
    expect(box.getByRole("textbox", { name: /Outcome for Ana Weber \(ann-0004\)/ })).toBeTruthy();
    expect(box.getByText("Ana Weber (ann-0004) sees this in the report.")).toBeTruthy();
    fireEvent.click(intent("Agree empty restart…"));
    box = within(confirmBox("Agree empty restart of Task 4"));
    expect(box.getByRole("checkbox", { name: /I agreed this restart with Ana Weber \(ann-0004\)/ })).toBeTruthy();
    expect(box.getByRole("textbox", { name: /Reason \(becomes the outcome Ana Weber \(ann-0004\) sees\)/ })).toBeTruthy();
    act.mockResolvedValue(leadReport({ reporter: ANA, revision: 2, holds: [hold({ owner: ANA, active: false, release_action: "resume", released_by_label: "lead-0002" })] }));
    fireEvent.click(intent("Release pause…"));
    box = within(confirmBox("Release pause"));
    fireEvent.change(box.getByRole("textbox", { name: /Reason/ }), { target: { value: "Go on" } });
    fireEvent.click(box.getByRole("button", { name: "Release pause" }));
    await screen.findByText(/Released the pause on Task 4, Ana Weber \(ann-0004\)\./);
  });
});
