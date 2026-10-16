import { useState } from "react";
import type { DocumentSummary, CaseSummary } from "../api/client";
import { Button, Checkbox, Dialog, IconWarning, InlineMessage } from "../ui";
import { BatchFeedback, eligibleMembers, TaskSelect, useAssignmentBatch, useMembers, type Task, useCaseVariants, canReviewSelection, taskLanguages } from "./assignmentUI";
export interface AssignDialogProps { projectKey: string; documents: DocumentSummary[]; cases?: readonly CaseSummary[] | null; onClose: () => void; onChanged: () => void }
export function AssignDialog(props: AssignDialogProps): JSX.Element { return <AssignEditor key={JSON.stringify([props.projectKey, props.documents.map(doc => [doc.document_id, doc.language])])} {...props} />; }
function AssignEditor({ projectKey, documents, cases, onClose, onChanged }: AssignDialogProps): JSX.Element {
  const [task, setTask] = useState<Task>("annotate");
  const [selected, setSelected] = useState<string[]>([]);
  const { members, notice } = useMembers(projectKey);
  const batch = useAssignmentBatch(projectKey, onChanged);
  const context = useCaseVariants(projectKey, cases);
  const reviewAllowed = canReviewSelection(documents, context.variants);
  const languages = new Map(documents.map(doc => [doc.document_id, taskLanguages(doc, task, context.variants)]));
  const blocked = batch.busy || batch.attempted;
  return <Dialog open title="Assign documents" size="lg" onClose={batch.busy ? undefined : onClose} footer={<Button disabled={batch.busy} onClick={onClose}>Close</Button>}>
    <p>{documents.length} documents selected.</p>
    <TaskSelect value={task} disabled={blocked} translationReviewAllowed={reviewAllowed} onChange={value => { setTask(value); setSelected([]); }} />
    {context.notice}
    {notice}
    <fieldset disabled={blocked}><legend>Members</legend>
      {members && eligibleMembers(members, task).map(member => {
        const missing = [...new Set(documents.flatMap(doc => (languages.get(doc.document_id) ?? []).filter(language => !member.languages.includes(language))))];
        const count = documents.filter(doc => languages.get(doc.document_id)?.some(language => !member.languages.includes(language))).length;
        return <div key={member.username}><Checkbox id={`assign-${member.username}`} label={`${member.display_name} (${member.username}) — ${member.languages.join(", ") || "No languages listed"}`} checked={selected.includes(member.username)} onChange={event => setSelected(event.target.checked ? [...selected, member.username] : selected.filter(name => name !== member.username))} />
          {count > 0 && <InlineMessage tone="warning"><IconWarning /> {count} document language{count === 1 ? " is" : "s are"} not listed in this profile: {missing.join(", ")}.</InlineMessage>}</div>;
      })}
      {members && !eligibleMembers(members, task).length && <p>No members hold this task's role.</p>}
    </fieldset>
    <Button variant="primary" loading={batch.busy} disabled={blocked || !selected.length || !documents.length || (task === "translation_review" && !reviewAllowed)} onClick={() => { void batch.submit({ task, confirm_language: false, rows: documents.flatMap(doc => selected.map(username => ({ document_id: doc.document_id, username }))) }); }}>Assign</Button>
    <BatchFeedback batch={batch} languages={languages} onConfirmLanguage={() => { void batch.submit({ task, confirm_language: true, rows: batch.languageRows }); }} />
  </Dialog>;
}
