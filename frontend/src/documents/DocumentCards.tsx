/**
 * Narrow-viewport Documents list (documents overview "Narrow"): one case card per case (case
 * checkbox + "case-107 · en source + 1 translation"), one `<article>` per text with its checkbox,
 * heading "{case · language}" with version marker and NEW, the three stage lines, "Waiting on: …",
 * the row action full width with the "+n" menu, "Open" and "History". Rows outside the plan are
 * muted articles; nothing collapses (VD1). Card and case headings carry the table's row-header and
 * group-label ids, so deep links, plan saves and the panel find the same focus targets in both layouts.
 */
import { useId, useMemo, type MouseEvent, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage, NextStepView } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import type { GroupSelectMode } from "../ui/DataTable";
import { caseHeaderText, type TableSelection } from "./DocumentsTable";
import type { PlanSaves } from "./PlanChips";
import { RowActionCell } from "./RowActions";
import { documentsGroupId, documentsRowId, HistoryToggle, LastActivityCell, NewBadge, RowOpenLinks, rowIsNew, rowKeyOf, rowName, rowNeedsDecision, ShortId, VersionMarker } from "./RowCells";
import { isActiveRow, stageText, waitingOnText, type StageName } from "./stageLabels";

export interface DocumentCardsProps {
  page: DocumentRowsPage;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** Toggle membership of `"{case}:{language}"` in `query.open`. */
  onToggleRow: (key: string) => void;
  /** Inline notice under a row (plan confirmations, resolve options). */
  renderRowNotice?: (row: DocumentRowView) => ReactNode | null;
  /** Expanded content of an open row (built by the page); stacks inside the card, with `layout: "list"` for Submissions. */
  renderExpanded?: (row: DocumentRowView, options: { layout: "list" }) => ReactNode;
  /** Visit badge of a row, shown next to the card heading. */
  rowBadge?: (row: DocumentRowView) => ReactNode;
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  /** Plan saves for the "Plan…" popover (VD2). */
  planSaves?: PlanSaves;
  onNavigate?: (route: Route) => void;
  busy?: boolean;
  empty?: ReactNode;
  /** Case and text checkboxes (VD4); the page owns the selection. */
  selection?: TableSelection;
}

interface DocumentCardProps extends Omit<DocumentCardsProps, "page" | "busy" | "empty" | "selection"> {
  row: DocumentRowView;
  group: DocumentGroupView;
  expanded: boolean;
  select?: { checked: boolean; onSelect: (mode: GroupSelectMode) => void };
}

const STAGE_TITLES: readonly (readonly [StageName, string])[] = [["review", "Review"], ["annotation", "Annotation"], ["final", "Final"]];

const selectModeOf = (event: MouseEvent<HTMLInputElement>): GroupSelectMode =>
  event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle-keep-anchor" : "toggle";

/** "Review: ✓ Accepted · unchanged": the stage title labels the line; the glyph is decorative, the tone colours the status. */
function StageLine({ row, stage, title, sourceLanguage }: { row: DocumentRowView; stage: StageName; title: string; sourceLanguage: string | null }): JSX.Element {
  const cell = row.stages?.[stage];
  const text = cell ? stageText(stage, cell, row, { sourceLanguage }) : { symbol: "", word: "—", detail: "" };
  const tone = cell?.tone ?? "none";
  return <p className={["document-card-line", "document-card-stage", `stage-cell--${tone}`, !isActiveRow(row) && "stage-cell--muted"].filter(Boolean).join(" ")}>
    <span className="document-card-stage-label">{`${title}:`}</span>{" "}
    <span className="stage-cell-status">{text.symbol && <><span className="stage-cell-symbol" aria-hidden="true">{text.symbol}</span>{" "}</>}{text.word}</span>
    {text.detail ? <span className="document-card-stage-detail">{` · ${text.detail}`}</span> : null}
  </p>;
}

/** "Waiting on: You" (strong); with "+n" the full list is spoken instead of the short one (not only a title). */
function WaitingOnLine({ row }: { row: DocumentRowView }): JSX.Element {
  const { text, title, you } = waitingOnText(row);
  const value = you ? <strong>{text}</strong>
    : title && title !== text ? <span title={title}><span aria-hidden="true">{text}</span><span className="visually-hidden">{title}</span></span>
      : <span>{text}</span>;
  return <span className="documents-waiting-on">Waiting on: {value}</span>;
}

function DocumentCard({ row, group, projectKey, query, expanded, onToggleRow, renderRowNotice, renderExpanded, rowBadge, onAction, planSaves, onNavigate, select }: DocumentCardProps): JSX.Element {
  const baseId = useId();
  const headingId = documentsRowId(row.case_id, row.language, "header");
  const regionId = `${baseId}-expanded`;
  const name = rowName(row);
  const showRegion = expanded && renderExpanded != null;
  const badge = rowBadge?.(row);
  const notice = renderRowNotice?.(row) ?? null;
  const active = isActiveRow(row);
  const source = group.rows.find(entry => entry.is_source)?.language ?? null;

  return (
    <article className={["document-card", !active && "document-card--muted", rowNeedsDecision(row) && "document-card--decision"].filter(Boolean).join(" ")} aria-labelledby={headingId}>
      <div className="document-card-line document-card-head">
        {select && <input type="checkbox" className="document-card-select checkbox-target" aria-label={`Select ${name}`} checked={select.checked}
          onChange={() => undefined} onClick={event => select.onSelect(selectModeOf(event))} />}
        <h4 id={headingId} tabIndex={-1} className="document-card-title">
          <span aria-hidden="true"><ShortId value={row.case_id} />{` · ${row.language}`}</span>
          <span className="visually-hidden">{name}</span>
        </h4>
        {rowNeedsDecision(row) && <span className="visually-hidden">Needs your decision</span>}
        {row.is_source && <span className="documents-source">source</span>}
        <VersionMarker row={row} />
        {active && rowIsNew(row) && <NewBadge />}
        {badge != null && badge !== false && <span className="documents-row-badge">{badge}</span>}
      </div>
      {STAGE_TITLES.map(([stage, title]) => <StageLine key={stage} row={row} stage={stage} title={title} sourceLanguage={source} />)}
      <div className="document-card-line document-card-owner">
        <WaitingOnLine row={row} />
        <span className="document-card-activity"><LastActivityCell iso={row.last_activity_at} /></span>
      </div>
      <RowActionCell row={row} onAction={onAction} plan={planSaves ? { saves: planSaves, groupRevision: group.plan_revision } : undefined} block />
      <div className="document-card-line document-card-actions">
        <RowOpenLinks row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} />
        <HistoryToggle row={row} expanded={expanded} controls={showRegion ? regionId : undefined} onToggleRow={onToggleRow}>History</HistoryToggle>
      </div>
      {notice != null && <div className="document-card-notice">{notice}</div>}
      {showRegion && <div id={regionId} className="document-card-expanded">{renderExpanded(row, { layout: "list" })}</div>}
    </article>
  );
}

export function DocumentCards({ page, busy, empty, query, selection, ...rest }: DocumentCardsProps): JSX.Element {
  const open = useMemo(() => new Set(query.open ?? []), [query.open]);
  const order = useMemo(() => page.groups.flatMap(group => group.rows.map(rowKeyOf)), [page.groups]);
  if (page.groups.length === 0) return <div className="document-cards-empty">{empty}</div>;
  return (
    <ul className="document-cards" aria-label="Documents" aria-busy={busy || undefined}>
      {page.groups.map(group => {
        const keys = group.rows.map(rowKeyOf);
        const state = selection?.caseState(keys) ?? "none";
        return (
          <li key={group.case_id} className="document-case-card">
            <div className="document-case-card-head">
              {selection && <input type="checkbox" className="document-case-card-select checkbox-target" aria-label={`Select ${group.case_id} (${group.rows.length === 1 ? "1 text" : `${group.rows.length} texts`})`}
                ref={element => { if (element) element.indeterminate = state === "some"; }}
                checked={state === "all"} onChange={() => undefined}
                onClick={event => selection.selectCase(keys, selectModeOf(event), order)} />}
              <h3 id={documentsGroupId(group.case_id)} tabIndex={-1} className="document-case-card-title">{caseHeaderText(group)}</h3>
            </div>
            {group.rows.map(row => (
              <DocumentCard key={rowKeyOf(row)} {...rest} row={row} group={group} query={query} expanded={open.has(rowKeyOf(row))}
                select={selection ? { checked: selection.keys.has(rowKeyOf(row)), onSelect: mode => selection.select(rowKeyOf(row), mode, order) } : undefined} />
            ))}
          </li>
        );
      })}
    </ul>
  );
}
