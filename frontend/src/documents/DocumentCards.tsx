/**
 * Narrow-viewport Documents list: one `<article aria-labelledby>` card per language row, built from
 * the same cell renderers as the table (`RowCells.tsx`) so names and wording stay identical.
 * Row expansion state is owned by the page (`query.open`); this component only renders it.
 */
import { useId, useMemo, type ReactNode } from "react";
import type { DocumentRowView, DocumentRowsPage } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import { IconChevronRight } from "../ui/icons";
import {
  documentsRowId,
  FinalCell,
  IssuesCell,
  LastActivityCell,
  RowOpenLinks,
  SelectCell,
  ShortId,
  VersionCell,
  WorkCell,
  rowKeyOf,
  rowName,
} from "./RowCells";

export interface DocumentCardsProps {
  page: DocumentRowsPage;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** Toggle membership of `"{case}:{language}"` in `query.open`. */
  onToggleRow: (key: string) => void;
  /** Selected bulk document IDs. */
  selected: ReadonlySet<string>;
  onToggleSelect: (documentId: string, checked: boolean) => void;
  /** Expanded content of an open row (built by the page); stacks inside the card, with `layout: "list"` for Submissions. */
  renderExpanded?: (row: DocumentRowView, options: { layout: "list" }) => ReactNode;
  /** Visit badge of a row, shown next to the card heading (also while collapsed). */
  rowBadge?: (row: DocumentRowView) => ReactNode;
  onNavigate?: (route: Route) => void;
  busy?: boolean;
  empty?: ReactNode;
}

interface DocumentCardProps extends Omit<DocumentCardsProps, "page" | "busy" | "empty"> {
  row: DocumentRowView;
  expanded: boolean;
}

function DocumentCard({ row, projectKey, query, expanded, onToggleRow, selected, onToggleSelect, renderExpanded, rowBadge, onNavigate }: DocumentCardProps): JSX.Element {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const regionId = `${baseId}-expanded`;
  const name = rowName(row);
  const showRegion = expanded && renderExpanded != null;
  const badge = rowBadge?.(row);

  return (
    <article className="document-card" aria-labelledby={headingId}>
      <div className="document-card-line document-card-head">
        <span className="document-card-select"><SelectCell row={row} selected={selected} onToggleSelect={onToggleSelect} /></span>
        <h3 id={headingId} className="document-card-title">
          <span aria-hidden="true"><ShortId value={row.case_id} />{` · ${row.language}`}</span>
          <span className="visually-hidden">{name}</span>
        </h3>
        {badge != null && badge !== false && <span className="documents-row-badge">{badge}</span>}
        <IssuesCell row={row} />
      </div>
      <div className="document-card-line"><VersionCell row={row} expanded={expanded} /></div>
      <div className="document-card-line"><FinalCell row={row} /></div>
      <div className="document-card-line document-card-work">
        <WorkCell row={row} />
        <span className="document-card-activity"><LastActivityCell iso={row.last_activity_at} /></span>
      </div>
      <div className="document-card-line document-card-actions">
        <RowOpenLinks row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} />
        <button
          type="button"
          id={documentsRowId(row.case_id, row.language, "disclosure")}
          className="document-card-toggle"
          aria-expanded={expanded}
          aria-controls={showRegion ? regionId : undefined}
          aria-label={`Show submissions, ${name}`}
          onClick={() => onToggleRow(rowKeyOf(row))}
        >
          <IconChevronRight className="disclosure-chevron" />
          Show submissions
        </button>
      </div>
      {showRegion && <div id={regionId} className="document-card-expanded">{renderExpanded(row, { layout: "list" })}</div>}
    </article>
  );
}

export function DocumentCards({ page, busy, empty, query, ...rest }: DocumentCardsProps): JSX.Element {
  const open = useMemo(() => new Set(query.open ?? []), [query.open]);
  const rows = page.groups.flatMap(group => group.rows);
  if (rows.length === 0) return <div className="document-cards-empty">{empty}</div>;
  return (
    <ul className="document-cards" aria-label="Documents" aria-busy={busy || undefined}>
      {rows.map(row => (
        <li key={rowKeyOf(row)} className="document-cards-item">
          <DocumentCard {...rest} row={row} query={query} expanded={open.has(rowKeyOf(row))} />
        </li>
      ))}
    </ul>
  );
}
