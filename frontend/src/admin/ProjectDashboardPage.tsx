import { type FinalPreflight } from "../api/client";
import { Button, InlineMessage } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { useFinalSelectionState } from '../variants/finalSelectionState';
import { routeHref } from '../app/router';

export function WorkflowWarnings({ state }: { state: FinalPreflight }): JSX.Element {
  return <><ul>{state.warnings.map(warning => <li key={warning.id}><strong>{warning.case_id} · {warning.language}</strong><p>{warning.reason}</p><a href={warning.destination}>Review issue</a></li>)}</ul>
    {state.warnings.length === 0 && <p>No open workflow warnings.</p>}
    {state.omissions.length > 0 && <p>Omitted without a final selection: {state.omissions.map(item => `${item.case_id} (${item.language})`).join(", ")}</p>}</>;
}

export function ProjectDashboardPage({ projectKey }: { projectKey: string }): JSX.Element {
  const { state, error, reload } = useFinalSelectionState(projectKey);
  return <section className="detail-section" aria-label="Final results and open issues"><h2>Final results and open issues</h2>
    <p>One explicitly selected result per text and language. Later work never replaces it automatically.</p>
    <Button onClick={reload}>Refresh final results</Button>
    {error != null && <ErrorNotice error={error} />}
    {!state && error == null && <InlineMessage tone="info">Loading final results…</InlineMessage>}
    {state && <><p>{state.selections.length} selected results</p>
      {state.selections.length > 0 && <ul aria-label="Selected final results">{state.selections.map(selection => <li key={JSON.stringify([selection.case_id, selection.language])}>
        <a href={routeHref({ name: 'projectCase', key: projectKey, caseId: selection.case_id, variant: selection.document_id })}>{selection.case_id} · {selection.language}</a>
        {' · '}{selection.submission_id}
      </li>)}</ul>}
      <WorkflowWarnings state={state} /><a href={`#/projects/${encodeURIComponent(projectKey)}/export`}>Review final export</a></>}
  </section>;
}
