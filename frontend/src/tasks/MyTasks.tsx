import { useEffect, useState } from "react";
import { api, onSessionRestored, type ProjectSummary, type TaskSummary } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { ErrorNotice } from "../admin/ErrorNotice";
import { assignmentStatusLabels, formatDateTime, taskLabels } from "../app/labels";
import { textLabel } from "../app/identity";
import { failedChecksTitle } from "../translation/labels";
import { IconWarning } from "../ui/icons";
import { Button, DataTable, EmptyState, InlineMessage, Select, StatusBadge, Toolbar, type Column } from "../ui";

export interface MyTasksProps {
  project?: string;
  projects: ProjectSummary[];
  onNavigate: (route: Route) => void;
}

type TaskState = { kind: "loading" } | { kind: "ready"; tasks: TaskSummary[] } | { kind: "error"; error: unknown };

/** The row action names what opening the task will do: start fresh work, continue it, or look at a submission. */
export const taskActionLabels: Record<TaskSummary["status"], string> = {
  open: "Start", reopened: "Continue", in_progress: "Continue", submitted: "View",
};

export function taskDescription(task: Pick<TaskSummary, "task" | "language" | "source_language" | "target_language">): string {
  if (task.task !== "translation_review") return taskLabels[task.task];
  return `${taskLabels.translation_review} (${task.source_language ?? "unknown language"} to ${task.target_language ?? task.language})`;
}

/** Failed automatic checks of a translation review task, or 0 for other tasks and servers that do not send a count. */
const failedChecks = (task: Pick<TaskSummary, "task" | "failed_check_count">): number =>
  task.task === "translation_review" ? task.failed_check_count ?? 0 : 0;

const projectLabel = (name: string, key: string): string => name === key ? name : `${name} (${key})`;

/** Text label "case-0101 · de"; servers without a case ID fall back to the document's external or internal ID. */
export const taskText = (task: Pick<TaskSummary, "case_id" | "external_id" | "document_id" | "language">): string =>
  textLabel({ case_id: task.case_id ?? task.external_id ?? task.document_id, language: task.language });

export function MyTasks({ project, projects, onNavigate }: MyTasksProps): JSX.Element {
  const [state, setState] = useState<TaskState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  // Bumped by every successful task load, so the guideline links are re-read with the tasks.
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      setState({ kind: "loading" });
      try {
        const tasks = await api.listMyTasks();
        if (active && request === generation) { setState({ kind: "ready", tasks }); setLoads(value => value + 1); }
      } catch (error: unknown) {
        if (active && request === generation) setState({ kind: "error", error });
      }
    };
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    document.addEventListener("visibilitychange", visible);
    const stopRestored = onSessionRestored(() => { void load(); });
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", visible);
      stopRestored();
    };
  }, [retry]);

  // One quiet "Project guidelines v3" link per listed project with a version in force (spec: My tasks).
  const taskProjects = state.kind === "ready" ? [...new Set(state.tasks.map(task => task.project_key))].sort() : [];
  const projectIdentity = JSON.stringify(taskProjects);
  const [guidelines, setGuidelines] = useState<{ identity: string; versions: ReadonlyMap<string, number> } | null>(null);
  useEffect(() => {
    const keys = JSON.parse(projectIdentity) as string[];
    if (keys.length === 0) return;
    let active = true;
    // A failed read only hides that project's link; the task list stays usable.
    void Promise.all(keys.map(key => api.listGuidelines(key).then(listing => listing.current?.version ?? null, () => null))).then(versions => {
      if (!active) return;
      const inForce = new Map<string, number>();
      keys.forEach((key, index) => { const version = versions[index]; if (version !== null) inForce.set(key, version); });
      setGuidelines({ identity: projectIdentity, versions: inForce });
    });
    return () => { active = false; };
  }, [projectIdentity, loads]);

  const tasks = state.kind === "ready" ? state.tasks : [];
  const filtered = project === undefined ? tasks : tasks.filter(task => task.project_key === project);
  const options = new Map(tasks.map(task => [task.project_key, projectLabel(task.project_name, task.project_key)]));
  if (project !== undefined && !options.has(project)) {
    const selected = projects.find(item => item.project_key === project);
    options.set(project, selected ? projectLabel(selected.name, selected.project_key) : project || "Empty project filter");
  }
  // Keep even an empty raw query distinct from All my tasks without reserving
  // any actual project key as a magic value.
  let allProjectsValue = "";
  while (options.has(allProjectsValue)) allProjectsValue += "_";
  const showFilter = new Set(tasks.map(task => task.project_key)).size >= 2 || project !== undefined;
  const count = (predicate: (task: TaskSummary) => boolean) => filtered.filter(predicate).length;
  const countsLabel = project === undefined ? "Task counts" : `Task counts in ${options.get(project) ?? project}`;
  const managed = projects.filter(item => item.can_manage && (project === undefined || item.project_key === project));
  const guidelineVersions = guidelines?.identity === projectIdentity ? guidelines.versions : new Map<string, number>();
  const listedProjects = new Set(filtered.map(task => task.project_key));
  const guidelineLinks = [...options.keys()].filter(key => listedProjects.has(key) && guidelineVersions.has(key));
  const guidelineLink = (key: string) => {
    const route: Route = { name: "projectGuidelines", key };
    const name = tasks.find(task => task.project_key === key)?.project_name ?? key;
    return <a href={routeHref(route)} onClick={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(route);
    }}>{`Project guidelines v${guidelineVersions.get(key)}${guidelineLinks.length > 1 ? ` · ${name}` : ""}`}</a>;
  };
  const columns: Column<TaskSummary>[] = [
    { id: "text", header: "Text", cell: task => taskText(task) },
    { id: "project", header: "Project", cell: task => projectLabel(task.project_name, task.project_key) },
    { id: "task", header: "Task", cell: task => <>
      {taskDescription(task)}
      {failedChecks(task) > 0 && <span className="task-check-flag"><IconWarning /> {failedChecksTitle(failedChecks(task))}</span>}
    </> },
    { id: "status", header: "Status", cell: task => <>
      <StatusBadge status={task.status}>{assignmentStatusLabels[task.status]}</StatusBadge>
      {task.held && <><StatusBadge tone="warning">Paused</StatusBadge><p>{task.hold_reason ?? "A project problem needs attention."}</p></>}
    </> },
    { id: "changed", header: "Last change", cell: task => <time dateTime={task.updated_at}>{formatDateTime(task.updated_at)}</time> },
    { id: "open", header: "Action", cell: task => <a className="btn btn-secondary" href={routeHref({ name: "task", assignmentId: task.assignment_id })} onClick={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate({ name: "task", assignmentId: task.assignment_id });
    }}>{task.held ? "View paused task" : taskActionLabels[task.status]}</a> },
  ];
  const empty = <EmptyState title="No documents are assigned to you yet." action={managed.length > 0 &&
    <Toolbar label="Assignment actions">{managed.map(item => {
      const route: Route = { name: "projectDocuments", key: item.project_key };
      return <a key={item.project_key} className="btn btn-secondary" href={routeHref(route)} onClick={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(route);
      }}>{managed.length > 1 ? `Go to Documents in ${projectLabel(item.name, item.project_key)}` : "Go to Documents"}</a>;
    })}</Toolbar>
  }>{managed.length > 0 && "As a project lead, you assign documents to people, yourself included, on the Documents page."}</EmptyState>;
  return <section aria-label="My tasks">
    <h1>My tasks</h1>
    {state.kind === "loading" && <InlineMessage tone="info">Loading tasks…</InlineMessage>}
    {state.kind === "error" && <>
      <ErrorNotice error={state.error} />
      <Button onClick={() => setRetry(value => value + 1)}>Try again</Button>
    </>}
    {state.kind === "ready" && <>
      {showFilter && <Select id="project-select" label="Filter my tasks by project" value={project ?? allProjectsValue} onChange={event => onNavigate(event.target.value === allProjectsValue ? { name: "tasks" } : { name: "tasks", project: event.target.value })}>
        <option value={allProjectsValue}>All my tasks</option>
        {[...options].map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </Select>}
      {tasks.length > 0 && <ul className="task-counts" aria-label={countsLabel}>
        <li>Open: {count(task => task.status === "open" || task.status === "reopened")}</li>
        <li>In progress: {count(task => task.status === "in_progress")}</li>
        <li>Submitted: {count(task => task.status === "submitted")}</li>
        <li>of which paused: {count(task => task.held)}</li>
      </ul>}
      {guidelineLinks.length > 0 && <ul className="task-counts" aria-label="Project guidelines">
        {guidelineLinks.map(key => <li key={key}>{guidelineLink(key)}</li>)}
      </ul>}
      {filtered.length === 0 ? empty : <DataTable label="My tasks" className="data-table--pin-end" rows={filtered} columns={columns} rowKey={task => String(task.assignment_id)} rowProps={task => ({ "data-testid": "task-row", "aria-label": `${projectLabel(task.project_name, task.project_key)}: ${taskText(task)}${failedChecks(task) > 0 ? `, ${failedChecksTitle(failedChecks(task))}` : ""}` })} />}
    </>}
  </section>;
}
