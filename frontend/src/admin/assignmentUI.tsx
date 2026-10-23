import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AssignRequest, type AssignResponse, type Member, type CaseSummary, type VariantSummary, type DocumentSummary } from "../api/client";
import { Button, InlineMessage, Select, StatusBadge } from "../ui";
import { assignmentStatusLabels, labelFor, taskLabels } from "../app/labels";
import { errorMessage } from "./errors";
import { ErrorNotice } from "./ErrorNotice";
import { reviewLanguages } from "./variantMetadata";
import { personLabel } from "../app/identity";

export type Task = AssignRequest["task"];
/** Member select label: identity format, languages and open-task count ("Ana Weber (ann-0004) — en, de, 3 open tasks"). */
export function memberOptionLabel(member: Member): string {
  const open = member.open_tasks ? member.open_tasks.translation_review + member.open_tasks.annotate + member.open_tasks.review : null;
  return `${personLabel(member)} — ${member.languages.join(", ") || "No languages listed"}${open === null ? "" : `, ${open} open task${open === 1 ? "" : "s"}`}`;
}
/** The document fields task-language and review checks need (a `DocumentSummary` satisfies it). */
export type TaskDocument = Pick<DocumentSummary, "document_id" | "language" | "translation_status">;
/** Annotators; the task argument is kept for callers (D1: consolidators are chosen in "Consolidate…" only). */
export const eligibleMembers = (members: Member[], _task: string) => members.filter(member => member.roles.includes("annotator"));
export function useCaseVariants(key: string, supplied?: readonly CaseSummary[] | null) {
  const [loaded, setLoaded] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (supplied !== undefined) return;
    let active = true; setLoaded(null); setError(undefined);
    void api.listCases(key).then(value => { if (active) setLoaded(value); }, failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [key, supplied]);
  const cases = supplied === undefined ? loaded : supplied;
  const variants = new Map<string, VariantSummary>();
  for (const item of cases ?? []) for (const variant of item.variants) variants.set(variant.document_id, variant);
  return { variants, notice: error !== undefined ? <ErrorNotice error={error} /> : cases === null ? <p>Translation metadata unavailable or loading.</p> : null };
}
export function taskLanguages(document: TaskDocument, task: Task, variants: ReadonlyMap<string, VariantSummary>): readonly string[] | null {
  return task === "translation_review" ? reviewLanguages(document.document_id, variants) : [document.language];
}
export const canReviewSelection = (documents: readonly TaskDocument[], variants: ReadonlyMap<string, VariantSummary>) => documents.length > 0 && documents.every(doc => {
  const actual = variants.get(doc.document_id);
  // Without a status on the document itself (targets from a batch preview), the variant decides.
  return doc.translation_status !== null && doc.translation_status !== "accepted" && actual && actual.translation_status !== null && actual.translation_status !== "accepted" && reviewLanguages(doc.document_id, variants) !== null;
});
export function useAlive() {
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}
export function TaskSelect({ value, onChange, disabled, translationReviewAllowed = false }: { value: Task; onChange: (task: Task) => void; disabled?: boolean; translationReviewAllowed?: boolean }) {
  return <Select id="assignment-task" label="Task" value={value} disabled={disabled} onChange={event => { if (event.target.value !== "translation_review" || translationReviewAllowed) onChange(event.target.value as Task); }}><option value="annotate">{taskLabels.annotate}</option>{translationReviewAllowed && <option value="translation_review">{taskLabels.translation_review}</option>}</Select>;
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
export function BatchFeedback({ batch, onConfirmLanguage, disabled, languages }: { batch: ReturnType<typeof useAssignmentBatch>; onConfirmLanguage: () => void; disabled?: boolean; languages?: ReadonlyMap<string, readonly string[] | null> }) {
  return <>
    {batch.error !== undefined && <ErrorNotice error={batch.error} />}
    {batch.attempted && <InlineMessage tone="info">Assignment request complete: {batch.accepted} accepted; {batch.refused.length} refused.</InlineMessage>}
    {batch.refused.length > 0 && <ul aria-label="Refused assignments">{batch.refused.map(row => <li key={rowKey(row)}>{row.document_id} — {row.username}: <span>{errorMessage(new ApiError(422, row.code, row.code))}</span></li>)}</ul>}
    {batch.languageRows.length > 0 && <section aria-label="Confirm document languages"><p>These people's profiles do not list the required document languages. Assign anyway?</p><ul>{batch.languageRows.map(row => <li key={rowKey(row)}>{row.document_id} — {row.username}: {languages?.get(row.document_id)?.join(", ") || "Required languages unavailable"}</li>)}</ul><Button disabled={disabled} loading={batch.busy} onClick={onConfirmLanguage}>Assign anyway</Button></section>}
  </>;
}
/** One assignee as person, task and status in plain words; the pseudonym is secondary when a name is known. */
export function AssigneeSummary({ name, pseudonym, task, status }: { name?: string | null; pseudonym: string; task: string; status: string }) {
  const person = name || pseudonym;
  return <span className="assignee">
    <span className="assignee-person">{person}{person !== pseudonym && <span className="assignee-pseudonym"> ({pseudonym})</span>}</span>
    <span className="assignee-work"><span>{labelFor(taskLabels, task)}</span><StatusBadge status={status}>{labelFor(assignmentStatusLabels, status)}</StatusBadge></span>
  </span>;
}
