/**
 * Collapsed Documents table: one `<tbody>` per text with a group header disclosure, one row per
 * language with a row-header disclosure. Group and row expansion state is owned by the page
 * (`expandedGroups`, `query.open`); this component only renders it.
 */
import { useId, useMemo, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import { plural } from "../app/labels";
import { DataTable, type Column, type DataTableGroup } from "../ui/DataTable";
import { IconChevronRight } from "../ui/icons";
import {
  FinalCell,
  IssuesCell,
  LastActivityCell,
  RowHeaderCell,
  SelectCell,
  ShortId,
  VersionCell,
  WorkCell,
  rowKeyOf,
} from "./RowCells";

/** Above this many texts (after filtering) groups without a bar-category issue start collapsed. */
export const COLLAPSE_GROUPS_ABOVE = 50;

/** Initial group expansion: issue groups always open; all open while the project has at most 50 texts. */
export function initialExpandedGroups(page: Pick<DocumentRowsPage, "groups" | "group_count">): Set<string> {
  const expandAll = page.group_count <= COLLAPSE_GROUPS_ABOVE;
  return new Set(page.groups.filter(group => expandAll || group.has_issue).map(group => group.case_id));
}

/** "{text ID}, {n} languages, final {n} of {m}". */
export function groupName(group: DocumentGroupView): string {
  return `${group.case_id}, ${plural(group.language_count, "language")}, final ${group.final_count} of ${group.language_count}`;
}

export interface DocumentsTableProps {
  page: DocumentRowsPage;
  projectKey: string;
  query: ProjectDocumentsQuery;
  expandedGroups: ReadonlySet<string>;
  onToggleGroup: (caseId: string) => void;
  /** Toggle membership of `"{case}:{language}"` in `query.open`. */
  onToggleRow: (key: string) => void;
  /** Selected bulk document IDs. */
  selected: ReadonlySet<string>;
  onToggleSelect: (documentId: string, checked: boolean) => void;
  /** Expanded content of an open row (built by the page). */
  renderExpanded?: (row: DocumentRowView) => ReactNode;
  /** Visit badge of a row, shown next to its row header (also while collapsed). */
  rowBadge?: (row: DocumentRowView) => ReactNode;
  /** Header of the Select column (e.g. "Select all"); defaults to a visually hidden "Select". */
  selectHeader?: ReactNode;
  onNavigate?: (route: Route) => void;
  busy?: boolean;
  empty?: ReactNode;
}

export function DocumentsTable({
  page, projectKey, query, expandedGroups, onToggleGroup, onToggleRow, selected, onToggleSelect,
  renderExpanded, rowBadge, selectHeader, onNavigate, busy, empty,
}: DocumentsTableProps): JSX.Element {
  const baseId = useId();
  const open = useMemo(() => new Set(query.open ?? []), [query.open]);

  // Stable DOM IDs per row key: the group header controls its rows, a row controls its region.
  const ids = useMemo(() => {
    const map = new Map<string, { row: string; region: string }>();
    page.groups.forEach((group, groupIndex) => group.rows.forEach((row, rowIndex) => {
      map.set(rowKeyOf(row), { row: `${baseId}-g${groupIndex}-r${rowIndex}`, region: `${baseId}-g${groupIndex}-r${rowIndex}-expanded` });
    }));
    return map;
  }, [page.groups, baseId]);

  const isOpen = (row: DocumentRowView) => open.has(rowKeyOf(row));

  const columns: Column<DocumentRowView>[] = [
    {
      id: "select",
      header: selectHeader ?? <span className="visually-hidden">Select</span>,
      width: "6rem",
      cell: row => <SelectCell row={row} selected={selected} onToggleSelect={onToggleSelect} />,
    },
    {
      id: "text",
      header: "Text · language",
      rowHeader: true,
      cell: row => (
        <RowHeaderCell
          row={row}
          projectKey={projectKey}
          query={query}
          expanded={isOpen(row)}
          controls={isOpen(row) && renderExpanded ? ids.get(rowKeyOf(row))?.region : undefined}
          onToggleRow={onToggleRow}
          onNavigate={onNavigate}
          badge={rowBadge?.(row)}
        />
      ),
    },
    { id: "versions", header: "Text version(s)", cell: row => <VersionCell row={row} expanded={isOpen(row)} /> },
    { id: "work", header: "Work", cell: row => <WorkCell row={row} /> },
    { id: "final", header: "Final result", cell: row => <FinalCell row={row} /> },
    { id: "issues", header: "Issues", cell: row => <IssuesCell row={row} /> },
    {
      id: "activity",
      header: "Last activity",
      cell: row => <LastActivityCell iso={row.last_activity_at} />,
    },
  ];

  const groups: DataTableGroup<DocumentRowView>[] = page.groups.map(group => {
    const expanded = expandedGroups.has(group.case_id);
    const controls = expanded ? group.rows.map(row => ids.get(rowKeyOf(row))?.row).filter(Boolean).join(" ") : "";
    const notes = group.note_count;
    return {
      key: group.case_id,
      expanded,
      rows: group.rows,
      headerProps: { className: group.has_issue ? "documents-group documents-group--issue" : "documents-group" },
      header: (
        <span className="documents-group-header">
          <button
            type="button"
            className="documents-group-toggle target-min"
            aria-expanded={expanded}
            aria-controls={controls || undefined}
            aria-label={groupName(group)}
            onClick={() => onToggleGroup(group.case_id)}
          >
            <IconChevronRight className="disclosure-chevron" />
            <ShortId value={group.case_id} />
            <span className="documents-group-meta">{`${plural(group.language_count, "language")} · final ${group.final_count} of ${group.language_count}`}</span>
          </button>
          {group.issue_count > 0 && <span className="documents-group-issues">{plural(group.issue_count, "issue")}</span>}
          {notes > 0 && <span className="documents-group-notes">{plural(notes, "note")}</span>}
          {group.last_activity_at && <span className="documents-group-activity"><LastActivityCell iso={group.last_activity_at} /></span>}
        </span>
      ),
    };
  });

  return (
    <DataTable
      label="Documents"
      className="documents-table"
      columns={columns}
      rows={[]}
      groups={groups}
      rowKey={rowKeyOf}
      rowProps={row => ({ id: ids.get(rowKeyOf(row))?.row, className: "documents-row" })}
      renderExpanded={renderExpanded ? row => (isOpen(row)
        ? <div id={ids.get(rowKeyOf(row))?.region} className="documents-expanded-slot">{renderExpanded(row)}</div>
        : null) : undefined}
      busy={busy}
      empty={empty}
    />
  );
}
