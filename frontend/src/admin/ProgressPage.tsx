import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { api, ApiError, type ProgressWorkloadView, type ProjectProgress } from "../api/client";
import { personLabel } from "../app/identity";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { Button, EmptyState, IconChevronRight, IconWarning, InlineMessage, Toolbar } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { countLabel, ledeSentence, stageCards, type StageCard, type StageRow } from "./progressLabels";

export interface ProgressPageProps { projectKey: string; onNavigate: (route: Route) => void }

const updatedFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const WORKLOAD_COLUMNS = [
  ["translation_reviews_open", "Translation reviews open"],
  ["annotations_open", "Annotations open"],
  ["reviews_open", "Reviews open"],
  ["paused", "Paused"],
  ["submitted", "Submitted"],
] as const;
const openWork = (entry: ProgressWorkloadView) => entry.translation_reviews_open + entry.annotations_open + entry.reviews_open + entry.paused;

export function ProgressPage(props: ProgressPageProps): JSX.Element {
  return <ProgressContent key={props.projectKey} {...props} />;
}

function RouteLink({ route, onNavigate, className, label, children }: { route: Route; onNavigate: (route: Route) => void; className?: string; label?: string; children: ReactNode }): JSX.Element {
  return <a className={className} aria-label={label} href={routeHref(route)} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(route);
  }}>{children}</a>;
}

function ProgressContent({ projectKey, onNavigate }: ProgressPageProps): JSX.Element {
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [perText, setPerText] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void api.getProgress(projectKey).then(value => {
      if (active) { setProgress(value); setUpdatedAt(new Date()); setLoading(false); }
    }, err => { if (active) { setProgress(null); setError(err); setLoading(false); } });
    void api.getProjectSettings(projectKey).then(value => { if (active) setPerText(value.annotations_per_text); }, () => {});
    return () => { active = false; };
  }, [projectKey, revision]);
  const documents = (query: ProjectDocumentsQuery): Route => ({ name: "projectDocuments", key: projectKey, ...query });
  const lede = progress?.lede;
  const empty = progress != null && (!lede || lede.cases === 0);
  const denied = error instanceof ApiError && [403, 404].includes(error.status);
  const people = (progress?.workload ?? []).map((entry, index) => ({ entry, index }))
    .sort((left, right) => openWork(right.entry) - openWork(left.entry) || left.index - right.index).map(item => item.entry);

  const countContent = (row: StageRow) => <>
    {row.warning && <IconWarning className="progress-count-warning" />}
    <span className="progress-count-label">{row.label}</span><span className="progress-count-n">{row.count}</span>
  </>;
  const stageCard = (card: StageCard, last: boolean) => {
    const percent = card.total > 0 ? Math.round((card.doneCount / card.total) * 100) : 0;
    return <li key={card.id} className="progress-pipeline-item">
      <section className="progress-stage" aria-labelledby={`progress-stage-${card.id}`}>
        <h2 id={`progress-stage-${card.id}`}>{card.title}</h2>
        <p className="progress-stage-scope">{card.scope}</p>
        <div className="progress-meter" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
        <p className="progress-stage-done"><strong>{`${card.doneCount} of ${card.total}`}</strong>{card.done.slice(`${card.doneCount} of ${card.total}`.length)}</p>
        <ul className="progress-counts">
          {card.rows.map(row => <li key={row.key} className={`progress-count${row.count === 0 ? " progress-count--zero" : ""}`}>
            {row.query
              ? <RouteLink route={documents(row.query)} onNavigate={onNavigate} label={`${row.label}: ${row.count}`}>{countContent(row)}</RouteLink>
              : countContent(row)}
          </li>)}
        </ul>
        {card.footer && <p className="progress-stage-foot">
          <RouteLink route={{ name: "projectExport", key: projectKey }} onNavigate={onNavigate}>Export final results…</RouteLink> <span className="muted">{card.footer}</span>
        </p>}
      </section>
      {!last && <span className="progress-arrow" aria-hidden="true"><IconChevronRight /></span>}
    </li>;
  };

  return <section className="progress-page">
    <h1>Progress</h1>
    {lede && !empty && <p className="progress-lede">
      {ledeSentence(lede)}{" "}
      <RouteLink route={documents({ segment: "decision" })} onNavigate={onNavigate}>{countLabel(lede.needs_decision, "needs your decision", "need your decision")}</RouteLink>
      {" · "}
      <RouteLink route={documents({ segment: "assign" })} onNavigate={onNavigate}>{`${lede.to_assign} to assign`}</RouteLink>
      {updatedAt && <>{" · "}<span className="muted">updated {updatedFormat.format(updatedAt)}</span></>}
    </p>}
    {progress && <Toolbar label="Progress actions"><Button disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh progress</Button></Toolbar>}
    {loading && !progress && <div role="status" className="progress-loading">
      <span className="visually-hidden">Loading progress …</span>
      <ol className="progress-pipeline" aria-hidden="true">
        {[0, 1, 2].map(index => <li key={index} className="progress-pipeline-item"><div className="progress-stage progress-stage--skeleton"><span className="progress-skeleton-bar" /><span className="progress-skeleton-bar" /><span className="progress-skeleton-bar" /></div></li>)}
      </ol>
    </div>}
    {error !== undefined && (denied
      ? <InlineMessage tone="error">You do not have access to this page.</InlineMessage>
      : <div className="progress-error"><ErrorNotice error={error} /><Button onClick={() => setRevision(value => value + 1)}>Retry</Button></div>)}
    {empty && <EmptyState title="No texts yet">Upload texts to start.</EmptyState>}
    {progress && !empty && <>
      {progress.stages && <section aria-labelledby="progress-pipeline-heading">
        <h2 id="progress-pipeline-heading" className="visually-hidden">Pipeline</h2>
        <ol className="progress-pipeline" aria-labelledby="progress-pipeline-heading">
          {stageCards(progress.stages, perText).map((card, index, all) => stageCard(card, index === all.length - 1))}
        </ol>
      </section>}
      <section className="progress-people" aria-labelledby="progress-people-heading">
        <h2 id="progress-people-heading">People</h2>
        {people.length === 0
          ? <EmptyState title="No assigned work">People appear here when work is assigned.</EmptyState>
          : <>
            <div className="data-table-scroll">
              <table className="data-table progress-people-table" aria-labelledby="progress-people-heading">
                <thead><tr><th scope="col">Person</th>{WORKLOAD_COLUMNS.map(([key, header]) => <th key={key} scope="col" className="num">{header}</th>)}</tr></thead>
                <tbody>{people.map(entry => <tr key={entry.person.pseudonym}>
                  <th scope="row"><RouteLink route={documents({ owner: entry.person.pseudonym })} onNavigate={onNavigate}>{personLabel(entry.person)}</RouteLink></th>
                  {WORKLOAD_COLUMNS.map(([key, header]) => <td key={key} className="num" data-label={header}>{entry[key]}</td>)}
                </tr>)}</tbody>
              </table>
            </div>
            <p className="muted progress-people-note">"Open" = assigned and not yet submitted; paused tasks count under Paused. A name links to Documents filtered to that person's next steps.</p>
          </>}
      </section>
    </>}
  </section>;
}
