import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type GuidelineListing, type GuidelineSummary } from "../api/client";
import { personLabel } from "../app/identity";
import { formatTime } from "../app/submissionLabels";
import { readGuidelineFile, type GuidelineKind } from "../guidelines/fileChecks";
import { formatGuidelineDay, GuidelineReader, withdrawnNote } from "../guidelines/GuidelineReader";
import { Button, DataTable, Dialog, GuidelineDocument, InlineMessage, TextInput, type Column } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import "../guidelines/guidelines.css";

const NOT_SEEN_SHOWN = 10;
type NotSeen = NonNullable<GuidelineSummary["not_seen"]>[number];
type Chosen = { file: File; text: string; kind: GuidelineKind };

/** "18 KB"; below one KiB the exact byte count. */
function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
}
/** "Tom Reis (ann-0004, notified)"; without a display name "ann-0004 (notified)". */
function notSeenLabel({ person, notified }: NotSeen): string {
  const label = personLabel(person);
  if (!notified) return label;
  return label.endsWith(")") ? `${label.slice(0, -1)}, notified)` : `${label} (notified)`;
}
const published = (summary: GuidelineSummary) => `${formatTime(summary.created_at)} by ${personLabel(summary.created_by)}`;
const isConflict = (error: unknown) => error instanceof ApiError && error.code === "GUIDELINE_VERSION_CONFLICT";

/** Settings › Guidelines: publish, read and withdraw versions; who has not seen the current one (spec G14, G23 to G25). */
export function GuidelinesSection({ projectKey }: { projectKey: string }): JSX.Element {
  return <GuidelinesEditor key={projectKey} projectKey={projectKey} />;
}

function GuidelinesEditor({ projectKey }: { projectKey: string }): JSX.Element {
  const id = useId();
  const [listing, setListing] = useState<GuidelineListing | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [generation, setGeneration] = useState(0);
  const [success, setSuccess] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<unknown>();
  const [republishError, setRepublishError] = useState<unknown>();
  const [reading, setReading] = useState<number | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<unknown>();
  const writing = useRef(false);
  const fileRead = useRef(0);
  const successRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const focusPreview = useRef(false);
  const readerRef = useRef<HTMLElement>(null);
  const focusSuccess = useRef(false);

  useEffect(() => {
    let active = true;
    setLoadError(undefined);
    void api.listGuidelines(projectKey).then(next => { if (active) setListing(next); }).catch((failure: unknown) => { if (active) setLoadError(failure); });
    return () => { active = false; };
  }, [projectKey, generation]);
  const reload = () => setGeneration(value => value + 1);

  useEffect(() => {
    if (success && focusSuccess.current) { focusSuccess.current = false; successRef.current?.focus(); }
  }, [success]);
  useEffect(() => { if (reading !== null) readerRef.current?.focus(); }, [reading]);
  useEffect(() => {
    if (chosen && focusPreview.current) { focusPreview.current = false; previewRef.current?.focus(); }
  }, [chosen]);

  const choose = async (file: File | undefined) => {
    const ticket = ++fileRead.current;
    setChosen(null); setFileError(null); setPublishError(undefined);
    if (!file) return;
    const result = await readGuidelineFile(file).catch(() => ({ error: "The file could not be read." }));
    if (ticket !== fileRead.current) return;
    if ("error" in result) setFileError(result.error);
    else setChosen({ file, text: result.text, kind: result.kind });
  };
  const discard = () => {
    fileRead.current++;
    setChosen(null); setFileError(null); setNote(""); setPublishError(undefined); setFileKey(value => value + 1);
  };
  // Withdrawn texts are deleted, so only a version whose text still exists can be republished: its text
  // fills the publish form as a new file, for review before "Publish as vN".
  const republish = async (version: number) => {
    const ticket = ++fileRead.current;
    setChosen(null); setFileError(null); setPublishError(undefined); setRepublishError(undefined); setSuccess(null);
    try {
      const document = await api.getGuideline(projectKey, version);
      if (ticket !== fileRead.current) return;
      if (document.body === null) { setRepublishError(new Error(`The text of v${version} is no longer available.`)); return; }
      const name = document.filename ?? `guidelines-v${version}.${document.kind === "markdown" ? "md" : "txt"}`;
      const file = new File([document.body], name, { type: document.kind === "markdown" ? "text/markdown" : "text/plain" });
      setFileKey(value => value + 1);
      setNote(`Republished v${version}`);
      focusPreview.current = true;
      setChosen({ file, text: document.body, kind: document.kind });
    } catch (failure: unknown) {
      if (ticket === fileRead.current) setRepublishError(failure);
    }
  };
  const showSuccess = (message: string) => { focusSuccess.current = true; setSuccess(message); };

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (writing.current || !chosen || listing === null) return;
    writing.current = true; setPublishing(true); setPublishError(undefined); setSuccess(null);
    try {
      const summary = await api.publishGuideline(projectKey, { file: chosen.file, changeNote: note.trim(), expectedLatestVersion: listing.latest_version });
      discard();
      showSuccess(`Published v${summary.version}. Annotators and reviewers see the update notice when they next open a task.`);
      reload();
    } catch (failure: unknown) {
      setPublishError(failure);
      if (isConflict(failure)) reload();
    } finally { writing.current = false; setPublishing(false); }
  };

  const withdraw = async () => {
    if (writing.current || withdrawTarget === null || listing?.latest_version == null) return;
    const version = withdrawTarget;
    writing.current = true; setWithdrawing(true); setWithdrawError(undefined); setSuccess(null);
    try {
      await api.withdrawGuideline(projectKey, version, { reason: reason.trim() || null, expected_latest_version: listing.latest_version });
      setWithdrawTarget(null); setReason("");
      showSuccess(`v${version} withdrawn.`);
      reload();
    } catch (failure: unknown) {
      setWithdrawError(failure);
      if (isConflict(failure)) reload();
    } finally { writing.current = false; setWithdrawing(false); }
  };
  const openWithdraw = (version: number) => { setWithdrawTarget(version); setReason(""); setWithdrawError(undefined); };
  const closeWithdraw = () => { if (!writing.current) { setWithdrawTarget(null); setWithdrawError(undefined); } };

  const current = listing?.current ?? null;
  const versions = listing?.versions ?? [];
  const latestWithdrawn = listing && !current && listing.latest_version !== null ? versions.find(item => item.version === listing.latest_version)?.withdrawn ?? null : null;
  const nextVersion = (listing?.latest_version ?? 0) + 1;
  const target = withdrawTarget === null ? null : versions.find(item => item.version === withdrawTarget) ?? null;
  const targetIsCurrent = target !== null && current?.version === target.version;
  const previous = target ? versions.find(item => item.version < target.version && !item.withdrawn) ?? null : null;

  const columns: Column<GuidelineSummary>[] = [
    { id: "version", header: "Version", rowHeader: true, cell: item => `v${item.version}` },
    { id: "file", header: "File", cell: item => item.withdrawn ? "—" : item.filename ?? "—" },
    { id: "note", header: "Change note", cell: item => withdrawnNote(item) ?? item.change_note ?? "" },
    { id: "published", header: "Published", cell: published },
    { id: "seen", header: "Seen by", cell: item => !item.withdrawn && item.reach ? `Seen by ${item.reach.opened} of ${item.reach.members} task members` : "—" },
    { id: "actions", header: "Actions", cell: item => item.withdrawn ? null : <div className="guidelines-row-actions">
      <Button size="sm" aria-label={`Read v${item.version}`} onClick={() => setReading(item.version)}>Read</Button>
      {item.version !== current?.version && <Button size="sm" onClick={() => { void republish(item.version); }}>Republish v{item.version}…</Button>}
      <Button size="sm" variant="quiet" onClick={() => openWithdraw(item.version)}>Withdraw v{item.version}…</Button>
    </div> },
  ];

  const notSeen = current?.not_seen ?? [];
  return <div className="guidelines-settings">
    <h2>Guidelines</h2>
    {success && <div ref={successRef} tabIndex={-1} className="guidelines-success"><InlineMessage tone="success" onDismiss={() => setSuccess(null)}>{success}</InlineMessage></div>}
    {loadError !== undefined && <><ErrorNotice error={loadError} /><Button onClick={reload}>Try again</Button></>}
    {listing === null ? loadError === undefined && <InlineMessage tone="info">Loading guidelines…</InlineMessage> : <>
      {current ? <div className="guidelines-current">
        <p className="guidelines-current-facts">{`v${current.version} · ${current.filename ?? "—"} · ${formatSize(current.size_bytes)} · published ${published(current)}`}</p>
        {current.change_note && <p className="guidelines-current-note">{current.change_note}</p>}
        {current.reach && <p>Seen by {current.reach.opened} of {current.reach.members} task members</p>}
        {notSeen.length > 0 && <div className="guidelines-not-seen">
          <p>{`Not yet seen by: ${notSeen.slice(0, NOT_SEEN_SHOWN).map(notSeenLabel).join(", ")}`}</p>
          {notSeen.length > NOT_SEEN_SHOWN && <details>
            <summary>and {notSeen.length - NOT_SEEN_SHOWN} more</summary>
            <p>{notSeen.slice(NOT_SEEN_SHOWN).map(notSeenLabel).join(", ")}</p>
          </details>}
        </div>}
        <div className="guidelines-current-actions">
          <Button onClick={() => setReading(current.version)}>Read v{current.version}</Button>
          <Button variant="quiet" onClick={() => openWithdraw(current.version)}>Withdraw v{current.version}…</Button>
        </div>
      </div>
      : latestWithdrawn ? <InlineMessage tone="warning">{`No guideline is in force. v${listing.latest_version} was withdrawn on ${formatGuidelineDay(latestWithdrawn.at)} by ${personLabel(latestWithdrawn.by)}. Publish a new version${versions.some(item => !item.withdrawn) ? ", or republish an earlier version from the list below" : ""}.`}</InlineMessage>
      : <p className="guidelines-empty">No guidelines yet. Upload a .md or .txt file. Annotators and reviewers will find it in every task.</p>}

      <form className="guidelines-publish" aria-labelledby={`${id}-publish`} onSubmit={event => { void publish(event); }}>
        <h3 id={`${id}-publish`}>Publish a new version</h3>
        <TextInput key={fileKey} id={`${id}-file`} type="file" label="Guideline file (.md or .txt, up to 256 KB)" accept=".md,.markdown,.txt,text/markdown,text/plain"
          error={fileError} onChange={event => { void choose(event.target.files?.[0]); }} />
        <TextInput id={`${id}-note`} label="What changed? (optional)" hint="Shown to annotators and reviewers with the update notice." maxLength={280}
          value={note} onChange={event => setNote(event.target.value)} />
        {republishError !== undefined && <ErrorNotice error={republishError} />}
        {chosen && <>
          {/* The action bar sits above the preview and sticks to the top while a long preview scrolls (finding 9). */}
          <div className="guidelines-publish-bar">
            <div className="guidelines-publish-actions">
              <Button type="submit" variant="primary" loading={publishing}>Publish as v{nextVersion}</Button>
              <Button variant="quiet" aria-disabled={publishing || undefined} onClick={() => { if (!writing.current) discard(); }}>Discard</Button>
            </div>
            {publishError !== undefined && <ErrorNotice error={publishError} />}
          </div>
          <p className="guidelines-file-facts">{`${chosen.file.name} · ${formatSize(chosen.file.size)}`}</p>
          <div className="guidelines-facts">
            <p><strong>Will be published as v{nextVersion}.</strong></p>
            <p>Annotators and reviewers see a notice the next time they open a task.</p>
            <p>Earlier versions stay readable. Published versions cannot be changed; a version can only be withdrawn.</p>
          </div>
          <section ref={previewRef} className="guidelines-preview" aria-label={`Preview of ${chosen.file.name}`} tabIndex={0}>
            <GuidelineDocument kind={chosen.kind} body={chosen.text} headingOffset={2} />
          </section>
        </>}
      </form>

      {versions.length > 0 && <section className="guidelines-versions" aria-labelledby={`${id}-versions`}>
        <h2 id={`${id}-versions`}>Versions</h2>
        <DataTable label="Guideline versions" columns={columns} rows={versions} rowKey={item => String(item.version)} />
      </section>}

      {reading !== null && <section ref={readerRef} tabIndex={-1} className="guidelines-reading" aria-label={`Reading v${reading}`}>
        <GuidelineReader key={`${reading}-${generation}`} projectKey={projectKey} version={reading} currentVersion={current?.version ?? null} />
        <Button variant="quiet" onClick={() => setReading(null)}>Close the reading view</Button>
      </section>}
    </>}

    <Dialog open={target !== null} size="sm" title={`Withdraw v${withdrawTarget ?? ""}?`} onClose={closeWithdraw}
      footer={<>
        <Button variant="quiet" onClick={closeWithdraw} aria-disabled={withdrawing || undefined}>Cancel</Button>
        <Button variant="danger" loading={withdrawing} onClick={() => { void withdraw(); }}>Withdraw v{withdrawTarget}</Button>
      </>}>
      {target && <>
        <p>{`The text, file name and change note of v${target.version} are deleted and can no longer be read or exported. The version number, who published it and when stay; results made under v${target.version} keep showing “Guidelines v${target.version} (withdrawn)”. This cannot be undone.`}</p>
        {targetIsCurrent && <p>{previous
          ? `No guideline is in force until you publish a new version. v${previous.version} does not come back automatically.`
          : "No guideline is in force until you publish a new version."}</p>}
        <TextInput id={`${id}-reason`} label="Reason (optional)" hint="Shown instead of the change note. Do not repeat confidential content." maxLength={280}
          value={reason} onChange={event => setReason(event.target.value)} />
        {withdrawError !== undefined && <ErrorNotice error={withdrawError} />}
      </>}
    </Dialog>
  </div>;
}
