import { useId, useState, type ReactNode } from "react";
import type { FinalSelectionSummary, RowRoundView, RowSubmissionView } from "../api/client";
import { textLabel } from "../app/identity";
import { routeHref, type Route } from "../app/router";
import { kindLabels, personLabel, submissionLabel, type SubmissionKind } from "../app/submissionLabels";
import { Time } from "../app/Time";
import { plural } from "../app/labels";
import { Button, DataTable, StatusBadge, type Column } from "../ui";
import { isPlainClick } from "./RowCells";

export { isPlainClick };

/** Rows beyond this collapse to the newest ones plus "Show all (n)"; the Final row stays visible. */
export const SUBMISSIONS_COLLAPSED_LIMIT = 10;

/** Passed to `actions` so every action can point `aria-describedby` at the submission label. */
export interface SubmissionActionContext {
  /** Id of a hidden element holding the submission label. */
  labelId: string;
  label: string;
  isFinal: boolean;
}

export interface SubmissionsTableProps {
  rows: RowSubmissionView[];
  rounds: RowRoundView[];
  final?: FinalSelectionSummary | null;
  /** The row has parallel roots: versions are written "{chain name} v{n}". */
  parallel: boolean;
  showFinalColumn: boolean;
  /** Language of the row; part of every submission label. */
  language: string;
  /** Case of the row; with it the Version column names the text ("case-0101 · de v2"). */
  caseId?: string;
  /** Selection and compare actions. Undefined = read-only mode without an Actions column. */
  actions?: (row: RowSubmissionView, context: SubmissionActionContext) => ReactNode;
  /** Non-null content becomes a full-width row below the submission (inline confirmations). */
  renderConfirm?: (row: RowSubmissionView) => ReactNode | null;
  /** Destination of the View link; null renders the round cell as text. The table never builds refs itself. */
  viewRoute: (row: RowSubmissionView) => Route | null;
  /** In-app navigation for plain left clicks; without it links navigate by `href`. */
  onNavigate?: (route: Route) => void;
  /** Accessible table name (default "Submissions"). */
  label?: string;
  /** Reference time for the current-year rule (tests). */
  now?: Date;
  /**
   * "table" (default): the columns. "list" for narrow cards: two-line items (label and Final badge;
   * findings and actions), an inline confirmation as a block below its item.
   */
  layout?: "table" | "list";
  /** DOM id of the Final row's View link (stable focus target). */
  finalLinkId?: string;
}

/** "Round n", "Initial submission" without a round, or the kind for rounds without an ordinal (consolidation). */
export function roundName(input: { round_ordinal: number | null; round_id?: string | null; kind: string }): string {
  if (input.round_ordinal != null) return `Round ${input.round_ordinal}`;
  if (input.round_id == null) return "Initial submission";
  return kindLabels[input.kind as SubmissionKind] ?? "Round";
}

/** "v2", or "{chain name} v1" with parallel roots. */
export function submissionVersion(version: number, chainName: string | null, parallel: boolean): string {
  return parallel && chainName ? `${chainName} v${version}` : `v${version}`;
}

/** Full submission label, e.g. "Annotation · Round 2 · ann-0004 · de v1 · 19 Oct, 00:57". */
export function rowSubmissionLabel(row: RowSubmissionView, language: string, parallel: boolean, options: { now?: Date; seconds?: boolean } = {}): string {
  return submissionLabel({
    kind: row.kind, ordinal: row.round_ordinal, author: row.author_label, isMe: row.is_me, person: row.author, language,
    version: submissionVersion(row.version, row.chain_name, parallel), recordedAt: row.recorded_at,
  }, options);
}

function roundSuffixes(row: RowSubmissionView, rows: readonly RowSubmissionView[]): string[] {
  const suffixes: string[] = [];
  if (row.round_id != null && rows.filter(other => other.round_id === row.round_id).length > 1) {
    suffixes.push(row.is_latest_in_round ? "latest" : "earlier submission");
  }
  if (row.round_state === "superseded" || row.round_state === "abandoned") suffixes.push(row.round_state);
  return suffixes;
}

const byRecorded = (left: RowSubmissionView, right: RowSubmissionView): number =>
  left.recorded_at.localeCompare(right.recorded_at) || left.submission_id.localeCompare(right.submission_id);

/** Rounds shown as muted "in progress, not submitted yet" lines (translation-review rounds are never listed by the API). */
export function pendingRounds(rounds: readonly RowRoundView[]): RowRoundView[] {
  return rounds.filter(round => !round.submitted && round.state !== "abandoned" && round.state !== "superseded");
}

/**
 * Submissions of one text and language, oldest first. Used by the Documents expanded row
 * (with actions and confirmations) and read-only by the case viewer history.
 */
export function SubmissionsTable({
  rows, rounds, final = null, parallel, showFinalColumn, language, caseId, actions, renderConfirm, viewRoute, onNavigate, label = "Submissions", now,
  layout = "table", finalLinkId,
}: SubmissionsTableProps): JSX.Element {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const sorted = [...rows].sort(byRecorded);
  const isFinal = (row: RowSubmissionView) => final != null && final.submission_id === row.submission_id;
  const collapsed = !showAll && sorted.length > SUBMISSIONS_COLLAPSED_LIMIT;
  const newest = new Set(sorted.slice(-SUBMISSIONS_COLLAPSED_LIMIT).map(row => row.submission_id));
  const visible = collapsed ? sorted.filter(row => newest.has(row.submission_id) || isFinal(row)) : sorted;
  const showVersion = new Set(rows.map(row => row.document_id)).size > 1;
  // Seconds only where two otherwise identical labels share a minute.
  const minuteLabels = new Map<string, number>();
  const minuteLabel = (row: RowSubmissionView) => rowSubmissionLabel(row, language, parallel, { now, seconds: false });
  for (const row of rows) minuteLabels.set(minuteLabel(row), (minuteLabels.get(minuteLabel(row)) ?? 0) + 1);
  const needsSeconds = (row: RowSubmissionView) => (minuteLabels.get(minuteLabel(row)) ?? 0) > 1;
  const labelOf = (row: RowSubmissionView) => rowSubmissionLabel(row, language, parallel, { now, seconds: needsSeconds(row) });
  const labelId = (row: RowSubmissionView) => `${id}-label-${sorted.indexOf(row)}`;

  const viewLink = (row: RowSubmissionView, text: string) => {
    const destination = viewRoute(row);
    const hidden = <span id={labelId(row)} hidden>{labelOf(row)}</span>;
    if (!destination) return <>{text}{hidden}</>;
    return <>
      <a id={isFinal(row) ? finalLinkId : undefined} href={routeHref(destination)} aria-label={`View ${labelOf(row)}`} onClick={event => {
        if (!onNavigate || !isPlainClick(event)) return;
        event.preventDefault(); onNavigate(destination);
      }}>{text}</a>{hidden}
    </>;
  };
  const versionCell = (row: RowSubmissionView) => {
    const version = submissionVersion(row.version, row.chain_name, parallel);
    return caseId == null ? version : `${textLabel({ case_id: caseId, language })} ${version}`;
  };
  const roundCellContent = (row: RowSubmissionView) => viewLink(row, [roundName(row), ...roundSuffixes(row, rows)].join(" · "));

  const columns: Column<RowSubmissionView>[] = [
    ...(showFinalColumn ? [{ id: "final", header: "Final", cell: (row: RowSubmissionView) => isFinal(row) ? <StatusBadge tone="success">Final</StatusBadge> : null }] : []),
    { id: "round", header: "Round", cell: roundCellContent },
    { id: "kind", header: "Kind", cell: row => kindLabels[row.kind] },
    ...(showVersion ? [{ id: "version", header: "Version", cell: (row: RowSubmissionView) => versionCell(row) }] : []),
    { id: "by", header: "By", cell: row => personLabel(row.author_label, row.is_me, row.author) },
    { id: "submitted", header: "Submitted", cell: row => <Time iso={row.recorded_at} now={now} seconds={needsSeconds(row)} /> },
    { id: "findings", header: "Findings", align: "end", cell: row => row.finding_count },
    ...(actions ? [{ id: "actions", header: "Actions", cell: (row: RowSubmissionView) => <div className="submission-actions">{actions(row, { labelId: labelId(row), label: labelOf(row), isFinal: isFinal(row) })}</div> }] : []),
  ];
  const pending = pendingRounds(rounds);
  const pendingList = pending.length > 0 && <ul className="submissions-pending">
    {pending.map(round => <li key={round.round_id}>{`${roundName({ round_ordinal: round.round_ordinal, round_id: round.round_id, kind: round.kind })} · ${personLabel(round.author_label, round.is_me, round.author)} · in progress, not submitted yet`}</li>)}
  </ul>;
  const showAllButton = collapsed && <Button size="sm" variant="quiet" onClick={() => setShowAll(true)}>Show all ({sorted.length})</Button>;

  if (layout === "list") {
    return <div className="submissions-table submissions-list-layout">
      {visible.length === 0 ? <p className="cell-secondary">No submissions yet.</p>
        : <ul className="submissions-list" aria-label={label}>
          {visible.map(row => {
            const confirm = renderConfirm?.(row) ?? null;
            // Consolidations name their kind once ("Consolidation", not "Consolidation · Consolidation").
            const parts = [kindLabels[row.kind], roundName(row), ...roundSuffixes(row, rows), personLabel(row.author_label, row.is_me, row.author),
              showVersion ? versionCell(row) : ""];
            const text = parts.filter((part, index) => part && parts.indexOf(part) === index).join(" · ");
            return <li key={row.submission_id} className={isFinal(row) ? "submissions-list-item final-row" : "submissions-list-item"}>
                <div className="submissions-list-line">
                  <span className="submissions-list-label">{viewLink(row, text)}</span>
                  {" "}<Time iso={row.recorded_at} now={now} seconds={needsSeconds(row)} />
                  {showFinalColumn && isFinal(row) && <> <StatusBadge tone="success">Final</StatusBadge></>}
                </div>
                <div className="submissions-list-line">
                  <span className="submissions-list-findings">{plural(row.finding_count, "finding")}</span>
                  {actions && <div className="submission-actions">{actions(row, { labelId: labelId(row), label: labelOf(row), isFinal: isFinal(row) })}</div>}
                </div>
                {confirm != null && <div className="submissions-list-confirm">{confirm}</div>}
              </li>;
          })}
        </ul>}
      {showAllButton}
      {pendingList}
    </div>;
  }

  return <div className="submissions-table">
    <DataTable
      label={label}
      columns={columns}
      rows={visible}
      rowKey={row => row.submission_id}
      rowProps={row => (isFinal(row) ? { className: "final-row" } : {})}
      renderExpanded={renderConfirm}
      empty="No submissions yet."
    />
    {showAllButton}
    {pendingList}
  </div>;
}
