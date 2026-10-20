import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, notifySessionRestored, type ProjectSummary, type TaskSummary } from "../src/api/client";
import { MyTasks } from "../src/tasks/MyTasks";

const project = (key: string, name: string, can_manage = false): ProjectSummary => ({
  project_key: key, name, description: null, roles: [], allowed_modes: [], document_count: 0, can_manage,
});
const task = (id: number, status: TaskSummary["status"], key = "p", name = "Project P"): TaskSummary => ({
  assignment_id: id, workflow_revision: 0, held: false, project_key: key, project_name: name, document_id: `doc-${id}`, language: "de", task: id === 2 ? "review" : "annotate", status, updated_at: "2026-10-15T10:30:00Z",
});
const tasks = [task(4, "reopened"), task(2, "in_progress", "q", "Project Q"), task(3, "open"), task(1, "submitted")];
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("My tasks component", () => {
  beforeEach(() => { vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("lists real task metadata in server order and delegates opening through the callback", async () => {
    const onNavigate = vi.fn();
    render(<MyTasks projects={[]} onNavigate={onNavigate} />);
    const rows = await screen.findAllByTestId("task-row");
    expect(rows.map(row => within(row).getByText(/^doc-/).textContent)).toEqual(["doc-4 · de", "doc-2 · de", "doc-3 · de", "doc-1 · de"]);
    expect(within(rows[1]).getByText("Review")).toBeDefined();
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
    expect(screen.getByRole("list", { name: /^Task counts/ }).textContent).toMatch(/Open: 0.*In progress: 1.*Submitted: 0/);
    fireEvent.change(select, { target: { value: "" } });
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "tasks" });
    expect(api.listMyTasks).toHaveBeenCalledTimes(1);
  });

  it("counts reopened as Open without altering its visible status", async () => {
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(screen.getByRole("list", { name: /^Task counts/ }).textContent).toMatch(/Open: 2.*In progress: 1.*Submitted: 1/);
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
    expect(screen.getByRole("list", { name: /^Task counts/ }).textContent).toMatch(/Open: 1.*In progress: 1.*Submitted: 1.*of which paused: 2/);
    const action = within(rows[0]).getByRole("link", { name: "View paused task" });
    expect(action.getAttribute("href")).toBe("#/tasks/11");
    fireEvent.click(action);
    expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 11 });
    rendered.rerender(<MyTasks project="q" projects={[]} onNavigate={onNavigate} />);
    expect(screen.getByRole("list", { name: /^Task counts/ }).textContent).toMatch(/Open: 0.*In progress: 1.*Submitted: 0.*of which paused: 0/);
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
    expect(rows[0].getAttribute("aria-label")).toBe("Research (p): shared-doc · de");
    expect(rows[1].getAttribute("aria-label")).toBe("Research (q): shared-doc · de");
    fireEvent.change(select, { target: { value: "q" } });
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", project: "q" });
    fireEvent.click(within(rows[1]).getByRole("link", { name: /^(Start|Continue|View)$/ }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "task", assignmentId: 12 });
  });

  it("distinguishes duplicate project names in all-managed empty-state Documents links", async () => {
    const onNavigate = vi.fn();
    vi.mocked(api.listMyTasks).mockResolvedValue([]);
    render(<MyTasks projects={[project("p", "Research", true), project("q", "Research", true)]} onNavigate={onNavigate} />);
    const first = await screen.findByRole("link", { name: "Go to Documents in Research (p)" });
    const second = screen.getByRole("link", { name: "Go to Documents in Research (q)" });
    expect(screen.getByText(/As a project lead, you assign documents/)).toBeDefined();
    expect(first.className).toBe("btn btn-secondary");
    expect(first.getAttribute("href")).toBe("#/projects/p/documents");
    expect(second.getAttribute("href")).toBe("#/projects/q/documents");
    fireEvent.click(second);
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "q" });
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
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks" });
  });

  it("offers every managed empty project with real links and callback navigation", async () => {
    vi.mocked(api.listMyTasks).mockResolvedValue([]);
    const onNavigate = vi.fn();
    render(<MyTasks projects={[project("p", "Project P", true), project("q", "Project Q", true), project("r", "Other")]} onNavigate={onNavigate} />);
    const first = await screen.findByRole("link", { name: "Go to Documents in Project P (p)" });
    const second = screen.getByRole("link", { name: "Go to Documents in Project Q (q)" });
    expect(screen.getAllByRole("link")).toHaveLength(2);
    fireEvent.click(first);
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p" });
    onNavigate.mockClear();
    fireEvent.click(second, { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(second.getAttribute("href")).toBe("#/projects/q/documents");
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
    expect(await screen.findByText("doc-8 · de")).toBeDefined();
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
    expect(await screen.findByText("doc-9 · de")).toBeDefined();
    await act(async () => { older.resolve(tasks); });
    expect(screen.queryByText("doc-4 · de")).toBeNull();
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
    expect(await screen.findByText("doc-8 · de")).toBeDefined();
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
      ["Text", "Project", "Task", "Status", "Last change", "Action"]);
    expect(within(rows[0]).getByText("case-0101 · de")).toBeDefined();
    expect(within(rows[0]).queryByText("EXT-5")).toBeNull();
    expect(rows[0].getAttribute("aria-label")).toBe("Project P (p): case-0101 · de");
    // Older servers without a case ID fall back to the external ID.
    expect(within(rows[1]).getByText("EXT-6 · de")).toBeDefined();
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
  const counts = () => screen.getByRole("list", { name: /^Task counts/ });

  it("hides filter and counts for a lead without tasks", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    render(<MyTasks projects={[project("p", "Project P", true)]} onNavigate={vi.fn()} />);
    await screen.findByText("No documents are assigned to you yet.");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("list", { name: /^Task counts/ })).toBeNull();
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

  it("renders four count items without glyph separators that add up", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([{ ...task(1, "open"), held: true }, task(2, "in_progress"), task(3, "submitted"), task(4, "reopened")]);
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(within(counts()).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "Open: 2", "In progress: 1", "Submitted: 1", "of which paused: 1",
    ]);
    expect(counts().textContent).not.toContain("·");
    expect(counts().getAttribute("aria-label")).toBe("Task counts");
  });

  it("names the filtered scope in the counts label", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
    render(<MyTasks project="q" projects={[]} onNavigate={vi.fn()} />);
    await screen.findAllByTestId("task-row");
    expect(counts().getAttribute("aria-label")).toBe("Task counts in Project Q (q)");
  });
});
