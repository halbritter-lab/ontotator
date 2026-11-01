import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type CurrentUser, type TechnicalReportView } from "../src/api/client";
import { lastApiError, resetLastApiError } from "../src/api/lastError";
import { CaseErrorBoundary } from "../src/app/ErrorBoundary";
import { Shell } from "../src/app/Shell";
import { TechnicalReportDialog } from "../src/reports/TechnicalReportDialog";
import { reportFacts, reportText, TechnicalReportsPage } from "../src/reports/TechnicalReportsPage";
import { reportContext } from "../src/reports/technicalReport";

const receipt = { id: 12, reference: "TR-12", created_at: "2026-11-01T10:00:00Z" };
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const report = (extra: Partial<TechnicalReportView> = {}): TechnicalReportView => ({
  id: 12, reference: "TR-12", status: "open", description: "The page stays blank.", created_at: "2026-11-01T10:00:00Z",
  reporter: { pseudonym: "ann-0004", display_name: "Ann", is_me: false }, reporter_username: "ann",
  app_version: "0.6.1", app_revision: "cc65cea5558f85384f92c6bfb07a15f5a3fabe2b", route: "#/projects/p/documents", task: null,
  user_agent: "TestBrowser/1.0", viewport: "1280x800", last_error_status: 500, last_error_code: "PROJECT_BUSY",
  last_error_at: "2026-11-01T09:59:00Z", crash_message: null, closed_at: null, closed_by: null, ...extra,
});

beforeEach(() => { resetLastApiError(); window.history.replaceState(null, "", "#/projects/p/documents?q=secret"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

describe("last API error", () => {
  it("keeps the status, code and time of a refused request in memory", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(503, { code: "PROJECT_BUSY", details: "busy" }));
    await expect(api.listProjects()).rejects.toBeDefined();
    expect(lastApiError()).toMatchObject({ status: 503, code: "PROJECT_BUSY" });
  });

  it("records a lost connection, and a failed report never replaces the error it reports", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api.listProjects()).rejects.toBeDefined();
    expect(lastApiError()).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(500, { code: "INTERNAL" }));
    await expect(api.sendTechnicalReport({ request_id: "r", description: "x" })).rejects.toBeDefined();
    expect(lastApiError()).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});

describe("report context", () => {
  it("adds the screen without its query, the window size and the crash message", () => {
    const context = reportContext("TypeError: x is undefined");
    expect(context.route).toBe("#/projects/p/documents");
    expect(context.viewport).toMatch(/^\d+x\d+$/);
    expect(context.crash_message).toBe("TypeError: x is undefined");
    expect(context.last_api_error).toBeUndefined();
  });
});

describe("Report a technical problem", () => {
  it("sends the description with the context and shows the reference", async () => {
    const send = vi.spyOn(api, "sendTechnicalReport").mockResolvedValue(receipt);
    const onClose = vi.fn();
    render(<TechnicalReportDialog onClose={onClose} />);
    const input = userEvent.setup();
    expect(screen.getByText(/Your task is not paused/)).toBeDefined();
    await input.click(screen.getByRole("button", { name: "Send report" }));
    expect(screen.getByText("Describe what happened.")).toBeDefined();
    expect(send).not.toHaveBeenCalled();
    await input.type(screen.getByLabelText("What happened?"), "  The list does not load. ");
    await input.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("Sent to the administrators. Reference: TR-12.")).toBeDefined();
    const body = send.mock.calls[0][0];
    expect(body.description).toBe("The list does not load.");
    expect(body.context?.route).toBe("#/projects/p/documents");
    expect(body.request_id).toBeTruthy();
    await input.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
  });

  it("explains a refused report and keeps the text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(429, { code: "TECHNICAL_REPORT_LIMIT", details: "raw" }));
    render(<TechnicalReportDialog onClose={vi.fn()} />);
    const input = userEvent.setup();
    await input.type(screen.getByLabelText("What happened?"), "Again");
    await input.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("You sent many reports in the last hour. Try again later.")).toBeDefined();
    expect((screen.getByLabelText("What happened?") as HTMLTextAreaElement).value).toBe("Again");
  });

  it("is offered on the crash screen with the error message as context", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const send = vi.spyOn(api, "sendTechnicalReport").mockResolvedValue(receipt);
    const Broken = (): JSX.Element => { throw new TypeError("Cannot read properties of undefined"); };
    render(<CaseErrorBoundary onBackToDashboard={vi.fn()}><Broken /></CaseErrorBoundary>);
    const input = userEvent.setup();
    await input.click(screen.getByRole("button", { name: "Report a technical problem…" }));
    const dialog = screen.getByRole("dialog", { name: "Report a technical problem" });
    expect(within(dialog).getByText("Error message: TypeError: Cannot read properties of undefined")).toBeDefined();
    // The user's text stays empty: the error goes into the context only.
    expect((within(dialog).getByLabelText("What happened?") as HTMLTextAreaElement).value).toBe("");
    await input.type(within(dialog).getByLabelText("What happened?"), "Opened a task");
    await input.click(within(dialog).getByRole("button", { name: "Send report" }));
    await screen.findByText(/Reference: TR-12/);
    expect(send.mock.calls[0][0].context?.crash_message).toBe("TypeError: Cannot read properties of undefined");
    expect(send.mock.calls[0][0].description).toBe("Opened a task");
  });
});

describe("closing the report dialog", () => {
  it("keeps typed text on Esc; Cancel still closes", async () => {
    const close = vi.fn();
    render(<TechnicalReportDialog onClose={close} />);
    const input = userEvent.setup();
    await input.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
    await input.type(screen.getByLabelText("What happened?"), "Half a sentence");
    await input.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
    await input.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledTimes(2);
  });
});

describe("navigation", () => {
  const user: CurrentUser = { username: "root", display_name: "Root", pseudonym: "adm-1", is_system_admin: true, csrf_token: "t" };

  it("offers the report to everyone and the open count to administrators", async () => {
    vi.spyOn(api, "listMyTasks").mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, "adminTechnicalReportSummary").mockResolvedValue({ open: 2 });
    render(<Shell user={user} projects={[]} route={{ name: "tasks" }} onNavigate={vi.fn()} onLogout={vi.fn()}>Page</Shell>);
    expect(await screen.findByRole("link", { name: "Technical reports, 2 open" })).toBeDefined();
    const entry = screen.getByRole("button", { name: "Report a technical problem…" });
    expect(entry.textContent).toBe("Technical problem…");
    await userEvent.setup().click(entry);
    expect(screen.getByRole("dialog", { name: "Report a technical problem" })).toBeDefined();
  });

  it("asks no count for other users", () => {
    vi.spyOn(api, "listMyTasks").mockReturnValue(new Promise(() => {}));
    const summary = vi.spyOn(api, "adminTechnicalReportSummary");
    render(<Shell user={{ ...user, is_system_admin: false }} projects={[]} route={{ name: "tasks" }} onNavigate={vi.fn()} onLogout={vi.fn()}>Page</Shell>);
    expect(screen.queryByRole("link", { name: /Technical reports/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Report a technical problem…" })).toBeDefined();
    expect(summary).not.toHaveBeenCalled();
  });
});

describe("Technical reports page", () => {
  it("lists open reports with their context and marks one as done", async () => {
    const list = vi.spyOn(api, "adminListTechnicalReports").mockResolvedValue([report()]);
    const set = vi.spyOn(api, "adminSetTechnicalReportStatus").mockResolvedValue(report({ status: "done", closed_at: "2026-11-01T11:00:00Z", closed_by: "root" }));
    render(<TechnicalReportsPage />);
    const card = await screen.findByRole("article", { name: "TR-12 · Open" });
    expect(list).toHaveBeenCalledWith("open");
    expect(within(card).getByText("The page stays blank.")).toBeDefined();
    expect(within(card).getByText("Ann (ann-0004), ann")).toBeDefined();
    expect(within(card).getByText("TestBrowser/1.0")).toBeDefined();
    await userEvent.setup().click(within(card).getByRole("button", { name: "Mark as done" }));
    expect(set).toHaveBeenCalledWith(12, "done");
    expect(await screen.findByText("TR-12 is marked as done.")).toBeDefined();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("filters done reports and reopens one", async () => {
    const list = vi.spyOn(api, "adminListTechnicalReports").mockResolvedValue([]);
    render(<TechnicalReportsPage />);
    expect(await screen.findByText("No open reports.")).toBeDefined();
    list.mockResolvedValue([report({ status: "done", closed_at: "2026-11-01T11:00:00Z", closed_by: "root" })]);
    const set = vi.spyOn(api, "adminSetTechnicalReportStatus").mockResolvedValue(report());
    const input = userEvent.setup();
    await input.selectOptions(screen.getByLabelText("Show"), "done");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("done"));
    const card = await screen.findByRole("article", { name: "TR-12 · Done" });
    await input.click(within(card).getByRole("button", { name: "Reopen" }));
    expect(set).toHaveBeenCalledWith(12, "open");
  });

  it("names the kind of task, its project and text", () => {
    const task = { task: "annotate", annotation_mode: "proposals", project_key: "neuro", document_id: "d1", case_id: "case-7", external_id: "e1", language: "de", version: 2, origin: "correction" } as const;
    const rows = (extra: Partial<NonNullable<TechnicalReportView["task"]>>) => reportFacts(report({ task: { ...task, ...extra } }));
    expect(rows({}).slice(1, 6).map(([label]) => label)).toEqual(["By", "Task", "Project", "Text", "App version"]);
    expect(Object.fromEntries(rows({}))).toMatchObject({ Task: "Annotation, from proposals", Project: "neuro", Text: "case-7 de v2 corrected" });
    expect(Object.fromEntries(rows({ task: "translation_review", annotation_mode: null })).Task).toBe("Translation review");
    expect(Object.fromEntries(rows({ task: "review", annotation_mode: null })).Task).toBe("Consolidation");
    expect(reportFacts(report()).map(([label]) => label)).not.toContain("Task");
  });

  it("copies a report as plain text for an issue", () => {
    const text = reportText(report({ crash_message: "boom" }));
    expect(text.startsWith("TR-12 (Open)\n\nThe page stays blank.\n")).toBe(true);
    expect(text).toContain("Last error: PROJECT_BUSY, HTTP 500");
    expect(text).toContain("Error message: boom");
    expect(reportFacts(report({ last_error_status: null, last_error_code: null })).map(([label]) => label)).not.toContain("Last error");
  });
});
