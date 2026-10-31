import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AssignmentRow, type AssignmentView, type ProposalResponse } from "../api/client";
import { Button, Dialog, InlineMessage, TextInput } from "../ui";
import { labelFor, taskLabels } from "../app/labels";
import { BatchFeedback, eligibleMembers, memberOptionLabel, useAlive, useAssignmentBatch, useMembers, type Task, type TaskDocument, useCaseVariants, canReviewSelection, taskLanguages } from "./assignmentUI";
import { personLabel, textLabel } from "../app/identity";
import type { CaseSummary } from "../api/client";
import { ErrorNotice } from "./ErrorNotice";
type Slot = { document_id: string; language: string; username: string; place: number };
/** `task` is fixed by the assign dialog ("Distribute evenly…"). */
export interface DistributionDialogProps { projectKey: string; documents: readonly (TaskDocument & { case_id: string })[]; cases?: readonly CaseSummary[] | null; task: Task; confirmUnreviewedTranslation?: boolean; onClose: () => void; onChanged: () => void }
export function DistributionDialog(props: DistributionDialogProps): JSX.Element { return <DistributionEditor key={JSON.stringify([props.projectKey, props.documents.map(doc => [doc.document_id, doc.language]), props.task])} {...props} />; }
function DistributionEditor({ projectKey, documents, cases, task, confirmUnreviewedTranslation, onClose, onChanged }: DistributionDialogProps): JSX.Element {
  const [count, setCount] = useState("1");
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [inventory, setInventory] = useState<AssignmentView[] | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const alive = useAlive();
  const { members, notice } = useMembers(projectKey);
  const batch = useAssignmentBatch(projectKey, onChanged);
  const context = useCaseVariants(projectKey, cases);
  const reviewAllowed = canReviewSelection(documents, context.variants);
  const languages = new Map(documents.map(doc => [doc.document_id, taskLanguages(doc, task, context.variants)]));
  const textName = (documentId: string) => { const text = documents.find(doc => doc.document_id === documentId); return text ? textLabel(text) : documentId; };
  const clear = () => { setProposal(null); setSlots([]); batch.reset(); setError(undefined); };
  const propose = async () => {
    if (writing.current || batch.busy || !members || !documents.length || (task === "translation_review" && !reviewAllowed)) return;
    writing.current = true; setBusy(true); clear();
    try {
      // Seed is deliberately omitted: every new proposal gets its actual server seed.
      const [response, assignments] = await Promise.all([
        api.proposeDistribution(projectKey, { document_ids: documents.map(doc => doc.document_id), task, per_document: Number(count) }),
        api.listAssignments(projectKey),
      ]);
      if (!alive.current) return;
      setProposal(response); setInventory(assignments);
      setSlots(response.context.document_ids.flatMap(document_id => {
        const rows = response.rows.filter(row => row.document_id === document_id);
        const language = rows[0]?.language ?? response.unassignable.find(row => row.document_id === document_id)?.language ?? documents.find(doc => doc.document_id === document_id)?.language ?? "";
        return Array.from({ length: response.per_document }, (_, place) => ({ document_id, language, username: rows[place]?.username ?? "", place }));
      }));
    } catch (failure: unknown) { if (alive.current) setError(failure); }
    finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };
  // A clean confirmation closes the dialog: the caller reports what was saved (issue 195).
  const saved = batch.attempted && !batch.busy && batch.error === undefined && batch.refused.length === 0 && batch.accepted > 0;
  useEffect(() => { if (saved) onClose(); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps -- once per clean save
  const stale = batch.error instanceof ApiError && batch.error.code === "DISTRIBUTION_STALE";
  const duplicate = slots.some((slot, index) => slot.username && slots.some((other, otherIndex) => index !== otherIndex && other.document_id === slot.document_id && other.username === slot.username));
  const editedRows: AssignmentRow[] = slots.filter(slot => slot.username).map(({ document_id, username }) => ({ document_id, username }));
  // Same-task unrevoked assignments, including submitted ones, are idempotent.
  const newRows = editedRows.filter(row => !(inventory ?? []).some(existing => !existing.revoked_at && existing.project_key === projectKey && existing.document_id === row.document_id && existing.username === row.username && existing.task === proposal?.context.task));
  const confirm = (confirm_language: boolean) => {
    if (!proposal || stale || busy || duplicate || (!confirm_language && batch.attempted)) return;
    void batch.submit({ rows: confirm_language ? batch.languageRows : editedRows, task: proposal.context.task, seed: proposal.seed, context: proposal.context, confirm_language, ...(confirmUnreviewedTranslation ? { confirm_unreviewed_translation: true } : {}) });
  };
  const eligible = members ? eligibleMembers(members, task) : [];
  const loadBefore = new Map<string, number>();
  for (const row of inventory ?? []) if (row.project_key === projectKey && !row.revoked_at && ["open", "in_progress", "reopened"].includes(row.status)) loadBefore.set(row.username, (loadBefore.get(row.username) ?? 0) + 1);
  for (const row of proposal?.rows ?? []) loadBefore.set(row.username, row.load_before);
  return <Dialog open title="Propose distribution" size="lg" onClose={busy || batch.busy ? undefined : onClose} footer={<Button disabled={busy || batch.busy} onClick={onClose}>Close</Button>}>
    <form onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) void propose(); }}>
      <p>Task: {labelFor(taskLabels, task)}</p>
      {context.notice}
      <TextInput id="distribution-count" label="People per document" type="number" min={1} step={1} required value={count} disabled={busy || batch.busy} onChange={event => { setCount(event.target.value); clear(); }} />
      {notice}<Button type="submit" disabled={!members || !documents.length || batch.busy || (task === "translation_review" && !reviewAllowed)} loading={busy}>{proposal || stale ? "Propose again" : "Propose"}</Button>
    </form>
    {error !== undefined && <ErrorNotice error={error} />}
    {proposal && <>
      <h3>Proposal</h3>
      <table className="data-table density-compact"><caption className="visually-hidden">Proposed assignments</caption><thead><tr><th>Document</th><th>Languages</th><th>Person</th></tr></thead><tbody>{slots.map((slot, index) => <tr key={JSON.stringify([slot.document_id, slot.place])}><td>{textName(slot.document_id)}</td><td>{languages.get(slot.document_id)?.join(", ") || "Required languages unavailable"}</td><td>
        <select id={`distribution-slot-${index}`} className="form-select" aria-label={`${textName(slot.document_id)}, person ${slot.place + 1}`} value={slot.username} disabled={batch.busy || batch.attempted || stale || busy} onChange={event => setSlots(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, username: event.target.value } : item))}>
          <option value="">Nobody</option>{slot.username && !eligible.some(member => member.username === slot.username) && <option value={slot.username}>{proposal.rows.find(row => row.username === slot.username)?.display_name || "Former member"}</option>}
          {eligible.map(member => <option key={member.username} value={member.username} disabled={slots.some((other, otherIndex) => index !== otherIndex && other.document_id === slot.document_id && other.username === member.username)}>{memberOptionLabel(member)}</option>)}
        </select></td></tr>)}</tbody></table>
      {duplicate && <InlineMessage tone="warning">Choose each person only once per document.</InlineMessage>}
      <section aria-label="Unassignable documents"><h3>Unassignable documents</h3>{proposal.unassignable.length ? <ul>{proposal.unassignable.map(row => <li key={row.document_id}>{textName(row.document_id)}: {unassignableLabel(row, proposal.per_document, languages.get(row.document_id))}</li>)}</ul> : <p>Every document has a proposal.</p>}</section>
      <section aria-label="Resulting load"><h3>Resulting load</h3><p>Open, in progress and reopened work across this project, before and after the selected rows.</p><ul>{eligible.map(member => <li key={member.username}>{personLabel(member)}: {loadBefore.has(member.username) || inventory !== null ? `${loadBefore.get(member.username) ?? 0} now, ${(loadBefore.get(member.username) ?? 0) + newRows.filter(row => row.username === member.username).length} after` : "Load unavailable"}</li>)}</ul></section>
      <Button variant="primary" disabled={busy || batch.busy || batch.attempted || stale || duplicate} onClick={() => confirm(false)}>Confirm</Button>
    </>}
    <BatchFeedback batch={batch} languages={languages} disabled={stale || busy} onConfirmLanguage={() => confirm(true)} />
  </Dialog>;
}

function unassignableLabel(row: ProposalResponse["unassignable"][number], places: number, languages?: readonly string[] | null): string {
  switch (row.reason) {
    case "NO_READER": return languages?.length ? `No member reads ${languages.join(" and ")}` : "No eligible reader; required languages unavailable";
    case "TOO_FEW_READERS": return `Only ${row.eligible_count} reader${row.eligible_count === 1 ? "" : "s"} for ${places} places`;
    case "translation_not_accepted": return "Translation not accepted yet";
    case "not_a_translation": return "Only translations can be reviewed";
    case "translation_already_accepted": return "Translation already accepted";
    case "variant_source_unknown": return "Translation source unavailable";
    case "NOT_IN_WORK_PLAN": return "Not planned for this task";
  }
}
