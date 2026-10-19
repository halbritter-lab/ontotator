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
  FinalCell,
  IssuesCell,
  LastActivityCell,
  RouteLink,
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
  /** Expanded content of an open row (built by the page); stacks inside the card. */
  renderExpanded?: (row: DocumentRowView) => ReactNode;
  onNavigate?: (route: Route) => void;
  busy?: boolean;
  empty?: ReactNode;
}

interface DocumentCardProps extends Omit<DocumentCardsProps, "page" | "busy" | "empty"> {
  row: DocumentRowView;
  expanded: boolean;
}

function DocumentCard({ row, projectKey, query, expanded, onToggleRow, selected, onToggleSelect, renderExpanded, onNavigate }: DocumentCardProps): JSX.Element {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const regionId = `${baseId}-expanded`;
  const descriptionId = `${baseId}-open-description`;
  const name = rowName(row);
  const documents = Object.keys(query).length ? { documents: query } : {};
  const openRoute: Route = { name: "projectCase", key: projectKey, caseId: row.case_id, variant: row.open.document_id, ...documents };
  const description = row.open.reason === "most_recent_root" && row.open.label ? `Opens ${row.open.label}, the most recent translation` : null;
  const showRegion = expanded && renderExpanded != null;

  return (
    <article className="document-card" aria-labelledby={headingId}>
      <div className="document-card-line document-card-head">
        <span className="document-card-select"><SelectCell row={row} selected={selected} onToggleSelect={onToggleSelect} /></span>
        <h3 id={headingId} className="document-card-title">
          <span aria-hidden="true"><ShortId value={row.case_id} />{` · ${row.language}`}</span>
          <span className="visually-hidden">{name}</span>
        </h3>
        <IssuesCell row={row} />
      </div>
      <div className="document-card-line"><VersionCell row={row} expanded={expanded} /></div>
      <div className="document-card-line"><FinalCell row={row} /></div>
      <div className="document-card-line document-card-work">
        <WorkCell row={row} />
        <span className="document-card-activity"><LastActivityCell iso={row.last_activity_at} /></span>
      </div>
      <div className="document-card-line document-card-actions">
        <RouteLink route={openRoute} onNavigate={onNavigate} className="documents-open" aria-label={`Open ${name}`} aria-describedby={description ? descriptionId : undefined}>Open</RouteLink>
        {description && <span id={descriptionId} className="visually-hidden">{description}</span>}
        {row.own_open_assignment_id != null && (
          <RouteLink route={{ name: "task", assignmentId: row.own_open_assignment_id }} onNavigate={onNavigate} className="documents-open-task">Open my task</RouteLink>
        )}
        <button
          type="button"
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
      {showRegion && <div id={regionId} className="document-card-expanded">{renderExpanded(row)}</div>}
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
