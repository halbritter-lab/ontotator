import { useEffect, useId, useRef, useState } from 'react';
import { personLabel } from '../app/identity';
import { api, ApiError, type AssignmentView, type Member, type SubmissionHistorySummary, type WorkRoundView } from '../api/client';
import { routeHref } from '../app/router';
import { Button, Checkbox, InlineMessage, Select, Textarea } from '../ui';
import { ErrorNotice } from '../admin/ErrorNotice';
import { formatDateTime } from '../app/labels';
import { onSpaceActivate } from '../ui/spaceActivates';
import { notifyFinalSelectionChanged } from './finalSelectionState';

/** An input submission; `label` is its visible name ("Ana Weber, Round 1, 21 Oct, 11:25"), never a code. */
export type ConsolidationInput = SubmissionHistorySummary & { label?: string };

interface Props {
  projectKey: string; documentId: string; language: string;
  /** The signed-in lead: offered first as "You (Mia Kühn)" (U4). */
  username: string;
  rows: ConsolidationInput[];
  /** Starts with the form open (the caller's own "Consolidate…" already asked), skipping the "Consolidate results" button. */
  defaultOpen?: boolean;
  /** Submissions checked when the form opens (e.g. the compared submissions on the current text). */
  defaultSelected?: readonly string[];
  /** The project keeps adjudication separate from annotation: people who annotated this text are unavailable. */
  adjudicatorNotAnnotator?: boolean;
  /** The round was started; a caller that closes (the final-result panel) replaces the success line with its own message. */
  onStarted?: (round: WorkRoundView, started: ConsolidationStarted) => void;
}

/** Who consolidates: the lead themselves (`self`), and whether they just got the Consolidator role. */
export interface ConsolidationStarted { self: boolean; roleGranted: boolean }

/** One entry of the reviewer list: the lead ("You") first, then the members with the Consolidator role. */
interface Candidate { username: string; label: string; member: Member | null; self: boolean; reason: string | null }

/**
 * Consolidation launcher (acceptance fixes WP-B, U4, T3): select the inputs and a consolidator, then one
 * `POST /projects/{key}/consolidations`. The lead may choose themselves and gets the Consolidator role then.
 */
export function ConsolidationLauncher(props: Props): JSX.Element {
  return <ConsolidationContent key={JSON.stringify([props.projectKey, props.documentId, props.username])} {...props} />;
}

function candidatesOf(members: readonly Member[], assignments: readonly AssignmentView[], props: Props): Candidate[] {
  const { username, projectKey, documentId, adjudicatorNotAnnotator = false } = props;
  const annotated = new Set(adjudicatorNotAnnotator ? assignments.filter(row => row.project_key === projectKey && row.document_id === documentId
    && row.task === 'annotate' && !row.revoked_at).map(row => row.username) : []);
  const me = members.find(member => member.username === username) ?? null;
  const myName = me?.display_name?.trim();
  const self: Candidate = { username, label: myName ? `You (${myName})` : 'You', member: me, self: true, reason: annotated.has(username) ? 'You annotated this text' : null };
  const others = members.filter(member => member.username !== username && member.roles.includes('adjudicator')).map((member): Candidate => ({
    username: member.username, label: personLabel(member), member, self: false,
    reason: annotated.has(member.username) ? `${member.display_name?.trim() || member.pseudonym} annotated this text` : null,
  }));
  return username ? [self, ...others] : others;
}

function ConsolidationContent(props: Props): JSX.Element {
  const { projectKey, documentId, language, rows, defaultOpen = false, defaultSelected = [], onStarted } = props;
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
  const [created, setCreated] = useState<{ round: WorkRoundView; roleGranted: boolean; self: boolean; name: string }>();
  const active = useRef(false);
  const writing = useRef(false);
  const request = useRef<{ intent: string; id: string }>();
  const current = inventory?.attempt === attempt ? inventory : null;
  const eligibleRows = rows.filter(row => row.document_id === documentId);
  const selectedIds = eligibleRows.filter(row => selected.has(row.submission_id)).map(row => row.submission_id);
  const candidates = current ? candidatesOf(current.members, current.assignments, props) : [];
  const chosen = candidates.find(row => row.username === reviewer && row.reason === null);
  const missingLanguage = !!chosen?.member && !chosen.member.languages.includes(language);
  const noConsolidator = current != null && !current.members.some(member => member.roles.includes('adjudicator'));
  const getsRole = !!chosen?.self && !chosen.member?.roles.includes('adjudicator');
  /** Why Start is unavailable, shown inline (never a silent disabled button). */
  const missing = selectedIds.length < 2 ? 'Select at least two submissions.'
    : !chosen ? 'Choose a reviewer.'
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
    if (!current || !chosen || missing || writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      // An existing review assignment of the reviewer on this text is reused at its revision; none means "new".
      const existing = current.assignments.find(row => row.project_key === projectKey && row.document_id === documentId && row.username === reviewer
        && row.task === 'review' && !row.revoked_at);
      const trimmed = reason.trim();
      const confirm = missingLanguage && confirmLanguage;
      const intent = JSON.stringify([reviewer, selectedIds, trimmed, confirm, existing?.workflow_revision ?? null]);
      if (request.current?.intent !== intent) request.current = { intent, id: crypto.randomUUID() };
      const response = await api.startConsolidation(projectKey, {
        document_id: documentId, reviewer, source_submission_ids: selectedIds, reason: trimmed || null, confirm_language: confirm,
        request_id: request.current.id, expected_workflow_revision: existing?.workflow_revision ?? null,
      });
      notifyFinalSelectionChanged(projectKey);
      if (active.current) setCreated({ round: response.round, roleGranted: response.role_granted, self: chosen.self, name: chosen.label });
      onStarted?.(response.round, { self: chosen.self, roleGranted: response.role_granted });
    } catch (failure) {
      if (active.current) setError(failure instanceof ApiError && failure.code === 'ROUND_INPUT_STALE'
        ? new Error('Selected submissions are no longer current. Refresh submission history and choose the exact inputs again.')
        : failure instanceof ApiError && failure.code === 'ROUND_ACTIVE'
          ? new Error('This reviewer has unfinished work on this text. Finish or deliberately restart that work before starting consolidation.')
          : failure);
    } finally { writing.current = false; if (active.current) setBusy(false); }
  };
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Consolidate results</Button>;
  const membersHref = routeHref({ name: 'projectSettings', key: projectKey, section: 'members' });
  return <section className="detail-section" aria-label="Consolidate submitted results"><h3>Consolidate submitted results</h3>
    <p>Select at least two exact results on this text and a reviewer. The reviewer creates a separate result; the original submissions remain in history.</p>
    {loadError != null && <><ErrorNotice error={loadError} /><Button onClick={() => setAttempt(value => value + 1)}>Reload reviewer tasks</Button></>}
    {!current && loadError == null && <InlineMessage tone="info">Loading reviewers and tasks…</InlineMessage>}
    {current && !created && <>
      <fieldset disabled={busy}><legend>Submissions to merge</legend>{eligibleRows.map(row => <Checkbox key={row.submission_id}
        id={`${fieldId}-${encodeURIComponent(row.submission_id)}`} label={row.label ?? `${row.author_label}, ${formatDateTime(row.created_at)}`}
        data-submission-id={row.submission_id} checked={selected.has(row.submission_id)} onChange={event => setSelected(previous => {
          const next = new Set(previous); if (event.target.checked) next.add(row.submission_id); else next.delete(row.submission_id); return next;
        })} />)}</fieldset>
      <Select id={`${fieldId}-reviewer`} label="Consolidation reviewer" value={chosen ? reviewer : ''} disabled={busy}
        onChange={event => { setReviewer(event.target.value); setConfirmLanguage(false); }}><option value="">Choose a reviewer</option>
        {candidates.map(row => <option key={row.username} value={row.username} disabled={row.reason !== null}>
          {row.reason ? `${row.label} — ${row.reason}` : row.label}
        </option>)}
      </Select>
      {getsRole && <p className="cell-secondary">You will get the Consolidator role for this project.</p>}
      {noConsolidator && <p className="cell-secondary">No member has the Consolidator role yet. Give it in <a href={membersHref}>Settings → Members</a>.</p>}
      {missingLanguage && <Checkbox id={`${fieldId}-language`} label={`Assign this reviewer despite missing ${language} in their profile`} checked={confirmLanguage} disabled={busy} onChange={event => setConfirmLanguage(event.target.checked)} />}
      <Textarea id={`${fieldId}-reason`} label="Consolidation reason (optional)" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
      {error != null && <><ErrorNotice error={error} /><Button disabled={busy} onClick={() => { setError(undefined); setAttempt(value => value + 1); }}>Reload reviewer tasks</Button></>}
      {missing && <p id={`${fieldId}-missing`} className="action-reason">{missing}</p>}
      <Button aria-disabled={missing || busy ? true : undefined} aria-describedby={missing ? `${fieldId}-missing` : undefined} loading={busy}
        onClick={() => { if (!missing && !busy) void start(); }}>Start consolidation</Button>
    </>}
    {created && <InlineMessage tone="success">
      {created.self ? 'Consolidation assigned to you.' : `Consolidation assigned to ${created.name}.`}
      {created.roleGranted && ' You now have the Consolidator role for this project.'}
      {created.self && <> <a className="btn btn-secondary btn-sm" href={`#/tasks/${created.round.assignment_id}`} onKeyDown={onSpaceActivate}>Open my consolidation task</a></>}
    </InlineMessage>}
  </section>;
}
