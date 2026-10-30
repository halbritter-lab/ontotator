import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, type UploadStatus, type UploadView } from "../api/client";
import { formatDateTime, labelFor, plural, uploadKindLabels, uploadStatusLabels } from "../app/labels";
import { Button, Dialog, IconButton, IconClose, Select, SuggestInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { commonLanguageCodes } from "./LanguagesField";
import { UploadPreview } from "./UploadPreview";
import type { UploadWorkPlanResult } from "./UploadWorkPlan";
import { caseCount, importButtonLabel, unitWord, type UploadKind } from "./uploadModel";
import { useJob } from "./useJob";

/** issue 174: the plain-text rule of `exchange/text.py` (file name without .txt = text ID, `DOCUMENT_ID`). */
const TEXT_FILES_HINT = "UTF-8 text files (.txt) or ZIP archives of them; checked before import. Each file name without .txt becomes the text ID: letters, digits, \".\", \"_\" and \"-\", starting with a letter or digit, up to 128 characters."

export interface UploadPanelProps {
  projectKey: string; languages: readonly string[]; /** Called once after a finished import with its result ("Imported 9 documents and 0 proposals."); the caller closes the dialog and shows the toast (Q5). */
  onImported: (message: string) => void;
  /** Cancel, Close and the header button. Closing during an import shows no toast and refreshes nothing (OQ2). */
  onClose?: () => void;
  /** The lead may accept translations as reviewed outside Ontotator in the work plan (per language, Q2). */
  canOverrideTranslationStatus?: boolean;
  /** Project rule "annotate accepted translations only" (default on): the work plan asks for the external-review acceptance only while it is on. */
  annotateAcceptedOnly?: boolean;
}
type Operation = { projectKey: string; uploadId: number; jobId: number; stage: "preview" | "commit" };
type Phase = "choose" | "checking" | "preview" | "problems" | "importing" | "imported" | "committed";
type Notice = { tone: "info" | "success" | "warning"; text: string };
/** Q4: only these uploads are listed; committed ones move to a later project history, discarded and invalid ones are not listed. */
export const UNFINISHED_STATUSES: readonly UploadStatus[] = ["previewing", "ready", "committing"];
const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** The "Upload texts" dialog: a 760 px dialog whose body is the only scroll area, with a fixed footer. */
export function UploadPanel({ projectKey, languages, onImported, onClose, canOverrideTranslationStatus = false, annotateAcceptedOnly = true }: UploadPanelProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const formId = `${ids}-form`;
  const reasonId = `${ids}-reason`;
  const [kind, setKind] = useState<UploadKind>("t1");
  const [language, setLanguage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadView[]>([]);
  const [view, setView] = useState<UploadView | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [action, setAction] = useState<"check" | "commit" | "open" | "discard" | "finish" | null>(null);
  const [error, setError] = useState<unknown>();
  const [listError, setListError] = useState<unknown>();
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const planIdentity = JSON.stringify([projectKey, view?.id, view?.plan_sha256]);
  const [workPlanDraft, setWorkPlanDraft] = useState<{ identity: string; result: UploadWorkPlanResult } | null>(null);
  const workPlan = view?.status === "ready" && view.preview?.committable ? view.preview.work_plan ?? null : null;
  const workPlanResult = workPlan && workPlanDraft?.identity === planIdentity ? workPlanDraft.result : null;
  const planBlocked = workPlanResult?.blockedReason ?? null;
  const lifetime = useRef(0);
  const mutation = useRef(false);
  const request = useRef(0);
  const handled = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const resultLine = useRef<HTMLParagraphElement>(null);
  const onImportedRef = useRef(onImported); onImportedRef.current = onImported;
  const { job, error: jobError } = useJob(operation?.projectKey === projectKey ? operation.jobId : null);
  const jobDone = !!job && (job.status === "failed" || job.status === "succeeded");
  const polling = operation !== null && !jobError && !jobDone;
  const busy = action !== null || polling;
  const failedJob = job?.status === "failed" && !stale ? job.error || "No failure details were supplied." : null;

  const phase: Phase = imported ? "imported"
    : view?.status === "committed" ? "committed"
    : action === "commit" || (operation?.stage === "commit" && (polling || action === "finish")) || view?.status === "committing" ? "importing"
    : action === "check" || (operation?.stage === "preview" && (polling || action === "finish")) || view?.status === "previewing" ? "checking"
    : view?.status === "ready" || (stale && view?.preview?.committable) ? "preview"
    : view || (failedJob && operation?.stage === "preview") ? "problems"
    : "choose";
  const unit = (view?.kind ?? kind) as UploadKind;
  const fileCount = view ? view.files.length : files.length;

  const refreshList = async (epoch: number) => {
    const generation = ++request.current;
    try {
      const rows = await api.listUploads(projectKey, UNFINISHED_STATUSES);
      if (lifetime.current === epoch && request.current === generation) { setUploads(rows); setListError(undefined); }
    } catch (err: unknown) {
      if (lifetime.current === epoch && request.current === generation) setListError(err);
    }
  };
  useEffect(() => {
    const epoch = ++lifetime.current;
    mutation.current = false; handled.current = null;
    setFiles([]); setView(null); setOperation(null); setAction(null); setError(undefined); setStale(false); setNotice(null); setImported(null); setUploads([]); setLanguage("");
    void refreshList(epoch);
    return () => { lifetime.current++; request.current++; };
  }, [projectKey]); // eslint-disable-line react-hooks/exhaustive-deps -- a new project starts over

  // The result line takes the focus after Check, Open preview, Import and Discard (no focus on <body>).
  useLayoutEffect(() => { if (focusRequest) resultLine.current?.focus(); }, [focusRequest]);
  const focusResult = () => setFocusRequest(value => value + 1);

  useEffect(() => {
    if (!operation || operation.projectKey !== projectKey || !job || (job.status !== "failed" && job.status !== "succeeded")) return;
    const identity = `${operation.jobId}:${job.status}`;
    if (handled.current === identity) return;
    handled.current = identity;
    const epoch = lifetime.current;
    if (job.status === "failed") {
      let active = true;
      setStale(operation.stage === "commit" && /\bUPLOAD_STALE\b/.test(job.error ?? ""));
      void api.getUpload(projectKey, operation.uploadId).then(current => {
        if (active && lifetime.current === epoch) { setView(current); focusResult(); }
      }, err => { if (active && lifetime.current === epoch) { setError(err); focusResult(); } });
      void refreshList(epoch);
      return () => { active = false; };
    }
    setAction("finish"); mutation.current = true;
    void (async () => {
      try {
        const current = await api.getUpload(projectKey, operation.uploadId);
        if (lifetime.current !== epoch) return;
        if (operation.stage === "commit") {
          if (current.status !== "committed" || !count(job.result?.documents_added) || !count(job.result?.proposals)) throw new Error("The import finished, but its final counts are unavailable. Refresh the upload status.");
          const message = `Imported ${plural(job.result.documents_added, "document")} and ${plural(job.result.proposals, "proposal")}.`;
          setView(current); setImported(message);
          onImportedRef.current(message);
        } else setView(current);
        setOperation(null);
        focusResult();
        await refreshList(epoch);
      } catch (err: unknown) {
        if (lifetime.current === epoch) { setError(err); setOperation(null); focusResult(); }
      } finally {
        if (lifetime.current === epoch) { mutation.current = false; setAction(null); }
      }
    })();
  }, [job, operation, projectKey]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshList reads the current project

  const languageMissing = kind === "text" && (!language.trim() || (languages.length > 0 ? !languages.includes(language) : !LANGUAGE_CODE.test(language.trim())));
  const chooseReason = !files.length ? "Choose at least one file." : languageMissing ? (language.trim() ? "Use a language code such as en, de or pt-BR." : "Choose the upload language.") : null;
  const check = async () => {
    if (mutation.current || busy || chooseReason) return;
    const epoch = lifetime.current;
    mutation.current = true; setAction("check"); setError(undefined); setStale(false); setNotice(null); setImported(null); setView(null); setOperation(null); handled.current = null;
    try {
      const created = await api.createUpload(projectKey, kind, files, kind === "text" ? language.trim() : undefined);
      if (lifetime.current === epoch) setOperation({ projectKey, uploadId: created.upload_id, jobId: created.job_id, stage: "preview" });
    } catch (err: unknown) { if (lifetime.current === epoch) { setError(err); focusResult(); } }
    finally { if (lifetime.current === epoch) { mutation.current = false; setAction(null); } }
  };
  const importReason = phase !== "preview" ? null
    : stale ? (files.length ? "The project changed since this check. Check again." : "The project changed since this check. Choose the files again and check them.")
    : planBlocked;
  const commit = async () => {
    if (mutation.current || busy || stale || planBlocked || view?.status !== "ready" || !view.preview?.committable || !view.plan_sha256) return;
    const epoch = lifetime.current;
    mutation.current = true; setAction("commit"); setError(undefined); setImported(null); handled.current = null;
    try {
      // Q2: the per-variant status overrides are no longer sent; acceptance lives in the work plan.
      const created = await (workPlan ? api.commitUpload(projectKey, view.id, view.plan_sha256, undefined, workPlanResult?.plan ?? { plan_languages: {}, plan_cases: [] })
        : api.commitUpload(projectKey, view.id, view.plan_sha256));
      if (lifetime.current === epoch) { setOperation({ projectKey, uploadId: created.upload_id, jobId: created.job_id, stage: "commit" }); focusResult(); void refreshList(epoch); }
    } catch (err: unknown) {
      if (lifetime.current === epoch) { setError(err); setStale(err instanceof ApiError && err.code === "UPLOAD_STALE"); focusResult(); }
    } finally { if (lifetime.current === epoch) { mutation.current = false; setAction(null); } }
  };
  /** Q4/state 7: attach to the upload's current state; a committed upload shows an info line, never the import toast. */
  const open = async (id: number) => {
    if (mutation.current || busy) return;
    const epoch = lifetime.current;
    mutation.current = true; setAction("open"); setError(undefined); setStale(false); setNotice(null); setImported(null); setOperation(null); handled.current = null;
    try {
      const current = await api.getUpload(projectKey, id);
      if (lifetime.current !== epoch) return;
      setView(current); setKind(current.kind); setLanguage(current.language ?? "");
      // A restored preview cannot recover the original File objects. Never
      // reuse a different selection for its stale-plan Check again action.
      setFiles([]);
      if (current.status === "previewing" && current.preview_job_id != null) setOperation({ projectKey, uploadId: id, jobId: current.preview_job_id, stage: "preview" });
      if (current.status === "committing" && current.commit_job_id !== null) setOperation({ projectKey, uploadId: id, jobId: current.commit_job_id, stage: "commit" });
      focusResult();
      if (current.status === "committed" || current.status === "discarded") void refreshList(epoch);
    } catch (err: unknown) { if (lifetime.current === epoch) { setError(err); focusResult(); } }
    finally { if (lifetime.current === epoch) { mutation.current = false; setAction(null); } }
  };
  /** State 6: back to step 1 with the files kept. */
  const discard = async (then?: () => void) => {
    if (mutation.current || busy || !view || !["ready", "invalid", "failed"].includes(view.status)) return;
    const epoch = lifetime.current;
    mutation.current = true; setAction("discard"); setError(undefined);
    try {
      await api.discardUpload(projectKey, view.id);
      if (lifetime.current !== epoch) return;
      setView(null); setOperation(null); setStale(false); handled.current = null;
      setNotice({ tone: "info", text: "Upload discarded. Nothing was imported." });
      then?.();
      focusResult();
      await refreshList(epoch);
    } catch (err: unknown) { if (lifetime.current === epoch) setError(err); }
    finally { if (lifetime.current === epoch) { mutation.current = false; setAction(null); } }
  };
  const switchFormat = (next: UploadKind) => {
    void discard(() => { setKind(next); setNotice({ tone: "info", text: `Upload discarded. The format is now ${uploadKindLabels[next]}${next === "text" ? "; choose the language" : ""}, then check again.` }); });
  };
  const changed = () => { setView(null); setOperation(null); setError(undefined); setStale(false); setImported(null); setNotice(null); };
  const addFiles = (chosen: FileList | null) => {
    const list = Array.from(chosen ?? []);
    if (!list.length) return;
    setFiles(current => [...current, ...list.filter(file => !current.some(other => sameFile(file, other)))]);
    changed();
  };

  const statusLine = (tone: "status" | "alert", text: string, extra?: string) => <p ref={resultLine} tabIndex={-1} role={tone} className={tone === "alert" ? "upload-result upload-result--alert" : "upload-result"}>
    {text}{extra && <span className="upload-result-extra"> {extra}</span>}
  </p>;
  const checkedText = `Checked ${plural(fileCount, "file")}`;
  const plan = view?.preview ?? null;
  const units = plan ? plural(caseCount(plan, unit), unitWord(unit)) : null;

  const body = (() => {
    switch (phase) {
      case "imported": return statusLine("status", imported ?? "");
      case "committed": return statusLine("status", "This upload was already imported. Its texts are in the project.");
      case "importing": return <>{statusLine("status", `Importing ${units ?? "the upload"} …`, "You can close this dialog; the import continues, and the texts appear after the next page load.")}</>;
      case "preview":
      case "problems": {
        const ready = phase === "preview";
        const line = failedJob ? statusLine("alert", operation?.stage === "commit" || view?.commit_job_id ? `The import failed: ${failedJob}` : `The check failed: ${failedJob}`)
          : stale ? statusLine("alert", "The project changed since this check. Nothing was imported.", files.length ? "Check again." : "Choose the files again and check them.")
          : !view ? statusLine("alert", "The check failed.")
          : view.status === "failed" ? statusLine("alert", "This upload failed. Nothing was imported.", "Discard it and upload the files again.")
          : ready ? statusLine("status", `${checkedText}: ready to import.`)
          : statusLine("alert", `${checkedText}: problems found. Nothing can be imported.`);
        return <>
          {line}
          {error !== undefined && !stale && <ErrorNotice error={error} />}
          {jobError !== undefined && <ErrorNotice error={jobError} />}
          {view?.preview && <UploadPreview plan={view.preview} kind={unit} files={view.files} uploadId={view.id} projectLanguages={languages} onSwitchFormat={switchFormat}
            workPlan={ready ? { ruleOn: annotateAcceptedOnly, canAccept: canOverrideTranslationStatus, disabled: busy || stale, onChange: result => setWorkPlanDraft({ identity: planIdentity, result }) } : undefined} />}
        </>;
      }
      default: return <>
        {phase === "checking" ? statusLine("status", `Checking ${plural(fileCount, "file")} …`)
          : notice ? <p ref={resultLine} tabIndex={-1} role="status" className="upload-result">{notice.text}</p> : null}
        {view?.status === "previewing" && view.preview_job_id == null && <Button size="sm" disabled={busy} onClick={() => { void open(view.id); }}>Refresh status</Button>}
        {phase === "choose" && error !== undefined && <ErrorNotice error={error} />}
        {jobError !== undefined && <ErrorNotice error={jobError} />}
        {!view && <form id={formId} noValidate className="upload-form" onSubmit={event => { event.preventDefault(); void check(); }}>
          <div className="upload-fields">
            <Select id={`${ids}-kind`} label="Format" value={kind} disabled={busy} onChange={event => { setKind(event.target.value as UploadKind); changed(); }}><option value="t1">{uploadKindLabels.t1}: .zip or .json</option><option value="text">{uploadKindLabels.text}: .txt or .zip</option></Select>
            {kind === "text" && (languages.length ? <Select id={`${ids}-language`} label="Upload language" required value={language} disabled={busy} onChange={event => { setLanguage(event.target.value); changed(); }}><option value="">Choose language</option>{languages.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <>
              {/* A language code, not a name ("english" is refused, #47 A-22); the suggestions are the common codes of the languages field. */}
              <SuggestInput id={`${ids}-language`} label="Upload language" hint="A language code, for example en or de." required pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*"
                title="A language code such as en, de or pt-BR" value={language}
                suggestions={commonLanguageCodes.filter(code => code.startsWith(language.trim().toLowerCase()) && code !== language.trim().toLowerCase()).map(code => ({ value: code }))}
                onPick={code => { setLanguage(code); changed(); }} disabled={busy} onChange={event => { setLanguage(event.target.value); changed(); }} />
            </>)}
          </div>
          <div className="form-group upload-files">
            <label className="form-label visually-hidden" htmlFor={`${ids}-files`}>Files</label>
            <input ref={fileInput} id={`${ids}-files`} className="visually-hidden" type="file" multiple tabIndex={-1} accept={kind === "t1" ? ".json,.zip" : ".txt,.zip"} disabled={busy} aria-describedby={`${ids}-files-hint`}
              onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />
            <div className="upload-files-row">
              <Button disabled={busy} aria-describedby={`${ids}-files-hint`} onClick={() => fileInput.current?.click()}>Choose files…</Button>
              {files.length > 0 && <ul className="upload-chips" aria-label="Chosen files">{files.map(file => <li key={`${file.name}-${file.size}-${file.lastModified}`} className="upload-chip">
                <span className="upload-chip-name">{file.name}</span>
                <IconButton size="sm" variant="quiet" label={`Remove ${file.name}`} icon={<IconClose />} disabled={busy} onClick={() => { setFiles(current => current.filter(other => !sameFile(file, other))); changed(); }} />
              </li>)}</ul>}
            </div>
            <p id={`${ids}-files-hint`} className="field-hint">{kind === "t1" ? "Ontospan exchange files (.json) or bundles (.zip) with texts and any proposals; checked before import." : TEXT_FILES_HINT}</p>
          </div>
        </form>}
        {phase === "choose" && <UnfinishedUploads uploads={uploads} error={listError} open={unfinishedOpen} onToggle={() => setUnfinishedOpen(value => !value)} busy={busy} onOpen={id => { void open(id); }} />}
      </>;
    }
  })();

  const closing = onClose ?? (() => undefined);
  // A checked upload with problems is never imported: leaving the dialog discards it (#196). A ready one stays under "Unfinished uploads".
  const refusedUpload = phase === "problems" && view && ["invalid", "failed"].includes(view.status) ? view : null;
  const cancel = () => {
    if (refusedUpload && !busy) void api.discardUpload(projectKey, refusedUpload.id).catch(() => undefined);
    closing();
  };
  const reason = phase === "choose" ? chooseReason : importReason;
  const footer = <>
    {reason && <span id={reasonId} className="dialog-footer-reason">{reason}</span>}
    {phase === "importing" || phase === "imported" || phase === "committed" ? <Button variant={phase === "importing" ? "secondary" : "primary"} onClick={closing}>Close</Button> : <>
      <Button onClick={cancel}>Cancel</Button>
      {/* After a failed check Discard also closes the dialog; after a good one it returns to step 1 with the files kept. */}
      {(phase === "preview" || phase === "problems") && view && ["ready", "invalid", "failed"].includes(view.status) && <Button disabled={busy} variant={phase === "problems" ? "primary" : "secondary"} onClick={() => { void discard(phase === "problems" ? closing : undefined); }}>Discard</Button>}
      {(phase === "choose" || phase === "checking") && <Button type="submit" form={formId} variant="primary" loading={phase === "checking"} aria-disabled={reason ? "true" : undefined} aria-describedby={reason ? reasonId : undefined}
        onClick={event => { if (reason) event.preventDefault(); }}>Check</Button>}
      {phase === "preview" && (stale && files.length
        ? <Button variant="primary" onClick={() => { void check(); }}>Check again</Button>
        : <Button variant="primary" aria-disabled={reason || busy ? "true" : undefined} aria-describedby={reason ? reasonId : undefined} onClick={() => { void commit(); }}>{importButtonLabel(view?.preview, unit)}</Button>)}
    </>}
  </>;
  return <Dialog open title="Upload texts" size="lg" className="upload-dialog" onClose={cancel} footer={footer}>
    <div className="upload-body" aria-busy={busy || undefined}>{body}</div>
  </Dialog>;
}

function UnfinishedUploads({ uploads, error, open, onToggle, busy, onOpen }: { uploads: readonly UploadView[]; error: unknown; open: boolean; onToggle: () => void; busy: boolean; onOpen: (id: number) => void }): JSX.Element | null {
  const ids = useId().replace(/:/g, "");
  if (error !== undefined) return <ErrorNotice error={error} />;
  if (!uploads.length) return null;
  return <details className="upload-disclosure upload-unfinished" open={open}>
    <summary onClick={event => { event.preventDefault(); onToggle(); }}>Unfinished uploads ({uploads.length})</summary>
    {open && <ul className="upload-unfinished-list">{uploads.map(item => {
      const describedBy = `${ids}-${item.id}`;
      return <li key={item.id}>
        <span id={describedBy} className="upload-unfinished-text">Started {formatDateTime(item.created_at)}: {item.files.map(file => file.filename).join(", ")}<span className="upload-muted"> · {labelFor(uploadKindLabels, item.kind)}{item.language ? `, ${item.language}` : ""} · {labelFor(uploadStatusLabels, item.status)}</span></span>
        <Button size="sm" disabled={busy} aria-describedby={describedBy} onClick={() => onOpen(item.id)}>{item.status === "committing" ? "Show progress" : "Open preview"}</Button>
      </li>;
    })}</ul>}
  </details>;
}

