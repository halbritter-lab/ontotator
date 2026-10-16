import type { ReactNode } from "react";
import type { CurrentUser, ProjectSummary } from "../api/client";
import { AppShell, type Crumb } from "../ui/AppShell";
import { routeHref, type Route } from "./router";

export interface ShellProps {
  user: CurrentUser;
  projects: ProjectSummary[];
  route: Route;
  onNavigate: (route: Route) => void;
  onLogout: () => void;
  breadcrumb?: Crumb[];
  children: ReactNode;
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

export function Shell({ user, projects, route, onNavigate, onLogout, breadcrumb, children }: ShellProps): JSX.Element {
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
    {projects.filter((project) => project.can_manage).map((project) => {
      const label = project.name === project.project_key ? project.name : `${project.name} (${project.project_key})`;
      return <section key={project.project_key} className="shell-nav-group" aria-label={label}>
        <h2>{label}</h2>
        <ul className="shell-nav-list">
          {link({ name: "projectSettings", key: project.project_key }, "Settings")}
          {link({ name: "projectDocuments", key: project.project_key }, "Documents")}
          {link({ name: "projectProgress", key: project.project_key }, "Progress")}
          {link({ name: "projectExport", key: project.project_key }, "Export")}
        </ul>
      </section>;
    })}
  </>;
  return <AppShell user={user} onLogout={onLogout} breadcrumb={breadcrumb} nav={nav}
    density={(route.name === "task" || route.name === "projectCase") ? "reading" : "compact"}>{children}</AppShell>;
}
