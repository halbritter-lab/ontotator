import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type DocumentRowView, type RowSubmissionView, type RowSubmissions, type SubmissionHistorySummary } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { personLabel } from "../app/submissionLabels";
import { Time } from "../app/Time";
import { Button, InlineMessage, Select } from "../ui";
import { ConsolidationLauncher } from "../variants/ConsolidationLauncher";
import { refKey } from "../variants/versionState";
import { historyLines } from "./historyLines";
import { versionName } from "./labels";
import { OWN_RESULT_REASON, SelectionNotice, type KeepRequest } from "./SelectionNotice";
import { documentsRowId, isPlainClick } from "./RowCells";
import { SubmissionsTable, type SubmissionActionContext } from "./SubmissionsTable";
import { acceptanceLabel, acceptanceOf, discardLabel, isDiscarded, TextVersions, type TextVersionsTools } from "./TextVersions";
import type { RowSubmissionsState } from "./useRowSubmissions";

/** Report state words of the "Problem reports (n)" list (same words as `reportStateBadge`). */
const REPORT_STATE_TEXT = { open: "Open", resolved: "Closed", withdrawn: "Withdrawn" } as const;

export type AssignTaskKind = "translation_review" | "annotate" | "review";

export interface SelectFinalRequest {
  kind: "use" | "replace";
  submission: RowSubmissionView;
  triggerId: string;
}

export interface ExpandedRowProps {
  row: DocumentRowView;
  projectKey: string;
  /** Current Documents query; links keep it as `documents_*`. */
  query: ProjectDocumentsQuery;
  /** Submissions of this row (`useRowSubmissions`): history times, consolidation and technical details. */
  submissions: RowSubmissionsState;
  onNavigate: (route: Route) => void;
  /** Region id. */
  id?: string;
  /** Page data for the Text versions actions; without it Text versions is read-only. */
  textVersionTools?: TextVersionsTools;
  /** Current plan revision of the case (Technical details). */
  planRevision?: number;
  /** Assign dialog for this row ("Assign annotation review…", D25 "Assign a new review…"). */
  onAssign?: (row: DocumentRowView, task: AssignTaskKind, options?: { newReviewOfAccepted?: boolean }) => void;
  /** The row's Review / Annotate chips (`PlanChips`) for the "Plan" line (VD2 (2)). */
  plan?: ReactNode;
  /** Pseudonym of the signed-in lead ("Final: chosen by you"). */
  me?: string | null;
  /** Opens Text versions and focuses its summary (interim target of the text-change actions until O7). */
  revealTextVersions?: boolean;
  onTextVersionsRevealed?: () => void;
  now?: Date;
}

/** Id of the "Submissions (n)" heading of a row (focus target after Keep). */
export function submissionsHeadingId(caseId: string, language: string): string {
  return `documents-submissions-${encodeURIComponent(caseId)}-${encodeURIComponent(language)}`;
}

function toHistorySummary(row: RowSubmissionView): SubmissionHistorySummary {
  return { submission_id: row.submission_id, document_id: row.document_id, author_label: row.author_label, created_at: row.recorded_at, mode: row.mode, round_id: row.round_id, guideline_version: row.guideline_version ?? null, guideline_withdrawn: row.guideline_withdrawn };
}

function useLink(onNavigate: (route: Route) => void) {
  return (route: Route, text: string, label?: string) => <a href={routeHref(route)} aria-label={label} onClick={event => {
    if (!isPlainClick(event)) return;
    event.preventDefault(); onNavigate(route);
  }}>{text}</a>;
}

/**
 * The slim expansion of one Documents row (documents overview spec "Expansion (▸)", V1): one region
 * "History, {case} · {language}" with History lines, the Plan line, Text versions, the optional
 * assignments, Start consolidation…, Problem reports and Technical details. No required action lives here.
 */
export function ExpandedRow({
  row, projectKey, query, submissions, onNavigate, id, textVersionTools, planRevision, onAssign, plan, me, revealTextVersions = false, onTextVersionsRevealed, now,
}: ExpandedRowProps): JSX.Element {
  const ownId = useId();
  const textVersionsRef = useRef<HTMLDetailsElement>(null);
  const [textVersionsOpen, setTextVersionsOpen] = useState(revealTextVersions);
  const data: RowSubmissions | null = submissions.data;
  const rows = data?.submissions ?? [];
  const documents = Object.keys(query).length ? { documents: query } : {};
  const link = useLink(onNavigate);
  const reportRoute = (reportId: string): Route => ({ name: "projectProblemReport", key: projectKey, reportId, ...documents });
  const nameOf = (documentId: string) => {
    const entry = row.versions.find(item => item.document_id === documentId);
    return versionName(entry?.version ?? 0, entry?.chain_name ?? "", row.parallel_roots);
  };

  // A text-change action asked for Text versions: open it and move focus to its summary.
  useEffect(() => {
    if (!revealTextVersions) return;
    setTextVersionsOpen(true);
    requestAnimationFrame(() => {
      textVersionsRef.current?.querySelector("summary")?.focus();
      onTextVersionsRevealed?.();
    });
    // Only a new request opens it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTextVersions]);

  const lines = historyLines(row, data ? rows : null, { me, now });
  const problemReports = row.problem_reports ?? [];
  const reviewable = onAssign && row.work.some(item => item.task === "annotate" && item.status === "submitted" && item.moved_to_version == null);
  // D25: a new review of a translation the lead (or the import override) accepted without one.
  const newReview = onAssign && !row.is_source
    && !row.work.some(item => item.task === "translation_review" && item.status !== "submitted" && item.moved_to_version == null)
    && row.versions.some(version => version.is_newest_in_chain && !isDiscarded(row, version) && version.translation_status === "accepted"
      && (acceptanceOf(version)?.source === "lead" || acceptanceOf(version)?.source === "override"));
  const consolidationDocuments = [...new Set(rows.map(item => item.document_id))]
    .filter(documentId => rows.filter(item => item.document_id === documentId).length >= 2);

  return <section role="region" id={id} aria-label={`History, ${row.case_id} · ${row.language}`} className="expanded-row">
    <div className="expanded-row-section">
      <h3 id={`${ownId}-history`}>History</h3>
      {lines.length > 0
        ? <ul className="expanded-row-issues" aria-labelledby={`${ownId}-history`}>{lines.map(line => <li key={line.key}>
          {line.text}{line.reportId && <>{" · "}{link(reportRoute(line.reportId), "Open report")}</>}
        </li>)}</ul>
        : <p className="cell-secondary">{submissions.loading && !data ? "Loading history…" : "No history yet."}</p>}
    </div>
    {plan != null && <div className="documents-expanded-plan" role="group" aria-labelledby={`${ownId}-plan`}>
      <span id={`${ownId}-plan`} className="documents-expanded-plan-label">Plan</span>{plan}
    </div>}
    <div className="expanded-row-section">
      <details ref={textVersionsRef} className="expanded-row-more" open={textVersionsOpen} onToggle={event => setTextVersionsOpen(event.currentTarget.open)}>
        <summary>Text versions ({row.versions.length})</summary>
        <TextVersions row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} tools={textVersionTools} now={now} />
      </details>
      {(reviewable || newReview) && <div className="expanded-row-links">
        {reviewable && <Button size="sm" variant="quiet" onClick={() => onAssign(row, "review")}>Assign annotation review…</Button>}
        {newReview && <Button size="sm" variant="quiet" onClick={() => onAssign(row, "translation_review", { newReviewOfAccepted: true })}>Assign a new review…</Button>}
      </div>}
      <details className="expanded-row-more">
        <summary>Start consolidation…</summary>
        {!data ? <p className="cell-secondary">Submissions are not loaded.</p>
          : consolidationDocuments.length === 0 ? <p className="cell-secondary">Consolidation needs at least two submissions on one text version.</p>
            : consolidationDocuments.map(documentId => <div key={documentId} className="expanded-row-consolidation">
              {consolidationDocuments.length > 1 && <h4>{nameOf(documentId)}</h4>}
              <ConsolidationLauncher projectKey={projectKey} documentId={documentId} language={row.language} username={textVersionTools?.username ?? ""}
                rows={rows.filter(item => item.document_id === documentId).map(toHistorySummary)} />
            </div>)}
      </details>
      {problemReports.length > 0 && <details className="expanded-row-more">
        <summary>Problem reports ({problemReports.length})</summary>
        <ul className="expanded-row-issues">{problemReports.map(report => <li key={report.report_id}>
          {report.title}{" · "}{report.reporter_label}{" · "}<Time iso={report.created_at} now={now} />
          {" · "}Report: {REPORT_STATE_TEXT[report.state]}{" · "}Paused tasks: {report.active_hold_count}{" · "}{link(reportRoute(report.report_id), "Open report")}
        </li>)}</ul>
      </details>}
      <details className="expanded-row-more">
        <summary>Technical details</summary>
        <dl className="technical-details">
          <dt>Text ID</dt><dd>{row.case_id}</dd>
          {planRevision != null && <><dt>Plan revision</dt><dd>{planRevision}</dd></>}
          {row.versions.map(version => {
            const name = versionName(version.version, version.chain_name, row.parallel_roots);
            const acceptance = acceptanceOf(version);
            return <Fragment key={version.document_id}>
              <FragmentPair term={`Document ID, ${name}`} value={version.document_id} />
              {acceptance && <FragmentPair term={`Acceptance, ${name}`} value={acceptanceLabel(acceptance, now)} />}
              {isDiscarded(row, version) && <FragmentPair term={`Discard, ${name}`} value={discardLabel(version, now)} />}
            </Fragment>;
          })}
          {rows.map(item => <FragmentPair key={item.submission_id} term={`Submission ID, ${item.author_label}`}
            value={`${item.submission_id}${item.round_id ? ` · round ${item.round_id}` : ""} · mode ${item.mode}`} />)}
          {(data?.rounds ?? []).filter(round => !round.submitted).map(round => <FragmentPair key={round.round_id} term={`Round ID, ${round.author_label}`}
            value={`${round.round_id} · mode ${round.mode}`} />)}
        </dl>
      </details>
    </div>
  </section>;
}

export interface FinalChoiceProps {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** Submissions of this row (`useRowSubmissions`). */
  submissions: RowSubmissionsState;
  onNavigate: (route: Route) => void;
  /** Current project rule (`page.adjudicator_not_annotator`). */
  adjudicatorNotAnnotator?: boolean;
  /** Opens "Use as final" or "Replace" for a submission; without it no selection actions are offered. */
  onSelectFinal?: (request: SelectFinalRequest) => void;
  onKeep?: (request: KeepRequest) => void;
  /** Inline confirmation below a submission row, or null. */
  renderConfirm?: (submission: RowSubmissionView) => ReactNode | null;
  /** Keep confirmation, rendered below the selection notice. */
  keepConfirm?: ReactNode;
  /** Another confirmation is busy: other confirm triggers are unavailable. */
  confirmBusy?: boolean;
  /** Polite announcement (the page's live region). */
  onAnnounce?: (message: string) => void;
  /** "list" in narrow cards: Submissions as two-line items instead of the table. */
  layout?: "table" | "list";
  onClose: () => void;
  now?: Date;
}

/**
 * Interim final-result choice under a row ("Compare results…", "Accept result…", "Review changes…"):
 * the selection notice and Submissions (n) moved out of the expansion (spec Change 10). The
 * final-result side panel (O6) replaces it.
 */
export function FinalChoice({
  row, projectKey, query, submissions, onNavigate, adjudicatorNotAnnotator = false,
  onSelectFinal, onKeep, renderConfirm, keepConfirm, confirmBusy = false, onAnnounce, layout = "table", onClose, now,
}: FinalChoiceProps): JSX.Element {
  const ownId = useId();
  const [compareFor, setCompareFor] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState("");
  // Version in force, once per mount, for "Guidelines v2 (current: v3)"; a failed read only drops the comparison.
  const [guidelineCurrent, setGuidelineCurrent] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    void api.listGuidelines(projectKey).then(listing => listing.current?.version ?? null, () => null).then(version => { if (active) setGuidelineCurrent(version); });
    return () => { active = false; };
  }, [projectKey]);
  const headingId = submissionsHeadingId(row.case_id, row.language);
  const data: RowSubmissions | null = submissions.data;
  const unavailable = submissions.loading || confirmBusy;
  const documents = Object.keys(query).length ? { documents: query } : {};
  const link = useLink(onNavigate);
  const caseRoute = (documentId: string, annotations?: string, compare?: string): Route => ({
    name: "projectCase", key: projectKey, caseId: row.case_id, variant: documentId,
    ...(annotations ? { annotations } : {}), ...(compare ? { compare } : {}), ...documents,
  });
  const submissionRef = (submissionId: string) => refKey({ kind: "submission", id: submissionId });
  const rows = data?.submissions ?? [];
  const final = row.final;
  // Submissions (n) only when n > 0 or a final result exists; a load error is shown with its heading.
  const showSubmissions = final != null || rows.length > 0 || (submissions.error != null && !data);

  const selectionAction = (submission: RowSubmissionView, context: SubmissionActionContext): ReactNode => {
    if (!onSelectFinal || context.isFinal) return null;
    const kind = final ? "replace" : "use";
    const triggerId = `${ownId}-select-${encodeURIComponent(submission.submission_id)}`;
    const blocked = adjudicatorNotAnnotator && submission.is_me;
    const reasonId = `${triggerId}-reason`;
    return <>
      <Button id={triggerId} size="sm" aria-describedby={[context.labelId, blocked ? reasonId : ""].filter(Boolean).join(" ")}
        aria-disabled={blocked || unavailable ? true : undefined}
        onClick={() => {
          if (blocked) { onAnnounce?.(OWN_RESULT_REASON); return; }
          if (unavailable) return;
          onSelectFinal({ kind, submission, triggerId });
        }}>{kind === "use" ? "Use as final…" : "Replace…"}</Button>
      {blocked && <span id={reasonId} className="action-reason">{OWN_RESULT_REASON}</span>}
    </>;
  };
  const compareAction = (submission: RowSubmissionView, context: SubmissionActionContext): ReactNode => {
    if (context.isFinal) return null;
    if (final) {
      if (final.document_id !== submission.document_id) return <span className="cell-secondary">Different text versions; open each with View.</span>;
      return <a href={routeHref(caseRoute(final.document_id, submissionRef(final.submission_id), submissionRef(submission.submission_id)))} aria-describedby={context.labelId}
        onClick={event => {
          if (!isPlainClick(event)) return;
          event.preventDefault(); onNavigate(caseRoute(final.document_id, submissionRef(final.submission_id), submissionRef(submission.submission_id)));
        }}>Compare</a>;
    }
    const candidates = rows.filter(other => other.document_id === submission.document_id && other.submission_id !== submission.submission_id);
    if (!candidates.length) return null;
    if (compareFor !== submission.submission_id) {
      return <Button size="sm" aria-describedby={context.labelId} onClick={() => {
        setCompareFor(submission.submission_id);
        setCompareWith(candidates.length === 1 ? candidates[0].submission_id : "");
      }}>Compare…</Button>;
    }
    const selectId = `${ownId}-compare-${encodeURIComponent(submission.submission_id)}`;
    const target = candidates.find(other => other.submission_id === compareWith);
    const route = target ? caseRoute(submission.document_id, submissionRef(submission.submission_id), submissionRef(target.submission_id)) : null;
    return <div className="compare-chooser">
      <Select id={selectId} label="Compare with" value={compareWith} onChange={event => setCompareWith(event.target.value)}>
        <option value="">Choose a submission</option>
        {candidates.map(other => <option key={other.submission_id} value={other.submission_id}>
          {[other.round_ordinal != null ? `Round ${other.round_ordinal}` : "Initial submission", personLabel(other.author_label, other.is_me)].join(" · ")}
        </option>)}
      </Select>
      {route && link(route, "Open comparison")}
      <Button size="sm" variant="quiet" onClick={() => setCompareFor(null)}>Cancel</Button>
    </div>;
  };
  const actions = (submission: RowSubmissionView, context: SubmissionActionContext) => <>{selectionAction(submission, context)}{compareAction(submission, context)}</>;

  return <section role="region" aria-label={`Final result · ${row.case_id} · ${row.language}`} className="expanded-row documents-final-choice">
    {!showSubmissions && submissions.loading && !data && <p role="status" className="cell-secondary">Loading submissions…</p>}
    {showSubmissions && <div className="expanded-row-section">
      <h3 id={headingId} tabIndex={-1}>{data ? `Submissions (${rows.length})` : "Submissions"}</h3>
      {submissions.error != null && !data
        ? <InlineMessage tone="error">Could not load submissions. <Button size="sm" onClick={submissions.retry}>Retry</Button></InlineMessage>
        : <>
          {submissions.loading && <p role="status" className="cell-secondary">Loading submissions…</p>}
          {data && <>
            <SelectionNotice row={row} data={data} adjudicatorNotAnnotator={adjudicatorNotAnnotator} onKeep={onKeep} keepConfirm={keepConfirm}
              unavailable={unavailable} onAnnounce={onAnnounce} now={now} />
            <SubmissionsTable rows={rows} rounds={data.rounds} final={final} parallel={row.parallel_roots} showFinalColumn language={row.language}
              actions={actions} renderConfirm={renderConfirm} onNavigate={onNavigate} now={now} layout={layout}
              finalLinkId={documentsRowId(row.case_id, row.language, "final-view")} guidelineCurrent={guidelineCurrent}
              label={`Submissions, ${row.case_id} · ${row.language}`}
              viewRoute={submission => caseRoute(submission.document_id, submissionRef(submission.submission_id))} />
          </>}
        </>}
    </div>}
    <div><Button size="sm" variant="quiet" onClick={onClose}>Close</Button></div>
  </section>;
}

function FragmentPair({ term, value }: { term: string; value: string }): JSX.Element {
  return <><dt>{term}</dt><dd>{value}</dd></>;
}
