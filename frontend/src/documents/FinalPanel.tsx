/**
 * Decision block of the row panel (acceptance fixes WP-A, WP-B; documents overview spec "Final-result panel",
 * V6, V9 display, VD16, VD17): "Accept result…", "Compare results…" and "Review changes…" open the
 * panel with this block on top; it decides (Use as final, Accept result, Keep, Use the newer result)
 * and then moves the panel to the next final decision of the list. Full agreement (W1) is one "Accept
 * result…"; "Consolidate…" exists only with at least two eligible submissions on one text.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type WorkRoundView, type DocumentRowView, type DocumentRowsPage, type FinalPanelSubmissionView, type NextStepView, type RowItemView } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { Time } from "../app/Time";
import { submissionGuidelineLabel } from "../guidelines/submissionLabel";
import { Button, InlineMessage, type ButtonVariant } from "../ui";
import { InlineConfirm } from "../ui/InlineConfirm";
import { onSpaceActivate } from "../ui/spaceActivates";
import { ConsolidationLauncher, type ConsolidationStarted } from "../variants/ConsolidationLauncher";
import { refKey } from "../variants/versionState";
import { failureOf, keepRequest, selectionPayload, selectRequest, type FinalConfirmFailure, type FinalConfirmRequest } from "./FinalConfirm";
import {
  acceptQuestion, AGREEMENT_EXPLANATION, agreementText, allMatchQuestion, allMatchText, barArrows, changedPassagesText, compareSummary, consolidateHint,
  consolidationInputs, decidedLine, decisionKind, keepLabel, listedSubmissions, nextFinalDecision, nextOtherDecision, onlyHereText, panelMode, panelStep,
  personName, savedText, submissionLine, submissionName, submissionWhen, textChangedLine, type NextRow,
} from "./finalPanelText";
import { versionName } from "./labels";
import { submissionVersion } from "./SubmissionsTable";
import { isPlainClick, rowKeyOf, rowName } from "./RowCells";
import { acknowledgeableItems, causeLines, notAcceptedLines, OWN_RESULT_REASON, waitingLines } from "./SelectionNotice";
import { useFinalPanel, type FinalPanelData } from "./useFinalPanel";
import { caseOfTextKey, languageOfTextKey } from "./useTextSelection";

export interface DecisionBlockProps {
  projectKey: string;
  /** Row shown in the row panel, "{case}:{language}" (route parameter `panel`). */
  rowKey: string;
  /** Current rows page: the row, the project rule and the list order for the advance (VD17). */
  page: DocumentRowsPage | null;
  /** Current Documents query; editor links keep it (with `panel`) so Back returns to the panel. */
  query: ProjectDocumentsQuery;
  /** Error of the latest rows reload (a new object per failed reload); a save waits for the reload or its failure. */
  refreshError?: unknown;
  /** Open on the compare content even when the row has a final ("Change final…"). */
  changeFinal?: boolean;
  /** "Close" after the last final decision: closes the row panel. */
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
  /** "Carry to v2…" with the final's submission, to the corrected version `targetDocumentId`. */
  onCarry?: (row: DocumentRowView, targetDocumentId: string) => void;
  /** A consolidation was started from the block. */
  onConsolidationStarted?: (row: DocumentRowView, round: WorkRoundView, started: ConsolidationStarted) => void;
  /** Moves focus to the row panel's heading (after a save or "Review again"). */
  onFocusHeading?: () => void;
  /**
   * A row without a final decision step: the block shows only "Consolidate…", and only once its data lists at
   * least two eligible submissions on one text version, else nothing (no choice of a final here).
   */
  optional?: boolean;
  /** The block holds input that a row switch would discard (the consolidation launcher is open). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Signed-in username (consolidation launcher). */
  username?: string;
  now?: Date;
}


interface Success { text: string; bar: string }
interface Pending { rowKey: string; before: DocumentRowsPage }

/** Polite announcements of the block (saves and their outcome). */
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

export function DecisionBlock(props: DecisionBlockProps): JSX.Element | null {
  const { projectKey, rowKey, page, refreshError = null, onClose, onDecided, onAdvance, onReload } = props;
  const caseId = caseOfTextKey(rowKey);
  const language = languageOfTextKey(rowKey);
  const state = useFinalPanel(projectKey, caseId, language, page);
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
    props.onFocusHeading?.();
    // Only a new request moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const headingId = useId();
  const consolidable = state.data ? consolidationDocuments(listedSubmissions(state.data.panel.submissions ?? [])).length > 0 : false;
  const optionalOnly = props.optional && !noneLeft && !success && !failure;
  if (props.optional && !consolidable && !noneLeft && !success && !failure) return null;

  let content: ReactNode;
  if (noneLeft) {
    content = <NoneLeft other={noneLeft.other} onRowAction={props.onRowAction} onClose={close} />;
  } else if (!page || (!state.data && state.loading)) {
    content = <p className="cell-secondary">Loading submissions…</p>;
  } else if (!row) {
    content = <p>{`${caseId} ${language} is not in this list.`}</p>;
  } else if (!state.data) {
    content = <InlineMessage tone="error">Could not load submissions. <Button size="sm" onClick={reviewAgain}>Review again</Button></InlineMessage>;
  } else if (optionalOnly) {
    const contentProps: ContentProps = { ...props, row, data: state.data, guidelineCurrent: state.guidelineCurrent, page, busy, onSave: save, onAnnounce: announce };
    content = <Consolidate {...contentProps} listed={listedSubmissions(state.data.panel.submissions ?? [])} primary={false} />;
  } else {
    content = <PanelContent {...props} row={row} data={state.data} guidelineCurrent={state.guidelineCurrent} page={page}
      busy={busy} onSave={save} onAnnounce={announce} />;
  }

  return <section className="final-panel text-card-decision" aria-labelledby={headingId}>
    <h3 id={headingId} className="text-card-decision-title">Final result</h3>
    <p className="visually-hidden" role="status" aria-live="polite">{message}</p>
    {success && <div className="notice notice-success final-panel-success">
      <div className="notice-content"><p>{success.text}</p>{success.bar && <p>{success.bar}</p>}</div>
    </div>}
    {failure && <FailureNotice failure={failure} onReview={reviewAgain} onRetry={retry} busy={busy !== null} />}
    {content}
  </section>;
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

function NoneLeft({ other, onRowAction, onClose }: { other: NextRow | null; onRowAction?: DecisionBlockProps["onRowAction"]; onClose: () => void }): JSX.Element {
  return <div className="final-panel-none">
    <p>No more final results to decide.</p>
    {other && onRowAction && <p><Button onClick={() => onRowAction(other.row, other.step)}>
      {`Next decision: ${rowName(other.row)} (${decisionKind(other.step)})`}
    </Button></p>}
    <Button onClick={onClose}>Close</Button>
  </div>;
}

interface ContentProps extends DecisionBlockProps {
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
  // W1 (U7): full agreement of the compared eligible submissions, no consolidation among them (X4).
  const listed = listedSubmissions(data.panel.submissions ?? []);
  const allMatch = data.panel.all_match && !compareAll && !row.final && !listed.some(item => item.kind === "consolidation")
    ? listed.find(item => item.submission_id === data.panel.all_match_submission_id) ?? null : null;
  if (allMatch) return <AllMatchContent {...props} submission={allMatch} />;
  return <CompareContent {...props} />;
}

/** W1: "All findings match (2 of 2)", one primary "Accept result…" with a confirmation; the table under "Show submissions". */
function AllMatchContent(props: ContentProps & { submission: FinalPanelSubmissionView }): JSX.Element {
  const { row, data, submission, busy, onSave, onAnnounce, onDirtyChange } = props;
  const id = useId();
  const [confirming, setConfirming] = useConfirming(onDirtyChange);
  const [show, setShow] = useState(false);
  const { route, link } = useEditorRoute(props);
  const listed = listedSubmissions(data.panel.submissions ?? []);
  const compared = listed.filter(item => item.comparable).length || listed.length;
  const findings = data.panel.agreement?.total ?? submission.finding_count;
  const triggerId = `${id}-accept`;
  const tableId = `${id}-submissions`;
  return <div className="final-panel-match">
    <p className="final-panel-question">{allMatchText(compared, findings)}</p>
    {!confirming && <div className="final-panel-actions">
      <ChoiceButton id={triggerId} label="Accept result…" variant="primary" blocked={!submission.eligible} busy={busy} onAnnounce={onAnnounce}
        onChoose={() => setConfirming(true)} />
    </div>}
    {confirming && <InlineConfirm title="Accept result?" headingLevel={4} message={allMatchQuestion(compared)} confirmLabel="Accept result"
      busy={busy !== null} onCancel={() => setConfirming(false)}
      onConfirm={() => { if (busy === null) onSave(selectRequest(row, data.submissions, submission, triggerId), triggerId); }}>
      <p>{link(route(submission.document_id, submission.submission_id), "Open result")}</p>
    </InlineConfirm>}
    <p><Button size="sm" variant="quiet" className="btn-link" aria-expanded={show} aria-controls={tableId} onClick={() => setShow(value => !value)}>Show submissions</Button></p>
    {show && <div id={tableId}><SubmissionTable {...props} listed={listed} /></div>}
  </div>;
}

/** An open "Accept result?" confirmation counts as unsaved work (onDirtyChange). */
function useConfirming(onDirtyChange: ContentProps["onDirtyChange"]): [boolean, (value: boolean) => void] {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    onDirtyChange?.(true);
    return () => onDirtyChange?.(false);
    // Only the confirmation's open state counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming]);
  return [confirming, setConfirming];
}

function useEditorRoute(props: ContentProps) {
  const { projectKey, row, query, onNavigate } = props;
  const route = (documentId: string, submissionId?: string): Route => ({
    name: "projectCase", key: projectKey, caseId: row.case_id, variant: documentId,
    ...(submissionId ? { annotations: refKey({ kind: "submission", id: submissionId }) } : {}),
    ...(Object.keys(query).length ? { documents: query } : {}),
  });
  // Commands ("Open in editor", "Open result") look like buttons; `info` keeps a text link for views that only show information.
  const link = (target: Route, text: string, label?: string, info = false) => <a className={info ? undefined : "btn btn-secondary btn-sm"} href={routeHref(target)} aria-label={label} onKeyDown={info ? undefined : onSpaceActivate} onClick={event => {
    if (!isPlainClick(event)) return;
    event.preventDefault(); onNavigate(target);
  }}>{text}</a>;
  return { route, link };
}

/**
 * Documents with at least two listed **eligible** submissions (consolidation inputs; acceptance fixes WP-B):
 * a submission the lead may not use (own result, the en-source case) does not make a text consolidable.
 */
function consolidationDocuments(submissions: readonly FinalPanelSubmissionView[]): string[] {
  const eligible = submissions.filter(item => item.eligible);
  return [...new Set(eligible.map(item => item.document_id))].filter(documentId => eligible.filter(item => item.document_id === documentId).length >= 2);
}

/** Does the row hold a preselected or chosen result (then "Consolidate…" is secondary)? */
function preselectedOf(row: DocumentRowView, data: FinalPanelData): boolean {
  return row.final != null || (data.panel.label_rule === "accept" && data.panel.accept_submission_id != null);
}

function AcceptContent(props: ContentProps & { submission: FinalPanelSubmissionView; onCompareAll: () => void }): JSX.Element {
  const { row, data, submission, busy, onSave, onAnnounce, onDirtyChange, guidelineCurrent, now } = props;
  const id = useId();
  const [confirming, setConfirming] = useConfirming(onDirtyChange);
  const { route, link } = useEditorRoute(props);
  const listed = listedSubmissions(data.panel.submissions ?? []);
  const triggerId = `${id}-accept`;
  const isFinal = row.final?.submission_id === submission.submission_id;
  const compared = listed.filter(item => item.comparable).length || listed.length;
  const consolidation = submission.kind === "consolidation" && submission.round_id
    ? { name: "projectConsolidation" as const, key: props.projectKey, roundId: submission.round_id,
      ...(Object.keys(props.query).length ? { documents: props.query } : {}) } : null;
  return <div className="final-panel-choose">
    {submission.kind === "consolidation" && <p className="final-panel-consolidated"><strong>{submissionName(submission)}</strong></p>}
    <p className="final-panel-question">{acceptQuestion(submission)}</p>
    <p className="cell-secondary">
      {submissionLine(submission, row.language, row.parallel_roots, now)}{", "}
      {link(route(submission.document_id, submission.submission_id), "Open in editor")}
      {consolidation && <>{", "}{link(consolidation, "Open consolidation")}</>}
    </p>
    <p className="cell-secondary">{submissionGuidelineLabel(submission.guideline_version, submission.guideline_withdrawn, guidelineCurrent)}</p>
    {!isFinal && !confirming && <div className="final-panel-actions">
      <ChoiceButton id={triggerId} label="Accept result…" variant="primary" blocked={!submission.eligible} busy={busy} onAnnounce={onAnnounce}
        onChoose={() => setConfirming(true)} />
    </div>}
    {!isFinal && confirming && <InlineConfirm title="Accept result?" headingLevel={4} message={acceptQuestion(submission)} confirmLabel="Accept result"
      busy={busy !== null} onCancel={() => setConfirming(false)}
      onConfirm={() => { if (busy === null) onSave(selectRequest(row, data.submissions, submission, triggerId), triggerId); }} />}
    <div className="final-panel-links">
      {submission.kind === "consolidation" && compared > 1 && <Button size="sm" onClick={props.onCompareAll}>{`Compare all ${compared}…`}</Button>}
    </div>
    <Consolidate {...props} listed={listed} primary={false} />
  </div>;
}

function DecidedContent(props: ContentProps & { onChange: () => void }): JSX.Element {
  const { row, data, guidelineCurrent, now } = props;
  const { route, link } = useEditorRoute(props);
  const final = (data.panel.submissions ?? []).find(item => item.submission_id === row.final?.submission_id) ?? null;
  const listed = listedSubmissions(data.panel.submissions ?? []);
  return <div className="final-panel-decided">
    <p className="final-panel-question">{final ? decidedLine(final) : "Final result chosen"}</p>
    {final && <>
      <p className="cell-secondary">
        {submissionLine(final, row.language, row.parallel_roots, now)}{", "}
        {link(route(final.document_id, final.submission_id), "Open in editor")}
      </p>
      <p className="cell-secondary">{submissionGuidelineLabel(final.guideline_version, final.guideline_withdrawn, guidelineCurrent)}</p>
    </>}
    {listed.length > 1 && <div className="final-panel-actions">
      <Button size="sm" onClick={props.onChange}>Change final…</Button>
    </div>}
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
    label: items.every(item => item.version < newest) ? `On ${name} (old text)` : `On ${name}, not compared`, items,
  }))];
}

function CompareContent(props: ContentProps): JSX.Element {
  const { row, data } = props;
  const id = useId();
  const [explain, setExplain] = useState(false);
  const listed = listedSubmissions(data.panel.submissions ?? []);
  const agreement = data.panel.agreement ?? null;
  const explanationId = `${id}-explanation`;
  return <div className="final-panel-compare">
    <p>{compareSummary(listed, agreement)}</p>
    {agreement && <div className="final-panel-agreement">
      <p>{agreementText(agreement)}</p>
      <meter aria-hidden="true" className="final-panel-agreement-bar" min={0} max={Math.max(agreement.total, 1)} value={agreement.matching} />
      <Button size="sm" variant="quiet" className="btn-link" aria-expanded={explain} aria-controls={explanationId} onClick={() => setExplain(value => !value)}>How is this counted?</Button>
      {explain && <p id={explanationId} className="cell-secondary">{AGREEMENT_EXPLANATION}</p>}
    </div>}
    <SubmissionTable {...props} listed={listed} />
    <Consolidate {...props} listed={listed} primary={!preselectedOf(row, data) && !data.panel.all_match} />
  </div>;
}

/** Submission, Findings, Only here, with "Open in editor" and "Use as final" per submission. */
function SubmissionTable(props: ContentProps & { listed: FinalPanelSubmissionView[] }): JSX.Element {
  const { row, data, listed, busy, onSave, onAnnounce, guidelineCurrent, now } = props;
  const id = useId();
  const { route, link } = useEditorRoute(props);
  return <table className="data-table density-compact final-panel-table">
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
            {submissionName(submission)}
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
    </table>;
}

/**
 * "Consolidate…": a secondary button (primary when agreement is not full and nothing is preselected) with the
 * hint "Resolve the n differences together"; it opens the launcher inside the block, which then holds unsaved input.
 */
function Consolidate(props: ContentProps & { listed: FinalPanelSubmissionView[]; primary: boolean }): JSX.Element | null {
  const { row, projectKey, page, listed, primary, username = "", data, onConsolidationStarted, onDirtyChange, now } = props;
  const [open, setOpen] = useState(false);
  const hintId = useId();
  useEffect(() => {
    if (!open) return;
    onDirtyChange?.(true);
    return () => onDirtyChange?.(false);
    // Only the launcher's open state counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const documents = consolidationDocuments(listed);
  const compared = listed.find(item => item.comparable)?.document_id;
  const documentId = compared && documents.includes(compared) ? compared : documents[0];
  if (!documentId) return null;
  const rows = consolidationInputs((data.panel.submissions ?? []).filter(item => item.document_id === documentId), now);
  // Preselected: the submissions the panel compares on that text (latest of a live round), never a superseded input.
  const preselected = listed.filter(item => item.document_id === documentId && item.comparable
    && item.round_state !== "abandoned" && item.round_state !== "superseded").map(item => item.submission_id);
  const hint = consolidateHint(data.panel.agreement ?? null);
  return <div className="final-panel-consolidate">
    {!open && <p>
      <Button size="sm" variant={primary ? "primary" : "secondary"} aria-describedby={hint ? hintId : undefined} onClick={() => setOpen(true)}>Consolidate…</Button>
      {hint && <>{" "}<span id={hintId} className="cell-secondary">{hint}</span></>}
    </p>}
    {open && <ConsolidationLauncher projectKey={projectKey} documentId={documentId} language={row.language} username={username} rows={rows} defaultOpen
      defaultSelected={preselected} adjudicatorNotAnnotator={page.adjudicator_not_annotator} onStarted={(round, started) => onConsolidationStarted?.(row, round, started)} />}
  </div>;
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
        {corrected.document_id && link(route(corrected.document_id), "Show changes", undefined, true)}
        {data.panel.changed_passages != null && <>{", "}{changedPassagesText(data.panel.changed_passages)}</>}
      </p>
    </div>}
    <div className="final-panel-actions">
      <ChoiceButton id={keepId} label={keepLabel(row)} variant={onlyTextChange ? "primary" : "secondary"} blocked={ownBlocked} busy={busy} onAnnounce={onAnnounce}
        onChoose={() => onSave(keepRequest(row, data.submissions, causes.map(item => item.cause_id), keepId), keepId)} />
      {corrected?.document_id && onCarry && <Button size="sm" aria-disabled={busy !== null || undefined} onClick={() => { if (busy === null && corrected.document_id) onCarry(row, corrected.document_id); }}>{`Carry to ${correctedName}…`}</Button>}
      {newer && <ChoiceButton id={newerId} label="Use the newer result" blocked={!newer.eligible} busy={busy} onAnnounce={onAnnounce}
        onChoose={() => onSave(selectRequest(row, data.submissions, newer, newerId), newerId)} />}
    </div>
  </div>;
}
