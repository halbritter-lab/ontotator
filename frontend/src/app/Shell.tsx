import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, onSessionRestored, type CurrentUser, type ProjectSummary } from "../api/client";
import { roleLabels } from "./labels";
import { AppShell, type Crumb } from "../ui/AppShell";
import { MY_TASKS, routeHref, type Route } from "./router";
import { projectDestination, ProjectSwitcher } from "./ProjectPicker";
import { rememberedProject } from "./lastProject";
import { useDocumentsSummary } from "../documents/useDocumentsSummary";
import { TASKS_CHANGED } from "../tasks/tasksEvents";
import { TechnicalReportHost } from "../reports/TechnicalReportDialog";
import { TECHNICAL_REPORTS_CHANGED } from "../reports/TechnicalReportsPage";
import { openTechnicalReport, REPORT_ENTRY_LABEL, REPORT_NAV_LABEL } from "../reports/technicalReport";

export interface ShellProps {
  user: CurrentUser;
  projects: ProjectSummary[];
  route: Route;
  onNavigate: (route: Route) => void;
  onLogout: () => void;
  breadcrumb?: Crumb[];
  children: ReactNode;
  taskProject?: string;
  /** The open task's kind: an annotator on a translation review reads as "Translation reviewer". */
  taskKind?: string;
  /** Changes on each navigation to My tasks or Projects; the My tasks count reloads then (issue 192). */
  navigation?: unknown;
}

function NavigationLink({ destination, current, onNavigate, label, children }: {
  destination: Route; current: Route; onNavigate: ShellProps["onNavigate"]; label?: string; children: ReactNode;
}): JSX.Element {
  const active = current.name === destination.name && (
    !("key" in destination) || ("key" in current && current.key === destination.key)
  );
  const inTasks = destination.name === "tasks" && current.name === "task";
  return <a href={routeHref(destination)} className="shell-nav-link" aria-label={label}
    aria-current={active ? "page" : inTasks ? "location" : undefined}
    onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate(destination);
    }}>{children}</a>;
}

const ROLE_ORDER = ["lead", "adjudicator", "annotator"] as const;

/** Second header line: the roles in the current project, else across all projects. */
export function shellRole(user: CurrentUser, projects: readonly ProjectSummary[], current: ProjectSummary | undefined, taskKind?: string): string | undefined {
  const roles = new Set((current ? [current] : projects).flatMap(project => project.roles));
  const labels = [
    ...(user.is_system_admin ? ["System administrator"] : []),
    ...ROLE_ORDER.filter(role => roles.has(role)).map(role => role === "annotator" && taskKind === "translation_review" ? "Translation reviewer" : roleLabels[role]),
  ];
  return labels.length ? labels.join(", ") : undefined;
}

/**
/**
 * Unsubmitted own tasks, loaded once per session and again on window focus, a restored session, a tasks-changed
 * event (an own submit or new work round, so the count never lags behind it) or a change of `navigation` (opening
 * My tasks or Projects).
 */
function useOpenTaskCount(username: string, navigation: unknown): number | null {
  const [count, setCount] = useState<{ username: string; value: number } | null>(null);
  const reload = useRef<(() => void) | null>(null);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = () => {
      const request = ++generation;
      api.listMyTasks().then(tasks => {
        if (active && request === generation) setCount({ username, value: tasks.filter(task => task.status !== "submitted" && !task.practice).length });
      }, () => { /* The nav keeps its plain label; My tasks itself reports errors. */ });
    };
    load();
    reload.current = load;
    window.addEventListener("focus", load);
    window.addEventListener(TASKS_CHANGED, load);
    const stopRestored = onSessionRestored(load);
    return () => {
      active = false;
      reload.current = null;
      window.removeEventListener("focus", load);
      window.removeEventListener(TASKS_CHANGED, load);
      stopRestored();
    };
  }, [username]);
  const seenNavigation = useRef(navigation);
  useEffect(() => {
    if (seenNavigation.current === navigation) return;
    seenNavigation.current = navigation;
    if (navigation) reload.current?.();
  }, [navigation]);
  return count?.username === username ? count.value : null;
}

/** Open technical reports for a system administrator (the navigation badge); null for others or while unknown. */
function useOpenReportCount(admin: boolean, navigation: unknown): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!admin) { setCount(null); return; }
    let active = true;
    const load = () => {
      api.adminTechnicalReportSummary().then(summary => { if (active) setCount(summary.open); },
        () => { /* The link keeps its plain label; the page itself reports errors. */ });
    };
    load();
    window.addEventListener("focus", load);
    window.addEventListener(TECHNICAL_REPORTS_CHANGED, load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      window.removeEventListener(TECHNICAL_REPORTS_CHANGED, load);
    };
  }, [admin, navigation]);
  return admin ? count : null;
}

export function Shell({ user, projects, route, onNavigate, onLogout, breadcrumb, children, taskProject, taskKind, navigation }: ShellProps): JSX.Element {
  const [choice, setChoice] = useState<{ username: string; key: string } | null>(null);
  const explicitKey = 'key' in route ? route.key : route.name === 'tasks' ? route.project : route.name === 'task' ? taskProject : undefined;
  // Without a project in the route: the switcher's last choice, else the remembered (last-used) project.
  const remembered = rememberedProject(user.username);
  const currentKey = explicitKey ?? (choice?.username === user.username ? choice.key : undefined)
    ?? (remembered !== null && projects.some(project => project.project_key === remembered) ? remembered : undefined);
  const current = projects.find(project => project.project_key === currentKey);
  const openTasks = useOpenTaskCount(user.username, navigation);
  const openReports = useOpenReportCount(user.is_system_admin, navigation);
  // "Documents (n)": rows needing the lead's decision (V3); the summary is lead only.
  const needsDecision = useDocumentsSummary(current?.project_key, !!current?.can_manage && current.roles.includes("lead"));
  const switcher = projects.length > 0 && <ProjectSwitcher projects={projects} current={current} route={route}
    onNavigate={onNavigate} onChoose={key => setChoice({ username: user.username, key })} />;
  const link = (destination: Route, text: string, label?: string) => <li key={destination.name}>
    <NavigationLink destination={destination} current={route} onNavigate={onNavigate} label={label}>{text}</NavigationLink>
  </li>;
  // With n > 0 the link opens Needs your decision (VD7); otherwise plain Documents (All).
  const documentsLink = (key: string) => needsDecision
    ? link({ name: "projectDocuments", key, segment: "decision" }, `Documents (${needsDecision})`, `Documents, ${needsDecision} need your decision`)
    : link({ name: "projectDocuments", key }, "Documents");
  const nav = <>
    {switcher}
    <ul className="shell-nav-list">
      {/* "All" explicitly, so a reload of My tasks never triggers the last-used landing. */}
      {link(MY_TASKS, openTasks === null ? "My tasks" : `My tasks (${openTasks})`)}
      {projects.length > 0 && link({ name: "projects" }, "Projects")}
      {link({ name: "me" }, "Profile")}
      <li><button type="button" className="shell-nav-link" aria-label={REPORT_ENTRY_LABEL} onClick={openTechnicalReport}>{REPORT_NAV_LABEL}</button></li>
    </ul>
    {user.is_system_admin && <section className="shell-nav-group" aria-label="Administration">
      <h2>Administration</h2>
      <ul className="shell-nav-list">
        {link({ name: "adminUsers" }, "Users")}
        {link({ name: "adminOntologies" }, "Ontologies")}
        {openReports
          ? link({ name: "adminReports" }, `Technical reports (${openReports})`, `Technical reports, ${openReports} open`)
          : link({ name: "adminReports" }, "Technical reports")}
        {link({ name: "projectNew" }, "New project")}
        {link({ name: "adminSettings" }, "Server settings")}
      </ul>
    </section>}
    {current?.can_manage && <section className="shell-nav-group" aria-label="Current project sections">
        <h2 title={current.name}>{current.name}</h2>
        <ul className="shell-nav-list">
          {documentsLink(current.project_key)}
          {link({ name: "projectProgress", key: current.project_key }, "Progress")}
          {link({ name: "projectSettings", key: current.project_key }, "Settings")}
          {link({ name: "projectExport", key: current.project_key }, "Export")}
        </ul>
      </section>}
  </>;
  // The logo's start page: the current project's landing (Documents for leads, its My tasks otherwise), else My tasks.
  const home = current ? projectDestination(current) : MY_TASKS;
  return <AppShell user={user} onLogout={onLogout} breadcrumb={breadcrumb} nav={nav} role={shellRole(user, projects, current, route.name === "task" ? taskKind : undefined)}
    homeHref={routeHref(home)} onHome={() => onNavigate(home)}
    density={(route.name === "task" || route.name === "projectCase") ? "reading" : "compact"}>{children}<TechnicalReportHost /></AppShell>;
}
