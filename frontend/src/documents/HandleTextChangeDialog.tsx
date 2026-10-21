import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type DocumentRowView, type NextStepView, type TextChangePreview } from "../api/client";
import { textLabel } from "../app/identity";
import { errorMessage } from "../admin/errors";
import { personName } from "../admin/assignSummary";
import { Button, Dialog } from "../ui";
import {
  CHECKING, finishDescription, finishingMessage, finishLabel, handleTitle, heldLine, moveDescription, movedMessage, moveLabel,
  openWorkLine, RELOADED_MESSAGE, unplacedLine, WITHDRAW_LABEL, withdrawDescription, withdrawnMessage,
} from "./textChangeText";

export type TextChangeChoice = "move" | "finish" | "withdraw";

export interface HandleTextChangeDialogProps {
  projectKey: string;
  /** The current row (the page passes the reloaded row after a conflict). */
  row: DocumentRowView;
  /** The row's `handle_text_change` step: `assignment_id` is the open work, `document_id` the target. */
  step: NextStepView;
  onClose: () => void;
  /** The choice was applied; the message is the page's toast. */
  onDone: (message: string) => void;
  /** The text or the task changed: the page reloads the rows. */
  onReload: () => void;
  /** "Decide on report…" for a paused task. */
  onDecideReport?: () => void;
}

/** Codes after which the row is reloaded and the choice kept (spec "States and edge cases › Conflict"). */
export const isTextChangeConflict = (error: unknown): boolean =>
  error instanceof ApiError && (error.code === "TEXT_CHANGE_CHANGED" || error.code === "WORKFLOW_REVISION_CONFLICT");

/** "Handle text change…": an open annotation on an old version (spec V5). */
export function HandleTextChangeDialog(props: HandleTextChangeDialogProps): JSX.Element {
  const { projectKey, row, step } = props;
  const id = useId();
  const item = row.work.find(entry => entry.assignment_id === step.assignment_id);
  const person = item ? personName(item.person ?? { pseudonym: item.author_label }) : "The annotator";
  const target = row.versions.find(version => version.document_id === step.document_id);
  const from = `v${item?.version ?? 1}`;
  const to = `v${target?.version ?? (item?.version ?? 1) + 1}`;
  const held = item?.held ?? false;
  const assignmentId = step.assignment_id ?? item?.assignment_id ?? null;
  const targetId = step.document_id ?? target?.document_id ?? "";

  const [choice, setChoice] = useState<TextChangeChoice>("move");
  const [preview, setPreview] = useState<TextChangePreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const writing = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (held || assignmentId === null || !targetId) return;
    let active = true;
    setPreview(null); setPreviewFailed(false);
    void api.previewTextChange(projectKey, { assignment_id: assignmentId, target_document_id: targetId }).then(
      value => { if (active) setPreview(value); },
      () => { if (active) setPreviewFailed(true); },
    );
    return () => { active = false; };
  }, [projectKey, assignmentId, targetId, held, reload]);

  const apply = async () => {
    if (writing.current || assignmentId === null) return;
    writing.current = true; setBusy(true); setFailure(null);
    try {
      const current = (await api.listAssignments(projectKey, { document_id: item?.document_id })).find(entry => entry.id === assignmentId);
      if (!current) throw new ApiError(409, RELOADED_MESSAGE, "TEXT_CHANGE_CHANGED");
      const expected_workflow_revision = current.workflow_revision;
      if (choice === "move") {
        await api.moveToVersion(assignmentId, { target_document_id: targetId, expected_workflow_revision, request_id: crypto.randomUUID() });
        if (alive.current) props.onDone(movedMessage(person, to));
      } else {
        await api.resolveTextChange(assignmentId, { resolution: choice === "finish" ? "finish_then_carry" : "withdrawn", target_document_id: targetId, expected_workflow_revision });
        if (alive.current) props.onDone(choice === "finish" ? finishingMessage(person, from, to) : withdrawnMessage(person, to));
      }
    } catch (error: unknown) {
      if (!alive.current) return;
      if (isTextChangeConflict(error)) { setFailure(RELOADED_MESSAGE); props.onReload(); setReload(value => value + 1); }
      else setFailure(errorMessage(error));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const options: { value: TextChangeChoice; label: string; description: string; extra?: string | null }[] = [
    { value: "move", label: moveLabel(to), description: moveDescription(person),
      extra: preview ? (preview.unplaced > 0 ? unplacedLine(preview.unplaced, preview.findings, person) : null) : previewFailed ? null : CHECKING },
    { value: "finish", label: finishLabel(person, from), description: finishDescription(person, to) },
    { value: "withdraw", label: WITHDRAW_LABEL, description: withdrawDescription(person, to) },
  ];
  const text = textLabel(row);

  return <Dialog open size="sm" title={handleTitle(text)} onClose={busy ? undefined : props.onClose} footer={<>
    {failure && <p className="text-change-error" role="alert">{failure}</p>}
    <Button disabled={busy} onClick={props.onClose}>Cancel</Button>
    {!held && <Button variant="primary" loading={busy} onClick={() => { void apply(); }}>Apply</Button>}
  </>}>
    <div className="text-change-dialog">
      <p>{openWorkLine(person, from, to)}</p>
      {held ? <p className="text-change-held">
        {heldLine(person)}{" "}
        {props.onDecideReport && <Button variant="quiet" size="sm" onClick={props.onDecideReport}>Decide on report…</Button>}
      </p> : <fieldset className="text-change-options">
        <legend className="visually-hidden">How to continue</legend>
        {options.map(option => {
          const inputId = `${id}-${option.value}`;
          const descriptionId = `${inputId}-description`;
          const extraId = `${inputId}-extra`;
          return <div key={option.value} className="text-change-option">
            <input id={inputId} type="radio" name={`${id}-choice`} value={option.value} checked={choice === option.value}
              aria-describedby={[descriptionId, option.extra && extraId].filter(Boolean).join(" ")}
              onChange={() => { if (!busy) { setChoice(option.value); setFailure(null); } }} />
            <label htmlFor={inputId}>{option.label}</label>
            <p id={descriptionId} className="text-change-description">{option.description}</p>
            {option.extra && <p id={extraId} className="text-change-description">{option.extra}</p>}
          </div>;
        })}
      </fieldset>}
    </div>
  </Dialog>;
}
