/**
 * Final-result side panel of the Documents page (documents overview spec "Final-result panel", V6,
 * V9 display, VD16, VD17): "Accept result…", "Compare results…" and "Review changes…" open it; it
 * decides (Use as final, Accept as final, Keep, Use the newer result) and then moves to the next
 * final decision of the list.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type DocumentRowView, type DocumentRowsPage, type FinalPanelSubmissionView, type NextStepView, type RowItemView } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { Time } from "../app/Time";
import { submissionGuidelineLabel } from "../guidelines/submissionLabel";
import { Button, Dialog, InlineMessage, type ButtonVariant } from "../ui";
import { ConsolidationLauncher } from "../variants/ConsolidationLauncher";
import { refKey } from "../variants/versionState";
import { failureOf, keepRequest, selectionPayload, selectRequest, type FinalConfirmFailure, type FinalConfirmRequest } from "./FinalConfirm";
import {
  acceptQuestion, AGREEMENT_EXPLANATION, agreementText, barArrows, changedPassagesText, compareSummary, consolidationInputs, decidedLine, decisionKind,
  keepLabel, listedSubmissions, nextFinalDecision, nextOtherDecision, onlyHereText, panelMode, panelStep, panelTitle, personName, savedText,
  submissionLine, submissionWhen, textChangedLine, type NextRow,
} from "./finalPanelText";
import { versionName } from "./labels";
import { submissionVersion } from "./SubmissionsTable";
import { isPlainClick, rowKeyOf, rowName } from "./RowCells";
import { acknowledgeableItems, causeLines, notAcceptedLines, OWN_RESULT_REASON, waitingLines } from "./SelectionNotice";
import { useFinalPanel, type FinalPanelData } from "./useFinalPanel";
import { caseOfTextKey, languageOfTextKey } from "./useTextSelection";

export type PanelSection = "history" | "versions" | "technical";

export interface FinalPanelProps {
  projectKey: string;
  /** Row shown in the panel, "{case}:{language}" (route parameter `panel`). */
  rowKey: string;
  /** Current rows page: the row, the project rule and the list order for the advance (VD17). */
  page: DocumentRowsPage | null;
  /** Current Documents query; editor links keep it (with `panel`) so Back returns to the panel. */
  query: ProjectDocumentsQuery;
  /** Error of the latest rows reload (a new object per failed reload); a save waits for the reload or its failure. */
  refreshError?: unknown;
  /** Open on the compare content even when the row has a final ("Change final…"). */
  changeFinal?: boolean;
  onClose: () => void;
  /** A decision was saved: the page records it and reloads the rows. */
  onDecided: (rowKey: string) => void;
  /** Show another row in the panel (VD17). */
  onAdvance: (rowKey: string) => void;
  /** "Review again": reload the rows (the panel reloads its own data with them). */
  onReload: () => void;
  onNavigate: (route: Route) => void;
  /** "Next decision: … (kind)": closes the panel and runs that row's action. */
  onRowAction?: (row: DocumentRowView, step: NextStepView) => void;
  /** "Assign annotation review…". */
  onAssign?: (row: DocumentRowView) => void;
  /** "Carry to v2…" with the final's submission, to the corrected version `targetDocumentId`. */
  onCarry?: (row: DocumentRowView, targetDocumentId: string) => void;
  /** Footer links: open that part of the row's expansion and close the panel. */
  onSection?: (row: DocumentRowView, section: PanelSection) => void;
  /** A consolidation was started from the panel: the panel closes. */
  onConsolidationStarted?: (row: DocumentRowView) => void;
  /** Focus target when the panel closes (the shown row's action); default: the element focused before it opened. */
  returnFocus?: () => HTMLElement | null;
  /** Signed-in username (consolidation launcher). */
  username?: string;
  now?: Date;
}


interface Success { text: string; bar: string }
interface Pending { rowKey: string; before: DocumentRowsPage }

/** Polite announcements inside the panel (the page's region is `inert` while the panel is open). */
function useAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const announce = (text: string) => {
    window.clearTimeout(timer.current);
    setMessage("");
    timer.current = window.setTimeout(() => setMessage(text), 0);
  };
  return { message, announce };
}

export function FinalPanel(props: FinalPanelProps): JSX.Element {
  const { projectKey, rowKey, page, refreshError = null, onClose, onDecided, onAdvance, onReload } = props;
  const caseId = caseOfTextKey(rowKey);
  const language = languageOfTextKey(rowKey);
  const state = useFinalPanel(projectKey, caseId, language, page);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { message, announce } = useAnnouncer();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<FinalConfirmFailure | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const [noneLeft, setNoneLeft] = useState<{ other: NextRow | null } | null>(null);
  const [focusHeading, setFocusHeading] = useState(0);
  const pending = useRef<Pending | null>(null);
  const lastRequest = useRef<{ request: FinalConfirmRequest; triggerId: string } | null>(null);
  const row = page?.groups.flatMap(group => group.rows).find(entry => rowKeyOf(entry) === rowKey) ?? null;

  // A new rows page after a save: the success line, then the next final decision or "none left".
  useEffect(() => {
    const saved = pending.current;
    if (!saved || !page || page === saved.before) return;
    pending.current = null;
    setBusy(null);
    setSuccess({ text: savedText(caseOfTextKey(saved.rowKey), languageOfTextKey(saved.rowKey)), bar: barArrows(saved.before.bar, page.bar) });
    const next = nextFinalDecision(page, saved.rowKey);
    if (next) {
      announce(`Final result saved. Next: ${rowName(next.row)}.`);
      onAdvance(rowKeyOf(next.row));
    } else {
      announce("Final result saved. No more final results to decide.");
      setNoneLeft({ other: nextOtherDecision(page, saved.rowKey) });
    }
    setFocusHeading(value => value + 1);
    // Only a new page completes a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Another row (advance or a new panel target): "none left" belonged to the previous row.
  const shownKey = useRef(rowKey);
  useEffect(() => {
    if (shownKey.current === rowKey) return;
    shownKey.current = rowKey;
    setNoneLeft(null);
  }, [rowKey]);

  // A save whose reload failed (each failed reload is a new error object): report it and stay on this row.
  useEffect(() => {
    const saved = pending.current;
    if (refreshError == null || !saved) return;
    pending.current = null;
    setBusy(null);
    const text = `${savedText(caseOfTextKey(saved.rowKey), languageOfTextKey(saved.rowKey))} The list could not be refreshed.`;
    setSuccess({ text, bar: "" });
    announce(text);
    setFocusHeading(value => value + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshError]);

  useEffect(() => {
    if (!focusHeading) return;
    bodyRef.current?.closest(".ui-dialog")?.querySelector<HTMLElement>(".ui-dialog-heading")?.focus();
  }, [focusHeading]);

  const save = (request: FinalConfirmRequest, triggerId: string) => {
    if (busy || !page) return;
    lastRequest.current = { request, triggerId };
    setBusy(triggerId);
    setFailure(null);
    setSuccess(null);
    const before = page;
    api.selectFinalResult(projectKey, selectionPayload(request)).then(() => {
      pending.current = { rowKey: request.rowKey, before };
      onDecided(request.rowKey);
    }, error => {
      setBusy(null);
      setFailure(failureOf(error));
    });
  };
  const retry = () => { if (lastRequest.current) save(lastRequest.current.request, lastRequest.current.triggerId); };
  const reviewAgain = () => {
    setFailure(null);
    state.reload();
    onReload();
    setFocusHeading(value => value + 1);
  };
  const close = () => { if (!busy) onClose(); };

  let content: ReactNode;
  if (noneLeft) {
    content = <NoneLeft other={noneLeft.other} onRowAction={props.onRowAction} onClose={close} />;
  } else if (!page || (!state.data && state.loading)) {
    content = <p className="cell-secondary">Loading submissions…</p>;
  } else if (!row) {
    content = <p>{`${caseId} · ${language} is not in this list.`}</p>;
  } else if (!state.data) {
    content = <InlineMessage tone="error">Could not load submissions. <Button size="sm" onClick={reviewAgain}>Review again</Button></InlineMessage>;
  } else {
    content = <PanelContent {...props} row={row} data={state.data} guidelineCurrent={state.guidelineCurrent} page={page}
      busy={busy} onSave={save} onAnnounce={announce} />;
  }

  return <Dialog open variant="side" title={panelTitle(caseId, language)} onClose={close} returnFocus={props.returnFocus}>
    <div ref={bodyRef} className="final-panel">
      <p className="visually-hidden" role="status" aria-live="polite">{message}</p>
      {success && <div className="notice notice-success final-panel-success">
        <div className="notice-content"><p>{success.text}</p>{success.bar && <p>{success.bar}</p>}</div>
      </div>}
      {failure && <FailureNotice failure={failure} onReview={reviewAgain} onRetry={retry} busy={busy !== null} />}
      {content}
    </div>
  </Dialog>;
}

function FailureNotice({ failure: shown, onReview, onRetry, busy: saving }: { failure: FinalConfirmFailure; onReview: () => void; onRetry: () => void; busy: boolean }): JSX.Element {
  if (shown.kind === "conflict") {
    return <div className="inline-confirm-notice" role="alert">
      <p>{shown.ownResult ? `${OWN_RESULT_REASON} Nothing was saved.` : "This final result changed."}</p>
      <Button size="sm" onClick={onReview}>Review again</Button>
    </div>;
  }
  if (shown.kind === "session") return <p className="inline-confirm-notice" role="alert">Your session ended. Nothing was saved. Sign in and confirm again.</p>;
  return <div className="inline-confirm-notice" role="alert">
    <p>Could not save. Nothing changed.</p>
    <Button size="sm" aria-disabled={saving || undefined} onClick={() => { if (!saving) onRetry(); }}>Retry</Button>
  </div>;
}

function NoneLeft({ other, onRowAction, onClose }: { other: NextRow | null; onRowAction?: FinalPanelProps["onRowAction"]; onClose: () => void }): JSX.Element {
  return <div className="final-panel-none">
    <p>No more final results to decide.</p>
    {other && onRowAction && <p><Button variant="quiet" onClick={() => onRowAction(other.row, other.step)}>
      {`Next decision: ${rowName(other.row)} (${decisionKind(other.step)})`}
    </Button></p>}
    <Button onClick={onClose}>Close</Button>
  </div>;
}

interface ContentProps extends FinalPanelProps {
  row: DocumentRowView;
  page: DocumentRowsPage;
  data: FinalPanelData;
  guidelineCurrent: number | null;
  /** Id of the choice whose save is in flight; every choice is unavailable meanwhile. */
  busy: string | null;
  onSave: (request: FinalConfirmRequest, triggerId: string) => void;
  onAnnounce: (message: string) => void;
}

/** A decision button: `aria-disabled` while a save runs or the rule blocks it (with the reason), never native `disabled`. */
function ChoiceButton({ id, label, variant = "secondary", blocked, busy, describedBy, onChoose, onAnnounce }: {
  id: string; label: string; variant?: ButtonVariant; blocked: boolean; busy: string | null; describedBy?: string;
  onChoose: () => void; onAnnounce: (message: string) => void;
}): JSX.Element {
  const reasonId = `${id}-reason`;
  return <>
    <Button id={id} size="sm" variant={variant} loading={busy === id}
      aria-disabled={blocked || (busy !== null && busy !== id) ? true : undefined}
      aria-describedby={[describedBy, blocked ? reasonId : ""].filter(Boolean).join(" ") || undefined}
      onClick={() => {
        if (blocked) { onAnnounce(OWN_RESULT_REASON); return; }
        if (busy !== null) return;
        onChoose();
      }}>{label}</Button>
    {blocked && <span id={reasonId} className="action-reason">{OWN_RESULT_REASON}</span>}
  </>;
}

function PanelContent(props: ContentProps): JSX.Element {
  const { row, data, changeFinal = false } = props;
  const mode = panelMode(row);
  const [compareAll, setCompareAll] = useState(changeFinal);
  if (mode === "review" && row.final) return <ReviewContent {...props} />;
  // A decided row without a final decision (Done, or reopened after a save): its final and "Change final…".
  if (row.final && !panelStep(row) && !compareAll) return <DecidedContent {...props} onChange={() => setCompareAll(true)} />;
  const accept = data.panel.label_rule === "accept" && !compareAll
    ? data.panel.submissions?.find(item => item.submission_id === data.panel.accept_submission_id) ?? null : null;
  if (accept) return <AcceptContent {...props} submission={accept} onCompareAll={() => setCompareAll(true)} />;
  return <CompareContent {...props} />;
}

function useEditorRoute(props: ContentProps) {
  const { projectKey, row, query, onNavigate } = props;
  const route = (documentId: string, submissionId?: string): Route => ({
    name: "projectCase", key: projectKey, caseId: row.case_id, variant: documentId,
    ...(submissionId ? { annotations: refKey({ kind: "submission", id: submissionId }) } : {}),
    ...(Object.keys(query).length ? { documents: query } : {}),
  });
  const link = (target: Route, text: string, label?: string) => <a href={routeHref(target)} aria-label={label} onClick={event => {
    if (!isPlainClick(event)) return;
    event.preventDefault(); onNavigate(target);
  }}>{text}</a>;
  return { route, link };
}

/** Documents with at least two listed submissions (consolidation inputs). */
function consolidationDocuments(submissions: readonly FinalPanelSubmissionView[]): string[] {
  return [...new Set(submissions.map(item => item.document_id))].filter(documentId => submissions.filter(item => item.document_id === documentId).length >= 2);
}

function AcceptContent(props: ContentProps & { submission: FinalPanelSubmissionView; onCompareAll: () => void }): JSX.Element {
  const { row, data, submission, busy, onSave, onAnnounce, onAssign, onClose, guidelineCurrent, now } = props;
  const id = useId();
  const { route, link } = useEditorRoute(props);
  const listed = listedSubmissions(data.panel.submissions ?? []);
  const triggerId = `${id}-accept`;
  const isFinal = row.final?.submission_id === submission.submission_id;
  const compared = listed.filter(item => item.comparable).length || listed.length;
  return <div className="final-panel-choose">
    <p className="final-panel-question">{acceptQuestion(submission)}</p>
    <p className="cell-secondary">
      {submissionLine(submission, row.language, row.parallel_roots, now)}{" · "}
      {link(route(submission.document_id, submission.submission_id), "Open in editor")}
    </p>
    <p className="cell-secondary">{submissionGuidelineLabel(submission.guideline_version, submission.guideline_withdrawn, guidelineCurrent)}</p>
    <div className="final-panel-actions">
      {!isFinal && <ChoiceButton id={triggerId} label="Accept as final" variant="primary" blocked={!submission.eligible} busy={busy} onAnnounce={onAnnounce}
        onChoose={() => onSave(selectRequest(row, data.submissions, submission, triggerId), triggerId)} />}
      <Button size="sm" variant="quiet" onClick={() => { if (!busy) onClose(); }}>Cancel</Button>
    </div>
    <div className="final-panel-links">
      {onAssign && <Button size="sm" variant="quiet" onClick={() => onAssign(row)}>Assign annotation review…</Button>}
      {submission.kind === "consolidation" && compared > 1 && <Button size="sm" variant="quiet" onClick={props.onCompareAll}>{`Compare all ${compared}…`}</Button>}
    </div>
    <Consolidate {...props} listed={listed} withHint={false} />
    <SectionLinks {...props} />
  </div>;
}

function DecidedContent(props: ContentProps & { onChange: () => void }): JSX.Element {
  const { row, data, onAssign, onClose, guidelineCurrent, now, busy } = props;
  const { route, link } = useEditorRoute(props);
  const final = (data.panel.submissions ?? []).find(item => item.submission_id === row.final?.submission_id) ?? null;
  const listed = listedSubmissions(data.panel.submissions ?? []);
  return <div className="final-panel-decided">
    <p className="final-panel-question">{final ? decidedLine(final) : "Final result chosen"}</p>
    {final && <>
      <p className="cell-secondary">
        {submissionLine(final, row.language, row.parallel_roots, now)}{" · "}
        {link(route(final.document_id, final.submission_id), "Open in editor")}
      </p>
      <p className="cell-secondary">{submissionGuidelineLabel(final.guideline_version, final.guideline_withdrawn, guidelineCurrent)}</p>
    </>}
    <div className="final-panel-actions">
      {listed.length > 1 && <Button size="sm" onClick={props.onChange}>Change final…</Button>}
      <Button size="sm" variant="quiet" onClick={() => { if (!busy) onClose(); }}>Close</Button>
    </div>
    {onAssign && <div className="final-panel-links">
      <Button size="sm" variant="quiet" onClick={() => onAssign(row)}>Assign annotation review…</Button>
    </div>}
    <SectionLinks {...props} />
  </div>;
}

/** The compared submissions first; the others grouped by version ("On v1 (old text)"). */
function compareGroups(listed: readonly FinalPanelSubmissionView[], parallel: boolean): { label: string | null; items: FinalPanelSubmissionView[] }[] {
  const current = listed.filter(item => item.comparable);
  if (!current.length || current.length === listed.length) return [{ label: null, items: [...listed] }];
  const newest = Math.max(...current.map(item => item.version));
  const others = new Map<string, FinalPanelSubmissionView[]>();
  for (const item of listed.filter(entry => !entry.comparable)) {
    const name = submissionVersion(item.version, item.chain_name, parallel);
    others.set(name, [...(others.get(name) ?? []), item]);
  }
  return [{ label: null, items: current }, ...[...others].map(([name, items]) => ({
    label: items.every(item => item.version < newest) ? `On ${name} (old text)` : `On ${name} · not compared`, items,
  }))];
}

function CompareContent(props: ContentProps): JSX.Element {
  const { row, data, busy, onSave, onAnnounce, guidelineCurrent, now } = props;
  const id = useId();
  const [explain, setExplain] = useState(false);
  const { route, link } = useEditorRoute(props);
  const listed = listedSubmissions(data.panel.submissions ?? []);
  const agreement = data.panel.agreement ?? null;
  const explanationId = `${id}-explanation`;
  return <div className="final-panel-compare">
    <p>{compareSummary(listed, agreement)}</p>
    {agreement && <div className="final-panel-agreement">
      <p>{agreementText(agreement)}</p>
      <meter aria-hidden="true" className="final-panel-agreement-bar" min={0} max={Math.max(agreement.total, 1)} value={agreement.matching} />
      <Button size="sm" variant="quiet" aria-expanded={explain} aria-controls={explanationId} onClick={() => setExplain(value => !value)}>How is this counted?</Button>
      {explain && <p id={explanationId} className="cell-secondary">{AGREEMENT_EXPLANATION}</p>}
    </div>}
    <table className="data-table density-compact final-panel-table">
      <caption className="visually-hidden">{`Submissions, ${rowName(row)}`}</caption>
      <thead><tr>
        <th scope="col">Submission</th><th scope="col">Findings</th><th scope="col">Only here</th>
        <th scope="col"><span className="visually-hidden">Actions</span></th>
      </tr></thead>
      {compareGroups(listed, row.parallel_roots).map(({ label, items }) => <tbody key={label ?? "compared"}>
        {label && <tr className="final-panel-table-group"><th scope="colgroup" colSpan={4}>{label}</th></tr>}
        {items.map(submission => {
        const nameId = `${id}-${encodeURIComponent(submission.submission_id)}-name`;
        const triggerId = `${id}-${encodeURIComponent(submission.submission_id)}-use`;
        const isFinal = row.final?.submission_id === submission.submission_id;
        return <tr key={submission.submission_id} className={isFinal ? "final-row" : undefined}>
          <th scope="row" id={nameId}>
            {personName(submission)}
            <div className="cell-secondary">{submissionWhen(submission, now)}</div>
            <div className="cell-secondary">{submissionGuidelineLabel(submission.guideline_version, submission.guideline_withdrawn, guidelineCurrent)}</div>
          </th>
          <td>{submission.finding_count}</td>
          <td>{onlyHereText(submission, row.parallel_roots)}</td>
          <td className="final-panel-row-actions">
            {link(route(submission.document_id, submission.submission_id), "Open in editor", `Open in editor, ${personName(submission)}`)}
            {" "}
            {isFinal ? <span>Final</span> : <ChoiceButton id={triggerId} label="Use as final" blocked={!submission.eligible} busy={busy} describedBy={nameId}
              onAnnounce={onAnnounce} onChoose={() => onSave(selectRequest(row, data.submissions, submission, triggerId), triggerId)} />}
          </td>
        </tr>;
      })}</tbody>)}
    </table>
    <Consolidate {...props} listed={listed} withHint />
    <SectionLinks {...props} />
  </div>;
}

/** "Consolidate…": the existing launcher inside the panel; a started consolidation closes the panel. */
function Consolidate(props: ContentProps & { listed: FinalPanelSubmissionView[]; withHint: boolean }): JSX.Element | null {
  const { row, projectKey, listed, withHint, username = "", data, onConsolidationStarted, now } = props;
  const [open, setOpen] = useState(false);
  const documents = consolidationDocuments(listed);
  const compared = listed.find(item => item.comparable)?.document_id;
  const documentId = compared && documents.includes(compared) ? compared : documents[0];
  if (!documentId) return null;
  const rows = consolidationInputs((data.panel.submissions ?? []).filter(item => item.document_id === documentId), now);
  // Preselected: the listed (latest per round) submissions on that text, the ones the panel compares.
  const preselected = listed.filter(item => item.document_id === documentId).map(item => item.submission_id);
  return <div className="final-panel-consolidate">
    {!open && <p>
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>Consolidate…</Button>
      {withHint && <span className="cell-secondary"> merge both into a new final (you or someone else)</span>}
    </p>}
    {open && <ConsolidationLauncher projectKey={projectKey} documentId={documentId} language={row.language} username={username} rows={rows} defaultOpen
      defaultSelected={preselected} onStarted={() => onConsolidationStarted?.(row)} />}
  </div>;
}

function SectionLinks({ row, onSection }: ContentProps): JSX.Element | null {
  if (!onSection) return null;
  return <p className="final-panel-sections">
    <Button size="sm" variant="quiet" onClick={() => onSection(row, "history")}>History</Button>{" · "}
    <Button size="sm" variant="quiet" onClick={() => onSection(row, "versions")}>Text versions</Button>{" · "}
    <Button size="sm" variant="quiet" onClick={() => onSection(row, "technical")}>Technical details</Button>
  </p>;
}

const suffixOf = (item: RowItemView): string => (item.cause_id.startsWith(`${item.code}:`) ? item.cause_id.slice(item.code.length + 1) : item.cause_id);

function ReviewContent(props: ContentProps): JSX.Element {
  const { row, data, page, busy, onSave, onAnnounce, onCarry, now } = props;
  const id = useId();
  const { route, link } = useEditorRoute(props);
  const final = row.final!;
  const causes = acknowledgeableItems(row);
  const lines = causeLines(row, data.submissions, now);
  const waiting = waitingLines(row, data.submissions);
  const corrected = causes.find(item => item.code === "SELECTED_TEXT_CORRECTED");
  const newerCause = causes.find(item => item.code === "SELECTED_NEWER_RESULT");
  const newer = newerCause ? (data.panel.submissions ?? []).find(item => item.submission_id === suffixOf(newerCause)) ?? null : null;
  const onlyTextChange = causes.length > 0 && causes.every(item => item.code === "SELECTED_TEXT_CORRECTED");
  const finalName = versionName(final.version ?? 1, final.chain_name ?? "", row.parallel_roots);
  const correctedVersion = corrected ? row.versions.find(version => version.document_id === corrected.document_id) : undefined;
  const correctedName = corrected ? versionName(corrected.version ?? correctedVersion?.version ?? 0, correctedVersion?.chain_name ?? "", row.parallel_roots) : "";
  const ownBlocked = page.adjudicator_not_annotator && final.is_mine;
  const keepId = `${id}-keep`;
  const newerId = `${id}-newer`;
  return <div className="final-panel-review">
    <ul className="selection-notice-lines">
      {lines.map(line => <li key={line.causeId}>
        {line.segments.map((part, index) => (typeof part === "string" ? part : <Time key={index} iso={part.time} now={now} />))}
        {line.hint && <span className="selection-notice-hint">{line.hint}</span>}
      </li>)}
      {notAcceptedLines(row).map(line => <li key={line.key}>{line.text}</li>)}
      {waiting.map(line => <li key={line} className="selection-notice-waiting">{line}</li>)}
    </ul>
    {corrected && <div className="final-panel-text-change">
      <p>{textChangedLine(finalName, correctedName)}</p>
      <p className="cell-secondary">
        {corrected.document_id && link(route(corrected.document_id), "Show changes")}
        {data.panel.changed_passages != null && <>{" · "}{changedPassagesText(data.panel.changed_passages)}</>}
      </p>
    </div>}
    <div className="final-panel-actions">
      <ChoiceButton id={keepId} label={keepLabel(row)} variant={onlyTextChange ? "primary" : "secondary"} blocked={ownBlocked} busy={busy} onAnnounce={onAnnounce}
        onChoose={() => onSave(keepRequest(row, data.submissions, causes.map(item => item.cause_id), keepId), keepId)} />
      {corrected?.document_id && onCarry && <Button size="sm" aria-disabled={busy !== null || undefined} onClick={() => { if (busy === null && corrected.document_id) onCarry(row, corrected.document_id); }}>{`Carry to ${correctedName}…`}</Button>}
      {newer && <ChoiceButton id={newerId} label="Use the newer result" blocked={!newer.eligible} busy={busy} onAnnounce={onAnnounce}
        onChoose={() => onSave(selectRequest(row, data.submissions, newer, newerId), newerId)} />}
    </div>
    <SectionLinks {...props} />
  </div>;
}
