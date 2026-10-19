import { FinalResultSelector } from "./FinalResultSelector";
import { useEffect, useState } from 'react';
import { api, type SubmissionHistoryDetail, type SubmissionHistorySummary, type VariantText } from '../api/client';
import { Button, Dialog, InlineMessage } from '../ui';
import { ErrorNotice } from '../admin/ErrorNotice';
import { formatDateTime } from '../app/labels';
import { useTermLabels } from '../editor/useTermLabels';
import { ReadOnlyAnnotationView } from './ReadOnlyAnnotationView';
import { ConsolidationLauncher } from './ConsolidationLauncher';

export interface SubmissionHistoryProps { projectKey: string; documentId: string; username: string; selectionContext?: { caseId: string; language: string } }

/** No browsing-role gate: the server returns all lead-visible or only own submissions.
 * Identity keys discard protected data immediately on account/document replacement.
 */
export function SubmissionHistory({ projectKey, documentId, username, selectionContext }: SubmissionHistoryProps): JSX.Element {
  const identity = JSON.stringify([projectKey, documentId, username]);
  const [opened, setOpened] = useState<string | null>(null);
  const open = opened === identity;
  const [retry, setRetry] = useState(0);
  const requestIdentity = JSON.stringify([identity, retry]);
  const [history, setHistory] = useState<{ identity: string; rows?: SubmissionHistorySummary[]; error?: unknown } | null>(null);
  const [selected, setSelected] = useState<{ identity: string; id: string } | null>(null);
  const selection = selected?.identity === requestIdentity ? selected.id : null;
  const payloadIdentity = JSON.stringify([requestIdentity, selection]);
  const [payload, setPayload] = useState<{ identity: string; detail?: SubmissionHistoryDetail; text?: VariantText; error?: unknown } | null>(null);
  const currentHistory = open && history?.identity === requestIdentity ? history : null;
  const current = open && payload?.identity === payloadIdentity ? payload : null;
  const labelFor = useTermLabels(projectKey, (current?.detail?.annotations ?? []).map(row => ({ layer_id: row.annotation.layer_id, term_id: row.annotation.term_id })));
  useEffect(() => {
    if (!open) return;
    let active = true;
    api.listSubmissionHistory(projectKey, documentId).then(rows => {
      if (active) setHistory({ identity: requestIdentity, rows: rows.filter(row => row.document_id === documentId) });
    }, error => { if (active) setHistory({ identity: requestIdentity, error }); });
    return () => { active = false; };
  }, [open, requestIdentity]);
  useEffect(() => {
    if (!open || !selection || !currentHistory?.rows?.some(row => row.submission_id === selection)) return;
    let active = true;
    Promise.all([api.getSubmissionHistory(projectKey, documentId, selection), api.getVariantText(projectKey, documentId)]).then(([detail, text]) => {
      if (active && detail.summary.document_id === documentId && detail.summary.submission_id === selection && text.document_id === documentId)
        setPayload({ identity: payloadIdentity, detail, text });
    }, error => { if (active) setPayload({ identity: payloadIdentity, error }); });
    return () => { active = false; };
  }, [open, payloadIdentity, currentHistory?.rows]);
  return <>
    <Button size="sm" onClick={() => { setRetry(value => value + 1); setOpened(identity); }}>Submissions</Button>
    <Dialog open={open} title="Submission history" size="lg" onClose={() => setOpened(null)} footer={<Button onClick={() => setOpened(null)}>Close</Button>}>
      <p>Immutable annotation results for this text version. Historical results are read-only.</p>
      {currentHistory?.error ? <><ErrorNotice error={currentHistory.error} /><Button onClick={() => setRetry(value => value + 1)}>Retry submissions</Button></>
        : !currentHistory?.rows ? <InlineMessage tone="info">Loading submissions...</InlineMessage>
        : <>{selectionContext && <FinalResultSelector key={`final-${identity}`} projectKey={projectKey} documentId={documentId} {...selectionContext} rows={currentHistory.rows} />}<p>{currentHistory.rows.length} submissions</p>
          {currentHistory.rows.length === 0 && <p>No submitted annotation results are available.</p>}
          {selectionContext && <ConsolidationLauncher key={`consolidation-${identity}`} projectKey={projectKey} documentId={documentId} username={username} language={selectionContext.language} rows={currentHistory.rows} />}
          <ol className="submission-result-list">{currentHistory.rows.map(row => <li key={row.submission_id}>
            <span>{row.author_label} · <time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time> · {row.mode}</span>
            {row.round_id && <span> · Round {row.round_id}</span>}{' '}
            <Button size="sm" aria-label={`View submission ${row.submission_id}`} aria-pressed={selection === row.submission_id}
              onClick={() => setSelected({ identity: requestIdentity, id: row.submission_id })}>View</Button>
          </li>)}</ol>
        </>}
      {selection && !current && <InlineMessage tone="info">Loading historical result...</InlineMessage>}
      {!!current?.error && <><ErrorNotice error={current.error} /><Button onClick={() => setRetry(value => value + 1)}>Retry submissions</Button></>}
      {current?.detail && current.text && <section className="submission-result" aria-label="Historical annotation result">
        <h2>Submitted result</h2>
        <ReadOnlyAnnotationView text={current.text.text} annotations={current.detail.annotations} evidence={current.detail.evidence} labelFor={labelFor} />
        <h3>Annotation notes</h3>
        {current.detail.annotations.some(row => row.annotation.note) ? <ul>{current.detail.annotations.filter(row => row.annotation.note).map(row => <li key={row.annotation.annotation_id}>
          <strong>{row.annotation.term_id}</strong><p className="historical-note">{row.annotation.note}</p>
        </li>)}</ul> : <p>No annotation notes.</p>}
        <h3>Review reasons</h3>
        {current.detail.decisions.length ? <ul>{current.detail.decisions.map(row => <li key={row.decision_id}>
          <strong>{row.target.annotation_id} · {row.outcome}</strong>{row.note && <p className="historical-note">{row.note}</p>}
        </li>)}</ul> : <p>No review decisions.</p>}
      </section>}
    </Dialog>
  </>;
}
