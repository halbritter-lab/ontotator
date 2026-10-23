import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type CarryRequest, type DocumentRowView, type NextStepView, type TextChangePreview } from "../api/client";
import { textLabel } from "../app/identity";
import { errorMessage } from "../admin/errors";
import { personName } from "../admin/assignSummary";
import { Button, Dialog } from "../ui";
import { isTextChangeConflict } from "./HandleTextChangeDialog";
import {
  ALREADY_ANNOTATING, authorDescription, authorLabel, carriedMessage, carryTitle, CHECKING, CHOOSE_PERSON, FROM_SCRATCH_DESCRIPTION,
  fromScratchLabel, RELOADED_MESSAGE, SOMEONE_ELSE, someoneElseDescription, submittedLine,
} from "./textChangeText";

/** The submission to carry and the version it goes to. */
export interface CarrySource {
  submissionId: string;
  targetDocumentId: string;
  fromVersion: number | null;
  roundOrdinal: number | null;
  /** Author's name when the row knows it; otherwise the preview's author. */
  author: string | null;
}

/** Source of a row's `carry_text_change` step (submitted work on an old version). */
export function carrySourceOfStep(row: DocumentRowView, step: NextStepView): CarrySource {
  const item = row.work.find(entry => entry.assignment_id === step.assignment_id);
  return {
    submissionId: step.submission_id ?? "",
    targetDocumentId: step.document_id ?? "",
    fromVersion: item?.version ?? null,
    roundOrdinal: item?.round_ordinal ?? null,
    author: item ? personName(item.person ?? { pseudonym: item.author_label }) : null,
  };
}

/** Source of the panel's "Carry to v2…": the final's submission (the final itself stays on the old version). */
export function carrySourceOfFinal(row: DocumentRowView, targetDocumentId: string): CarrySource | null {
  if (!row.final) return null;
  return { submissionId: row.final.submission_id, targetDocumentId, fromVersion: row.final.version ?? null, roundOrdinal: row.final.round_ordinal ?? null, author: null };
}

export interface CarryDialogProps {
  projectKey: string;
  row: DocumentRowView;
  source: CarrySource;
  onClose: () => void;
  /** Carried or handed over; the message is the page's toast. */
  onDone: (message: string) => void;
  /** The text or the task changed: the page reloads the rows. */
  onReload: () => void;
  /** "Annotate v2 from scratch" was recorded: the page opens the assign dialog. */
  onFromScratch: () => void;
}

type Mode = CarryRequest["mode"];

/** "Carry to v2…": submitted work on an old version, or a final on old text (spec V5, VD13). */
export function CarryDialog(props: CarryDialogProps): JSX.Element {
  const { projectKey, row, source } = props;
  const id = useId();
  const [mode, setMode] = useState<Mode>("author");
  const [username, setUsername] = useState<string | null>(null);
  const [preview, setPreview] = useState<TextChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const writing = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    setPreview(null); setPreviewError(null);
    void api.previewTextChange(projectKey, { submission_id: source.submissionId, target_document_id: source.targetDocumentId }).then(
      value => { if (active) setPreview(value); },
      error => { if (active) setPreviewError(error); },
    );
    return () => { active = false; };
  }, [projectKey, source.submissionId, source.targetDocumentId, reload]);

  const targetVersion = row.versions.find(version => version.document_id === source.targetDocumentId)?.version ?? preview?.to_version;
  const to = `v${targetVersion ?? 2}`;
  const fromNumber = source.fromVersion ?? preview?.from_version ?? null;
  const from = fromNumber ? `v${fromNumber}` : "the old text";
  const people = preview?.persons ?? [];
  const author = source.author ?? people.find(person => person.author)?.display_name ?? "The author";
  const others = people.filter(person => !person.author);
  const chosen = others.find(person => person.username === username) ?? null;
  const reason = mode === "other" && (!chosen || chosen.has_work) ? CHOOSE_PERSON : null;

  const reset = () => { setFailure(null); setConfirming(false); };
  const carry = async (confirmLanguage: boolean) => {
    if (writing.current || reason) return;
    writing.current = true; setBusy(true); reset();
    try {
      const result = await api.carrySubmission(projectKey, source.submissionId, {
        target_document_id: source.targetDocumentId, mode, confirm_language: confirmLanguage, request_id: crypto.randomUUID(),
        ...(mode === "other" && chosen ? { username: chosen.username } : {}),
      });
      if (!alive.current) return;
      if (mode === "dismiss") props.onFromScratch();
      else props.onDone(carriedMessage(mode === "other" && chosen ? chosen.display_name : author, to, result.carried_findings));
    } catch (error: unknown) {
      if (!alive.current) return;
      if (isTextChangeConflict(error)) { setFailure(RELOADED_MESSAGE); props.onReload(); setReload(value => value + 1); }
      else if (error instanceof ApiError && error.code === "LANGUAGE_CONFIRMATION_REQUIRED" && !confirmLanguage) setConfirming(true);
      else setFailure(errorMessage(error));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const reasonId = `${id}-reason`;
  const choose = (value: Mode) => { if (!busy) { setMode(value); reset(); } };
  const options: { value: Mode; label: string; description: string }[] = [
    { value: "author", label: authorLabel(author), description: authorDescription(to) },
    { value: "other", label: SOMEONE_ELSE, description: someoneElseDescription(to) },
    { value: "dismiss", label: fromScratchLabel(to), description: FROM_SCRATCH_DESCRIPTION },
  ];

  return <Dialog open size="sm" title={carryTitle(to, textLabel(row))} onClose={busy ? undefined : props.onClose} footer={<>
    {failure && <p className="text-change-error" role="alert">{failure}</p>}
    {reason && <span id={reasonId} className="assign-footer-reason">{reason}</span>}
    <Button disabled={busy} onClick={props.onClose}>Cancel</Button>
    <Button variant="primary" loading={busy} aria-disabled={reason ? "true" : undefined} aria-describedby={reason ? reasonId : undefined}
      onClick={() => { void carry(false); }}>Assign</Button>
  </>}>
    <div className="text-change-dialog">
      <p>{preview ? submittedLine(author, from, source.roundOrdinal, preview.findings) : previewError ? submittedLine(author, from, source.roundOrdinal, null) : CHECKING}</p>
      {previewError !== null && <p className="text-change-error">{errorMessage(previewError)} <Button size="sm" onClick={() => setReload(value => value + 1)}>Retry</Button></p>}
      <fieldset className="text-change-options">
        <legend className="visually-hidden">Who continues</legend>
        {options.map(option => {
          const inputId = `${id}-${option.value}`;
          const descriptionId = `${inputId}-description`;
          return <div key={option.value} className="text-change-option">
            <input id={inputId} type="radio" name={`${id}-mode`} value={option.value} checked={mode === option.value}
              aria-describedby={descriptionId} onChange={() => choose(option.value)} />
            <label htmlFor={inputId}>{option.label}</label>
            <p id={descriptionId} className="text-change-description">{option.description}</p>
            {option.value === "other" && mode === "other" && <fieldset className="text-change-people">
              <legend>Annotator</legend>
              {!preview && !previewError && <p className="assign-muted">{CHECKING}</p>}
              {others.map(person => {
                const personId = `${id}-person-${person.username}`;
                const mutedId = `${personId}-muted`;
                return <div key={person.username} className={person.has_work ? "text-change-person is-unavailable" : "text-change-person"}>
                  <input id={personId} type="radio" name={`${id}-person`} value={person.username} checked={username === person.username}
                    aria-disabled={person.has_work || busy ? "true" : undefined} aria-describedby={person.has_work ? mutedId : undefined}
                    onClick={event => { if (person.has_work || busy) event.preventDefault(); }}
                    onChange={() => { if (!person.has_work && !busy) { setUsername(person.username); reset(); } }} />
                  <label htmlFor={personId}>{person.display_name}{person.has_work && <span className="assign-reason">, <span id={mutedId}>{ALREADY_ANNOTATING}</span></span>}</label>
                </div>;
              })}
            </fieldset>}
          </div>;
        })}
      </fieldset>
      {confirming && <section className="assign-confirm" aria-label="Confirm languages">
        <p>{`${mode === "other" && chosen ? chosen.display_name : author} does not read every language this task needs. Assign anyway?`}</p>
        <span className="assign-confirm-actions">
          <Button disabled={busy} onClick={() => setConfirming(false)}>Back</Button>
          <Button loading={busy} onClick={() => { void carry(true); }}>Assign anyway</Button>
        </span>
      </section>}
    </div>
  </Dialog>;
}
