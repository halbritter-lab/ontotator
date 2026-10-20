import { useEffect, useState } from 'react';
import { api, type FinalSelectionSummary, type RowRoundView, type RowSubmissionView, type SubmissionHistorySummary } from '../api/client';
import type { ProjectDocumentsQuery, Route } from '../app/router';
import { ErrorNotice } from '../admin/ErrorNotice';
import { SubmissionsTable } from '../documents/SubmissionsTable';
import { Button, Dialog, InlineMessage } from '../ui';
import { refKey } from './versionState';

export interface SubmissionHistoryProps {
  projectKey: string; caseId: string; documentId: string; language: string;
  /** Version of the current text; labels the own submissions of non-leads. */
  version: number;
  username: string;
  /** Leads read every submission of the row with its Final marker; others only their own submissions. */
  canManage: boolean;
  onNavigate: (route: Route) => void;
  /** Documents query kept on the View links (back link of the case viewer). */
  documents?: ProjectDocumentsQuery;
}

interface HistoryData { rows: RowSubmissionView[]; rounds: RowRoundView[]; final: FinalSelectionSummary | null; parallel: boolean }

/** Own submission from the per-document history (non-leads); the finding count comes from its detail. */
function ownRow(row: SubmissionHistorySummary, version: number, findings: number): RowSubmissionView {
  return {
    submission_id: row.submission_id, document_id: row.document_id, version, chain_name: null, author_label: row.author_label,
    is_me: true, recorded_at: row.created_at, mode: row.mode, kind: row.mode === 'review' ? 'review' : 'annotation',
    round_id: row.round_id ?? null, round_ordinal: null, round_state: null, is_latest_in_round: null, finding_count: findings,
  };
}

async function loadLead(projectKey: string, caseId: string, language: string): Promise<HistoryData> {
  const [data, page] = await Promise.all([api.getRowSubmissions(projectKey, caseId, language), api.listDocumentRows(projectKey, { case: caseId, language })]);
  const row = page.groups.flatMap(group => group.rows).find(item => item.case_id === caseId && item.language === language);
  return { rows: data.submissions, rounds: data.rounds, final: row?.final ?? null, parallel: row?.parallel_roots ?? false };
}

async function loadOwn(projectKey: string, documentId: string, version: number): Promise<HistoryData> {
  const summaries = (await api.listSubmissionHistory(projectKey, documentId)).filter(row => row.document_id === documentId);
  const details = await Promise.all(summaries.map(row => api.getSubmissionHistory(projectKey, documentId, row.submission_id)));
  return { rows: summaries.map((row, index) => ownRow(row, version, details[index].annotations.length)), rounds: [], final: null, parallel: false };
}

/**
 * Read-only submission history of the case viewer: the Documents submissions table without
 * selection or consolidation actions. View opens a submission in the viewer.
 * Identity keys discard protected data immediately on account, document or role replacement.
 */
export function SubmissionHistory({ projectKey, caseId, documentId, language, version, username, canManage, onNavigate, documents }: SubmissionHistoryProps): JSX.Element {
  const identity = JSON.stringify([projectKey, caseId, documentId, language, version, username, canManage]);
  const [opened, setOpened] = useState<string | null>(null);
  const open = opened === identity;
  const [retry, setRetry] = useState(0);
  const requestIdentity = JSON.stringify([identity, retry]);
  const [history, setHistory] = useState<{ identity: string; data?: HistoryData; error?: unknown } | null>(null);
  const current = open && history?.identity === requestIdentity ? history : null;
  useEffect(() => {
    if (!open) return;
    let active = true;
    (canManage ? loadLead(projectKey, caseId, language) : loadOwn(projectKey, documentId, version)).then(
      data => { if (active) setHistory({ identity: requestIdentity, data }); },
      error => { if (active) setHistory({ identity: requestIdentity, error }); },
    );
    return () => { active = false; };
  }, [open, requestIdentity]);
  const viewRoute = (row: RowSubmissionView): Route => ({
    name: 'projectCase', key: projectKey, caseId, variant: row.document_id,
    annotations: refKey({ kind: canManage ? 'submission' : 'own', id: row.submission_id }), ...(documents ? { documents } : {}),
  });
  const close = () => setOpened(null);
  return <>
    <Button size="sm" onClick={() => { setRetry(value => value + 1); setOpened(identity); }}>Submissions</Button>
    <Dialog open={open} title="Submission history" size="lg" onClose={close} footer={<Button onClick={close}>Close</Button>}>
      <p>{canManage ? 'Submitted results of this text in all versions.' : 'Your submitted results for this text version.'} Results are read-only; choose a round to open it in the viewer.</p>
      {current?.error ? <><ErrorNotice error={current.error} /><Button onClick={() => setRetry(value => value + 1)}>Retry submissions</Button></>
        : !current?.data ? <InlineMessage tone="info">Loading submissions...</InlineMessage>
        : <SubmissionsTable rows={current.data.rows} rounds={current.data.rounds} final={current.data.final} parallel={current.data.parallel}
          showFinalColumn={canManage} language={language} caseId={caseId} viewRoute={viewRoute} label="Submission history"
          onNavigate={route => { close(); onNavigate(route); }} />}
    </Dialog>
  </>;
}
