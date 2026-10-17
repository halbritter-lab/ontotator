import { useEffect, useState } from "react";
import { api, onSessionRestored, type ProjectSummary, type TaskSummary } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, DataTable, EmptyState, InlineMessage, Select, StatusBadge, Toolbar, type Column } from "../ui";

export interface MyTasksProps {
  project?: string;
  projects: ProjectSummary[];
  onNavigate: (route: Route) => void;
}

type TaskState = { kind: "loading" } | { kind: "ready"; tasks: TaskSummary[] } | { kind: "error"; error: unknown };

const statusLabels: Record<TaskSummary["status"], string> = {
  open: "Open", reopened: "Reopened", in_progress: "In progress", submitted: "Submitted",
};

const projectLabel = (name: string, key: string): string => name === key ? name : `${name} (${key})`;

export function MyTasks({ project, projects, onNavigate }: MyTasksProps): JSX.Element {
  const [state, setState] = useState<TaskState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      setState({ kind: "loading" });
      try {
        const tasks = await api.listMyTasks();
        if (active && request === generation) setState({ kind: "ready", tasks });
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

  const tasks = state.kind === "ready" ? state.tasks : [];
  const filtered = project === undefined ? tasks : tasks.filter(task => task.project_key === project);
  const options = new Map(tasks.map(task => [task.project_key, projectLabel(task.project_name, task.project_key)]));
  if (project !== undefined && !options.has(project)) {
    const selected = projects.find(item => item.project_key === project);
    options.set(project, selected ? projectLabel(selected.name, selected.project_key) : project || "Empty project filter");
  }
  // Keep even an empty raw query distinct from All projects without reserving
  // any actual project key as a magic value.
  let allProjectsValue = "";
  while (options.has(allProjectsValue)) allProjectsValue += "_";
  const managed = projects.filter(item => item.can_manage && (project === undefined || item.project_key === project));
  const columns: Column<TaskSummary>[] = [
    { id: "document", header: "Document", cell: task => task.external_id ?? task.document_id },
    { id: "project", header: "Project", cell: task => projectLabel(task.project_name, task.project_key) },
    { id: "language", header: "Language", cell: task => task.language },
    { id: "task", header: "Task", cell: task => task.task === "translation_review" ? `Review translation ${task.source_language ?? "?"} → ${task.target_language ?? task.language}` : task.task === "annotate" ? "Annotate" : "Review" },
    { id: "status", header: "Status", cell: task => <StatusBadge status={task.status}>{statusLabels[task.status]}</StatusBadge> },
    { id: "changed", header: "Last change", cell: task => <time dateTime={task.updated_at}>{new Date(task.updated_at).toLocaleString()}</time> },
    { id: "open", header: "Action", cell: task => <a className="btn btn-secondary" href={routeHref({ name: "task", assignmentId: task.assignment_id })} onClick={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate({ name: "task", assignmentId: task.assignment_id });
    }}>Open</a> },
  ];
  const empty = <EmptyState title="No documents are assigned to you yet." action={managed.length > 0 &&
    <Toolbar label="Assignment actions">{managed.map(item => {
      const route: Route = { name: "projectDocuments", key: item.project_key };
      return <a key={item.project_key} href={routeHref(route)} onClick={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(route);
      }}>{project === undefined ? `Assign documents in ${projectLabel(item.name, item.project_key)}` : "Assign documents"}</a>;
    })}</Toolbar>
  } />;
  return <section aria-label="My tasks">
    <h1>My tasks</h1>
    {state.kind === "loading" && <InlineMessage tone="info">Loading tasks…</InlineMessage>}
    {state.kind === "error" && <>
      <ErrorNotice error={state.error} />
      <Button onClick={() => setRetry(value => value + 1)}>Try again</Button>
    </>}
    {state.kind === "ready" && <>
      <Select id="project-select" label="Project" value={project ?? allProjectsValue} onChange={event => onNavigate(event.target.value === allProjectsValue ? { name: "tasks" } : { name: "tasks", project: event.target.value })}>
        <option value={allProjectsValue}>All projects</option>
        {[...options].map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </Select>
      <p role="group" aria-label="Task counts">Open: {filtered.filter(task => task.status === "open" || task.status === "reopened").length} · In progress: {filtered.filter(task => task.status === "in_progress").length} · Submitted: {filtered.filter(task => task.status === "submitted").length}</p>
      {filtered.length === 0 ? empty : <DataTable label="My tasks" className="data-table--pin-end" rows={filtered} columns={columns} rowKey={task => String(task.assignment_id)} rowProps={task => ({ "data-testid": "task-row", "aria-label": `${projectLabel(task.project_name, task.project_key)}: ${task.document_id}` })} />}
    </>}
  </section>;
}
