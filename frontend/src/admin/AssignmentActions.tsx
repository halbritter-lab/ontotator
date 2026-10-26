import { useRef, useState } from "react";
import { api, ApiError, type AssignmentView, type Member } from "../api/client";
import { Button, ConfirmDialog, Dialog, Select, Textarea } from "../ui";
import { eligibleMembers, memberOptionLabel, useAlive } from "./assignmentUI";
import { ErrorNotice } from "./ErrorNotice";
import { assignmentStatusLabels, labelFor, taskLabels } from "../app/labels";
export interface AssignmentActionsProps {
  assignment: AssignmentView; members: Member[]; onChanged: () => void;
  /** Only this action's dialog, open at once (no buttons); `onClose` runs when it closes or the action is done. */
  open?: "reassign" | "reopen" | "revoke";
  onClose?: () => void;
}
export function AssignmentActions(props: AssignmentActionsProps): JSX.Element { return <Actions key={JSON.stringify([props.assignment.project_key, props.assignment.id, props.assignment.updated_at, props.assignment.status, props.assignment.revoked_at])} {...props} />; }
const startedMessage = "Work has started. The previous draft stays with its author; the new person starts from the document's inputs.";
function Actions({ assignment, members, onChanged, open, onClose }: AssignmentActionsProps): JSX.Element {
  const [action, setAction] = useState<"reassign" | "reopen" | "revoke" | null>(open ?? null);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<"started" | "language" | "unreviewed" | null>(null);
  const [confirmedStarted, setConfirmedStarted] = useState(false);
  const [confirmedLanguage, setConfirmedLanguage] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const alive = useAlive();
  const close = () => { if (!writing.current) { setAction(null); setConfirmation(null); setError(undefined); setTarget(""); setReason(""); setConfirmedStarted(false); setConfirmedLanguage(false); onClose?.(); } };
  const mutate = async (confirm_started = false, confirm_language = false, confirm_unreviewed_translation = false) => {
    if (writing.current || !action) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      if (action === "reassign") await api.reassign(assignment.id, { username: target, confirm_started, confirm_language, confirm_unreviewed_translation });
      else if (action === "reopen") await api.reopenAssignment(assignment.id, reason.trim() || undefined);
      else await api.revokeAssignment(assignment.id);
      if (alive.current) { setAction(null); setConfirmation(null); onChanged(); onClose?.(); }
    } catch (failure: unknown) {
      if (!alive.current) return;
      if (action === "reassign" && failure instanceof ApiError && failure.code === "REASSIGN_CONFIRMATION_REQUIRED") setConfirmation("started");
      else if (action === "reassign" && failure instanceof ApiError && failure.code === "LANGUAGE_CONFIRMATION_REQUIRED") { setConfirmedStarted(confirm_started); setConfirmation("language"); }
      else if (action === "reassign" && failure instanceof ApiError && failure.code === "TRANSLATION_NOT_REVIEWED" && !confirm_unreviewed_translation) { setConfirmedStarted(confirm_started); setConfirmedLanguage(confirm_language); setConfirmation("unreviewed"); }
      else setError(failure);
    } finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };
  if (assignment.revoked_at) return <span>Removed</span>;
  // D1: a consolidation task (task review) cannot be handed to someone else.
  const reassignable = assignment.task !== "review";
  return <>
    {/* The actions stand plainly side by side, no disclosure (B8-1). */}
    {!open && <>
      {reassignable && <Button size="sm" onClick={() => setAction("reassign")}>Reassign…</Button>}
      {assignment.status === "submitted" && <Button size="sm" onClick={() => setAction("reopen")}>Reopen</Button>}
      <Button size="sm" variant="danger" onClick={() => setAction("revoke")}>Remove assignment</Button>
    </>}
    <Dialog open={action === "reassign"} title={`Reassign ${assignment.document_id}`} onClose={busy || confirmation ? undefined : close} footer={<><Button disabled={busy || confirmation !== null} onClick={close}>Cancel</Button><Button disabled={!target || confirmation !== null} loading={busy} onClick={() => { if (assignment.status !== "open" && !confirmedStarted) setConfirmation("started"); else void mutate(confirmedStarted, false); }}>Reassign</Button></>}>
      <p>{assignment.pseudonym}: {labelFor(taskLabels, assignment.task)}, {labelFor(assignmentStatusLabels, assignment.status).toLowerCase()}</p>
      {confirmedStarted && <p>{startedMessage}</p>}
      <Select id={`reassign-${assignment.id}`} label="New assignee" value={target} disabled={busy || confirmation !== null} onChange={event => { setTarget(event.target.value); setConfirmedStarted(false); setConfirmedLanguage(false); setError(undefined); }}><option value="">Choose a member</option>{eligibleMembers(members, assignment.task).filter(member => member.username !== assignment.username).map(member => <option key={member.username} value={member.username}>{memberOptionLabel(member)}</option>)}</Select>
      {error !== undefined && <ErrorNotice error={error} />}
    </Dialog>
    <ConfirmDialog open={confirmation === "unreviewed"} title="Annotate before the review is accepted?" message={<><p>Translation not reviewed yet.</p>{error !== undefined && <ErrorNotice error={error} />}</>} confirmLabel="Annotate before the review is accepted" busy={busy} onCancel={() => { setConfirmation(null); setError(undefined); }} onConfirm={() => { void mutate(confirmedStarted, confirmedLanguage, true); }} />
    <ConfirmDialog open={confirmation === "started" || confirmation === "language"} title={confirmation === "started" ? "Reassign started work?" : "Confirm document language?"} message={<>{confirmation === "started" ? startedMessage : <><p>This person's profile does not list the document language. Reassign anyway?</p>{confirmedStarted && <p>{startedMessage}</p>}</>}{error !== undefined && <ErrorNotice error={error} />}</>} confirmLabel={confirmation === "started" ? "Reassign started work" : "Reassign anyway"} busy={busy} onCancel={() => { setConfirmation(null); setError(undefined); }} onConfirm={() => { if (confirmation === "started") { setConfirmedStarted(true); void mutate(true, false); } else void mutate(confirmedStarted, true); }} />
    <Dialog open={action === "reopen"} title={`Reopen ${assignment.document_id}`} onClose={busy ? undefined : close} footer={<><Button disabled={busy} onClick={close}>Cancel</Button><Button loading={busy} onClick={() => { void mutate(); }}>Reopen assignment</Button></>}>
      <Textarea id={`reopen-reason-${assignment.id}`} label="Reason (optional)" disabled={busy} value={reason} onChange={event => setReason(event.target.value)} />{error !== undefined && <ErrorNotice error={error} />}
    </Dialog>
    <ConfirmDialog open={action === "revoke"} title="Remove assignment?" message={<><p>Remove {assignment.pseudonym}'s {labelFor(taskLabels, assignment.task).toLowerCase()} assignment for {assignment.document_id}?</p>{error !== undefined && <ErrorNotice error={error} />}</>} confirmLabel="Confirm removal" tone="danger" busy={busy} onCancel={close} onConfirm={() => { void mutate(); }} />
  </>;
}
