import { useState } from "react";
import type { DocumentSummary } from "../api/client";
import { Button, Checkbox, Dialog, IconWarning, InlineMessage } from "../ui";
import { BatchFeedback, eligibleMembers, TaskSelect, useAssignmentBatch, useMembers, type Task } from "./assignmentUI";
export interface AssignDialogProps { projectKey: string; documents: DocumentSummary[]; onClose: () => void; onChanged: () => void }
export function AssignDialog(props: AssignDialogProps): JSX.Element { return <AssignEditor key={JSON.stringify([props.projectKey, props.documents.map(doc => [doc.document_id, doc.language])])} {...props} />; }
function AssignEditor({ projectKey, documents, onClose, onChanged }: AssignDialogProps): JSX.Element {
  const [task, setTask] = useState<Task>("annotate");
  const [selected, setSelected] = useState<string[]>([]);
  const { members, notice } = useMembers(projectKey);
  const batch = useAssignmentBatch(projectKey, onChanged);
  const blocked = batch.busy || batch.attempted;
  return <Dialog open title="Assign documents" size="lg" onClose={batch.busy ? undefined : onClose} footer={<Button disabled={batch.busy} onClick={onClose}>Close</Button>}>
    <p>{documents.length} documents selected.</p>
    <TaskSelect value={task} disabled={blocked} onChange={value => { setTask(value); setSelected([]); }} />
    {notice}
    <fieldset disabled={blocked}><legend>Members</legend>
      {members && eligibleMembers(members, task).map(member => {
        const count = documents.filter(doc => !member.languages.includes(doc.language)).length;
        return <div key={member.username}><Checkbox id={`assign-${member.username}`} label={`${member.display_name} (${member.username}) — ${member.languages.join(", ") || "No languages listed"}`} checked={selected.includes(member.username)} onChange={event => setSelected(event.target.checked ? [...selected, member.username] : selected.filter(name => name !== member.username))} />
          {count > 0 && <InlineMessage tone="warning"><IconWarning /> {count} document language{count === 1 ? " is" : "s are"} not listed in this profile.</InlineMessage>}</div>;
      })}
      {members && !eligibleMembers(members, task).length && <p>No members hold this task's role.</p>}
    </fieldset>
    <Button variant="primary" loading={batch.busy} disabled={blocked || !selected.length || !documents.length} onClick={() => { void batch.submit({ task, confirm_language: false, rows: documents.flatMap(doc => selected.map(username => ({ document_id: doc.document_id, username }))) }); }}>Assign</Button>
    <BatchFeedback batch={batch} onConfirmLanguage={() => { void batch.submit({ task, confirm_language: true, rows: batch.languageRows }); }} />
  </Dialog>;
}
