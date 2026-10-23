import { useEffect, useId, useRef, useState } from 'react';
import { personLabel } from '../app/identity';
import { api, type AssignmentView, type Member, type VariantSummary } from '../api/client';
import { eligibleMembers } from '../admin/assignmentUI';
import { ErrorNotice } from '../admin/ErrorNotice';
import { Button, Checkbox, InlineMessage, Select, Textarea } from '../ui';
import { onSpaceActivate } from '../ui/spaceActivates';
import { notifyFinalSelectionChanged } from './finalSelectionState';

interface Props {
  projectKey: string; variant: VariantSummary; username: string; requiredLanguages: readonly string[] | null;
  /** Starts with the form open (the Documents row menu already asked), skipping the button. */
  defaultOpen?: boolean;
  /** Inside a dialog whose title names the action: no heading of its own. */
  inDialog?: boolean;
}
export function TranslationCorrectionAction(props: Props): JSX.Element | null {
  if (props.variant.translation_status !== 'accepted') return null;
  return <CorrectionContent key={JSON.stringify([props.projectKey, props.variant.document_id, props.variant.text_sha256, props.username])} {...props} />;
}

function CorrectionContent({ projectKey, variant, username, requiredLanguages, defaultOpen = false, inDialog = false }: Props): JSX.Element {
  const fieldId = useId(), active = useRef(false), writing = useRef(false);
  const [open, setOpen] = useState(defaultOpen), [attempt, setAttempt] = useState(0);
  const [members, setMembers] = useState<Member[] | null>(null), [error, setError] = useState<unknown>();
  const [reviewer, setReviewer] = useState(''), [reason, setReason] = useState('');
  const [confirmLanguage, setConfirmLanguage] = useState(false), [busy, setBusy] = useState(false);
  const [assigned, setAssigned] = useState<AssignmentView>();
  const reviewers = eligibleMembers(members ?? [], 'translation_review');
  const member = reviewers.find(row => row.username === reviewer);
  const missingLanguages = member ? (requiredLanguages ?? []).filter(language => !member.languages.includes(language)) : [];
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    let live = true; setMembers(null); setError(undefined);
    api.listMembers(projectKey).then(value => { if (live) setMembers(value); }, failure => { if (live) setError(failure); });
    return () => { live = false; };
  }, [open, projectKey, attempt]);
  const assign = async () => {
    if (!member || !requiredLanguages || !reason.trim() || (missingLanguages.length > 0 && !confirmLanguage) || writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const value = await api.assignTranslationCorrection(projectKey, variant.document_id, { username: reviewer, expected_text_sha256: variant.text_sha256,
        reason: reason.trim(), confirm_language: missingLanguages.length > 0 && confirmLanguage });
      notifyFinalSelectionChanged(projectKey);
      if (active.current) setAssigned(value);
    } catch (failure) { if (active.current) setError(failure); }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Request translation correction</Button>;
  return <section className={inDialog ? undefined : 'detail-section'} aria-label="Request translation correction">
    {!inDialog && <h3>{assigned ? 'Translation correction requested' : 'Request translation correction'}</h3>}
    {!assigned && <p>Review this exact accepted text again. A submitted correction creates a separate text version and keeps the earlier review.</p>}
    {!requiredLanguages && <InlineMessage tone="warning">The exact source lineage is unavailable. Reload the text metadata before assigning another review.</InlineMessage>}
    {!members && error == null && <InlineMessage tone="info">Loading translation reviewers…</InlineMessage>}
    {!assigned && members && <>
      <Select id={`${fieldId}-reviewer`} label="Translation reviewer" value={member ? reviewer : ''} disabled={busy}
        onChange={event => { setReviewer(event.target.value); setConfirmLanguage(false); }}><option value="">Choose a reviewer</option>
        {reviewers.map(row => <option key={row.username} value={row.username}>{personLabel(row)}</option>)}
      </Select>
      <Textarea id={`${fieldId}-reason`} label="Reason for another review" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
      {missingLanguages.length > 0 && <Checkbox id={`${fieldId}-language`} label={`Assign despite missing ${missingLanguages.join(', ')} in this reviewer's profile`}
        checked={confirmLanguage} disabled={busy} onChange={event => setConfirmLanguage(event.target.checked)} />}
      <Button disabled={!member || !requiredLanguages || !reason.trim() || (missingLanguages.length > 0 && !confirmLanguage) || busy} loading={busy} onClick={() => { void assign(); }}>Assign correction review</Button>
    </>}
    {error != null && <><ErrorNotice error={error} />{!members && <Button onClick={() => setAttempt(value => value + 1)}>Reload translation reviewers</Button>}</>}
    {assigned && <InlineMessage tone="success">Translation correction assigned to {personLabel(member, { fallback: 'the reviewer' })}.
      {assigned.username === username && <> <a className="btn btn-secondary btn-sm" href={`#/tasks/${assigned.id}`} onKeyDown={onSpaceActivate}>Open my translation review</a></>}
    </InlineMessage>}
  </section>;
}
