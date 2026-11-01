import { useEffect, useState } from "react";
import { api, type AdminPracticeProject } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, ConfirmDialog, DataTable, type Column } from "../ui";
import { PracticePill } from "./PracticeOnMyTasks";
import { tasksDone } from "./practiceSteps";
import { formatDay } from "./usePractice";
import "./practice.css";

/**
 * Projects page, administrators only (issue 266): "Show practice projects (n)", off by default. Practice projects
 * are never among the real projects; here each row has a Practice pill and Delete…, which refuses a real project.
 */
export function AdminPracticeProjects(): JSX.Element | null {
  const [rows, setRows] = useState<AdminPracticeProject[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [shown, setShown] = useState(false);
  const [doomed, setDoomed] = useState<AdminPracticeProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    api.adminListPracticeProjects().then(value => { if (active) setRows(value); }, failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [retry]);
  if (rows === null) return error != null ? <ErrorNotice error={error} /> : null;
  const remove = async () => {
    if (!doomed) return;
    setBusy(true); setError(null);
    try { await api.adminDeletePracticeProject(doomed.project_key); setDoomed(null); setRetry(value => value + 1); }
    catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  const columns: Column<AdminPracticeProject>[] = [
    { id: "project", header: "Project", rowHeader: true, cell: item => <>
      {/* The name repeats "Practice" and the owner: the pill and the Owner column say both once. */}
      <PracticePill />
      <span className="cell-secondary">{item.project_key}</span>
    </> },
    { id: "owner", header: "Owner", cell: item => <>{item.owner_display_name}<span className="cell-secondary">{item.owner_username}</span></> },
    { id: "progress", header: "Progress", cell: item => tasksDone(item.done, item.total) },
    { id: "expires", header: "Deleted on", cell: item => <time dateTime={item.expires_at}>{formatDay(item.expires_at)}</time> },
    { id: "action", header: "Action", cell: item => <Button size="sm" onClick={() => setDoomed(item)}>Delete…</Button> },
  ];
  return <section className="practice-admin" aria-label="Practice projects">
    <Checkbox id="projects-show-practice" label={`Show practice projects (${rows.length})`} checked={shown}
      onChange={event => setShown(event.target.checked)} />
    {error != null && <ErrorNotice error={error} />}
    {shown && <DataTable label="Practice projects" rows={rows} columns={columns} rowKey={item => item.project_key}
      rowProps={item => ({ "data-testid": "practice-project-row", "aria-label": `Practice project ${item.name}` })} empty="No practice projects." />}
    <ConfirmDialog open={doomed !== null} title="Delete practice project?" tone="danger" busy={busy} confirmLabel="Delete practice project"
      message={<p>{doomed ? `${doomed.name} and the practice work in it are deleted. Its audit entries stay. Real projects are never affected.` : ""}</p>}
      onConfirm={() => { void remove(); }} onCancel={() => setDoomed(null)} />
  </section>;
}
