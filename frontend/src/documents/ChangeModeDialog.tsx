/**
 * "Change mode…" for a text whose annotation mode is fixed by work (#109): the lead may still switch between
 * "from proposals" and "from scratch", but only after a warning that names whose submitted work is discarded
 * and whose assignment is removed. Nothing is deleted: the work is marked discarded and "Restore…" brings it back
 * while no new annotation work has started.
 */
import { useEffect, useId, useState } from "react";
import { api, ApiError, type DocumentRowView, type ModeChangePreview, type ModeChangeView, type PersonRefView } from "../api/client";
import { errorMessage } from "../admin/errors";
import { plural } from "../app/labels";
import { Button, ConfirmDialog, Dialog, InlineMessage, Textarea } from "../ui";
import { shortName } from "./stageLabels";

export type ModeName = "proposals" | "scratch";

const MODE_WORDS: Record<ModeName, string> = { proposals: "from proposals", scratch: "from scratch" };

/** One line per person: what the change does to their work, submitted work first. */
export interface AffectedPerson {
  name: string;
  submissions: number;
  /** Their live assignment is removed (unsubmitted drafts are kept, not counted). */
  removed: boolean;
  consolidation: boolean;
}

function personKey(person: PersonRefView): string {
  return person.pseudonym;
}

/** Group the preview by person: submitted work (discarded) first, then removed unsubmitted assignments. */
export function affectedPeople(preview: Pick<ModeChangePreview, "submissions" | "assignments">): AffectedPerson[] {
  const people = new Map<string, AffectedPerson>();
  const entry = (person: PersonRefView): AffectedPerson => {
    const key = personKey(person);
    let found = people.get(key);
    if (!found) {
      found = { name: shortName(person), submissions: 0, removed: false, consolidation: false };
      people.set(key, found);
    }
    return found;
  };
  for (const item of preview.submissions) {
    const person = entry(item.author);
    person.submissions += 1;
    if (item.mode === "review") person.consolidation = true;
  }
  for (const item of preview.assignments) {
    const person = entry(item.person);
    person.removed = true;
    if (item.task === "review") person.consolidation = true;
  }
  return [...people.values()].sort((a, b) => (b.submissions > 0 ? 1 : 0) - (a.submissions > 0 ? 1 : 0) || a.name.localeCompare(b.name));
}

/** "Anne Notator: 1 submission is discarded." / "Arne Notator: the unsubmitted assignment is removed." */
export function affectedLine(person: AffectedPerson): string {
  const work = person.consolidation ? "consolidation" : "submission";
  if (person.submissions > 0) {
    return `${person.name}: ${plural(person.submissions, work)} ${person.submissions === 1 ? "is" : "are"} discarded.`;
  }
  return `${person.name}: the unsubmitted ${person.consolidation ? "consolidation" : "assignment"} is removed.`;
}

/** The confirm step of a mode change: loads the preview, names everyone affected, asks for a reason. */
export function ChangeModeDialog({ projectKey, row, mode, revision, onCancel, onChanged }: {
  projectKey: string;
  row: Pick<DocumentRowView, "case_id" | "language">;
  /** The new mode. */
  mode: ModeName;
  /** The case's plan revision the card shows. */
  revision: number;
  onCancel: () => void;
  onChanged: (change: ModeChangeView, revision: number) => void;
}): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [preview, setPreview] = useState<ModeChangePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [missingReason, setMissingReason] = useState(false);

  useEffect(() => {
    let live = true;
    api.previewModeChange(projectKey, { case_id: row.case_id, language: row.language, mode })
      .then(found => { if (live) setPreview(found); })
      .catch(failure => { if (live) setLoadError(errorMessage(failure)); });
    return () => { live = false; };
  }, [projectKey, row.case_id, row.language, mode]);

  const confirm = async () => {
    if (!preview || busy) return;
    if (!reason.trim()) { setMissingReason(true); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await api.changeMode(projectKey, {
        case_id: row.case_id, language: row.language, mode, reason: reason.trim(),
        expected_revision: preview.revision ?? revision,
        expected_submission_ids: preview.submissions.map(item => item.submission_id),
      });
      onChanged(result.change, result.revision);
    } catch (failure) {
      // The work changed since the warning: show the new list and ask again.
      if (failure instanceof ApiError && failure.code === "MODE_CHANGE_STALE" && typeof failure.details === "object" && failure.details !== null) {
        setPreview(failure.details as unknown as ModeChangePreview);
      }
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  const people = preview ? affectedPeople(preview) : [];
  const discarded = people.filter(person => person.submissions > 0);
  const from = preview ? MODE_WORDS[preview.from_mode] : null;
  const title = `Change annotation of ${row.case_id} ${row.language} to ${MODE_WORDS[mode]}?`;
  const footer = <>
    <Button disabled={busy} onClick={onCancel}>Cancel</Button>
    <Button variant="danger" loading={busy} aria-disabled={preview ? undefined : "true"} onClick={() => { void confirm(); }}>
      {discarded.length ? "Discard work and change mode" : "Change mode"}
    </Button>
  </>;
  return <Dialog open title={title} size="md" onClose={busy ? undefined : onCancel} footer={footer}>
    <div className="mode-change-dialog">
      {!preview && !loadError && <p role="status">Checking the work on this text…</p>}
      {loadError && <InlineMessage tone="error">{loadError}</InlineMessage>}
      {preview && <>
        <p>{`The annotation of this text started ${from}. Changing it to ${MODE_WORDS[mode]} starts the annotation again.`}</p>
        {discarded.length > 0
          ? <p><strong>{`Submitted work of ${plural(discarded.length, "person", "people")} is discarded:`}</strong></p>
          : <p>No submitted work is discarded.</p>}
        {people.length > 0 && <ul aria-label="Affected people" className="mode-change-people">
          {people.map(person => <li key={person.name}>{affectedLine(person)}</li>)}
        </ul>}
        <p className="field-hint">Discarded work is kept, not deleted: it no longer counts for progress, consolidation, the final result or exports. You can restore it while no new annotation has started.</p>
        <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason}
          error={missingReason && !reason.trim() ? "Give a reason for the change." : undefined}
          onChange={event => { setReason(event.target.value); setMissingReason(false); }} />
      </>}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
    </div>
  </Dialog>;
}

/** "Restore…": undo a mode change; the discarded work counts again and the removed assignments come back. */
export function RestoreModeDialog({ projectKey, change, revision, onCancel, onRestored }: {
  projectKey: string;
  change: ModeChangeView;
  revision: number;
  onCancel: () => void;
  onRestored: (change: ModeChangeView, revision: number) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = [...new Set(change.submissions.map(item => shortName(item.author)))];
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.restoreModeChange(projectKey, change.change_id, revision);
      onRestored(result.change, result.revision);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };
  return <ConfirmDialog open title="Restore discarded work?" confirmLabel="Restore" busy={busy} onCancel={onCancel} onConfirm={() => { void restore(); }}
    message={<>
      <p>{`The text goes back to annotation ${MODE_WORDS[change.from_mode]}.`}</p>
      {names.length > 0 && <p>{`The work of ${names.join(", ")} counts again.`}</p>}
      {change.revoked_assignment_ids.length > 0 && <p>{`${plural(change.revoked_assignment_ids.length, "removed assignment")} ${change.revoked_assignment_ids.length === 1 ? "comes" : "come"} back.`}</p>}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
    </>} />;
}

const BLOCKED: Record<string, string> = {
  ANNOTATION_MODE_LOCKED: "New annotation work has started, so the discarded work cannot be restored.",
  MODE_CHANGE_NOT_LATEST: "A later mode change is in place.",
};

/**
 * Under the card's annotation plan: the latest unrestored mode change of the text, whose work it discarded and
 * "Restore…" (or why not). Loads only when the row says work was discarded.
 */
export function ModeChangeNotice({ projectKey, row, revision, onChanged, now = new Date() }: {
  projectKey: string;
  row: Pick<DocumentRowView, "case_id" | "language" | "annotation_mode">;
  revision: number;
  onChanged: () => void;
  now?: Date;
}): JSX.Element | null {
  const discardedCount = row.annotation_mode?.discarded_count ?? 0;
  const [change, setChange] = useState<ModeChangeView | null>(null);
  const [restoring, setRestoring] = useState(false);
  useEffect(() => {
    if (discardedCount <= 0) { setChange(null); return; }
    let live = true;
    api.listModeChanges(projectKey, row.case_id, row.language)
      .then(found => { if (live) setChange(found.changes.find(item => item.restored_at == null) ?? null); })
      .catch(() => { if (live) setChange(null); });
    return () => { live = false; };
  }, [projectKey, row.case_id, row.language, discardedCount]);
  if (!change) return null;
  const names = [...new Set(change.submissions.map(item => shortName(item.author)))];
  const day = new Date(change.changed_at);
  const when = day.getFullYear() === now.getFullYear()
    ? day.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : day.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const blocked = change.restore_blocked ? BLOCKED[change.restore_blocked] ?? errorMessage(new ApiError(409, change.restore_blocked, change.restore_blocked)) : null;
  return <div className="text-card-mode-change">
    <p className="text-card-muted">{`Mode changed to ${MODE_WORDS[change.to_mode]} on ${when}${names.length ? `; discarded work of ${names.join(", ")}` : ""}.`}</p>
    {blocked ? <p className="text-card-muted">{blocked}</p>
      : change.restorable && <Button size="sm" onClick={() => setRestoring(true)}>Restore…</Button>}
    {restoring && <RestoreModeDialog projectKey={projectKey} change={change} revision={revision} onCancel={() => setRestoring(false)}
      onRestored={() => { setRestoring(false); setChange(null); onChanged(); }} />}
  </div>;
}
