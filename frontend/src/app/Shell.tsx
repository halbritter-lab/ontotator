import { useEffect, useState, type ReactNode } from "react";
import { api, onSessionRestored, type CurrentUser, type ProjectSummary } from "../api/client";
import { roleLabels } from "./labels";
import { AppShell, type Crumb } from "../ui/AppShell";
import { routeHref, type Route } from "./router";
import { ProjectPicker } from "./ProjectPicker";
import { useDocumentsSummary } from "../documents/useDocumentsSummary";

export interface ShellProps {
  user: CurrentUser;
  projects: ProjectSummary[];
  route: Route;
  onNavigate: (route: Route) => void;
  onLogout: () => void;
  breadcrumb?: Crumb[];
  children: ReactNode;
  taskProject?: string;
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
export function shellRole(user: CurrentUser, projects: readonly ProjectSummary[], current: ProjectSummary | undefined): string | undefined {
  const roles = new Set((current ? [current] : projects).flatMap(project => project.roles));
  const labels = [
    ...(user.is_system_admin ? ["System administrator"] : []),
    ...ROLE_ORDER.filter(role => roles.has(role)).map(role => roleLabels[role]),
  ];
  return labels.length ? labels.join(", ") : undefined;
}

/** Unsubmitted own tasks, loaded once per session and again on window focus or a restored session. */
function useOpenTaskCount(username: string): number | null {
  const [count, setCount] = useState<{ username: string; value: number } | null>(null);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = () => {
      const request = ++generation;
      api.listMyTasks().then(tasks => {
        if (active && request === generation) setCount({ username, value: tasks.filter(task => task.status !== "submitted").length });
      }, () => { /* The nav keeps its plain label; My tasks itself reports errors. */ });
    };
    load();
    window.addEventListener("focus", load);
    const stopRestored = onSessionRestored(load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      stopRestored();
    };
  }, [username]);
  return count?.username === username ? count.value : null;
}

export function Shell({ user, projects, route, onNavigate, onLogout, breadcrumb, children, taskProject }: ShellProps): JSX.Element {
  const [choice, setChoice] = useState<{ username: string; key: string } | null>(null);
  const explicitKey = 'key' in route ? route.key : route.name === 'tasks' ? route.project : route.name === 'task' ? taskProject : undefined;
  const currentKey = explicitKey ?? (choice?.username === user.username ? choice.key : undefined);
  const current = projects.find(project => project.project_key === currentKey);
  const openTasks = useOpenTaskCount(user.username);
  // "Documents (n)": rows needing the lead's decision (V3); the summary is lead only.
  const needsDecision = useDocumentsSummary(current?.project_key, !!current?.can_manage && current.roles.includes("lead"));
  const selector = projects.length > 0 && <ProjectPicker projects={projects} current={current} route={route}
    onNavigate={onNavigate} onChoose={key => setChoice({ username: user.username, key })} />;
  const link = (destination: Route, text: string, label?: string) => <li key={destination.name}>
    <NavigationLink destination={destination} current={route} onNavigate={onNavigate} label={label}>{text}</NavigationLink>
  </li>;
  // With n > 0 the link opens Needs your decision (VD7); otherwise plain Documents (All).
  const documentsLink = (key: string) => needsDecision
    ? link({ name: "projectDocuments", key, segment: "decision" }, `Documents (${needsDecision})`, `Documents, ${needsDecision} need your decision`)
    : link({ name: "projectDocuments", key }, "Documents");
  const nav = <>
    <ul className="shell-nav-list">
      {link({ name: "tasks" }, openTasks === null ? "My tasks" : `My tasks (${openTasks})`)}
      {link({ name: "me" }, "Profile")}
    </ul>
    {user.is_system_admin && <section className="shell-nav-group" aria-label="Administration">
      <h2>Administration</h2>
      <ul className="shell-nav-list">
        {link({ name: "adminUsers" }, "Users")}
        {link({ name: "adminOntologies" }, "Ontologies")}
        {link({ name: "projectNew" }, "New project")}
      </ul>
    </section>}
    {current?.can_manage && <section className="shell-nav-group" aria-label="Current project sections">
        <h2>{current.name}</h2>
        <ul className="shell-nav-list">
          {documentsLink(current.project_key)}
          {link({ name: "projectProgress", key: current.project_key }, "Progress")}
          {link({ name: "projectSettings", key: current.project_key }, "Settings")}
          {link({ name: "projectExport", key: current.project_key }, "Export")}
        </ul>
      </section>}
  </>;
  return <AppShell user={user} onLogout={onLogout} breadcrumb={breadcrumb} nav={nav} actions={selector} role={shellRole(user, projects, current)}
    density={(route.name === "task" || route.name === "projectCase") ? "reading" : "compact"}>{children}</AppShell>;
}
