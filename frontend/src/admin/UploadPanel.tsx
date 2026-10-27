import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type UploadView, type StatusOverride } from "../api/client";
import { Button, Checkbox, Field, InlineMessage, Select, SuggestInput, TextInput, Toolbar } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { commonLanguageCodes } from "./LanguagesField";
import { UploadPreview } from "./UploadPreview";
import { importLabel, type UploadWorkPlanResult } from "./UploadWorkPlan";
import { useJob } from "./useJob";
import { labelFor, plural, uploadKindLabels, uploadStatusLabels } from "../app/labels";

export interface UploadPanelProps {
  projectKey: string; languages: readonly string[]; /** Called once after a finished import with its result ("Imported 9 documents and 0 proposals."). */
  onImported: (message: string) => void; canOverrideTranslationStatus?: boolean;
  /** Project rule "annotate accepted translations only" (default on): the work plan asks for the external-review acceptance only while it is on. */
  annotateAcceptedOnly?: boolean;
}
type Operation = { projectKey: string; uploadId: number; jobId: number; stage: "preview" | "commit" };
const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

export function UploadPanel({ projectKey, languages, onImported, canOverrideTranslationStatus = false, annotateAcceptedOnly = true }: UploadPanelProps): JSX.Element {
  const importReasonId = `upload-import-reason-${useId().replace(/:/g, "")}`;
  const [kind, setKind] = useState<"t1" | "text">("t1");
  const [language, setLanguage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadView[]>([]);
  const [view, setView] = useState<UploadView | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>();
  const [listError, setListError] = useState<unknown>();
  const [stale, setStale] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const overrideIdentity = JSON.stringify([projectKey, view?.id, view?.plan_sha256, canOverrideTranslationStatus]);
  const [overrideDraft, setOverrideDraft] = useState<{ identity: string; values: Record<string, StatusOverride> }>({ identity: "", values: {} });
  const overrides = overrideDraft.identity === overrideIdentity ? overrideDraft.values : {};
  const setOverrides = (change: (current: Record<string, StatusOverride>) => Record<string, StatusOverride>) => setOverrideDraft(current => ({ identity: overrideIdentity, values: change(current.identity === overrideIdentity ? current.values : {}) }));
  const statusOverrides = canOverrideTranslationStatus ? Object.values(overrides) : [];
  const missingReason = statusOverrides.some(item => !item.reason.trim());
  const [workPlanDraft, setWorkPlanDraft] = useState<{ identity: string; result: UploadWorkPlanResult } | null>(null);
  const workPlan = view?.status === "ready" && view.preview?.committable ? view.preview.work_plan ?? null : null;
  const workPlanResult = workPlan && workPlanDraft?.identity === overrideIdentity ? workPlanDraft.result : null;
  const planBlocked = workPlanResult?.blockedReason ?? null;
  // Rows accepted by "Accept without review" need no external-review acceptance in the work plan.
  const acceptedRows = new Set(statusOverrides.flatMap(item => (view?.preview?.variants ?? []).filter(variant => variant.external_id === item.external_id && variant.language === item.language && variant.version === item.version).map(variant => `${variant.case_id}:${variant.language}`)));
  const lifetime = useRef(0);
  const mutation = useRef(false);
  const request = useRef(0);
  const handled = useRef<string | null>(null);
  const onImportedRef = useRef(onImported); onImportedRef.current = onImported;
  const { job, error: jobError } = useJob(operation?.projectKey === projectKey ? operation.jobId : null);
  const polling = operation !== null && !jobError && (!job || (job.status !== "failed" && job.status !== "succeeded"));
  const busy = working || polling;
  useEffect(() => { setOverrideDraft({ identity: overrideIdentity, values: {} }); }, [overrideIdentity]);

  const refreshList = async (epoch: number) => {
    const generation = ++request.current;
    try {
      const rows = await api.listUploads(projectKey);
      if (lifetime.current === epoch && request.current === generation) { setUploads(rows); setListError(undefined); }
    } catch (err: unknown) {
      if (lifetime.current === epoch && request.current === generation) setListError(err);
    }
  };
  useEffect(() => {
    const epoch = ++lifetime.current;
    mutation.current = false; handled.current = null;
    setFiles([]); setView(null); setOperation(null); setWorking(false); setError(undefined); setStale(false); setImported(null); setUploads([]); setLanguage("");
    void refreshList(epoch);
    return () => { lifetime.current++; request.current++; };
  }, [projectKey]);

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
        if (active && lifetime.current === epoch) setView(current);
      }, err => { if (active && lifetime.current === epoch) setError(err); });
      void refreshList(epoch);
      return () => { active = false; };
    }
    setWorking(true); mutation.current = true;
    void (async () => {
      try {
        const current = await api.getUpload(projectKey, operation.uploadId);
        if (lifetime.current !== epoch) return;
        setView(current);
        if (operation.stage === "commit") {
          if (current.status !== "committed" || !count(job.result?.documents_added) || !count(job.result?.proposals)) throw new Error("The import finished, but its final counts are unavailable. Refresh the upload status.");
          const message = `Imported ${plural(job.result.documents_added, "document")} and ${plural(job.result.proposals, "proposal")}.`;
          setImported(message);
          onImportedRef.current(message);
        }
        setOperation(null);
        await refreshList(epoch);
      } catch (err: unknown) {
        if (lifetime.current === epoch) setError(err);
      } finally {
        if (lifetime.current === epoch) { mutation.current = false; setWorking(false); }
      }
    })();
  }, [job, operation, projectKey]);

  const check = async () => {
    if (mutation.current || busy || !files.length || (kind === "text" && (!language || (languages.length > 0 && !languages.includes(language))))) return;
    const epoch = lifetime.current;
    mutation.current = true; setWorking(true); setError(undefined); setStale(false); setImported(null); setView(null); setOperation(null); handled.current = null;
    try {
      const created = await api.createUpload(projectKey, kind, files, kind === "text" ? language : undefined);
      if (lifetime.current === epoch) setOperation({ projectKey, uploadId: created.upload_id, jobId: created.job_id, stage: "preview" });
    } catch (err: unknown) { if (lifetime.current === epoch) setError(err); }
    finally { if (lifetime.current === epoch) { mutation.current = false; setWorking(false); } }
  };
  const commit = async () => {
    if (mutation.current || busy || stale || missingReason || planBlocked || view?.status !== "ready" || !view.preview?.committable || !view.plan_sha256) return;
    const epoch = lifetime.current;
    mutation.current = true; setWorking(true); setError(undefined); setImported(null); handled.current = null;
    try {
      const created = await (workPlan ? api.commitUpload(projectKey, view.id, view.plan_sha256, statusOverrides.length ? statusOverrides : undefined, workPlanResult?.plan ?? { plan_languages: {}, plan_cases: [] })
        : statusOverrides.length ? api.commitUpload(projectKey, view.id, view.plan_sha256, statusOverrides) : api.commitUpload(projectKey, view.id, view.plan_sha256));
      if (lifetime.current === epoch) setOperation({ projectKey, uploadId: created.upload_id, jobId: created.job_id, stage: "commit" });
    } catch (err: unknown) {
      if (lifetime.current === epoch) { setError(err); setStale(err instanceof ApiError && err.code === "UPLOAD_STALE"); }
    } finally { if (lifetime.current === epoch) { mutation.current = false; setWorking(false); } }
  };
  const resume = async (id: number) => {
    if (mutation.current || busy) return;
    const epoch = lifetime.current;
    mutation.current = true; setWorking(true); setError(undefined); setStale(false); setImported(null); setOperation(null); handled.current = null;
    try {
      const current = await api.getUpload(projectKey, id);
      if (lifetime.current !== epoch) return;
      setView(current);
      // A restored preview cannot recover the original File objects. Never
      // reuse a different selection for its stale-plan Check again action.
      setFiles([]);
      if (current.status === "previewing" && current.preview_job_id != null) setOperation({ projectKey, uploadId: id, jobId: current.preview_job_id, stage: "preview" });
      if ((current.status === "committing" || current.status === "committed") && current.commit_job_id !== null) setOperation({ projectKey, uploadId: id, jobId: current.commit_job_id, stage: "commit" });
    } catch (err: unknown) { if (lifetime.current === epoch) setError(err); }
    finally { if (lifetime.current === epoch) { mutation.current = false; setWorking(false); } }
  };
  const discard = async () => {
    if (mutation.current || busy || !view || !["ready", "invalid"].includes(view.status)) return;
    const epoch = lifetime.current;
    mutation.current = true; setWorking(true); setError(undefined);
    try {
      const current = await api.discardUpload(projectKey, view.id);
      if (lifetime.current === epoch) { setView(current); setOperation(null); await refreshList(epoch); }
    } catch (err: unknown) { if (lifetime.current === epoch) setError(err); }
    finally { if (lifetime.current === epoch) { mutation.current = false; setWorking(false); } }
  };
  const changed = () => { setView(null); setOperation(null); setError(undefined); setStale(false); setImported(null); };
  return <section aria-label="Upload documents">
    <form onSubmit={event => { event.preventDefault(); void check(); }}>
      <Select id="upload-kind" label="Format" value={kind} disabled={busy} onChange={event => { setKind(event.target.value as "t1" | "text"); changed(); }}><option value="t1">{uploadKindLabels.t1}: .zip or .json</option><option value="text">{uploadKindLabels.text}: .txt or .zip</option></Select>
      {kind === "text" && (languages.length ? <Select id="upload-language" label="Upload language" required value={language} disabled={busy} onChange={event => { setLanguage(event.target.value); changed(); }}><option value="">Choose language</option>{languages.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <>
        {/* A language code, not a name ("english" is refused, #47 A-22); the suggestions are the common codes of the languages field. */}
        <SuggestInput id="upload-language" label="Upload language" hint="BCP-47 language tag, for example en or de." required pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*"
          title="A language code such as en, de or pt-BR" value={language}
          suggestions={commonLanguageCodes.filter(code => code.startsWith(language.trim().toLowerCase()) && code !== language.trim().toLowerCase()).map(code => ({ value: code }))}
          onPick={code => { setLanguage(code); changed(); }} disabled={busy} onChange={event => { setLanguage(event.target.value); changed(); }} />
      </>)}
      <Field id="upload-files" label="Files" hint={kind === "t1" ? "Documents, plus any annotation proposals from people or tools, in the ontospan (T1) exchange format that other annotation tools read and write. Choose one or more JSON files or ZIP archives. Files are checked before import." : "Choose UTF-8 text files or ZIP archives. Files are checked before import."}><input type="file" multiple required accept={kind === "t1" ? ".json,.zip" : ".txt,.zip"} disabled={busy} onChange={event => { setFiles(Array.from(event.target.files ?? [])); changed(); }} /></Field>
      {/* The file input names a single file itself; several files are listed here. */}
      {files.length > 1 && <p>{files.map(file => file.name).join(", ")}</p>}
      <Button type="submit" loading={busy && operation?.stage !== "commit"} disabled={busy || !files.length}>{busy && operation?.stage !== "commit" ? "Checking …" : "Check"}</Button>
    </form>
    {error !== undefined && !stale && <ErrorNotice error={error} />}
    {jobError !== undefined && <ErrorNotice error={jobError} />}
    {job?.status === "failed" && !stale && <InlineMessage tone="error">Job failed: {job.error || "No failure details were supplied."}</InlineMessage>}
    {stale && <InlineMessage tone="error">The project changed since this preview. Check again.</InlineMessage>}
    {stale && (files.length ? <Button disabled={busy} onClick={() => { void check(); }}>Check again</Button> : <p>Select the original files to check again.</p>)}
    {operation?.stage === "commit" && busy && <InlineMessage tone="info">Importing …</InlineMessage>}
    {imported && <InlineMessage tone="success">{imported}</InlineMessage>}
    {view && <><p>Upload {view.id}, {labelFor(uploadStatusLabels, view.status)}</p>{view.preview && <UploadPreview plan={view.preview} workPlan={view.status === "ready" ? { ruleOn: annotateAcceptedOnly, canAccept: canOverrideTranslationStatus, acceptedRows, disabled: busy || stale, onChange: result => setWorkPlanDraft({ identity: overrideIdentity, result }) } : undefined} />}
      {canOverrideTranslationStatus && view.status === "ready" && view.preview?.variants?.some(item => item.status !== null) && <fieldset disabled={busy || stale}><legend>Accept without review</legend>
        <p>Explicitly accept a translation without review. A reason is required for every selected variant.</p>
        {view.preview.variants.filter(item => item.status !== null).map(item => {
          const identity = JSON.stringify([item.external_id, item.language, item.version]);
          const selected = overrides[identity];
          const id = `override-${encodeURIComponent(identity)}`;
          return <div key={identity}><Checkbox id={id} label={`Accept without review: ${item.external_id}, ${item.language}, v${item.version}`} checked={!!selected} onChange={event => setOverrides(current => {
            const next = { ...current };
            if (event.target.checked) next[identity] = { external_id: item.external_id, language: item.language, version: item.version, reason: "" };
            else delete next[identity];
            return next;
          })} />{selected && <TextInput id={`${id}-reason`} label={`Reason: ${item.external_id}, ${item.language}, v${item.version}`} required value={selected.reason} onChange={event => setOverrides(current => ({ ...current, [identity]: { ...selected, reason: event.target.value } }))} />}</div>;
        })}
      </fieldset>}
      {view.status === "previewing" && <><InlineMessage tone="info">Checking …</InlineMessage>{view.preview_job_id == null && <Button disabled={busy} onClick={() => { void resume(view.id); }}>Refresh status</Button>}</>}
      {["ready", "invalid"].includes(view.status) && <Toolbar label="Preview actions"><Button variant="primary" disabled={busy || stale || missingReason || view.status !== "ready" || !view.preview?.committable || !view.plan_sha256} aria-disabled={planBlocked ? true : undefined} aria-describedby={planBlocked ? importReasonId : undefined} onClick={() => { void commit(); }}>{workPlan ? importLabel(workPlan, view.kind) : "Import"}</Button><Button disabled={busy} onClick={() => { void discard(); }}>Discard</Button></Toolbar>}
      {planBlocked && <p id={importReasonId} className="field-hint">{planBlocked}</p>}
    </>}
    <section className="detail-section"><h3>Recent uploads</h3>{listError !== undefined && <ErrorNotice error={listError} />}<Button disabled={busy} onClick={() => { void refreshList(lifetime.current); }}>Refresh uploads</Button>
      {uploads.length ? <ul>{uploads.map(item => <li key={item.id}>Upload {item.id}, {labelFor(uploadKindLabels, item.kind)}, {labelFor(uploadStatusLabels, item.status)}, {item.files.map(file => file.filename).join(", ")} <Button size="sm" disabled={busy} onClick={() => { void resume(item.id); }}>Resume upload {item.id}</Button></li>)}</ul> : <p>No retained uploads.</p>}
    </section>
  </section>;
}
