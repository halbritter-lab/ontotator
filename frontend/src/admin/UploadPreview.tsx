import { useId, useState } from "react";
import type { ImportPlan, UploadView } from "../api/client";
import { humanize, plural, uploadKindLabels } from "../app/labels";
import { Button } from "../ui";
import { UploadTextList } from "./UploadTextList";
import { UploadWorkPlan, type UploadWorkPlanProps } from "./UploadWorkPlan";
import { formatHint, problemsByFile, proposalSourceLine, proposalSources, uploadNotes, uploadSummary, uploadTextRows, type UploadKind, type UploadNote } from "./uploadModel";

export interface UploadPreviewProps {
  plan: ImportPlan;
  kind?: UploadKind;
  /** The upload's files (problems are grouped by file); shown by name only. */
  files?: UploadView["files"];
  /** Upload number, shown in "Technical details" only. */
  uploadId?: number;
  /** The project's languages: other languages in a bundle get a warning line (OQ1), never a refusal. */
  projectLanguages?: readonly string[];
  /** Adds the "Work plan" step (before Import) when the preview carries a work plan. */
  workPlan?: Omit<UploadWorkPlanProps, "workPlan" | "kind">;
  /** Offered by the fix hint when the files look like the other format. */
  onSwitchFormat?: (kind: UploadKind) => void;
}

/**
 * The checked upload: summary row, one line per note, the work plan, the collapsed text list, the
 * proposal sources and collapsed "Technical details" (hashes and IDs live only there); or, when the upload
 * cannot be imported, its problems grouped per uploaded file.
 */
export function UploadPreview({ plan, kind = "t1", files = [], uploadId, projectLanguages = [], workPlan, onSwitchFormat }: UploadPreviewProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  if (!plan.committable) return <section className="upload-preview" aria-label="Upload preview">
    <UploadProblems plan={plan} kind={kind} files={files} onSwitchFormat={onSwitchFormat} />
    <TechnicalDetails plan={plan} files={files} uploadId={uploadId} />
  </section>;
  const notes = uploadNotes(plan, kind, projectLanguages);
  const sources = proposalSources(plan);
  return <section className="upload-preview" aria-label="Upload preview">
    <dl className="upload-summary">{uploadSummary(plan, kind).map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    {notes.length > 0 && <section aria-labelledby={`${ids}-notes`} className="upload-block">
      <h3 id={`${ids}-notes`} className="upload-block-heading">Notes</h3>
      <ul className="upload-notes">{notes.map(note => <NoteLine key={note.id} note={note} />)}</ul>
    </section>}
    {workPlan && plan.work_plan && <UploadWorkPlan key={plan.plan_sha256} workPlan={plan.work_plan} kind={kind} {...workPlan} />}
    <UploadTextList rows={uploadTextRows(plan, kind)} kind={kind} />
    {sources.length > 0 && <section aria-labelledby={`${ids}-sources`} className="upload-block">
      <h3 id={`${ids}-sources`} className="upload-block-heading">Proposal sources</h3>
      <ul className="upload-sources">{sources.map(source => <li key={source.name}>{proposalSourceLine(source)}</li>)}</ul>
    </section>}
    <TechnicalDetails plan={plan} files={files} uploadId={uploadId} />
  </section>;
}

function NoteLine({ note }: { note: UploadNote }): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  return <li className={note.tone === "warning" ? "upload-note upload-note--warning" : "upload-note"}>
    <span className="upload-note-text">{note.text}</span>
    {note.details.length > 0 && <Button size="sm" variant="quiet" aria-expanded={open} aria-controls={`${id}-details`} aria-label={`${open ? "Hide" : "Show"}: ${note.text}`} onClick={() => setOpen(value => !value)}>{open ? "Hide" : "Show"}</Button>}
    {open && <ul id={`${id}-details`} className="upload-note-details">{note.details.map((line, index) => <li key={index}>{line}</li>)}</ul>}
  </li>;
}

function UploadProblems({ plan, kind, files, onSwitchFormat }: { plan: ImportPlan; kind: UploadKind; files: UploadView["files"]; onSwitchFormat?: (kind: UploadKind) => void }): JSX.Element {
  const groups = problemsByFile(plan, files);
  const hint = formatHint(plan, kind, files);
  return <section className="upload-problems" aria-label="Problems">
    {hint && <div className="upload-hint">
      <p>{hint === "text" ? "These files look like plain text. Upload them with the format Plain text." : "These files look like an ontospan bundle. Upload them with the format Ontospan bundle."}</p>
      {onSwitchFormat && <Button size="sm" onClick={() => onSwitchFormat(hint)}>Switch to {uploadKindLabels[hint]}</Button>}
    </div>}
    {groups.map(group => <section key={group.file} className="upload-problem-file" aria-label={`Problems in ${group.file}`}>
      <h3 className="upload-block-heading">{group.file}: {plural(group.count, "problem")}</h3>
      <ul>{group.groups.map(item => <li key={item.code}>
        <strong>{item.title}</strong>{item.count > 1 ? ` (${item.count})` : ""}
        <ul className="upload-problem-examples">{item.examples.map((line, index) => <li key={index}>{line}</li>)}{item.count > item.examples.length && <li className="upload-muted">and {item.count - item.examples.length} more</li>}</ul>
      </li>)}</ul>
    </section>)}
  </section>;
}

/** Hashes, IDs and per-set data; rendered only while open. */
function TechnicalDetails({ plan, files, uploadId }: { plan: ImportPlan; files: UploadView["files"]; uploadId?: number }): JSX.Element {
  const [open, setOpen] = useState(false);
  return <details className="upload-disclosure upload-technical" open={open}>
    <summary onClick={event => { event.preventDefault(); setOpen(value => !value); }}>Technical details</summary>
    {open && <div className="upload-technical-body">
      <dl className="upload-technical-list">
        {uploadId != null && <><dt>Upload</dt><dd>{uploadId}</dd></>}
        <dt>Plan SHA-256</dt><dd><code>{plan.plan_sha256}</code></dd>
        <dt>Input SHA-256</dt><dd><code>{plan.input_sha256}</code></dd>
        <dt>Project state SHA-256</dt><dd><code>{plan.state_sha256}</code></dd>
        {files.map(file => <FileRow key={file.sha256 + file.filename} file={file} />)}
      </dl>
      {!!plan.collisions?.length && <><h4>Text conflicts</h4><ul>{plan.collisions.map((item, index) => <li key={index}>{item.document_id}: stored <code>{item.existing_sha256}</code>, uploaded <code>{item.new_sha256}</code></li>)}</ul></>}
      {!!plan.documents?.length && <><h4>Documents</h4><ul>{plan.documents.map((item, index) => <li key={index}>{item.document_id} ({item.language}), {item.label}, {item.action === "add" ? "new" : "unchanged"}, <code>{item.text_sha256}</code></li>)}</ul></>}
      {(plan.proposal_sets ?? []).map((set, index) => <section key={index} className="upload-technical-set">
        <h4>{set.document_id}, {set.annotation_set_id}</h4>
        <p>{humanize(set.set_kind)}, {set.action === "already_imported" ? "already imported" : "new set"}, {set.proposals.annotations.length} proposed, {new Set(set.refused.map(item => item.annotation_id)).size} refused</p>
        {set.actors.map((actor, actorIndex) => <p key={actorIndex}>{actor.kind === "tool" ? "Tool" : "Actor"}: {[actor.name, actor.version, actor.model, actor.run_id].filter(value => typeof value === "string" && value.length).join(", ") || "no label supplied"}</p>)}
        {set.bundle_id && <p>Bundle: {set.bundle_id}</p>}
        {set.manifest_sha256 && <p>Manifest: <code>{set.manifest_sha256}</code></p>}
        {!!set.refused.length && <><p>Refusal rules ({set.refused.length})</p><ul>{set.refused.map((item, refusalIndex) => <li key={refusalIndex}>{item.annotation_id}: {item.rule}{Object.keys(item.detail).length ? `, ${Object.entries(item.detail).map(([key, value]) => `${key}: ${String(value)}`).join(", ")}` : ""}</li>)}</ul></>}
        {!!Object.keys(set.proposals.notes ?? {}).length && <><p>Imported notes</p><ul>{Object.entries(set.proposals.notes ?? {}).flatMap(([id, notes]) => notes.map((note, noteIndex) => <li key={`${id}-${noteIndex}`}>{id}: {note}</li>))}</ul></>}
      </section>)}
      {!!plan.errors?.length && <><h4>All problems</h4><ul>{plan.errors.map((issue, index) => <li key={index}>{issue.code}, {issue.unit || "upload"}{issue.annotation_id ? `, ${issue.annotation_id}` : ""}: {issue.message}</li>)}</ul></>}
      {!!plan.warnings?.length && <><h4>All warnings</h4><ul>{plan.warnings.map((issue, index) => <li key={index}>{issue.code}, {issue.unit || "upload"}{issue.annotation_id ? `, ${issue.annotation_id}` : ""}: {issue.message}</li>)}</ul></>}
    </div>}
  </details>;
}

function FileRow({ file }: { file: UploadView["files"][number] }): JSX.Element {
  return <><dt>{file.filename}</dt><dd>{plural(file.size, "byte")}, <code>{file.sha256}</code></dd></>;
}
