import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, notifySessionRestored, type CurrentUser, type ProjectSummary, type TaskSummary } from "../src/api/client";
import userEvent from "@testing-library/user-event";
import { Shell, type ShellProps } from "../src/app/Shell";
import { NotFound } from "../src/app/NotFound";
import { routeHref } from "../src/app/router";
import { notifyDocumentsChanged } from "../src/documents/documentsEvents";
import { DOCUMENTS_SUMMARY_REFRESH_MS } from "../src/documents/useDocumentsSummary";

const user: CurrentUser = { username: "alex", display_name: "Alex", pseudonym: "a1", is_system_admin: false, csrf_token: "test" };
const project = (key: string, canManage: boolean): ProjectSummary => ({
  project_key: key, name: "Research", description: null, roles: canManage ? ["lead"] : ["annotator"],
  allowed_modes: ["independent"], document_count: 0, can_manage: canManage,
});
const props = (extra: Partial<ShellProps> = {}): ShellProps => ({
  user, projects: [], route: { name: "tasks" }, onNavigate: vi.fn(), onLogout: vi.fn(), children: "Page content", ...extra,
});

const task = (id: number, status: TaskSummary["status"]): TaskSummary => ({
  assignment_id: id, workflow_revision: 0, held: false, project_key: "p", project_name: "P", document_id: `doc-${id}`,
  case_id: `case-${id}`, language: "de", task: "annotate", status, updated_at: "2026-10-20T10:00:00Z",
});

beforeEach(() => {
  window.history.replaceState(null, "", "#/tasks/42");
  // The task count stays unknown unless a test answers it.
  vi.spyOn(api, "listMyTasks").mockReturnValue(new Promise(() => {}));
  // Likewise the Documents counter.
  vi.spyOn(api, "documentsSummary").mockReturnValue(new Promise(() => {}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); window.history.replaceState(null, "", "/"); });

describe("role-based shell", () => {
  it("keeps reading navigation in a keyboard-accessible disclosure without a permanent sidebar", async () => {
    const state = props({ user: { ...user, is_system_admin: true }, projects: [project("managed", true)], route: { name: "task", assignmentId: 42 }, taskProject: "managed" });
    render(<Shell {...state} />);
    expect(document.querySelector<HTMLDetailsElement>(".shell-reading-navigation")?.open).toBe(false);
    expect(screen.getByRole("main").parentElement?.querySelector(":scope > .app-nav")).toBeNull();
    const summary = screen.getByText("Sections");
    expect(summary.tagName).toBe("SUMMARY");
    const input = userEvent.setup();
    await input.click(summary);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav.closest("details")?.open).toBe(true);
    expect(within(nav).getByRole("link", { name: "Export" })).toBeDefined();
    await input.click(within(nav).getByRole("link", { name: "Profile" }));
    expect(state.onNavigate).toHaveBeenCalledWith({ name: "me" });
    expect(window.location.hash).toBe("#/tasks/42");
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    fireEvent.keyDown(summary, { key: "Escape" });
    expect(nav.closest("details")?.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });
  it("shows an annotator only My tasks and Profile, using the real AppShell once", () => {
    render(<Shell {...props({ projects: [project("assigned", false)] })} />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["My tasks", "Projects", "Profile"]);
    expect(within(nav).queryByRole("navigation")).toBeNull();
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByTestId("current-user").textContent).toBe("Alex (a1)Annotator");
    expect(screen.getByTestId("current-user").textContent).not.toContain("alex");
    expect(screen.getByText("Page content")).toBeDefined();
  });

  it("shows an admin Users, Ontologies and New project without unmanageable project links", () => {
    render(<Shell {...props({ user: { ...user, is_system_admin: true }, projects: [project("hidden", false)] })} />);
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("href")).toBe("#/admin/users");
    expect(screen.getByRole("link", { name: "Ontologies" }).getAttribute("href")).toBe("#/admin/ontologies");
    expect(screen.getByRole("link", { name: "New project" }).getAttribute("href")).toBe("#/projects/new");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("lists authorized projects and shows sections only for the current project", () => {
    const state = props({ projects: [project("first", true), project("reader", false), project("second / α", true)], route: { name: "projectDocuments", key: "first" } });
    render(<Shell {...state} />);
    expect(screen.getAllByRole("link", { name: "Documents" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Documents" }).getAttribute("href")).toBe("#/projects/first/documents");
    fireEvent.click(screen.getByRole("button", { name: "Project: Research, switch project" }));
    const panel = screen.getByRole("dialog", { name: "Switch project" });
    const target = routeHref({ name: "projectDocuments", key: "second / α" });
    // Every fixture project is named "Research", so the link is found by its destination, not its name.
    const link = within(panel).getAllByRole("link").find(item => item.getAttribute("href") === target);
    expect(link, `link to ${target}`).toBeDefined();
    fireEvent.click(link!);
    expect(state.onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "second / α" });
    expect(screen.queryByText("unauthorized")).toBeNull();
  });

  it("never silently chooses the first project and uses an authorized task's project", () => {
    const state = props({ projects: [project("first", true), project("second", true)] });
    const { rerender } = render(<Shell {...state} />);
    expect(screen.queryByRole("link", { name: "Documents" })).toBeNull();
    rerender(<Shell {...state} route={{ name: "task", assignmentId: 42 }} taskProject="second" />);
    expect(screen.getByRole("link", { name: "Documents" }).getAttribute("href")).toBe("#/projects/second/documents");
  });

  it("delegates ordinary navigation without changing the active hash or calling logout", () => {
    const state = props({ projects: [project("first", true)], route: { name: "projectDocuments", key: "first" } });
    render(<Shell {...state} />);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(screen.getByRole("link", { name: "Documents" }), event);
    expect(event.defaultPrevented).toBe(true);
    expect(state.onNavigate).toHaveBeenCalledOnce();
    expect(state.onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "first" });
    expect(state.onLogout).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/tasks/42");
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])("leaves modified/native clicks alone: %j", (modifier) => {
    const state = props();
    render(<Shell {...state} />);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...modifier });
    let preventedByShell: boolean | undefined;
    // Observe the shell's decision, then stop jsdom's deferred same-tab hash
    // navigation; a browser may open these modified clicks in another tab.
    document.addEventListener("click", (bubbled) => {
      preventedByShell = bubbled.defaultPrevented;
      bubbled.preventDefault();
    }, { once: true });
    fireEvent(screen.getByRole("link", { name: "Profile" }), event);
    expect(preventedByShell).toBe(false);
    expect(state.onNavigate).not.toHaveBeenCalled();
  });

  it("passes logout and caller-controlled breadcrumbs through to AppShell", () => {
    const back = vi.fn();
    const state = props({ breadcrumb: [{ label: "Back to tasks", onClick: back }, { label: "Current page" }] });
    render(<Shell {...state} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));
    expect(back).toHaveBeenCalledOnce();
    expect(state.onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(state.onLogout).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("#/tasks/42");
  });

  it("uses reading density only for task routes", () => {
    const { rerender } = render(<Shell {...props({ route: { name: "task", assignmentId: 42 } })} />);
    expect(screen.getByRole("main").classList.contains("density-reading")).toBe(true);
    expect(screen.getByRole("link", { name: "My tasks" }).getAttribute("aria-current")).toBe("location");
    rerender(<Shell {...props({ route: { name: "projectDocuments", key: "a" } })} />);
    expect(screen.getByRole("main").classList.contains("density-compact")).toBe(true);
  });

  it("marks only the matching project page active, ignoring document query changes", () => {
    const state = props({ projects: [project("first", true), project("second", true)], route: { name: "projectDocuments", key: "second", q: "prefix", select: "doc/1" } });
    const { rerender } = render(<Shell {...state} />);
    const links = screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("#/projects/second/documents");
    expect(links[0].getAttribute("aria-current")).toBe("page");
    rerender(<Shell {...state} route={{ name: "projectDocuments", key: "second", status: "open" }} />);
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Current project sections" }).querySelector('[aria-current="page"]')?.textContent).toBe("Documents");
  });

  it("marks the tasks page current even with its project filter", () => {
    render(<Shell {...props({ route: { name: "tasks", project: "first" } })} />);
    expect(screen.getByRole("link", { name: "My tasks" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Profile" }).hasAttribute("aria-current")).toBe(false);
  });

  it("puts the project switcher first in the nav and no project control in the header", () => {
    render(<Shell {...props({ projects: [project("first", true)], route: { name: "projectDocuments", key: "first" } })} />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const switcher = within(nav).getByRole("button", { name: "Project: Research, switch project" });
    expect(nav.firstElementChild).toBe(switcher);
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: /project/i })).toBeNull();
    expect(document.querySelector(".shell-actions .project-switcher")).toBeNull();
  });

  it("links My tasks to the All tab and marks it current on every tasks route", () => {
    const state = props({ projects: [project("first", false)] });
    const { rerender } = render(<Shell {...state} />);
    const myTasks = screen.getByRole("link", { name: "My tasks" });
    expect(myTasks.getAttribute("href")).toBe("#/?status=all");
    fireEvent.click(myTasks);
    expect(state.onNavigate).toHaveBeenCalledWith({ name: "tasks", status: "all" });
    for (const route of [{ name: "tasks" }, { name: "tasks", status: "submitted" }, { name: "tasks", project: "first", status: "todo" }] as const) {
      rerender(<Shell {...state} route={route} />);
      expect(screen.getByRole("link", { name: "My tasks" }).getAttribute("aria-current")).toBe("page");
    }
  });

  it("shows Projects after My tasks only with at least one project", () => {
    const state = props({ projects: [project("first", false)], route: { name: "projects" } });
    const { rerender } = render(<Shell {...state} />);
    const links = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link").map(link => link.textContent);
    expect(links.indexOf("Projects")).toBe(links.indexOf("My tasks") + 1);
    const projectsLink = screen.getByRole("link", { name: "Projects" });
    expect(projectsLink.getAttribute("href")).toBe("#/projects");
    expect(projectsLink.getAttribute("aria-current")).toBe("page");
    rerender(<Shell {...state} projects={[]} />);
    expect(screen.queryByRole("link", { name: "Projects" })).toBeNull();
    expect(screen.queryByRole("button", { name: /switch project|Choose project/ })).toBeNull();
  });

  it("names the remembered project without a project in the route", () => {
    window.localStorage.setItem("ontocurator.lastProject.v1:alex", "second");
    render(<Shell {...props({ projects: [project("first", true), { ...project("second", true), name: "Second" }], route: { name: "projects" } })} />);
    expect(screen.getByRole("button", { name: "Project: Second, switch project" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Current project sections" })).toBeDefined();
  });

  it("puts the switcher first inside Sections in the reading shell", async () => {
    render(<Shell {...props({ projects: [project("first", true)], route: { name: "task", assignmentId: 42 }, taskProject: "first" })} />);
    await userEvent.setup().click(screen.getByText("Sections"));
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav.closest("details")).not.toBeNull();
    expect(nav.firstElementChild).toBe(within(nav).getByRole("button", { name: "Project: Research, switch project" }));
  });

  it.each(["click", "keyboard"])("focuses main via skip-link %s without leaving the editor hash", async (activation) => {
    window.history.replaceState(null, "", "#/tasks/17");
    const onNavigate = vi.fn();
    render(<Shell {...props({ route: { name: "task", assignmentId: 17 }, onNavigate })} />);
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip.getAttribute("href")).toBe("#main");
    const user = userEvent.setup();
    if (activation === "click") await user.click(skip);
    else {
      skip.focus();
      await user.keyboard("{Enter}");
    }
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expect(window.location.hash).toBe("#/tasks/17");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("shell identity and task count", () => {
  it("shows My tasks (n) counting unsubmitted tasks, refreshed on focus", async () => {
    vi.mocked(api.listMyTasks).mockResolvedValue([task(1, "open"), task(2, "in_progress"), task(3, "reopened"), task(4, "submitted")]);
    render(<Shell {...props()} />);
    const link = await screen.findByRole("link", { name: "My tasks (3)" });
    expect(link.getAttribute("href")).toBe("#/?status=all");
    expect(api.listMyTasks).toHaveBeenCalledTimes(1);
    vi.mocked(api.listMyTasks).mockResolvedValue([task(1, "submitted")]);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByRole("link", { name: "My tasks (0)" })).toBe(link);
    expect(api.listMyTasks).toHaveBeenCalledTimes(2);
    vi.mocked(api.listMyTasks).mockResolvedValue([task(5, "open")]);
    act(() => { notifySessionRestored(); });
    expect(await screen.findByRole("link", { name: "My tasks (1)" })).toBe(link);
  });

  it("keeps the plain My tasks label when the count cannot be loaded", async () => {
    vi.mocked(api.listMyTasks).mockRejectedValue(new Error("offline"));
    render(<Shell {...props()} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("link", { name: "My tasks" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows Display name (pseudonym) with the role as a second line", () => {
    const { rerender } = render(<Shell {...props({ projects: [project("led", true)], route: { name: "projectDocuments", key: "led" } })} />);
    const identity = screen.getByTestId("current-user");
    expect(identity.querySelector(".current-user-name")?.textContent).toBe("Alex (a1)");
    expect(identity.querySelector(".cell-secondary")?.textContent).toBe("Project lead");
    expect(identity.textContent).not.toContain("alex");
    rerender(<Shell {...props({ user: { ...user, is_system_admin: true }, projects: [] })} />);
    expect(identity.querySelector(".cell-secondary")?.textContent).toBe("System administrator");
    rerender(<Shell {...props({ projects: [] })} />);
    expect(identity.querySelector(".cell-secondary")).toBeNull();
  });
});

describe("Documents counter (V3, VD7)", () => {
  const led = () => props({ projects: [project("led", true)], route: { name: "projectProgress", key: "led" } });

  it("shows Documents (3) for leads with accessible name Documents, 3 need your decision", async () => {
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 3 });
    render(<Shell {...led()} />);
    const link = await screen.findByRole("link", { name: "Documents, 3 need your decision" });
    expect(link.textContent).toBe("Documents (3)");
    expect(api.documentsSummary).toHaveBeenCalledWith("led");
  });

  it("links segment=decision when n > 0, plain Documents otherwise", async () => {
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 2 });
    const state = led();
    render(<Shell {...state} />);
    const link = await screen.findByRole("link", { name: "Documents, 2 need your decision" });
    expect(link.getAttribute("href")).toBe(routeHref({ name: "projectDocuments", key: "led", segment: "decision" }));
    fireEvent.click(link);
    expect(state.onNavigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "led", segment: "decision" });
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 0 });
    act(() => { notifyDocumentsChanged(); });
    const plain = await screen.findByRole("link", { name: "Documents" });
    expect(plain).toBe(link);
    expect(plain.textContent).toBe("Documents");
    expect(plain.getAttribute("href")).toBe("#/projects/led/documents");
  });

  it("reloads on focus, every 60 s and on documents-changed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 1 });
      render(<Shell {...led()} />);
      await screen.findByRole("link", { name: "Documents, 1 need your decision" });
      vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 4 });
      act(() => { window.dispatchEvent(new Event("focus")); });
      await screen.findByRole("link", { name: "Documents, 4 need your decision" });
      vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 5 });
      await act(async () => { vi.advanceTimersByTime(DOCUMENTS_SUMMARY_REFRESH_MS); });
      await screen.findByRole("link", { name: "Documents, 5 need your decision" });
      vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 6 });
      act(() => { notifyDocumentsChanged(); });
      await screen.findByRole("link", { name: "Documents, 6 need your decision" });
      expect(api.documentsSummary).toHaveBeenCalledTimes(4);
    } finally { vi.useRealTimers(); }
  });

  it("non-leads see no count", async () => {
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 3 });
    // A system administrator manages the project without leading it: the summary is lead only.
    const admin = { ...project("managed", true), roles: [] as ProjectSummary["roles"] };
    render(<Shell {...props({ user: { ...user, is_system_admin: true }, projects: [admin], route: { name: "projectProgress", key: "managed" } })} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("link", { name: "Documents" }).textContent).toBe("Documents");
    expect(api.documentsSummary).not.toHaveBeenCalled();
  });
});

describe("NotFound page", () => {
  it.each([false, true])("shows accurate noAccess=%s copy and delegates its real My tasks link", (noAccess) => {
    const onNavigate = vi.fn();
    render(<NotFound noAccess={noAccess} onNavigate={onNavigate} />);
    expect(screen.getByText(noAccess ? "You do not have access to this page." : "This page does not exist.")).toBeDefined();
    const link = screen.getByRole("link", { name: "My tasks" });
    expect(link.getAttribute("href")).toBe("#/");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks" });
    expect(window.location.hash).toBe("#/tasks/42");
  });
});
