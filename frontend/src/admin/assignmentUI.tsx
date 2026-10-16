import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AssignRequest, type AssignResponse, type Member } from "../api/client";
import { Button, InlineMessage, Select } from "../ui";
import { errorMessage } from "./errors";
import { ErrorNotice } from "./ErrorNotice";

export type Task = AssignRequest["task"];
export const eligibleMembers = (members: Member[], task: Task) => members.filter(member => member.roles.includes(task === "annotate" ? "annotator" : "adjudicator"));
export function useAlive() {
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}
export function TaskSelect({ value, onChange, disabled }: { value: Task; onChange: (task: Task) => void; disabled?: boolean }) {
  return <Select id="assignment-task" label="Task" value={value} disabled={disabled} onChange={event => onChange(event.target.value as Task)}><option value="annotate">Annotate</option><option value="review">Review</option></Select>;
}
export function useMembers(key: string) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setMembers(null); setError(undefined);
    void api.listMembers(key).then(rows => { if (active) setMembers(rows); }).catch((failure: unknown) => { if (active) setError(failure); });
    return () => { active = false; };
  }, [key, retry]);
  return { members, notice: error !== undefined ? <><ErrorNotice error={error} /><Button onClick={() => setRetry(value => value + 1)}>Retry members</Button></> : members === null ? <InlineMessage tone="info">Loading members…</InlineMessage> : null };
}
const rowKey = (row: { document_id: string; username: string }) => JSON.stringify([row.document_id, row.username]);
export function useAssignmentBatch(projectKey: string, onChanged: () => void) {
  const alive = useAlive();
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [accepted, setAccepted] = useState(0);
  const [refused, setRefused] = useState<AssignResponse["refused"]>([]);
  const [error, setError] = useState<unknown>();
  const submit = async (body: AssignRequest) => {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const response = await api.createAssignments(projectKey, body);
      if (!alive.current) return;
      const sent = new Set(body.rows.map(rowKey));
      setRefused(previous => [...previous.filter(row => !sent.has(rowKey(row))), ...response.refused]);
      setAccepted(value => value + response.created.length); setAttempted(true);
      if (response.created.length) onChanged();
    } catch (failure: unknown) { if (alive.current) setError(failure); }
    finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };
  const reset = () => { setAttempted(false); setAccepted(0); setRefused([]); setError(undefined); };
  const languageRows = refused.filter(row => row.code === "LANGUAGE_CONFIRMATION_REQUIRED").map(({ document_id, username }) => ({ document_id, username }));
  return { busy, attempted, accepted, refused, error, submit, reset, languageRows };
}
export function BatchFeedback({ batch, onConfirmLanguage, disabled }: { batch: ReturnType<typeof useAssignmentBatch>; onConfirmLanguage: () => void; disabled?: boolean }) {
  return <>
    {batch.error !== undefined && <ErrorNotice error={batch.error} />}
    {batch.attempted && <InlineMessage tone="info">Assignment request complete: {batch.accepted} accepted; {batch.refused.length} refused.</InlineMessage>}
    {batch.refused.length > 0 && <ul aria-label="Refused assignments">{batch.refused.map(row => <li key={rowKey(row)}>{row.document_id} — {row.username}: <span>{errorMessage(new ApiError(422, row.code, row.code))}</span></li>)}</ul>}
    {batch.languageRows.length > 0 && <section aria-label="Confirm document languages"><p>These people's profiles do not list the document language. Assign anyway?</p><Button disabled={disabled} loading={batch.busy} onClick={onConfirmLanguage}>Assign anyway</Button></section>}
  </>;
}
