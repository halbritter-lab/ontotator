import { ProjectDashboardPage } from "./ProjectDashboardPage";
import { useEffect, useState } from "react";
import { api, ApiError, type ProjectProgress } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { Button, DataTable, EmptyState, InlineMessage, Select, Toolbar, type Column } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { AssigneeSummary } from "./assignmentUI";
import { assignmentStatusLabels, labelFor } from "../app/labels";

export interface ProgressPageProps { projectKey: string; onNavigate: (route: Route) => void }
const statuses = ["open", "in_progress", "submitted", "reopened"] as const;
const label = (value: string) => value === "documents" ? "Documents" : labelFor(assignmentStatusLabels, value);

export function ProgressPage(props: ProgressPageProps): JSX.Element {
  return <ProgressContent key={props.projectKey} {...props} />;
}

function ProgressContent({ projectKey, onNavigate }: ProgressPageProps): JSX.Element {
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void api.getProgress(projectKey).then(value => {
      if (active) { setProgress(value); setLoading(false); }
    }, err => { if (active) { setProgress(null); setError(err); setLoading(false); } });
    return () => { active = false; };
  }, [projectKey, revision]);
  const people = (progress?.people ?? []).map((person, index) => ({ person, index }))
    .sort((left, right) => (right.person.open + right.person.in_progress) - (left.person.open + left.person.in_progress) || left.index - right.index).map(item => item.person);
  const documents = (progress?.documents ?? []).filter(doc => !status || (status === "unassigned" ? !doc.assignees?.length : doc.assignees?.some(assignee => assignee.status === status)));
  const peopleColumns: Column<ProjectProgress["people"][number]>[] = [
    { id: "person", header: "Person", cell: person => <span title={person.username}>{person.display_name || person.username}</span> },
    { id: "pseudonym", header: "Pseudonym", cell: person => person.pseudonym },
    ...statuses.map(value => ({ id: value, header: label(value), cell: (person: ProjectProgress["people"][number]) => person[value] })),
  ];
  const documentColumns: Column<ProjectProgress["documents"][number]>[] = [
    { id: "document", header: "Document", cell: doc => doc.document_id },
    { id: "language", header: "Language", cell: doc => doc.language },
    { id: "assignees", header: "Assignees", cell: doc => doc.assignees?.length ? <ul className="assignee-list">{doc.assignees.map(assignee => <li key={assignee.assignment_id}><AssigneeSummary name={progress?.people.find(person => person.username === assignee.username)?.display_name} {...assignee} /></li>)}</ul> : "Unassigned" },
    { id: "assign", header: "Assignment", cell: doc => {
      const route: Route = { name: "projectDocuments", key: projectKey, select: doc.document_id };
      return <a className="btn btn-secondary btn-sm" href={routeHref(route)} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onNavigate(route);
      }}>Assign</a>;
    } },
  ];
  return <section>
    <h1>Progress</h1><ProjectDashboardPage key={projectKey} projectKey={projectKey} />
    <Toolbar label="Progress actions"><Button disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh progress</Button></Toolbar>
    {loading && <p role="status">Loading progress …</p>}
    {error !== undefined && (error instanceof ApiError && [403, 404].includes(error.status) ? <InlineMessage tone="error">You do not have access to this page.</InlineMessage> : <ErrorNotice error={error} />)}
    {progress && <>
      <section className="detail-section" aria-label="Project totals"><h2>Totals</h2><p>Open, in progress, submitted and reopened count assignments.</p><dl className="stat-row">{(["documents", "unassigned", ...statuses] as const).map(value => <div key={value}><dt>{label(value)}</dt><dd>{progress.totals[value]}</dd></div>)}</dl></section>
      <section className="detail-section"><h2>People</h2><DataTable label="People" columns={peopleColumns} rows={people} rowKey={person => person.username} empty={<EmptyState title="No assignments">People appear here when work is assigned.</EmptyState>} /></section>
      <section className="detail-section"><h2>Documents</h2><Select id="progress-status" label="Document status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="unassigned">Unassigned</option>{statuses.map(value => <option key={value} value={value}>{label(value)}</option>)}</Select>
        <DataTable label="Progress documents" columns={documentColumns} rows={documents} rowKey={doc => doc.document_id} empty={<EmptyState title="No matching documents">Choose another status to see other documents.</EmptyState>} />
      </section>
    </>}
  </section>;
}
