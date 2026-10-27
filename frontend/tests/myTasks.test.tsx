import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, notifySessionRestored, type ProjectSummary, type TaskSummary } from "../src/api/client";
import { MyTasks } from "../src/tasks/MyTasks";
import { guidelineListing, guidelineSummary, withdrawnGuideline } from "./projectFixtures";

const project = (key: string, name: string, can_manage = false): ProjectSummary => ({
  project_key: key, name, description: null, roles: [], allowed_modes: [], document_count: 0, can_manage,
});
const task = (id: number, status: TaskSummary["status"], key = "p", name = "Project P"): TaskSummary => ({
  assignment_id: id, workflow_revision: 0, held: false, project_key: key, project_name: name, document_id: `doc-${id}`, language: "de", task: id === 2 ? "review" : "annotate", status, updated_at: "2026-10-15T10:30:00Z",
});
const tasks = [task(4, "reopened"), task(2, "in_progress", "q", "Project Q"), task(3, "open"), task(1, "submitted")];
/** Accessible names of the status tabs ("To do, 3"), in order. */
const tabNames = () => screen.queryAllByRole("tab").map(tab => tab.getAttribute("aria-label"));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// No project has guidelines unless a test says so.
beforeEach(() => { vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([])); });

describe("My tasks component", () => {
  beforeEach(() => { vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("lists real task metadata in server order and delegates opening through the callback", async () => {
    const onNavigate = vi.fn();
    render(<MyTasks projects={[]} onNavigate={onNavigate} />);
    const rows = await screen.findAllByTestId("task-row");
    expect(rows.map(row => within(row).getByText(/^doc-/).textContent)).toEqual(["doc-4 de", "doc-2 de", "doc-3 de", "doc-1 de"]);
    expect(within(rows[1]).getByText("Consolidation")).toBeDefined();
    expect(within(rows[0]).getByText("Annotation")).toBeDefined();
    expect(within(rows[0]).getByText("Reopened")).toBeDefined();
    expect(rows[0].querySelector("time")?.getAttribute("datetime")).toBe(tasks[0].updated_at);
    expect(within(rows[0]).getByRole("link", { name: "Continue" }).getAttribute("href")).toBe("#/tasks/4");
    expect(within(rows[1]).getByRole("link", { name: "Continue" })).toBeDefined();
    expect(within(rows[2]).getByRole("link", { name: "Start" })).toBeDefined();
    expect(within(rows[3]).getByRole("link", { name: "View" })).toBeDefined();
    fireEvent.click(within(rows[0]).getByRole("link", { name: "Continue" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 4 });
  });

  it("shows the annotation mode and the assigned date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 23, 15, 0));
    const at = new Date(2026, 9, 23, 10, 40).toISOString();
    vi.mocked(api.listMyTasks).mockResolvedValue([{ ...task(7, "open"), annotation_mode: "proposals", assigned_at: at }, { ...task(8, "open"), annotation_mode: "scratch" }, task(2, "open")]);
    try {
      render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
      const rows = await screen.findAllByTestId("task-row");
      expect(within(rows[0]).getByText("Annotation, from proposals")).toBeDefined();
      expect(within(rows[0]).getByText("assigned today 10:40")).toBeDefined();
      expect(within(rows[1]).getByText("Annotation, from scratch")).toBeDefined();
      expect(within(rows[2]).getByText("Consolidation")).toBeDefined();
    } finally { vi.useRealTimers(); }
  });

  it("shows loading while the request is pending", async () => {
    const pending = deferred<TaskSummary[]>();
    vi.mocked(api.listMyTasks).mockReturnValue(pending.promise);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Loading tasks");
    expect(screen.queryByRole("table")).toBeNull();
    await act(async () => { pending.resolve([]); });
    expect(await screen.findByText("No documents are assigned to you yet.")).toBeDefined();
  });

  it("filters by the controlled raw project key and updates only through navigation", async () => {
    const onNavigate = vi.fn();
    const props = { projects: [], onNavigate };
    const view = render(<MyTasks {...props} />);
    await screen.findAllByTestId("task-row");
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" }) as HTMLSelectElement;
    expect(select.id).toBe("project-select");
    expect(within(select).getByRole("option", { name: "Project Q (q)" })).toBeDefined();
    fireEvent.change(select, { target: { value: "q" } });
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", project: "q" });
    expect(select.value).toBe("");
    expect(screen.getAllByTestId("task-row")).toHaveLength(4);
    view.rerender(<MyTasks {...props} project="q" />);
    expect(select.value).toBe("q");
    expect(screen.getAllByTestId("task-row")).toHaveLength(1);
    expect(tabNames()).toEqual(["To do, 1", "Submitted, 0", "All, 1"]);
    fireEvent.change(select, { target: { value: "" } });
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "tasks", status: "all" });
    expect(api.listMyTasks).toHaveBeenCalledTimes(1);
  });

  it("remembers the last chosen project per user and reopens it on the next visit", async () => {
    window.localStorage.clear();
    const onNavigate = vi.fn();
    const projects = [project("p", "Project P"), project("q", "Project Q")];
    const view = render(<MyTasks projects={projects} onNavigate={onNavigate} username="ana" />);
    await screen.findAllByTestId("task-row");
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter my tasks by project" }), { target: { value: "q" } });
    expect(window.localStorage.getItem("ontotator.myTasks.project.v1:ana")).toBe("q");
    view.unmount();
    onNavigate.mockClear();
    // Next visit: the project list arrives after the first render.
    const next = render(<MyTasks projects={[]} status="all" onNavigate={onNavigate} username="ana" />);
    expect(onNavigate).not.toHaveBeenCalled();
    next.rerender(<MyTasks projects={projects} status="all" onNavigate={onNavigate} username="ana" />);
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", project: "q", status: "all" }, { replace: true });
    next.unmount();
    // Another user and an explicit All are not redirected.
    onNavigate.mockClear();
    render(<MyTasks projects={projects} onNavigate={onNavigate} username="ben" />).unmount();
    window.localStorage.setItem("ontotator.myTasks.project.v1:ana", "");
    render(<MyTasks projects={projects} onNavigate={onNavigate} username="ana" />).unmount();
    expect(onNavigate).not.toHaveBeenCalled();
    window.localStorage.clear();
  });

  it("counts reopened as To do without altering its visible status", async () => {
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(tabNames()).toEqual(["To do, 3", "Submitted, 1", "All, 4"]);
    expect(screen.getByText("Reopened")).toBeDefined();
  });

  it("shows pauses alongside underlying status and keeps saved work accessible", async () => {
    vi.mocked(api.listMyTasks).mockResolvedValue([
      { ...task(11, "open"), held: true, hold_reason: "Source evidence needs clarification" },
      { ...task(12, "submitted"), held: true, hold_reason: "Lead is checking a reported conflict" },
      task(13, "in_progress", "q", "Project Q"),
    ]);
    const onNavigate = vi.fn();
    const rendered = render(<MyTasks projects={[]} onNavigate={onNavigate} />);
    const rows = await screen.findAllByTestId("task-row");
    expect(within(rows[0]).getByText("Open")).toBeDefined();
    expect(within(rows[0]).getByText("Paused")).toBeDefined();
    expect(within(rows[0]).getByText("Source evidence needs clarification")).toBeDefined();
    expect(within(rows[0]).queryByRole("link", { name: "Start" })).toBeNull();
    expect(within(rows[1]).getByText("Submitted")).toBeDefined();
    expect(within(rows[1]).getByText("Paused")).toBeDefined();
    expect(tabNames()).toEqual(["To do, 2", "Paused, 2", "Submitted, 1", "All, 3"]);
    const action = within(rows[0]).getByRole("link", { name: "View paused task" });
    expect(action.getAttribute("href")).toBe("#/tasks/11");
    fireEvent.click(action);
    expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 11 });
    rendered.rerender(<MyTasks project="q" projects={[]} onNavigate={onNavigate} />);
    expect(tabNames()).toEqual(["To do, 1", "Submitted, 0", "All, 1"]);
  });

  it("distinguishes duplicate project names for filters and same-document task context", async () => {
    const onNavigate = vi.fn();
    vi.mocked(api.listMyTasks).mockResolvedValue([
      { ...task(11, "open", "p", "Research"), document_id: "shared-doc" },
      { ...task(12, "open", "q", "Research"), document_id: "shared-doc" },
    ]);
    render(<MyTasks projects={[project("p", "Research"), project("q", "Research")]} onNavigate={onNavigate} />);
    const rows = await screen.findAllByTestId("task-row");
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" });
    expect((within(select).getByRole("option", { name: "Research (p)" }) as HTMLOptionElement).value).toBe("p");
    expect((within(select).getByRole("option", { name: "Research (q)" }) as HTMLOptionElement).value).toBe("q");
    expect(within(rows[0]).getByText("Research (p)")).toBeDefined();
    expect(within(rows[1]).getByText("Research (q)")).toBeDefined();
    expect(rows[0].getAttribute("aria-label")).toBe("Research (p): shared-doc de");
    expect(rows[1].getAttribute("aria-label")).toBe("Research (q): shared-doc de");
    fireEvent.change(select, { target: { value: "q" } });
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", project: "q" });
    fireEvent.click(within(rows[1]).getByRole("link", { name: /^(Start|Continue|View)$/ }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "task", assignmentId: 12 });
  });

  it("several managed projects without tasks get one Go to Projects, not a button per project", async () => {
    const onNavigate = vi.fn();
    vi.mocked(api.listMyTasks).mockResolvedValue([]);
    render(<MyTasks projects={[project("p", "Research", true), project("q", "Research", true)]} onNavigate={onNavigate} />);
    const link = await screen.findByRole("link", { name: "Go to Projects" });
    expect(screen.queryByRole("link", { name: /Go to Documents/ })).toBeNull();
    expect(screen.getByText("You assign documents to people, yourself included, on a project's Documents page.")).toBeDefined();
    expect(link.className).toBe("btn btn-secondary");
    expect(link.getAttribute("href")).toBe("#/projects");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ name: "projects" });
  });

  it("keeps a selected empty project visible by its current project summary name", async () => {
    render(<MyTasks project="empty%/project" projects={[project("empty%/project", "Empty project", true)]} onNavigate={vi.fn()} />);
    await screen.findByText("No documents are assigned to you yet.");
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" }) as HTMLSelectElement;
    expect(select.value).toBe("empty%/project");
    expect(select.selectedOptions[0].textContent).toBe("Empty project (empty%/project)");
    expect(screen.getByRole("link", { name: "Go to Documents" }).getAttribute("href")).toBe("#/projects/empty%25%2Fproject/documents");
  });

  it("keeps unknown route filters without inventing a project or choosing another one", async () => {
    render(<MyTasks project="unavailable" projects={[project("p", "Managed", true)]} onNavigate={vi.fn()} />);
    await screen.findByText("No documents are assigned to you yet.");
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" }) as HTMLSelectElement;
    expect(select.value).toBe("unavailable");
    expect(select.selectedOptions[0].textContent).toBe("unavailable");
    expect(screen.queryByRole("link", { name: /Go to Documents/ })).toBeNull();
  });

  it("shows ordinary empty notice without inventing an assignment action", async () => {
    vi.mocked(api.listMyTasks).mockResolvedValue([]);
    render(<MyTasks projects={[project("p", "P")]} onNavigate={vi.fn()} />);
    await screen.findByText("No documents are assigned to you yet.");
    expect(screen.queryByRole("link", { name: /Go to Documents/ })).toBeNull();
  });

  it("keeps an empty raw route filter distinct from All my tasks", async () => {
    const onNavigate = vi.fn();
    render(<MyTasks project="" projects={[]} onNavigate={onNavigate} />);
    await screen.findByText("No documents are assigned to you yet.");
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" }) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0].textContent).toBe("Empty project filter");
    const all = within(select).getByRole("option", { name: "All my tasks" }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: all.value } });
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", status: "all" });
  });

  it("the one empty-state entry is a real link: modified clicks keep browser behaviour", async () => {
    vi.mocked(api.listMyTasks).mockResolvedValue([]);
    const onNavigate = vi.fn();
    render(<MyTasks projects={[project("p", "Project P", true), project("q", "Project Q", true), project("r", "Other")]} onNavigate={onNavigate} />);
    const link = await screen.findByRole("link", { name: "Go to Projects" });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    fireEvent.click(link, { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("refreshes only when a visibility change makes the tab visible", async () => {
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(api.listMyTasks).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(api.listMyTasks).mockResolvedValue([task(8, "open")]);
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByText("doc-8 de")).toBeDefined();
    expect(api.listMyTasks).toHaveBeenCalledTimes(2);
  });

  it("ignores an older request that resolves after the latest refresh", async () => {
    const older = deferred<TaskSummary[]>();
    const newer = deferred<TaskSummary[]>();
    vi.mocked(api.listMyTasks).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { newer.resolve([task(9, "open")]); });
    expect(await screen.findByText("doc-9 de")).toBeDefined();
    await act(async () => { older.resolve(tasks); });
    expect(screen.queryByText("doc-4 de")).toBeNull();
  });

  it("ignores stale errors and removes refresh subscriptions on unmount", async () => {
    const older = deferred<TaskSummary[]>();
    vi.mocked(api.listMyTasks).mockReturnValueOnce(older.promise).mockResolvedValue(tasks);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const view = render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    fireEvent(document, new Event("visibilitychange"));
    await screen.findAllByTestId("task-row");
    await act(async () => { older.reject(new Error("old error")); });
    expect(screen.queryByRole("alert")).toBeNull();
    view.unmount();
    fireEvent(document, new Event("visibilitychange"));
    notifySessionRestored();
    expect(api.listMyTasks).toHaveBeenCalledTimes(2);
  });

  it("discards a pending reply after unmount", async () => {
    const pending = deferred<TaskSummary[]>();
    vi.mocked(api.listMyTasks).mockReturnValue(pending.promise);
    const view = render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    view.unmount();
    await act(async () => { pending.resolve(tasks); });
    expect(screen.queryByTestId("task-row")).toBeNull();
  });

  it("uses shared code messages and lets the user retry without a login gate", async () => {
    vi.mocked(api.listMyTasks).mockRejectedValueOnce(new ApiError(404, "raw", "PROJECT_NOT_FOUND")).mockResolvedValueOnce(tasks);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("You do not have access to this project");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findAllByTestId("task-row");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("falls back to the server message and clears old tasks after a failed refresh", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    vi.mocked(api.listMyTasks).mockRejectedValue(new ApiError(500, "Server is temporarily unavailable", "NEW_CODE"));
    fireEvent(document, new Event("visibilitychange"));
    expect((await screen.findByRole("alert")).textContent).toContain("Server is temporarily unavailable");
    expect(screen.queryByTestId("task-row")).toBeNull();
  });

  it("refreshes through the existing session-restored signal", async () => {
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    vi.mocked(api.listMyTasks).mockResolvedValue([task(8, "open")]);
    act(() => { notifySessionRestored(); });
    expect(await screen.findByText("doc-8 de")).toBeDefined();
  });
  it("adds a failed-check line with an icon to translation review rows and to their accessible name", async () => {
    vi.mocked(api.listMyTasks).mockResolvedValue([
      { ...task(7, "open"), task: "translation_review", source_language: "en", target_language: "de", failed_check_count: 1 },
      { ...task(8, "open"), task: "translation_review", source_language: "en", target_language: "de", failed_check_count: 0 },
      { ...task(9, "open"), failed_check_count: null },
    ]);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    const rows = await screen.findAllByTestId("task-row");
    const line = within(rows[0]).getByText("1 automatic check failed");
    expect(line.closest(".task-check-flag")?.querySelector("svg")).not.toBeNull();
    expect(rows[0].getAttribute("aria-label")).toBe("Project P (p): doc-7 de, 1 automatic check failed");
    expect(within(rows[1]).queryByText(/automatic check/)).toBeNull();
    expect(rows[1].getAttribute("aria-label")).toBe("Project P (p): doc-8 de");
    expect(within(rows[2]).queryByText(/automatic check/)).toBeNull();
  });
  it("pluralises the failed-check line", async () => {
    vi.mocked(api.listMyTasks).mockResolvedValue([{ ...task(7, "open"), task: "translation_review", failed_check_count: 3 }]);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    expect(await screen.findByText("3 automatic checks failed")).toBeDefined();
  });
});

describe("My tasks text label", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("labels tasks by text label and drops the Language column", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([
      { ...task(5, "open"), case_id: "case-0101", external_id: "EXT-5" },
      { ...task(6, "open"), external_id: "EXT-6" },
    ]);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    const rows = await screen.findAllByTestId("task-row");
    const table = screen.getByRole("table", { name: "My tasks" });
    expect(within(table).getAllByRole("columnheader").map(header => header.textContent)).toEqual(
      ["Text", "Project", "Task", "Status", "Assigned", "Last change", "Action"]);
    expect(within(rows[0]).getByText("case-0101 de")).toBeDefined();
    expect(within(rows[0]).queryByText("EXT-5")).toBeNull();
    expect(rows[0].getAttribute("aria-label")).toBe("Project P (p): case-0101 de");
    // Older servers without a case ID fall back to the external ID.
    expect(within(rows[1]).getByText("EXT-6 de")).toBeDefined();
  });

  it("offers Go to Documents to a lead with no tasks", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    const onNavigate = vi.fn();
    render(<MyTasks projects={[project("p", "Project P", true)]} onNavigate={onNavigate} />);
    const link = await screen.findByRole("link", { name: "Go to Documents" });
    expect(link.getAttribute("href")).toBe("#/projects/p/documents");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p" });
  });
});

describe("My tasks filter and counts", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("hides filter and counts for a lead without tasks", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    render(<MyTasks projects={[project("p", "Project P", true)]} onNavigate={vi.fn()} />);
    await screen.findByText("No documents are assigned to you yet.");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("hides the filter for tasks in one project until a filter is active", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([task(1, "open"), task(3, "submitted")]);
    const view = render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(screen.queryByRole("combobox")).toBeNull();
    view.rerender(<MyTasks project="p" projects={[]} onNavigate={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" }) as HTMLSelectElement;
    expect(select.value).toBe("p");
    expect(within(select).getByRole("option", { name: "All my tasks" })).toBeDefined();
  });

  it("shows the filter for tasks in two projects", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" });
    expect(within(select).getAllByRole("option").map(o => o.textContent)).toEqual(["All my tasks", "Project P (p)", "Project Q (q)"]);
  });

  it("renders the status tabs in order with counts that add up", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([{ ...task(1, "open"), held: true }, task(2, "in_progress"), task(3, "submitted"), task(4, "reopened")]);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(tabNames()).toEqual(["To do, 3", "Paused, 1", "Submitted, 1", "All, 4"]);
    expect(screen.getByRole("tablist").textContent).not.toContain("·");
    expect(screen.queryByRole("list", { name: /^Task counts/ })).toBeNull();
  });

  it("keeps the tablist label when a project filter is active", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    render(<MyTasks project="q" projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(screen.getByRole("tablist", { name: "Task status" })).toBeDefined();
    expect(tabNames()).toEqual(["To do, 1", "Submitted, 0", "All, 1"]);
  });
});

describe("My tasks status tabs", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const rowTexts = () => screen.getAllByTestId("task-row").map(row => within(row).getByText(/^doc-/).textContent);

  it("opens on All and labels the table panel by the active tab", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    const tablist = screen.getByRole("tablist", { name: "Task status" });
    expect(within(tablist).getAllByRole("tab").map(tab => tab.querySelector(".ui-tab-label")?.textContent)).toEqual(["To do", "Submitted", "All"]);
    const all = screen.getByRole("tab", { name: "All, 4" });
    expect(all.getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(all.id);
    expect(within(panel).getByRole("table", { name: "My tasks" })).toBeDefined();
    expect(rowTexts()).toHaveLength(4);
  });

  it("filters the rows client-side by the active tab", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([...tasks, { ...task(5, "open"), held: true }]);
    const view = render(<MyTasks status="submitted" projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(rowTexts()).toEqual(["doc-1 de"]);
    expect(screen.getByRole("tab", { name: "Submitted, 1" }).getAttribute("aria-selected")).toBe("true");
    view.rerender(<MyTasks status="todo" projects={[]} onNavigate={vi.fn()} />);
    expect(rowTexts()).toEqual(["doc-4 de", "doc-2 de", "doc-3 de", "doc-5 de"]);
    view.rerender(<MyTasks status="paused" projects={[]} onNavigate={vi.fn()} />);
    expect(rowTexts()).toEqual(["doc-5 de"]);
    view.rerender(<MyTasks status="all" project="p" projects={[]} onNavigate={vi.fn()} />);
    expect(rowTexts()).toEqual(["doc-4 de", "doc-3 de", "doc-1 de", "doc-5 de"]);
    expect(tabNames()).toEqual(["To do, 3", "Paused, 1", "Submitted, 1", "All, 4"]);
    expect(api.listMyTasks).toHaveBeenCalledTimes(1);
  });

  it("shows Paused only with paused tasks or while it is active", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    const view = render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(screen.queryByRole("tab", { name: /^Paused/ })).toBeNull();
    view.rerender(<MyTasks status="paused" projects={[]} onNavigate={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Paused, 0" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("No paused tasks.")).toBeDefined();
  });

  it("navigates through the tabs and keeps the project filter in every link", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    const onNavigate = vi.fn();
    render(<MyTasks project="q" projects={[]} onNavigate={onNavigate} />);
    await screen.findAllByTestId("task-row");
    expect(screen.getByRole("tab", { name: "To do, 1" }).getAttribute("href")).toBe("#/?project=q&status=todo");
    expect(screen.getByRole("tab", { name: "All, 1" }).getAttribute("href")).toBe("#/?project=q&status=all");
    fireEvent.click(screen.getByRole("tab", { name: "Submitted, 0" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", project: "q", status: "submitted" });
  });

  it("keeps the active tab when the project filter changes", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    const onNavigate = vi.fn();
    render(<MyTasks status="todo" projects={[]} onNavigate={onNavigate} />);
    await screen.findAllByTestId("task-row");
    const select = screen.getByRole("combobox", { name: "Filter my tasks by project" });
    fireEvent.change(select, { target: { value: "q" } });
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "tasks", project: "q", status: "todo" });
    fireEvent.change(select, { target: { value: "" } });
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "tasks", status: "todo" });
  });

  it("shows a tab-specific empty state with a link to all tasks", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([task(1, "submitted"), task(2, "open", "q", "Project Q")]);
    const onNavigate = vi.fn();
    const view = render(<MyTasks status="todo" project="p" projects={[]} onNavigate={onNavigate} />);
    expect(await screen.findByText("Nothing to do here.")).toBeDefined();
    expect(screen.queryByText("No documents are assigned to you yet.")).toBeNull();
    const panel = screen.getByRole("tabpanel");
    const showAll = within(panel).getByRole("link", { name: "Show all tasks" });
    expect(showAll.getAttribute("href")).toBe("#/?project=p&status=all");
    fireEvent.click(showAll);
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", project: "p", status: "all" });
    view.rerender(<MyTasks status="submitted" project="q" projects={[]} onNavigate={onNavigate} />);
    expect(screen.getByText("No submitted tasks yet.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Show all tasks" }).getAttribute("href")).toBe("#/?project=q&status=all");
  });

  it("keeps the no-assignments notice without tabs when there are no tasks at all", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    render(<MyTasks status="todo" projects={[]} onNavigate={vi.fn()} />);
    expect(await screen.findByText("No documents are assigned to you yet.")).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Nothing to do here.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Show all tasks" })).toBeNull();
  });
});

describe("My tasks guideline links", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("links Project guidelines v3 once per project with a version in force", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([...tasks, task(5, "open", "r", "Project R")]);
    vi.mocked(api.listGuidelines).mockImplementation(async key => key === "p" ? guidelineListing([guidelineSummary(3), guidelineSummary(2)])
      : key === "q" ? guidelineListing([guidelineSummary(1)]) : guidelineListing([withdrawnGuideline(2), guidelineSummary(1)]));
    const onNavigate = vi.fn();
    const { rerender } = render(<MyTasks projects={[]} onNavigate={onNavigate} />);
    await screen.findAllByTestId("task-row");
    const links = await screen.findAllByRole("link", { name: /^Project guidelines/ });
    // Ordered as the project filter options; R has no version in force (its current one is withdrawn).
    expect(links.map(link => link.textContent)).toEqual(["Project guidelines v3, Project P", "Project guidelines v1, Project Q"]);
    expect(links.map(link => link.getAttribute("href"))).toEqual(["#/projects/p/guidelines", "#/projects/q/guidelines"]);
    expect(vi.mocked(api.listGuidelines).mock.calls.map(([key]) => key).sort()).toEqual(["p", "q", "r"]);
    fireEvent.click(links[0]);
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectGuidelines", key: "p" });

    rerender(<MyTasks project="p" projects={[]} onNavigate={onNavigate} />);
    const filtered = await screen.findAllByRole("link", { name: /^Project guidelines/ });
    expect(filtered.map(link => link.textContent)).toEqual(["Project guidelines v3"]);
    expect(api.listGuidelines).toHaveBeenCalledTimes(3);
  });

  it("re-reads the guideline links when the tasks reload on a visibility change", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([task(3, "open")]);
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([guidelineSummary(1)]));
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    expect((await screen.findByRole("link", { name: /^Project guidelines/ })).textContent).toBe("Project guidelines v1");
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([guidelineSummary(2), guidelineSummary(1)]));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByRole("link", { name: /^Project guidelines/ }).textContent).toBe("Project guidelines v2"));
    expect(api.listGuidelines).toHaveBeenCalledTimes(2);
  });

  it("shows no guideline link when the request fails or no project has guidelines", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    vi.mocked(api.listGuidelines).mockImplementation(async key => { if (key === "p") throw new Error("Network down"); return guidelineListing([]); });
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    await waitFor(() => expect(api.listGuidelines).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("link", { name: /^Project guidelines/ })).toBeNull();
    expect(screen.queryByText("Network down")).toBeNull();
  });
});
