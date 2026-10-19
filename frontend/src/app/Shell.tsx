import { useState, type ReactNode } from "react";
import type { CurrentUser, ProjectSummary } from "../api/client";
import { AppShell, type Crumb } from "../ui/AppShell";
import { routeHref, type Route } from "./router";
import { Select, TextInput } from "../ui";

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

function NavigationLink({ destination, current, onNavigate, children }: {
  destination: Route; current: Route; onNavigate: ShellProps["onNavigate"]; children: ReactNode;
}): JSX.Element {
  const active = current.name === destination.name && (
    !("key" in destination) || ("key" in current && current.key === destination.key)
  );
  const inTasks = destination.name === "tasks" && current.name === "task";
  return <a href={routeHref(destination)} className="shell-nav-link"
    aria-current={active ? "page" : inTasks ? "location" : undefined}
    onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate(destination);
    }}>{children}</a>;
}

export function Shell({ user, projects, route, onNavigate, onLogout, breadcrumb, children, taskProject }: ShellProps): JSX.Element {
  const [choice, setChoice] = useState<{ username: string; key: string } | null>(null);
  const [search, setSearch] = useState('');
  const explicitKey = 'key' in route ? route.key : route.name === 'tasks' ? route.project : route.name === 'task' ? taskProject : undefined;
  const currentKey = explicitKey ?? (choice?.username === user.username ? choice.key : undefined);
  const current = projects.find(project => project.project_key === currentKey);
  const matches = projects.filter(project => `${project.name} ${project.project_key}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selector = projects.length > 0 && <details className="shell-project-selector">
    <summary>Project: {current?.name ?? 'Choose project'}</summary>
    <div className="shell-project-menu">
      <TextInput id="shell-project-search" type="search" label="Find project" value={search} onChange={event => setSearch(event.target.value)} />
      <Select id="shell-current-project" label="Current project" value={current?.project_key ?? ''} onChange={event => {
        const selected = projects.find(project => project.project_key === event.target.value);
        if (!selected) return;
        setChoice({ username: user.username, key: selected.project_key });
        setSearch('');
        const destination: Route = selected.can_manage
          ? { name: 'projectDocuments', key: selected.project_key }
          : { name: 'tasks', project: selected.project_key };
        onNavigate(destination);
      }}>
        <option value="">Choose a project</option>
        {matches.map(project => <option key={project.project_key} value={project.project_key}>{project.name} ({project.project_key})</option>)}
      </Select>
      {!matches.length && <p role="status">No matching projects.</p>}
      {current && <p className="cell-secondary">Project key: {current.project_key}</p>}
    </div>
  </details>;
  const link = (destination: Route, label: string) => <li key={destination.name}>
    <NavigationLink destination={destination} current={route} onNavigate={onNavigate}>{label}</NavigationLink>
  </li>;
  const nav = <>
    <ul className="shell-nav-list">
      {link({ name: "tasks" }, "My tasks")}
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
          {link({ name: "projectDocuments", key: current.project_key }, "Documents")}
          {link({ name: "projectProgress", key: current.project_key }, "Progress")}
          {link({ name: "projectSettings", key: current.project_key }, "Settings")}
          {link({ name: "projectExport", key: current.project_key }, "Export")}
        </ul>
      </section>}
  </>;
  return <AppShell user={user} onLogout={onLogout} breadcrumb={breadcrumb} nav={nav} actions={selector}
    density={(route.name === "task" || route.name === "projectCase") ? "reading" : "compact"}>{children}</AppShell>;
}
