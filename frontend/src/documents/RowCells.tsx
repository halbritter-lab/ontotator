/**
 * Cell renderers of a Documents language row, shared by the table (D4) and the narrow cards (D5).
 * Each renderer takes the row view plus explicit options; none holds state.
 */
import { useId, type MouseEvent, type ReactNode } from "react";
import type { DocumentRowView, DocumentVersionView, FinalSelectionSummary } from "../api/client";
import { Time } from "../app/Time";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { IconCheck, IconChevronRight } from "../ui/icons";
import { StatusBadge } from "../ui/StatusBadge";
import {
  decisionCategoryLabels,
  issueAriaLabel,
  middleEllipsis,
  personLabel,
  statusBadgeText,
  submissionLabel,
  versionName,
  versionText,
  workText,
  type DecisionCategory,
} from "./labels";

/** Longest ID shown in full in a cell; longer IDs get a middle ellipsis with the full value in `title`. */
export const ID_DISPLAY_MAX = 24;

/** Waiting items appear as the waiting line in the selection notice, never as a note count. */
const WAITING_CODES = new Set(["ROUND_REVIEW_PENDING"]);

/** Row wording of notes (causes outside the bar categories). */
const NOTE_LABELS: Readonly<Record<string, string>> = {
  SOURCE_UPDATE_UNREVIEWED: "Source text changed",
  TASK_ON_HOLD: "Task paused",
  REVIEWER_NEEDED: "Reviewer needed",
};

/** `"{case}:{language}"`: the row key used in `query.open`. */
export const rowKeyOf = (row: Pick<DocumentRowView, "case_id" | "language">): string => `${row.case_id}:${row.language}`;

/** "{text ID} · {language}" as used in accessible names. */
export const rowName = (row: Pick<DocumentRowView, "case_id" | "language">): string => `${row.case_id} · ${row.language}`;

export function noteLabel(code: string): string {
  return NOTE_LABELS[code] ?? "Other note";
}

/** Notes counted in the Issues column (waiting items excluded). */
export function countedNotes(row: DocumentRowView): DocumentRowView["notes"] {
  return row.notes.filter(note => !WAITING_CODES.has(note.code));
}

/** Issue counts per bar category and note counts per row wording. */
export function issueCounts(row: DocumentRowView): { issues: Partial<Record<DecisionCategory, number>>; notes: Record<string, number> } {
  const issues: Partial<Record<DecisionCategory, number>> = {};
  for (const issue of row.issues) {
    const category = issue.category as DecisionCategory | null;
    if (category && category in decisionCategoryLabels) issues[category] = (issues[category] ?? 0) + 1;
  }
  const notes: Record<string, number> = {};
  for (const note of countedNotes(row)) notes[noteLabel(note.code)] = (notes[noteLabel(note.code)] ?? 0) + 1;
  return { issues, notes };
}

/** A long ID with a middle ellipsis; the full value is in `title`. */
export function ShortId({ value, max = ID_DISPLAY_MAX }: { value: string; max?: number }): JSX.Element {
  const short = middleEllipsis(value, max);
  return <span className="documents-id" title={value}>{short}</span>;
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

/** A link with a real `href`; plain left clicks go through `onNavigate` when given. */
export function RouteLink({ route, onNavigate, children, className, ...rest }: {
  route: Route;
  onNavigate?: (route: Route) => void;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}): JSX.Element {
  return (
    <a
      {...rest}
      className={className}
      href={routeHref(route)}
      onClick={onNavigate ? event => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onNavigate(route);
      } : undefined}
    >
      {children}
    </a>
  );
}

function versionOf(row: DocumentRowView, documentId: string | null): DocumentVersionView | undefined {
  return documentId == null ? undefined : row.versions.find(entry => entry.document_id === documentId);
}

/** "v3 · Correction of v2 · Ready for review" for one version of the row. */
export function versionLabel(row: DocumentRowView, entry: DocumentVersionView): string {
  return versionText({
    version: entry.version,
    origin: entry.origin,
    derivedVersion: versionOf(row, entry.derived_from)?.version ?? null,
    status: entry.translation_status,
    decision: entry.latest_review_decision,
    chainName: entry.chain_name,
    parallel: row.parallel_roots,
    acceptedWithoutReview: entry.accepted_without_review,
  });
}

/** Short form for the "Matched:" line: "v1 · Check failed". */
function matchedLabel(row: DocumentRowView, entry: DocumentVersionView): string {
  const badge = statusBadgeText(entry.translation_status, entry.latest_review_decision, entry.accepted_without_review);
  return [versionName(entry.version, entry.chain_name, row.parallel_roots), badge].filter(Boolean).join(" · ");
}

/** Chain names of the row's roots, in version order. */
export function chainNames(row: DocumentRowView): string[] {
  const names = new Map<string, string>();
  for (const entry of row.versions) if (!names.has(entry.chain_id)) names.set(entry.chain_id, entry.chain_name);
  return [...names.values()];
}

/** The version the collapsed row displays: the newest of its single chain; none with parallel roots. */
export function displayedVersion(row: DocumentRowView): DocumentVersionView | undefined {
  if (row.parallel_roots) return undefined;
  return row.versions.find(entry => entry.is_newest_in_chain) ?? row.versions[row.versions.length - 1];
}

/** Versions to name in "Matched: …" for a collapsed row; empty when the displayed content already matches. */
export function matchedVersions(row: DocumentRowView): DocumentVersionView[] {
  const matching = row.versions.filter(entry => entry.matches_filter);
  if (matching.length === 0 || matching.length === row.versions.length) return [];
  const shown = displayedVersion(row);
  if (shown && shown.matches_filter) return [];
  return matching;
}

export function VersionCell({ row, expanded }: { row: DocumentRowView; expanded: boolean }): JSX.Element {
  const shown = displayedVersion(row);
  const matched = expanded ? [] : matchedVersions(row);
  const summary = shown
    ? versionLabel(row, shown)
    : `${chainNames(row).length} independent translations: ${chainNames(row).join(", ")}`;
  return (
    <>
      <span className="documents-version">{summary}</span>
      {matched.length > 0 && <span className="documents-matched">{`Matched: ${matched.map(entry => matchedLabel(row, entry)).join(", ")}`}</span>}
    </>
  );
}

export function WorkCell({ row }: { row: DocumentRowView }): JSX.Element {
  const paused = row.work.some(entry => entry.held);
  return (
    <span className="documents-work">
      <span>{workText(row.work)}</span>
      {paused && <StatusBadge tone="warning">Paused</StatusBadge>}
    </span>
  );
}

/** "Annotation · Round 2 · ann-0004 · 18 Oct, 10:00 · v1": no language; the marker follows when needed. */
export function finalLabel(row: DocumentRowView, final: FinalSelectionSummary): string {
  const kind = final.kind ?? "annotation";
  const author = final.author_label ?? "Unknown";
  const base = final.recorded_at
    ? submissionLabel({ kind, ordinal: final.round_ordinal, author, isMe: final.is_mine, language: final.language, version: null, recordedAt: final.recorded_at }, { withLanguage: false })
    : [kind === "consolidation" ? null : final.round_ordinal == null ? "Initial submission" : `Round ${final.round_ordinal}`, personLabel(author, final.is_mine)]
      .filter(Boolean).join(" · ");
  const needsMarker = final.version != null && (!final.is_newest_of_chain || row.parallel_roots);
  if (!needsMarker) return base;
  const chain = final.chain_name ?? versionOf(row, final.document_id)?.chain_name ?? "";
  return `${base} · ${versionName(final.version!, chain, row.parallel_roots)}`;
}

export function FinalCell({ row }: { row: DocumentRowView }): JSX.Element {
  if (!row.final) return <span className="documents-final documents-final--none">None</span>;
  return (
    <span className="documents-final">
      <IconCheck className="documents-final-icon" />
      <span>{finalLabel(row, row.final)}</span>
    </span>
  );
}

/** Warning badge with the bar-category count plus neutral "n notes"; one grouped accessible label. */
export function IssuesCell({ row }: { row: DocumentRowView }): JSX.Element | null {
  const { issues, notes } = issueCounts(row);
  const issueTotal = Object.values(issues).reduce((sum, count) => sum + (count ?? 0), 0);
  const noteTotal = Object.values(notes).reduce((sum, count) => sum + count, 0);
  if (issueTotal === 0 && noteTotal === 0) return null;
  return (
    <span className="documents-issues" role="img" aria-label={issueAriaLabel(issues, notes)}>
      {issueTotal > 0 && <StatusBadge tone="warning">{issueTotal}</StatusBadge>}
      {noteTotal > 0 && <span className="documents-notes">{noteTotal === 1 ? "1 note" : `${noteTotal} notes`}</span>}
    </span>
  );
}

export function LastActivityCell({ iso }: { iso: string | null }): JSX.Element {
  return iso ? <Time iso={iso} /> : <span className="documents-muted">No activity</span>;
}

export interface SelectCellProps {
  row: DocumentRowView;
  selected: ReadonlySet<string>;
  onToggleSelect: (documentId: string, checked: boolean) => void;
}

/** Bulk checkbox for the row's bulk version, or "Choose in Text versions". */
export function SelectCell({ row, selected, onToggleSelect }: SelectCellProps): JSX.Element {
  const id = useId();
  const documentId = row.bulk.document_id;
  if (row.bulk.mode !== "checkbox" || documentId == null) return <span className="documents-choose">Choose in Text versions</span>;
  return (
    <input
      id={id}
      type="checkbox"
      className="form-checkbox documents-select"
      aria-label={`Select ${rowName(row)}`}
      checked={selected.has(documentId)}
      onChange={event => onToggleSelect(documentId, event.target.checked)}
    />
  );
}

export interface RowHeaderCellProps {
  row: DocumentRowView;
  projectKey: string;
  /** Current Documents query; passed through as `documents_*` so the case viewer can return. */
  query: ProjectDocumentsQuery;
  expanded: boolean;
  /** ID of the expanded content; set only while it exists. */
  controls?: string;
  onToggleRow: (key: string) => void;
  onNavigate?: (route: Route) => void;
}

/** Disclosure, language code, "Open" and "Open my task". */
export function RowHeaderCell({ row, projectKey, query, expanded, controls, onToggleRow, onNavigate }: RowHeaderCellProps): JSX.Element {
  const descriptionId = useId();
  const name = rowName(row);
  const documents = Object.keys(query).length ? { documents: query } : {};
  const openRoute: Route = { name: "projectCase", key: projectKey, caseId: row.case_id, variant: row.open.document_id, ...documents };
  const description = row.open.reason === "most_recent_root" && row.open.label ? `Opens ${row.open.label}, the most recent translation` : null;
  return (
    <span className="documents-row-header">
      <button
        type="button"
        className="documents-disclosure target-min"
        aria-expanded={expanded}
        aria-controls={controls}
        aria-label={`Show submissions, ${name}`}
        onClick={() => onToggleRow(rowKeyOf(row))}
      >
        <IconChevronRight className="disclosure-chevron" />
        <span className="documents-language">{row.language}</span>
      </button>
      <RouteLink route={openRoute} onNavigate={onNavigate} className="documents-open" aria-label={`Open ${name}`} aria-describedby={description ? descriptionId : undefined}>Open</RouteLink>
      {description && <span id={descriptionId} className="visually-hidden">{description}</span>}
      {row.own_open_assignment_id != null && (
        <RouteLink route={{ name: "task", assignmentId: row.own_open_assignment_id }} onNavigate={onNavigate} className="documents-open-task">Open my task</RouteLink>
      )}
    </span>
  );
}
