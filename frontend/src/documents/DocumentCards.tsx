/**
 * Narrow-viewport Documents list (documents overview "Narrow"): one case card per case (case
 * checkbox + "case-107 · en source + 1 translation"), one `<article>` per text with its checkbox,
 * heading "{case · language}" with version marker and NEW, the three stage lines, "Waiting on: …",
 * the row action full width with the "+n" menu, "Open" and "Details" (the only way into the row panel's
 * sheet, acceptance fixes X19). As in the table, opening the panel ("Details" or a stage popover's details)
 * also adds the text to the selection. Rows outside the plan are muted articles; nothing collapses (VD1). Card and
 * case headings carry the table's row-header and group-label ids, so deep links, plan saves and the panel
 * find the same focus targets in both layouts.
 */
import { useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage, NextStepView } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import type { GroupSelectMode } from "../ui/DataTable";
import type { MenuItem } from "../ui/MenuButton";
import { caseHeaderText, openAndSelect, type TableSelection } from "./DocumentsTable";
import type { PlanSaves } from "./PlanChips";
import { RowActionCell } from "./RowActions";
import { documentsGroupId, documentsRowId, LastActivityCell, NewBadge, RowOpenLinks, rowIsNew, rowKeyOf, rowName, rowNeedsDecision, ShortId, VersionMarker, type OpenRowPanel } from "./RowCells";
import { StagePopover } from "./StagePopover";
import { isActiveRow, stageText, waitingOnText, type StageName } from "./stageLabels";

export interface DocumentCardsProps {
  page: DocumentRowsPage;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** "Details" opens the row panel (a full-screen sheet below 700 px); a stage line's popover opens it filtered. */
  onOpenPanel?: OpenRowPanel;
  /** Admin actions of one stage of a row, shown in the stage popover (as under the row panel's filtered Activity). */
  stageActions?: (row: DocumentRowView, stage: StageName) => ReactNode;
  /** Pseudonym of the signed-in lead (stage popover lines "Final: chosen by you"). */
  me?: string | null;
  /** `"{case}:{language}"` of the row the panel shows (the active card). */
  activeKey?: string | null;
  /** Inline notice under a row (plan confirmations, resolve options). */
  renderRowNotice?: (row: DocumentRowView) => ReactNode | null;
  /** Visit badge of a row, shown next to the card heading. */
  rowBadge?: (row: DocumentRowView) => ReactNode;
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  /** Plan saves for the "Plan…" popover (VD2). */
  planSaves?: PlanSaves;
  /** Lead actions of a row that are no step (its "+n" menu). */
  rowExtras?: (row: DocumentRowView) => readonly MenuItem[];
  onNavigate?: (route: Route) => void;
  busy?: boolean;
  empty?: ReactNode;
  /** Case and text checkboxes (VD4); the page owns the selection. */
  selection?: TableSelection;
}

interface DocumentCardProps extends Omit<DocumentCardsProps, "page" | "busy" | "empty" | "selection" | "activeKey"> {
  row: DocumentRowView;
  group: DocumentGroupView;
  active: boolean;
  select?: { checked: boolean; onSelect: (mode: GroupSelectMode) => void };
}

const STAGE_TITLES: readonly (readonly [StageName, string])[] = [["review", "Review"], ["annotation", "Annotation"], ["final", "Final"]];

const selectModeOf = (event: MouseEvent<HTMLInputElement>): GroupSelectMode =>
  event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle-keep-anchor" : "toggle";

interface StageLineProps {
  row: DocumentRowView;
  stage: StageName;
  title: string;
  sourceLanguage: string | null;
  projectKey: string;
  onOpenPanel?: OpenRowPanel;
  stageActions?: DocumentCardsProps["stageActions"];
  me?: string | null;
}

/**
 * "Review: ✓ Accepted · unchanged": the stage title labels the line; the glyph is decorative, the tone colours
 * the status. With the row panel the status is a button (dotted underline) that opens the stage popover.
 */
function StageLine({ row, stage, title, sourceLanguage, projectKey, onOpenPanel, stageActions, me }: StageLineProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const detailId = useId();
  const contentId = useId();
  const cell = row.stages?.[stage];
  const text = cell ? stageText(stage, cell, row, { sourceLanguage }) : { symbol: "", word: "—", detail: "" };
  const tone = cell?.tone ?? "none";
  // X5: the Final line's "1 flagged" (findings flagged "guidelines unclear" in the submitted consolidation), as in the table.
  const flagged = stage === "final" ? row.flagged_unclear ?? 0 : 0;
  const flagId = useId();
  const describedBy = [text.detail && detailId, flagged > 0 && flagId].filter(Boolean).join(" ");
  const status = <span className="stage-cell-status">{text.symbol && <><span className="stage-cell-symbol" aria-hidden="true">{text.symbol}</span>{" "}</>}{text.word}</span>;
  const openDetails = () => {
    setOpen(false);
    if (anchor.current) onOpenPanel?.(row, { stage, opener: anchor.current });
  };
  return <>
    <p className={["document-card-line", "document-card-stage", `stage-cell--${tone}`, !isActiveRow(row) && "stage-cell--muted"].filter(Boolean).join(" ")}>
      <span className="document-card-stage-label">{`${title}:`}</span>{" "}
      {cell && onOpenPanel
        ? <button ref={anchor} type="button" className="document-card-stage-button" aria-label={`${title}: ${text.word}. Show history, ${rowName(row)}`}
          aria-describedby={describedBy || undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? contentId : undefined}
          onClick={() => setOpen(value => !value)}>{status}</button>
        : status}
      {text.detail ? <span id={detailId} className="document-card-stage-detail">{` · ${text.detail}`}</span> : null}
      {flagged > 0 ? <span id={flagId} className="document-card-stage-detail documents-stage-flagged">{` · ${flagged} flagged`}</span> : null}
    </p>
    {/* After the line: the popover is a `div` (a sheet `Dialog` below 700 px), never inside the `p`. */}
    {open && <StagePopover row={row} stage={stage} projectKey={projectKey} anchorRef={anchor} contentId={contentId} me={me}
      actions={stageActions?.(row, stage)} onClose={() => setOpen(false)} onOpenDetails={openDetails} />}
  </>;
}

/** "Waiting on: You" (strong); with "+n" the full list is spoken instead of the short one (not only a title). */
function WaitingOnLine({ row }: { row: DocumentRowView }): JSX.Element {
  const { text, title, you } = waitingOnText(row);
  const value = you ? <strong>{text}</strong>
    : title && title !== text ? <span title={title}><span aria-hidden="true">{text}</span><span className="visually-hidden">{title}</span></span>
      : <span>{text}</span>;
  return <span className="documents-waiting-on">Waiting on: {value}</span>;
}

function DocumentCard({ row, group, projectKey, query, active: current, onOpenPanel, stageActions, me, renderRowNotice, rowBadge, onAction, planSaves, onNavigate, select, rowExtras }: DocumentCardProps): JSX.Element {
  const headingId = documentsRowId(row.case_id, row.language, "header");
  const name = rowName(row);
  const badge = rowBadge?.(row);
  const notice = renderRowNotice?.(row) ?? null;
  const active = isActiveRow(row);
  const source = group.rows.find(entry => entry.is_source)?.language ?? null;

  return (
    <article className={["document-card", !active && "document-card--muted", rowNeedsDecision(row) && "document-card--decision", current && "document-card--active"].filter(Boolean).join(" ")}
      aria-labelledby={headingId} aria-current={current || undefined}>
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
      {STAGE_TITLES.map(([stage, title]) => <StageLine key={stage} row={row} stage={stage} title={title} sourceLanguage={source} projectKey={projectKey}
        onOpenPanel={onOpenPanel} stageActions={stageActions} me={me} />)}
      <div className="document-card-line document-card-owner">
        <WaitingOnLine row={row} />
        <span className="document-card-activity"><LastActivityCell iso={row.last_activity_at} /></span>
      </div>
      <RowActionCell row={row} onAction={onAction} extraActions={rowExtras?.(row)} plan={planSaves ? { saves: planSaves, groupRevision: group.plan_revision } : undefined} block />
      <div className="document-card-line document-card-actions">
        <RowOpenLinks row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} />
        {onOpenPanel && <button type="button" id={documentsRowId(row.case_id, row.language, "details")} className="documents-details-button target-min"
          aria-label={`Details, ${name}`} onClick={event => onOpenPanel(row, { opener: event.currentTarget })}>Details</button>}
      </div>
      {notice != null && <div className="document-card-notice">{notice}</div>}
    </article>
  );
}

export function DocumentCards({ page, busy, empty, query, selection, activeKey = null, onOpenPanel, ...rest }: DocumentCardsProps): JSX.Element {
  const order = useMemo(() => page.groups.flatMap(group => group.rows.map(rowKeyOf)), [page.groups]);
  const openPanel = openAndSelect(onOpenPanel, selection, order);
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
              <DocumentCard key={rowKeyOf(row)} {...rest} onOpenPanel={openPanel} row={row} group={group} query={query} active={rowKeyOf(row) === activeKey}
                select={selection ? { checked: selection.keys.has(rowKeyOf(row)), onSelect: mode => selection.select(rowKeyOf(row), mode, order) } : undefined} />
            ))}
          </li>
        );
      })}
    </ul>
  );
}
