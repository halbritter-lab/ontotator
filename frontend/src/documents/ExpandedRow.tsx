import { Fragment, useId, useRef, useState, type ReactNode } from "react";
import type { DocumentRowView, RowItemView, RowSubmissionView, RowSubmissions, SubmissionHistorySummary } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { personLabel } from "../app/submissionLabels";
import { Time } from "../app/Time";
import { Button, InlineMessage, Select } from "../ui";
import { ConsolidationLauncher } from "../variants/ConsolidationLauncher";
import { refKey } from "../variants/versionState";
import { versionName } from "./labels";
import { ACKNOWLEDGEABLE_CODES, OWN_RESULT_REASON, SelectionNotice, type KeepRequest } from "./SelectionNotice";
import { documentsRowId, isPlainClick } from "./RowCells";
import { plannedStages, StageBlocks, type AssignTaskKind, type BlockStage, type StageLine } from "./StageBlocks";
import { SubmissionsTable, type SubmissionActionContext } from "./SubmissionsTable";
import { acceptanceLabel, acceptanceOf, discardLabel, isDiscarded, TextVersions, type TextVersionsTools } from "./TextVersions";
import type { RowSubmissionsState } from "./useRowSubmissions";

/** Report excerpts are cut to this many characters. */
export const REPORT_EXCERPT_LENGTH = 120;

/** Issue codes shown inside a stage block when that block is rendered (spec "Changes to approved decisions" 6). */
const BLOCK_CODES: Readonly<Record<string, BlockStage>> = {
  TRANSLATION_CHECK_FAILED: "translation_review",
  TRANSLATION_NOT_ACCEPTED: "translation_review",
  REVIEWER_NEEDED: "translation_review",
  MISSING_FINAL: "final",
};

/** Codes that never appear in the Issues section (selection notice, waiting lines, preflight-only). */
const NOT_IN_ISSUES = new Set([...ACKNOWLEDGEABLE_CODES, "ROUND_REVIEW_PENDING", "MISSING_FINAL_SELECTION"]);

/** Report state words of the "Problem reports (n)" list (same words as `reportStateBadge`). */
const REPORT_STATE_TEXT = { open: "Open", resolved: "Closed", withdrawn: "Withdrawn" } as const;

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
  /** Submissions of this row (`useRowSubmissions`). */
  submissions: RowSubmissionsState;
  onNavigate: (route: Route) => void;
  /** Region id (target of the row disclosure's `aria-controls`). */
  id?: string;
  /** Id of the element naming the row (the row header); otherwise an own hidden "{text ID} · {language}" label. */
  labelledBy?: string;
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
  /** Page data for the Text versions actions; without it Text versions is read-only. */
  textVersionTools?: TextVersionsTools;
  /** "list" in narrow cards: Submissions as two-line items instead of the table. */
  layout?: "table" | "list";
  /** Current plan revision of the case (Technical details). */
  planRevision?: number;
  /** Assign dialog for this row (stage block links, D25 "Assign a new review…"). */
  onAssign?: (row: DocumentRowView, task: AssignTaskKind, options?: { newReviewOfAccepted?: boolean }) => void;
  /** Content inside the Translation review block (`StageBlocks` `translationSlot`). */
  translationSlot?: ReactNode;
  now?: Date;
}

/** Id of the "Submissions (n)" heading of a row (focus target after Keep). */
export function submissionsHeadingId(caseId: string, language: string): string {
  return `documents-submissions-${encodeURIComponent(caseId)}-${encodeURIComponent(language)}`;
}

function excerpt(text: string): string {
  return text.length > REPORT_EXCERPT_LENGTH ? `${text.slice(0, REPORT_EXCERPT_LENGTH)}…` : text;
}

function toHistorySummary(row: RowSubmissionView): SubmissionHistorySummary {
  return { submission_id: row.submission_id, document_id: row.document_id, author_label: row.author_label, created_at: row.recorded_at, mode: row.mode, round_id: row.round_id };
}

/** Expanded content of one Documents row: stage blocks, Issues, Submissions (n) and More. */
export function ExpandedRow({
  row, projectKey, query, submissions, onNavigate, id, labelledBy, adjudicatorNotAnnotator = false,
  onSelectFinal, onKeep, renderConfirm, keepConfirm, confirmBusy = false, onAnnounce, textVersionTools, layout = "table", planRevision, onAssign, translationSlot, now,
}: ExpandedRowProps): JSX.Element {
  const ownId = useId();
  const labelId = `${ownId}-label`;
  const textVersionsRef = useRef<HTMLDetailsElement>(null);
  const [textVersionsOpen, setTextVersionsOpen] = useState(false);
  const [compareFor, setCompareFor] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState("");
  const headingId = submissionsHeadingId(row.case_id, row.language);
  const data: RowSubmissions | null = submissions.data;
  const unavailable = submissions.loading || confirmBusy;
  const documents = Object.keys(query).length ? { documents: query } : {};
  const nameOf = (documentId: string | null, version: number | null) => {
    const entry = row.versions.find(item => item.document_id === documentId);
    return versionName(version ?? entry?.version ?? 0, entry?.chain_name ?? "", row.parallel_roots);
  };

  const link = (route: Route, text: string, label?: string) => <a href={routeHref(route)} aria-label={label} onClick={event => {
    if (!isPlainClick(event)) return;
    event.preventDefault(); onNavigate(route);
  }}>{text}</a>;
  const reportRoute = (reportId: string, resume = false): Route => ({ name: "projectProblemReport", key: projectKey, reportId, ...(resume ? { action: "resume" as const } : {}), ...documents });
  const caseRoute = (documentId: string, annotations?: string, compare?: string): Route => ({
    name: "projectCase", key: projectKey, caseId: row.case_id, variant: documentId,
    ...(annotations ? { annotations } : {}), ...(compare ? { compare } : {}), ...documents,
  });
  const submissionRef = (submissionId: string) => refKey({ kind: "submission", id: submissionId });
  const openTextVersions = () => {
    setTextVersionsOpen(true);
    // The summary is the focusable control of the disclosure.
    requestAnimationFrame(() => textVersionsRef.current?.querySelector("summary")?.focus());
  };
  const focusSubmissions = () => document.getElementById(headingId)?.focus();

  /** One issue line; inside a stage block the block's own Text versions link replaces the line's. */
  const issueLine = (item: RowItemView, inBlock = false): ReactNode => {
    const textVersionsButton = inBlock ? null : <> <Button size="sm" variant="quiet" onClick={openTextVersions}>Text versions</Button></>;
    const name = nameOf(item.document_id, item.version);
    switch (item.code) {
      case "OPEN_PROBLEM_REPORT": {
        const report = item.report;
        if (!report) return item.report_id ? <>Open problem report. {link(reportRoute(item.report_id), "Open report")}</> : "Open problem report.";
        return <>
          <q className="issue-excerpt">{excerpt(report.excerpt)}</q>{" · "}{report.reporter_label}{" · "}<Time iso={report.created_at} now={now} />
          {" · "}{report.task_state === "paused" ? "task paused" : "task resumed"}{" "}{link(reportRoute(report.report_id), "Open report")}
        </>;
      }
      case "TASK_PAUSED_WITHOUT_REPORT":
        return <>{item.author_label ?? "A"}'s task is paused, but its report is resolved.{item.report_id && <> {link(reportRoute(item.report_id, true), "Resume task")}</>}</>;
      case "TASK_ON_HOLD":
        return <>Task paused{item.author_label ? ` (${item.author_label})` : ""}.{item.report_id && <> {link(reportRoute(item.report_id), "Open report")}</>}</>;
      case "TRANSLATION_CHECK_FAILED":
        return <>{name} failed the automatic translation check.{textVersionsButton}</>;
      case "TRANSLATION_NOT_ACCEPTED":
        return <>{name} was {item.review_decision === "query" ? "queried" : "rejected"} in review.{textVersionsButton}</>;
      case "REVIEWER_NEEDED":
        return <>{name} needs a translation reviewer.{textVersionsButton}</>;
      case "SOURCE_UPDATE_UNREVIEWED":
        return <>The source text changed.{item.document_id && <> {link(caseRoute(item.document_id), "Review source change")}</>}</>;
      case "MISSING_FINAL":
        return inBlock ? "No final result yet, and all work is submitted."
          : <>No final result yet, and all work is submitted. <Button size="sm" variant="quiet" onClick={focusSubmissions}>Submissions</Button></>;
      default:
        return null;
    }
  };
  const rows = data?.submissions ?? [];
  const final = row.final;
  const problemReports = row.problem_reports ?? [];
  // Submissions (n) only when n > 0 or a final result exists; a load error is shown with its heading.
  const showSubmissions = final != null || rows.length > 0 || (submissions.error != null && !data);

  // Translation lines and the missing-final line go into their stage block when it is rendered;
  // report, pause and source-change lines (and lines without a block) stay under Issues.
  const stages = new Set(plannedStages(row));
  const blockLines: Partial<Record<BlockStage, StageLine[]>> = {};
  const issueLines: { item: RowItemView; content: ReactNode }[] = [];
  for (const item of [...row.issues, ...row.notes]) {
    if (NOT_IN_ISSUES.has(item.code)) continue;
    const stage = BLOCK_CODES[item.code];
    const inBlock = stage !== undefined && stages.has(stage);
    const content = issueLine(item, inBlock);
    if (content === null) continue;
    if (inBlock) (blockLines[stage] ??= []).push({ key: item.cause_id, content });
    else issueLines.push({ item, content });
  }

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

  const consolidationDocuments = [...new Set(rows.map(item => item.document_id))]
    .filter(documentId => rows.filter(item => item.document_id === documentId).length >= 2);

  return <section role="region" id={id} aria-labelledby={labelledBy ?? labelId} className="expanded-row">
    {!labelledBy && <span id={labelId} hidden>{row.case_id} · {row.language}</span>}
    <StageBlocks row={row} submissions={data?.submissions ?? null} lines={blockLines} now={now}
      onOpenTextVersions={openTextVersions} onShowTranslationReviews={textVersionTools?.onShowTranslationReviews} onAssign={onAssign}
      onFocusSubmissions={showSubmissions ? focusSubmissions : undefined} translationSlot={translationSlot} />
    {issueLines.length > 0 && <div className="expanded-row-section">
      <h3>Issues</h3>
      <ul className="expanded-row-issues">{issueLines.map(({ item, content }) => <li key={item.cause_id}>{content}</li>)}</ul>
    </div>}
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
              finalLinkId={documentsRowId(row.case_id, row.language, "final-view")}
              label={`Submissions, ${row.case_id} · ${row.language}`}
              viewRoute={submission => caseRoute(submission.document_id, submissionRef(submission.submission_id))} />
          </>}
        </>}
    </div>}
    <div className="expanded-row-section">
      <h3>More</h3>
      <details className="expanded-row-more">
        <summary>Start consolidation…</summary>
        {!data ? <p className="cell-secondary">Submissions are not loaded.</p>
          : consolidationDocuments.length === 0 ? <p className="cell-secondary">Consolidation needs at least two submissions on one text version.</p>
            : consolidationDocuments.map(documentId => <div key={documentId} className="expanded-row-consolidation">
              {consolidationDocuments.length > 1 && <h4>{nameOf(documentId, null)}</h4>}
              <ConsolidationLauncher projectKey={projectKey} documentId={documentId} language={row.language} username={textVersionTools?.username ?? ""}
                rows={rows.filter(item => item.document_id === documentId).map(toHistorySummary)} />
            </div>)}
      </details>
      <details ref={textVersionsRef} className="expanded-row-more" open={textVersionsOpen} onToggle={event => setTextVersionsOpen(event.currentTarget.open)}>
        <summary>Text versions ({row.versions.length})</summary>
        <TextVersions row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} tools={textVersionTools} now={now} />
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

function FragmentPair({ term, value }: { term: string; value: string }): JSX.Element {
  return <><dt>{term}</dt><dd>{value}</dd></>;
}
