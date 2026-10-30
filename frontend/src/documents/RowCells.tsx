/**
 * Cell renderers of a Documents text row, shared by the table and the narrow cards (documents
 * overview "Columns"; one-line rows, spec 2026-10-23 §2b): Text (row header whose name opens the text
 * card), the one-line status cells, Waiting on, Last activity. Each renderer takes the row view plus
 * explicit options; none holds state.
 */
import { useId, type MouseEvent, type ReactNode } from "react";
import type { DocumentRowView, DocumentVersionView, FinalSelectionSummary } from "../api/client";
import { plural } from "../app/labels";
import { kindLabels, type SubmissionKind } from "../app/submissionLabels";
import { Time } from "../app/Time";
import { routeHref, type PanelStage, type ProjectDocumentsQuery, type Route } from "../app/router";
import { IconBot, IconBotOff } from "../ui/icons";
import { onSpaceActivate } from "../ui/spaceActivates";
import { StatusBadge } from "../ui/StatusBadge";
import {
  middleEllipsis,
  personLabel,
  submissionLabel,
  versionName,
  versionText,
} from "./labels";
import { isActiveRow, shortName, stageText, versionMarkerText, waitingOnText, type StageName } from "./stageLabels";
import { annotationState, finalizationState, translationState } from "./textCard/cardModel";
import { LanguageFlag } from "../ui/LanguageTag";
import { StageSymbol, type StageTone } from "../ui/StageCell";

/** Longest ID shown in full in a cell; longer IDs get a middle ellipsis with the full value in `title`. */
export const ID_DISPLAY_MAX = 24;

/** `"{case}:{language}"`: the row key used in `query.panel`. */
export const rowKeyOf = (row: Pick<DocumentRowView, "case_id" | "language">): string => `${row.case_id}:${row.language}`;

/** "{text ID} {language}" as used in accessible names. */
export const rowName = (row: Pick<DocumentRowView, "case_id" | "language">): string => `${row.case_id} ${row.language}`;

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

/** A link with a real `href`; plain left clicks go through `onNavigate` when given; styled as a button (`btn`) it also answers Space (V4). */
export function RouteLink({ route, onNavigate, children, className, ...rest }: {
  route: Route;
  onNavigate?: (route: Route) => void;
  children: ReactNode;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}): JSX.Element {
  return (
    <a
      {...rest}
      className={className}
      href={routeHref(route)}
      onKeyDown={className?.split(" ").includes("btn") ? onSpaceActivate : undefined}
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

/** "v3, Correction of v2, Ready for review" for one version of the row. */
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

export interface FinalLabelOptions {
  /** Full submission label with language and version (confirmations); default is the Final column form. */
  withLanguage?: boolean;
}

/**
 * Label of a final result from its summary, the one fallback for every place without the loaded
 * submission. Final column: "Annotation, Round 2, ann-0004, 18 Oct, 10:00, v1" (no language;
 * the version marker follows when needed). `withLanguage`: "Annotation, Round 2, ann-0004, de v1, 18 Oct, 10:00".
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
      personLabel(author, final.is_mine), withLanguage ? [language, labelVersion].filter(Boolean).join(" ") : null].filter(Boolean).join(", ");
  return marker ? `${base}, ${marker}` : base;
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

/** "Open" (with its description) of a narrow card; "Open my task" is the row's next step (`RowActionCell`). */
export function RowOpenLinks({ row, projectKey, query, onNavigate }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  onNavigate?: (route: Route) => void;
}): JSX.Element {
  const descriptionId = useId();
  const { route, description } = openLink(row, projectKey, query);
  return <>
    <RouteLink route={route} onNavigate={onNavigate} className="documents-open btn btn-secondary btn-sm" aria-label={`Open text, ${rowName(row)}`} aria-describedby={description ? descriptionId : undefined}>Open</RouteLink>
    {description && <span id={descriptionId} className="visually-hidden">{description}</span>}
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

/** Opens the text card of a row, optionally on a stage segment; `opener` gets focus back. */
export type OpenTextCard = (row: DocumentRowView, options: { stage?: PanelStage; opener: HTMLElement }) => void;

export interface RowHeaderCellProps {
  row: DocumentRowView;
  /** Visit badge ("Resolved" / "Changed: …"). */
  badge?: ReactNode;
  /** Enter on the text name opens the text card (clicks and Space reach the row, which selects); without it the name is plain text. */
  onOpenCard?: (opener: HTMLElement) => void;
  /** Flat table: the case ID shows before the language (muted); otherwise it is only in the accessible name. */
  showCaseId?: boolean;
  /** Texts of the case the table does not show (not in plan): a "+n" marker. */
  more?: number;
  /** "+n" becomes a button that shows the texts not in plan, so they can be selected (R-2). */
  onShowMore?: () => void;
  /** Another text of the case is open in the card (the row's tint has this as its words). */
  sibling?: boolean;
  /** The row is selected: the text name is a toggle button, as a click (or Space) on it toggles the selection (#41). */
  selected?: boolean;
}

/**
 * Text cell (row header): the text name, flag and language code in plain text style (a toggle button "Text
 * case-107 de": click and Space toggle the row's selection, Enter opens the text card), "source", version marker, NEW and the visit badge;
 * decision rows add the hidden "Needs your decision". No "Open" link: a double click on the row opens the card.
 */
export function RowHeaderCell({ row, badge, onOpenCard, showCaseId = false, more = 0, onShowMore, sibling = false, selected }: RowHeaderCellProps): JSX.Element {
  const active = isActiveRow(row);
  const nameId = documentsRowId(row.case_id, row.language, "header");
  const caseId = showCaseId ? <><span className="documents-row-case"><ShortId value={row.case_id} /></span>{" "}</> : <span className="visually-hidden">{`${row.case_id} `}</span>;
  const nameContent = <>{caseId}<span className="documents-language"><LanguageFlag code={row.language} />{row.language}</span></>;
  return (
    <span className="documents-row-header documents-text-cell">
      {onOpenCard
        ? <button type="button" id={nameId} className="documents-text-name" aria-label={`Text ${row.case_id} ${row.language}`}
          aria-pressed={selected} aria-keyshortcuts="Enter" title="Click selects; Enter or double click opens the text card"
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onOpenCard(event.currentTarget); } }}>{nameContent}</button>
        : <span id={nameId} tabIndex={-1} className="documents-text-name">{nameContent}</span>}
      {rowNeedsDecision(row) && <span className="visually-hidden">Needs your decision</span>}
      {row.is_source && <span className="documents-source">source</span>}
      {more > 0 && (onShowMore
        ? <button type="button" className="documents-more" title="Show texts not in plan" onClick={onShowMore}><span aria-hidden="true">{`+${more}`}</span>
          <span className="visually-hidden">{`Show ${more} more ${more === 1 ? "text" : "texts"} of this case not in plan`}</span></button>
        : <span className="documents-more"><span aria-hidden="true">{`+${more}`}</span>
          <span className="visually-hidden">{`${more} more ${more === 1 ? "text" : "texts"} of this case not in plan`}</span></span>)}
      {sibling && <span className="visually-hidden">Same case as the open text</span>}
      <VersionMarker row={row} />
      {active && rowIsNew(row) && <NewBadge />}
      {badge != null && badge !== false && <span className="documents-row-badge">{badge}</span>}
    </span>
  );
}

/** The robot icon's state: the text is in the plan, has tool proposals and is planned for annotation (spec 2026-10-25 §1). */
export function proposalIconState(row: DocumentRowView): { count: number; scratch: boolean } | null {
  const mode = row.annotation_mode?.mode;
  return isActiveRow(row) && row.proposal_count > 0 && mode ? { count: row.proposal_count, scratch: mode === "scratch" } : null;
}

/** The robot icon of the Annotation cell: the text has tool proposals; muted when it is annotated from scratch. */
export function ProposalsIcon({ row }: { row: DocumentRowView }): JSX.Element | null {
  const state = proposalIconState(row);
  if (!state) return null;
  const proposals = plural(state.count, "tool proposal");
  if (state.scratch) {
    const text = `${proposals}; this text is annotated from scratch, the annotators do not see them`;
    return <span className="documents-bot documents-bot--off" title={text} aria-label={text} role="img"><IconBotOff /></span>;
  }
  const text = `${proposals}; the annotation starts from them`;
  return <span className="documents-bot" title={text} aria-label={text} role="img"><IconBot /></span>;
}

/** The short state of a stage as the text card's path names it (`cardModel`). */
const STATE_OF: Readonly<Record<StageName, (row: DocumentRowView) => { state: string }>> = {
  review: translationState,
  annotation: annotationState,
  final: row => finalizationState(row, new Date()),
};

/** Who works on the stage, in grey after the state: reviewers of a running review, annotators at work. */
function stagePeople(row: DocumentRowView, stage: StageName): string {
  const cell = row.stages?.[stage];
  const working = stage === "review" ? ["in_progress", "re_review"] : stage === "annotation" ? ["in_progress", "paused"] : [];
  return cell && working.includes(cell.state) ? (cell.detail.people ?? []).map(shortName).join(", ") : "";
}

/** The state a stage cell shows (also its sort value); texts outside the plan: "not in plan" and no finalization (D10). */
export function stageCellText(row: DocumentRowView, stage: StageName): string {
  if (!isActiveRow(row) && stage !== "review") return stage === "annotation" ? "not in plan" : "—";
  // The card's "in review (Ana Weber)" becomes "in review" plus the grey who.
  return stage === "review" && stagePeople(row, stage) ? "in review" : STATE_OF[stage](row).state;
}

/**
 * Glyph and tone of a row's stage cell. A running consolidation belongs to Finalization ("◐ consolidating …"); the
 * Annotation cell is complete then once every planned submission is in. "waiting" always has its ○.
 */
function rowStageGlyph(row: DocumentRowView, stage: StageName, state: string): { symbol: string; tone: StageTone } {
  const cell = row.stages?.[stage];
  if (!cell || (!isActiveRow(row) && stage !== "review")) return { symbol: "", tone: cell?.tone ?? "none" };
  const annotation = row.stages?.annotation;
  if (annotation?.state === "consolidating") {
    const { submitted, total } = annotation.detail;
    if (stage === "final") return { symbol: "◐", tone: "running" };
    if (stage === "annotation" && (submitted == null || total == null || submitted >= total)) return { symbol: "✓", tone: "done" };
  }
  if (stage === "final" && state === "waiting") return { symbol: "○", tone: "waiting" };
  return { symbol: stageText(stage, cell, row).symbol, tone: cell.tone };
}

/**
 * One stage cell of the row on one line: glyph, the card's short state and a short "who" in grey, cut with an
 * ellipsis; `title` holds the full text. Rows outside the plan are muted (VD1). The Annotation cell adds the robot icon.
 */
export function RowStageCell({ row, stage }: { row: DocumentRowView; stage: StageName }): JSX.Element {
  const people = stagePeople(row, stage);
  const state = stageCellText(row, stage);
  const { symbol, tone } = rowStageGlyph(row, stage, state);
  // X5: findings flagged "guidelines unclear" in the submitted consolidation.
  const flagged = stage === "final" && (row.flagged_unclear ?? 0) > 0 ? `${row.flagged_unclear} flagged` : "";
  const who = [people, flagged].filter(Boolean).join(", ");
  // Annotators named in the cell have not submitted yet; "(Ben)" after "1 of 2 submitted" read like Ben had.
  const suffix = !who ? "" : stage === "annotation" ? ` · open: ${who}` : ` (${who})`;
  const full = state + suffix;
  const className = ["documents-status", "stage-cell", `stage-cell--${tone}`, !isActiveRow(row) && "stage-cell--muted"].filter(Boolean).join(" ");
  return <span className="documents-status-cell">
    <span className={className} title={full}>
      {symbol && <><StageSymbol symbol={symbol} />{" "}</>}
      {state}{suffix && <span className="documents-status-who">{suffix}</span>}
    </span>
    {stage === "annotation" && <ProposalsIcon row={row} />}
  </span>;
}

/** Waiting on: "You" (strong), a person, up to two names and "+n" with the full list (VD8), or "—". */
export function WaitingOnCell({ row }: { row: DocumentRowView }): JSX.Element {
  const { text, title, you } = waitingOnText(row);
  if (you) return <strong className="documents-waiting-on">{text}</strong>;
  if (!title || title === text) return <span className="documents-waiting-on">{text}</span>;
  return <span className="documents-waiting-on" title={title}><span aria-hidden="true">{text}</span><span className="visually-hidden">{title}</span></span>;
}
