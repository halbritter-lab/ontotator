import { useEffect, useState } from "react";
import { api, type AssignmentSubmissionView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { formatTime } from "../app/submissionLabels";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { HistoricalSubmissionDialog } from "./HistoricalSubmissionDialog";
import { fromHistoryDetail, type HistoricalSubmissionView } from "./historicalSubmission";

const findings = (count: number) => `${count} ${count === 1 ? "finding" : "findings"}`;
const roundOf = (row: AssignmentSubmissionView) => (row.round_ordinal ? `Round ${row.round_ordinal}` : "Initial submission");
/** "Round 1, 19 Oct, 00:16"; also the dialog heading. */
const submissionName = (row: AssignmentSubmissionView) => `${roundOf(row)}, ${formatTime(row.recorded_at)}`;
const byTime = (a: AssignmentSubmissionView, b: AssignmentSubmissionView) =>
  (a.round_ordinal ?? 0) - (b.round_ordinal ?? 0) || Date.parse(a.recorded_at) - Date.parse(b.recorded_at);

/** Spec section 7 "My submissions": the user's own submissions on this task across all rounds, read-only. */
export function MySubmissions({ assignmentId, projectKey, currentRound, documentId, documentText, termLabel, reloadKey }: {
  assignmentId: number;
  projectKey: string;
  /** The round open in the editor; adds "Round n, not submitted yet" while it has no submission. */
  currentRound?: { roundId: string; ordinal: number };
  /** Open text, for quotes of submissions on the same text version. */
  documentId: string;
  documentText: string;
  termLabel: (layer: string | undefined, term: string) => string | null;
  /** Changes when a new submission was accepted, to reload the list. */
  reloadKey?: string;
}): JSX.Element {
  const [rows, setRows] = useState<AssignmentSubmissionView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [viewError, setViewError] = useState<unknown>(null);
  const [open, setOpen] = useState<HistoricalSubmissionView | null>(null);
  useEffect(() => {
    let active = true;
    setError(null);
    api.listAssignmentSubmissions(assignmentId).then(
      value => { if (active) setRows([...value].sort(byTime)); },
      failure => { if (active) setError(failure); },
    );
    return () => { active = false; };
  }, [assignmentId, attempt, reloadKey]);
  const view = async (row: AssignmentSubmissionView) => {
    setOpening(row.submission_id); setViewError(null);
    try {
      const detail = await api.getSubmissionHistory(projectKey, row.document_id, row.submission_id);
      setOpen(fromHistoryDetail(detail, submissionName(row), snapshot =>
        termLabel(snapshot.annotation.layer_id, snapshot.annotation.term_id) ?? snapshot.annotation.term_id));
    } catch (failure) {
      setViewError(failure);
    } finally {
      setOpening(null);
    }
  };
  const pending = currentRound && rows && !rows.some(row => row.round_id === currentRound.roundId);
  return (
    <section className="detail-section submission-history" aria-label="My submissions">
      <h3>My submissions</h3>
      {error ? <>
        <InlineMessage tone="error">Your submissions could not be loaded.</InlineMessage>
        <Button type="button" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button>
      </> : rows === null ? <InlineMessage tone="info">Loading your submissions…</InlineMessage> : <>
        {rows.length === 0 && !pending && <p>No submissions yet.</p>}
        {(rows.length > 0 || pending) && <ul className="my-submissions">
          {rows.map(row => <li key={row.submission_id}>
            <span>{`${submissionName(row)}, ${findings(row.finding_count)}`}</span>{" "}
            <Button type="button" variant="secondary" size="sm" loading={opening === row.submission_id}
              aria-label={`View ${submissionName(row)}`} onClick={() => { if (!opening) void view(row); }}>View</Button>
          </li>)}
          {pending && <li style={{ color: "var(--text-muted)" }}>{`Round ${currentRound.ordinal}, not submitted yet`}</li>}
        </ul>}
        {viewError != null && <ErrorNotice error={viewError} />}
      </>}
      {open && <HistoricalSubmissionDialog view={open} documentText={documentText} currentDocumentId={documentId}
        projectKey={projectKey} termLabel={termLabel} onClose={() => setOpen(null)} />}
    </section>
  );
}
