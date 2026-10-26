import { useEffect, useState, type MouseEvent } from "react";
import { api, type ProjectSummary } from "../api/client";
import { DataTable, EmptyState, IconCheck, TextInput, type Column } from "../ui";
import { PROJECT_SEARCH_THRESHOLD, projectDestination, projectRoles } from "./ProjectPicker";
import { routeHref, type Route } from "./router";
import "../styles/screens/projects.css";

export interface ProjectsPageProps {
  projects: ProjectSummary[];
  /** The current (last-used) project; marked "✓ Current". */
  currentKey?: string;
  onNavigate: (route: Route) => void;
}

const leads = (project: ProjectSummary) => project.can_manage && project.roles.includes("lead");

/** `undefined` while loading or after a failure: the cell shows "–". */
type Counts = Readonly<Record<string, number | undefined>>;

/** Rows needing the lead's decision, one lazy summary per led project. */
function useDecisionCounts(projects: readonly ProjectSummary[]): Counts {
  const [counts, setCounts] = useState<Counts>({});
  const keys = projects.filter(leads).map(project => project.project_key);
  const identity = JSON.stringify(keys);
  useEffect(() => {
    let active = true;
    setCounts({});
    void Promise.allSettled(keys.map(key => api.documentsSummary(key).then(summary => [key, summary.needs_decision] as const)))
      .then(results => {
        if (!active) return;
        setCounts(Object.fromEntries(results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])));
      });
    return () => { active = false; };
  }, [identity]);
  return counts;
}

/** Non-submitted own tasks per project, from one `listMyTasks`. */
function useOpenTasks(enabled: boolean): Counts | null {
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.listMyTasks().then(tasks => {
      if (!active) return;
      const next: Record<string, number> = {};
      for (const task of tasks) if (task.status !== "submitted") next[task.project_key] = (next[task.project_key] ?? 0) + 1;
      setCounts(next);
    }, () => { /* The column keeps "–". */ });
    return () => { active = false; };
  }, [enabled]);
  return counts;
}

/** Every project of the user (spec F8, D4): the landing when no last-used project is accessible. */
export function ProjectsPage({ projects, currentKey, onNavigate }: ProjectsPageProps): JSX.Element {
  const [search, setSearch] = useState("");
  const decisions = useDecisionCounts(projects);
  const openTasks = useOpenTasks(projects.length > 0);
  const needle = search.trim().toLocaleLowerCase();
  const shown = projects.filter(item => `${item.name} ${item.project_key}`.toLocaleLowerCase().includes(needle));
  const link = (destination: Route, text: string, primary = false) => <a href={routeHref(destination)}
    className={`btn btn-sm ${primary ? "btn-primary" : "btn-secondary"}`}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate(destination);
    }}>{text}</a>;
  const columns: Column<ProjectSummary>[] = [
    { id: "project", header: "Project", rowHeader: true, cell: item => <>
      <span className="projects-page__name">{item.name}</span>
      {item.project_key === currentKey && <span className="projects-page__current"><span aria-hidden="true"><IconCheck /></span> Current</span>}
      {item.name !== item.project_key && <span className="cell-secondary">{item.project_key}</span>}
      {/* M2 D4: the description set in Settings › General. */}
      {item.description?.trim() && <span className="cell-secondary projects-page__description">{item.description.trim()}</span>}
    </> },
    { id: "roles", header: "Your roles", cell: projectRoles },
    { id: "decision", header: "Needs your decision", cell: item => {
      const count = leads(item) ? decisions[item.project_key] : undefined;
      return count === undefined ? "–" : <>
        <span aria-hidden="true">{count}</span>
        <span className="visually-hidden">{count} documents need your decision</span>
      </>;
    } },
    { id: "tasks", header: "Your open tasks", cell: item => openTasks === null ? "–" : String(openTasks[item.project_key] ?? 0) },
    { id: "action", header: "Action", cell: item => <span className="projects-page__actions">
      {link(projectDestination(item), "Open", true)}
      {item.can_manage && link({ name: "projectSettings", key: item.project_key }, "Settings")}
    </span> },
  ];
  return <section className="projects-page" aria-labelledby="projects-heading">
    <h1 id="projects-heading">Projects</h1>
    {projects.length === 0 ? <EmptyState title="You are not a member of any project yet." /> : <>
      {projects.length > PROJECT_SEARCH_THRESHOLD && <TextInput id="projects-search" type="search" label="Find project"
        value={search} onChange={event => setSearch(event.target.value)} />}
      <DataTable label="Projects" className="projects-table" rows={shown} columns={columns} rowKey={item => item.project_key}
        rowProps={item => item.project_key === currentKey ? { "aria-current": "true", className: "projects-table__row--current" } : {}}
        empty="No matching projects." />
    </>}
  </section>;
}
