import { useEffect, useId, useRef, useState } from 'react';
import { personLabel } from '../app/identity';
import { api, ApiError, type AssignmentView, type Member, type SubmissionHistorySummary, type WorkRoundView } from '../api/client';
import { Button, Checkbox, InlineMessage, Select, Textarea } from '../ui';
import { ErrorNotice } from '../admin/ErrorNotice';
import { eligibleMembers } from '../admin/assignmentUI';
import { formatDateTime } from '../app/labels';
import { notifyFinalSelectionChanged } from './finalSelectionState';

/** An input submission; `label` is its visible name ("Ana Weber · Round 1 · 21 Oct, 11:25"), never a code. */
export type ConsolidationInput = SubmissionHistorySummary & { label?: string };

interface Props {
  projectKey: string; documentId: string; language: string; username: string; rows: ConsolidationInput[];
  /** Starts with the form open (the caller's own "Consolidate…" already asked), skipping the "Consolidate results" button. */
  defaultOpen?: boolean;
  /** Submissions checked when the form opens (e.g. the compared submissions on the current text). */
  defaultSelected?: readonly string[];
  /** The round was started; a caller that closes (the final-result panel) replaces the success line with its own message. */
  onStarted?: (round: WorkRoundView) => void;
}
export function ConsolidationLauncher(props: Props): JSX.Element {
  return <ConsolidationContent key={JSON.stringify([props.projectKey, props.documentId, props.username])} {...props} />;
}

function ConsolidationContent({ projectKey, documentId, language, username, rows, defaultOpen = false, defaultSelected = [], onStarted }: Props): JSX.Element {
  const fieldId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [attempt, setAttempt] = useState(0);
  const [inventory, setInventory] = useState<{ attempt: number; members: Member[]; assignments: AssignmentView[] } | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(defaultSelected));
  const [reviewer, setReviewer] = useState('');
  const [confirmLanguage, setConfirmLanguage] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<WorkRoundView>();
  const active = useRef(false);
  const writing = useRef(false);
  const request = useRef<{ intent: string; id: string }>();
  const current = inventory?.attempt === attempt ? inventory : null;
  const eligibleRows = rows.filter(row => row.document_id === documentId);
  const selectedIds = eligibleRows.filter(row => selected.has(row.submission_id)).map(row => row.submission_id);
  const reviewers = eligibleMembers(current?.members ?? [], 'review');
  const member = reviewers.find(row => row.username === reviewer);
  const missingLanguage = !!member && !member.languages.includes(language);
  /** Why Start is unavailable, shown inline (never a silent disabled button). */
  const missing = selectedIds.length < 2 ? 'Select at least two submissions.'
    : !member ? 'Choose a reviewer.'
      : missingLanguage && !confirmLanguage ? `Confirm the reviewer despite missing ${language}.` : null;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoadError(undefined);
    Promise.all([api.listMembers(projectKey), api.listAssignments(projectKey)]).then(([members, assignments]) => {
      if (live) setInventory({ attempt, members, assignments });
    }, failure => { if (live) setLoadError(failure); });
    return () => { live = false; };
  }, [projectKey, open, attempt]);
  const start = async () => {
    if (!current || !member || selectedIds.length < 2 || (missingLanguage && !confirmLanguage) || writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      let assignment = current.assignments.find(row => row.project_key === projectKey && row.document_id === documentId && row.username === reviewer && row.task === 'review' && !row.revoked_at);
      if (!assignment) {
        const response = await api.createAssignments(projectKey, { task: 'review', rows: [{ document_id: documentId, username: reviewer }], confirm_language: missingLanguage && confirmLanguage });
        assignment = response.created.find(row => row.project_key === projectKey && row.document_id === documentId && row.username === reviewer && row.task === 'review' && !row.revoked_at);
        if (!assignment) throw new ApiError(409, 'The reviewer assignment could not be created.', response.refused[0]?.code);
        if (active.current) setInventory({ ...current, assignments: [...current.assignments, assignment] });
      }
      const intent = JSON.stringify([assignment.id, selectedIds, reason.trim()]);
      if (request.current?.intent !== intent) request.current = { intent, id: crypto.randomUUID() };
      const round = await api.startWorkRound(assignment.id, { request_id: request.current.id, expected_workflow_revision: assignment.workflow_revision,
        kind: 'consolidation', source_submission_ids: selectedIds, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      notifyFinalSelectionChanged(projectKey);
      if (active.current) setCreated(round);
      onStarted?.(round);
    } catch (failure) {
      if (active.current) setError(failure instanceof ApiError && failure.code === 'ROUND_INPUT_STALE'
        ? new Error('Selected submissions are no longer current. Refresh submission history and choose the exact inputs again.')
        : failure instanceof ApiError && failure.code === 'ROUND_ACTIVE'
          ? new Error('This reviewer has unfinished work on this text. Finish or deliberately restart that work before starting consolidation.')
          : failure);
    } finally { writing.current = false; if (active.current) setBusy(false); }
  };
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Consolidate results</Button>;
  return <section className="detail-section" aria-label="Consolidate submitted results"><h3>Consolidate submitted results</h3>
    <p>Select at least two exact results on this text and a reviewer. The reviewer creates a separate result; the original submissions remain in history.</p>
    {loadError != null && <><ErrorNotice error={loadError} /><Button onClick={() => setAttempt(value => value + 1)}>Reload reviewer tasks</Button></>}
    {!current && loadError == null && <InlineMessage tone="info">Loading reviewers and tasks…</InlineMessage>}
    {current && !created && <>
      <fieldset disabled={busy}><legend>Submissions to merge</legend>{eligibleRows.map(row => <Checkbox key={row.submission_id}
        id={`${fieldId}-${encodeURIComponent(row.submission_id)}`} label={row.label ?? `${row.author_label} · ${formatDateTime(row.created_at)}`}
        checked={selected.has(row.submission_id)} onChange={event => setSelected(previous => {
          const next = new Set(previous); if (event.target.checked) next.add(row.submission_id); else next.delete(row.submission_id); return next;
        })} />)}</fieldset>
      <Select id={`${fieldId}-reviewer`} label="Consolidation reviewer" value={member ? reviewer : ''} disabled={busy}
        onChange={event => { setReviewer(event.target.value); setConfirmLanguage(false); }}><option value="">Choose a reviewer</option>
        {reviewers.map(row => <option key={row.username} value={row.username}>{personLabel(row)}</option>)}
      </Select>
      {missingLanguage && <Checkbox id={`${fieldId}-language`} label={`Assign this reviewer despite missing ${language} in their profile`} checked={confirmLanguage} disabled={busy} onChange={event => setConfirmLanguage(event.target.checked)} />}
      <Textarea id={`${fieldId}-reason`} label="Consolidation reason (optional)" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
      {error != null && <><ErrorNotice error={error} /><Button disabled={busy} onClick={() => { setError(undefined); setAttempt(value => value + 1); }}>Reload reviewer tasks</Button></>}
      {missing && <p id={`${fieldId}-missing`} className="action-reason">{missing}</p>}
      <Button aria-disabled={missing || busy ? true : undefined} aria-describedby={missing ? `${fieldId}-missing` : undefined} loading={busy}
        onClick={() => { if (!missing && !busy) void start(); }}>Start consolidation</Button>
    </>}
    {created && <InlineMessage tone="success">Consolidation assigned to {personLabel(member, { fallback: 'the reviewer' })}.
      {reviewer === username && <> <a href={`#/tasks/${created.assignment_id}`}>Open my consolidation task</a></>}
    </InlineMessage>}
  </section>;
}
