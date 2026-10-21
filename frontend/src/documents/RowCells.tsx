/**
 * Cell renderers of a Documents text row, shared by the table and the narrow cards (documents
 * overview "Columns"): Text (row header with the "Details" entry of the row panel), the stage cells
 * (the filtered entry of the row panel), Waiting on, Last activity. Each renderer takes the row view
 * plus explicit options; none holds state.
 */
import { useId, type MouseEvent, type ReactNode } from "react";
import type { DocumentRowView, DocumentVersionView, FinalSelectionSummary } from "../api/client";
import { kindLabels, type SubmissionKind } from "../app/submissionLabels";
import { Time } from "../app/Time";
import { routeHref, type PanelStage, type ProjectDocumentsQuery, type Route } from "../app/router";
import { IconCheck } from "../ui/icons";
import { StageCell } from "../ui/StageCell";
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
import { isActiveRow, stageText, versionMarkerText, waitingOnText, type StageName } from "./stageLabels";

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

/** `"{case}:{language}"`: the row key used in `query.panel`. */
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

/** A plain left click (no modifier): in-app navigation; anything else keeps the browser default. */
export function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

/** Parts of a Documents row with a stable DOM id (focus targets); `header` is the text name ("Details, …"). */
export type DocumentsRowPart = "header" | "details" | "final-view" | "action" | "plan";

/** Stable id of a part of the row `{case}:{language}`, e.g. its text name or the Final row's View link. */
export function documentsRowId(caseId: string, language: string, part: DocumentsRowPart): string {
  return `documents-row-${encodeURIComponent(caseId)}-${encodeURIComponent(language)}-${part}`;
}

/** Stable id of a case's group row label (a focus fallback; the group row is no disclosure, VD5). */
export function documentsGroupId(caseId: string): string {
  return `documents-group-${encodeURIComponent(caseId)}-toggle`;
}

/** Stable id of the former not-in-plan toggle of a case; no element has it since VD1 (plan chips keep it as a focus fallback). */
export function documentsNotInPlanId(caseId: string): string {
  return `documents-group-${encodeURIComponent(caseId)}-not-in-plan`;
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

export interface FinalLabelOptions {
  /** Full submission label with language and version (confirmations); default is the Final column form. */
  withLanguage?: boolean;
}

/**
 * Label of a final result from its summary, the one fallback for every place without the loaded
 * submission. Final column: "Annotation · Round 2 · ann-0004 · 18 Oct, 10:00 · v1" (no language;
 * the version marker follows when needed). `withLanguage`: "Annotation · Round 2 · ann-0004 · de v1 · 18 Oct, 10:00".
 * Without `recorded_at` the time is omitted, never invented; an unknown author reads "Unknown".
 */
export function finalLabel(row: DocumentRowView, final: FinalSelectionSummary, options: FinalLabelOptions = {}): string {
  const withLanguage = options.withLanguage ?? false;
  const kind = (final.kind ?? "annotation") as SubmissionKind;
  const author = final.author_label ?? "Unknown";
  const language = final.language || row.language;
  const chain = final.chain_name ?? versionOf(row, final.document_id)?.chain_name ?? "";
  const version = final.version != null ? versionName(final.version, chain, row.parallel_roots) : null;
  // The Final column appends the version only as a marker (older version or parallel roots).
  const marker = !withLanguage && final.version != null && (!final.is_newest_of_chain || row.parallel_roots) ? version : null;
  const labelVersion = withLanguage ? version : null;
  const base = final.recorded_at
    ? submissionLabel({ kind, ordinal: final.round_ordinal, author, isMe: final.is_mine, language, version: labelVersion, recordedAt: final.recorded_at }, { withLanguage })
    : [kindLabels[kind] ?? kind, kind === "consolidation" ? null : final.round_ordinal == null ? "Initial submission" : `Round ${final.round_ordinal}`,
      personLabel(author, final.is_mine), withLanguage ? [language, labelVersion].filter(Boolean).join(" ") : null].filter(Boolean).join(" · ");
  return marker ? `${base} · ${marker}` : base;
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

/** The row's "Open" destination and, for parallel translations, which one it opens. */
export function openLink(row: DocumentRowView, projectKey: string, query: ProjectDocumentsQuery): { route: Route; description: string | null } {
  const documents = Object.keys(query).length ? { documents: query } : {};
  return {
    route: { name: "projectCase", key: projectKey, caseId: row.case_id, variant: row.open.document_id, ...documents },
    description: row.open.reason === "most_recent_root" && row.open.label ? `Opens ${row.open.label}, the most recent translation` : null,
  };
}

/** "Open" (with its description) and "Open my task" of a row; shared by the table and the cards. */
export function RowOpenLinks({ row, projectKey, query, onNavigate }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  onNavigate?: (route: Route) => void;
}): JSX.Element {
  const descriptionId = useId();
  const { route, description } = openLink(row, projectKey, query);
  return <>
    <RouteLink route={route} onNavigate={onNavigate} className="documents-open" aria-label={`Open in editor, ${rowName(row)}`} aria-describedby={description ? descriptionId : undefined}>Open</RouteLink>
    {description && <span id={descriptionId} className="visually-hidden">{description}</span>}
    {row.own_open_assignment_id != null && (
      <RouteLink route={{ name: "task", assignmentId: row.own_open_assignment_id }} onNavigate={onNavigate} className="documents-open-task">Open my task</RouteLink>
    )}
  </>;
}

/** NEW since the lead's last visit (O1 `new`; absent before the regeneration). */
export function rowIsNew(row: DocumentRowView): boolean {
  return (row as DocumentRowView & { new?: boolean }).new === true;
}

/** The decision edge: the row's next step is a lead decision (in plan or undecided, V10). */
export function rowNeedsDecision(row: DocumentRowView): boolean {
  return isActiveRow(row) && row.next_step?.kind === "decision";
}

/** "v2 corrected" / "v2" / "2 translations" with the full version label as `title`. */
export function VersionMarker({ row }: { row: DocumentRowView }): JSX.Element | null {
  const text = versionMarkerText(row);
  if (!text) return null;
  const shown = displayedVersion(row);
  const title = shown && !row.parallel_roots ? versionLabel(row, shown) : chainNames(row).join(", ");
  return <span className="documents-version-marker" title={title || undefined}>{text}</span>;
}

/** Small info badge "NEW"; accessible text "New since your last visit". */
export function NewBadge(): JSX.Element {
  return <StatusBadge tone="info"><span aria-hidden="true">NEW</span><span className="visually-hidden">New since your last visit</span></StatusBadge>;
}

/** Opens the row panel for a row: unfiltered (text name) or filtered to a stage (stage cell); `opener` gets focus back. */
export type OpenRowPanel = (row: DocumentRowView, options: { stage?: PanelStage; opener: HTMLElement }) => void;

export interface RowHeaderCellProps {
  row: DocumentRowView;
  projectKey: string;
  /** Current Documents query; passed through as `documents_*` so the case viewer can return. */
  query: ProjectDocumentsQuery;
  onNavigate?: (route: Route) => void;
  /** Visit badge ("Resolved" / "Changed: …"). */
  badge?: ReactNode;
  /** The text name opens the row panel ("Details, {case} · {language}"); without it the name is plain text. */
  onOpenPanel?: OpenRowPanel;
}

/**
 * Text cell (row header, named "{case} · {language}"): the text name (the row panel's entry "Details, …"),
 * "source", version marker, NEW, visit badge, "Open" and "Open my task"; decision rows add the hidden
 * "Needs your decision".
 */
export function RowHeaderCell({ row, projectKey, query, onNavigate, badge, onOpenPanel }: RowHeaderCellProps): JSX.Element {
  const active = isActiveRow(row);
  const nameId = documentsRowId(row.case_id, row.language, "header");
  const nameContent = <><span className="visually-hidden">{`${row.case_id} · `}</span><span className="documents-language">{row.language}</span></>;
  return (
    <span className="documents-row-header documents-text-cell">
      {onOpenPanel
        ? <button type="button" id={nameId} className="documents-text-name documents-text-button" aria-label={`Details, ${rowName(row)}`}
          onClick={event => onOpenPanel(row, { opener: event.currentTarget })}>{nameContent}</button>
        : <span id={nameId} tabIndex={-1} className="documents-text-name">{nameContent}</span>}
      {rowNeedsDecision(row) && <span className="visually-hidden">Needs your decision</span>}
      {row.is_source && <span className="documents-source">source</span>}
      <VersionMarker row={row} />
      {active && rowIsNew(row) && <NewBadge />}
      {badge != null && badge !== false && <span className="documents-row-badge">{badge}</span>}
      <RowOpenLinks row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} />
    </span>
  );
}

/** Stage column titles (the accessible names of the stage cell buttons). */
const STAGE_CELL_TITLES: Readonly<Record<StageName, string>> = { review: "Review", annotation: "Annotation", final: "Final" };

/**
 * One stage cell of the row; rows outside the plan are muted (VD1). With `onOpenPanel` the cell is a
 * frameless button with a dotted status underline that opens the row panel filtered to this stage:
 * "Annotation: 0 of 2 submitted. Show history, case-108 · de" (the detail line is its description).
 */
export function RowStageCell({ row, stage, sourceLanguage, onOpenPanel }: {
  row: DocumentRowView; stage: StageName; sourceLanguage?: string | null; onOpenPanel?: OpenRowPanel;
}): JSX.Element {
  const detailId = useId();
  const cell = row.stages?.[stage];
  if (!cell) return <StageCell symbol="" word="—" tone="none" muted={!isActiveRow(row)} />;
  const text = stageText(stage, cell, row, { sourceLanguage });
  const content = <StageCell symbol={text.symbol} word={text.word} detail={text.detail ? <span id={detailId}>{text.detail}</span> : undefined}
    tone={cell.tone} muted={!isActiveRow(row)} />;
  if (!onOpenPanel) return content;
  return <button type="button" className="documents-stage-button" aria-label={`${STAGE_CELL_TITLES[stage]}: ${text.word}. Show history, ${rowName(row)}`}
    aria-describedby={text.detail ? detailId : undefined} onClick={event => onOpenPanel(row, { stage, opener: event.currentTarget })}>{content}</button>;
}

/** Waiting on: "You" (strong), a person, up to two names and "+n" with the full list (VD8), or "—". */
export function WaitingOnCell({ row }: { row: DocumentRowView }): JSX.Element {
  const { text, title, you } = waitingOnText(row);
  if (you) return <strong className="documents-waiting-on">{text}</strong>;
  if (!title || title === text) return <span className="documents-waiting-on">{text}</span>;
  return <span className="documents-waiting-on" title={title}><span aria-hidden="true">{text}</span><span className="visually-hidden">{title}</span></span>;
}
