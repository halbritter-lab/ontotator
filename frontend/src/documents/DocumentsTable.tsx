/**
 * Documents table under the work plan (spec "Screens › Documents" item 6): one `<tbody>` per case
 * with a case header, one row per language with six columns (Text · language, Plan, Next step,
 * Owner, Action, Last activity). Rows that are not in the plan collapse into one line per case
 * ("en, fr not in plan · show"). Expansion state is owned by the page; this component renders it.
 */
import { useId, useMemo, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage, NextStepView } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import { plural } from "../app/labels";
import { DataTable, type Column, type DataTableGroup } from "../ui/DataTable";
import { IconChevronRight } from "../ui/icons";
import { StatusBadge } from "../ui/StatusBadge";
import {
  ActionCell,
  documentsGroupId,
  documentsNotInPlanId,
  LastActivityCell,
  notInPlanToggleLabel,
  NextStepCell,
  OwnerCell,
  RowHeaderCell,
  ShortId,
  rowKeyOf,
} from "./RowCells";

/** Above this many matching cases, groups without a decision start collapsed. */
export const COLLAPSE_GROUPS_ABOVE = 50;

/** In-plan rows of a group whose next step is a lead decision. */
export function decisionCount(group: Pick<DocumentGroupView, "rows">): number {
  return group.rows.filter(row => row.in_plan && row.next_step?.kind === "decision").length;
}

/** Initial group expansion: groups with a decision step expanded; all expanded while at most 50 cases match. */
export function initialExpandedGroups(page: Pick<DocumentRowsPage, "groups" | "group_count">): Set<string> {
  const expandAll = page.group_count <= COLLAPSE_GROUPS_ABOVE;
  return new Set(page.groups.filter(group => expandAll || decisionCount(group) > 0).map(group => group.case_id));
}

/** "case-0101 · en source + 2 translations"; without the source row in view "case-0101 · 3 languages". */
export function caseHeaderText(group: Pick<DocumentGroupView, "case_id" | "rows" | "language_count">): string {
  const source = group.rows.find(row => row.is_source);
  if (!source) return `${group.case_id} · ${plural(group.language_count, "language")}`;
  const translations = group.language_count - 1;
  return `${group.case_id} · ${source.language} source${translations > 0 ? ` + ${plural(translations, "translation")}` : ""}`;
}

/** Languages of the group's shown rows that are not in the plan, source first. */
export function notInPlanLanguages(group: Pick<DocumentGroupView, "rows">): string[] {
  return group.rows.filter(row => !row.in_plan).map(row => row.language);
}

/** A table line: a language row or the collapsed "not in plan" line of a case. */
type Line = { kind: "row"; row: DocumentRowView } | { kind: "hidden"; caseId: string; languages: string[]; shown: boolean };
const lineKey = (line: Line): string => (line.kind === "row" ? rowKeyOf(line.row) : `${line.caseId}:not-in-plan`);

export interface DocumentsTableProps {
  page: DocumentRowsPage;
  projectKey: string;
  query: ProjectDocumentsQuery;
  expandedGroups: ReadonlySet<string>;
  onToggleGroup: (caseId: string) => void;
  /** Toggle membership of `"{case}:{language}"` in `query.open`. */
  onToggleRow: (key: string) => void;
  /** Cases whose not-in-plan rows are shown. */
  shownNotInPlan: ReadonlySet<string>;
  onToggleNotInPlan: (caseId: string) => void;
  /** Plan chips of a row (built by the page). */
  renderPlan?: (row: DocumentRowView, group: DocumentGroupView) => ReactNode;
  /** Inline notice under a row (plan confirmations, resolve options), also while collapsed. */
  renderRowNotice?: (row: DocumentRowView) => ReactNode | null;
  /** Expanded content of an open row (built by the page). */
  renderExpanded?: (row: DocumentRowView) => ReactNode;
  /** Visit badge of a row, shown next to its row header (also while collapsed). */
  rowBadge?: (row: DocumentRowView) => ReactNode;
  /** The row action of a lead-owned step. */
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  onNavigate?: (route: Route) => void;
  busy?: boolean;
  empty?: ReactNode;
}

export function DocumentsTable({
  page, projectKey, query, expandedGroups, onToggleGroup, onToggleRow, shownNotInPlan, onToggleNotInPlan,
  renderPlan, renderRowNotice, renderExpanded, rowBadge, onAction, onNavigate, busy, empty,
}: DocumentsTableProps): JSX.Element {
  const baseId = useId();
  const open = useMemo(() => new Set(query.open ?? []), [query.open]);
  const groupOf = useMemo(() => new Map(page.groups.map(group => [group.case_id, group])), [page.groups]);

  // Stable DOM IDs per row key: the group header controls its rows, a row controls its region.
  const ids = useMemo(() => {
    const map = new Map<string, { row: string; region: string }>();
    page.groups.forEach((group, groupIndex) => group.rows.forEach((row, rowIndex) => {
      map.set(rowKeyOf(row), { row: `${baseId}-g${groupIndex}-r${rowIndex}`, region: `${baseId}-g${groupIndex}-r${rowIndex}-expanded` });
    }));
    return map;
  }, [page.groups, baseId]);

  const isOpen = (row: DocumentRowView) => open.has(rowKeyOf(row));
  const rowCell = (render: (row: DocumentRowView) => ReactNode) => (line: Line) => (line.kind === "row" ? render(line.row) : null);

  const columns: Column<Line>[] = [
    {
      id: "text",
      header: "Text · language",
      rowHeader: true,
      cell: line => (line.kind === "hidden"
        ? <span className="documents-not-in-plan">
          {`${line.languages.join(", ")} not in plan · `}
          <button type="button" id={documentsNotInPlanId(line.caseId)} className="documents-not-in-plan-toggle" aria-expanded={line.shown}
            aria-label={notInPlanToggleLabel(line.caseId, line.languages, line.shown)} onClick={() => onToggleNotInPlan(line.caseId)}>{line.shown ? "hide" : "show"}</button>
        </span>
        : <RowHeaderCell
          row={line.row}
          projectKey={projectKey}
          query={query}
          expanded={isOpen(line.row)}
          controls={isOpen(line.row) && renderExpanded ? ids.get(rowKeyOf(line.row))?.region : undefined}
          onToggleRow={onToggleRow}
          onNavigate={onNavigate}
          badge={rowBadge?.(line.row)}
        />),
    },
    { id: "plan", header: "Plan", cell: rowCell(row => renderPlan?.(row, groupOf.get(row.case_id)!) ?? null) },
    { id: "step", header: "Next step", cell: rowCell(row => <NextStepCell row={row} onToggleRow={key => { if (!open.has(key)) onToggleRow(key); }} />) },
    { id: "owner", header: "Owner", cell: rowCell(row => <OwnerCell row={row} />) },
    { id: "action", header: "Action", cell: rowCell(row => <ActionCell row={row} onAction={onAction} />) },
    { id: "activity", header: "Last activity", cell: rowCell(row => <LastActivityCell iso={row.last_activity_at} />) },
  ];

  const groups: DataTableGroup<Line>[] = page.groups.map(group => {
    const expanded = expandedGroups.has(group.case_id);
    const hidden = notInPlanLanguages(group);
    const shown = shownNotInPlan.has(group.case_id);
    const lines: Line[] = group.rows.filter(row => row.in_plan).map(row => ({ kind: "row", row }));
    if (hidden.length) {
      lines.push({ kind: "hidden", caseId: group.case_id, languages: hidden, shown });
      if (shown) lines.push(...group.rows.filter(row => !row.in_plan).map(row => ({ kind: "row" as const, row })));
    }
    const controls = expanded ? lines.flatMap(line => (line.kind === "row" ? [ids.get(rowKeyOf(line.row))?.row] : [])).filter(Boolean).join(" ") : "";
    const decisions = decisionCount(group);
    const title = caseHeaderText(group);
    return {
      key: group.case_id,
      expanded,
      rows: lines,
      headerProps: { className: decisions ? "documents-group documents-group--issue" : "documents-group" },
      header: (
        <span className="documents-group-header">
          <button
            type="button"
            id={documentsGroupId(group.case_id)}
            className="documents-group-toggle target-min"
            aria-expanded={expanded}
            aria-controls={controls || undefined}
            aria-label={title}
            onClick={() => onToggleGroup(group.case_id)}
          >
            <IconChevronRight className="disclosure-chevron" />
            <ShortId value={group.case_id} />
            <span className="documents-group-meta">{title.slice(group.case_id.length)}</span>
          </button>
          {decisions > 0 && <StatusBadge tone="warning">{plural(decisions, "decision")}</StatusBadge>}
          {group.last_activity_at && <span className="documents-group-activity"><LastActivityCell iso={group.last_activity_at} /></span>}
        </span>
      ),
    };
  });

  const below = (line: Line): ReactNode | null => {
    if (line.kind !== "row") return null;
    const row = line.row;
    const notice = renderRowNotice?.(row) ?? null;
    const expandedContent = isOpen(row) && renderExpanded ? renderExpanded(row) : null;
    if (notice == null && expandedContent == null) return null;
    return <>
      {notice != null && <div className="documents-row-notice-slot">{notice}</div>}
      {expandedContent != null && <div id={ids.get(rowKeyOf(row))?.region} className="documents-expanded-slot">{expandedContent}</div>}
    </>;
  };

  return (
    <DataTable
      label="Documents"
      className="documents-table"
      columns={columns}
      rows={[]}
      groups={groups}
      rowKey={lineKey}
      rowProps={line => (line.kind === "row"
        ? { id: ids.get(rowKeyOf(line.row))?.row, className: line.row.in_plan ? "documents-row" : "documents-row documents-row--not-in-plan" }
        : { className: "documents-not-in-plan-row" })}
      renderExpanded={below}
      busy={busy}
      empty={empty}
    />
  );
}
