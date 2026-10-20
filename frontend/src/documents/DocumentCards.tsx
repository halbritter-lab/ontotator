/**
 * Narrow-viewport Documents list (spec "Narrow (Documents)"): one case card per case with one
 * `<article>` per language row: heading "{case · language}", the plan chips, the next step
 * (strong) with badges and secondary line, "Owner: …", the row action full width, "Open" and
 * "Details". Not-in-plan rows collapse into one line per case card, as in the table.
 */
import { useId, useMemo, type ReactNode } from "react";
import type { DocumentGroupView, DocumentRowView, DocumentRowsPage, NextStepView } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import { IconChevronRight } from "../ui/icons";
import { caseHeaderText, notInPlanLanguages } from "./DocumentsTable";
import { ownerLabel } from "./nextStepLabels";
import { ActionCell, documentsRowId, LastActivityCell, NextStepCell, RowOpenLinks, ShortId, rowKeyOf, rowName } from "./RowCells";

export interface DocumentCardsProps {
  page: DocumentRowsPage;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** Toggle membership of `"{case}:{language}"` in `query.open`. */
  onToggleRow: (key: string) => void;
  shownNotInPlan: ReadonlySet<string>;
  onToggleNotInPlan: (caseId: string) => void;
  /** Plan chips of a row (card size; built by the page). */
  renderPlan?: (row: DocumentRowView, group: DocumentGroupView) => ReactNode;
  /** Inline notice under a row (plan confirmations, resolve options). */
  renderRowNotice?: (row: DocumentRowView) => ReactNode | null;
  /** Expanded content of an open row (built by the page); stacks inside the card, with `layout: "list"` for Submissions. */
  renderExpanded?: (row: DocumentRowView, options: { layout: "list" }) => ReactNode;
  /** Visit badge of a row, shown next to the card heading (also while collapsed). */
  rowBadge?: (row: DocumentRowView) => ReactNode;
  onAction?: (row: DocumentRowView, step: NextStepView) => void;
  onNavigate?: (route: Route) => void;
  busy?: boolean;
  empty?: ReactNode;
}

interface DocumentCardProps extends Omit<DocumentCardsProps, "page" | "busy" | "empty" | "shownNotInPlan" | "onToggleNotInPlan"> {
  row: DocumentRowView;
  group: DocumentGroupView;
  expanded: boolean;
}

function DocumentCard({ row, group, projectKey, query, expanded, onToggleRow, renderPlan, renderRowNotice, renderExpanded, rowBadge, onAction, onNavigate }: DocumentCardProps): JSX.Element {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const regionId = `${baseId}-expanded`;
  const name = rowName(row);
  const showRegion = expanded && renderExpanded != null;
  const badge = rowBadge?.(row);
  const notice = renderRowNotice?.(row) ?? null;

  return (
    <article className="document-card" aria-labelledby={headingId}>
      <div className="document-card-line document-card-head">
        <h3 id={headingId} className="document-card-title">
          <span aria-hidden="true"><ShortId value={row.case_id} />{` · ${row.language}`}</span>
          <span className="visually-hidden">{name}</span>
        </h3>
        {row.is_source && <span className="documents-source">source</span>}
        {badge != null && badge !== false && <span className="documents-row-badge">{badge}</span>}
      </div>
      <div className="document-card-line document-card-plan">{renderPlan?.(row, group)}</div>
      <div className="document-card-line document-card-step"><NextStepCell row={row} strong onToggleRow={key => { if (!expanded) onToggleRow(key); }} /></div>
      <div className="document-card-line document-card-owner">
        <span>{`Owner: ${row.in_plan ? ownerLabel(row.next_step) : "—"}`}</span>
        <span className="document-card-activity"><LastActivityCell iso={row.last_activity_at} /></span>
      </div>
      <ActionCell row={row} onAction={onAction} block />
      <div className="document-card-line document-card-actions">
        <RowOpenLinks row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} />
        <button
          type="button"
          id={documentsRowId(row.case_id, row.language, "disclosure")}
          className="document-card-toggle"
          aria-expanded={expanded}
          aria-controls={showRegion ? regionId : undefined}
          aria-label={`Show details, ${name}`}
          onClick={() => onToggleRow(rowKeyOf(row))}
        >
          <IconChevronRight className="disclosure-chevron" />
          Details
        </button>
      </div>
      {notice != null && <div className="document-card-notice">{notice}</div>}
      {showRegion && <div id={regionId} className="document-card-expanded">{renderExpanded(row, { layout: "list" })}</div>}
    </article>
  );
}

export function DocumentCards({ page, busy, empty, query, shownNotInPlan, onToggleNotInPlan, ...rest }: DocumentCardsProps): JSX.Element {
  const open = useMemo(() => new Set(query.open ?? []), [query.open]);
  if (page.groups.length === 0) return <div className="document-cards-empty">{empty}</div>;
  return (
    <ul className="document-cards" aria-label="Documents" aria-busy={busy || undefined}>
      {page.groups.map(group => {
        const hidden = notInPlanLanguages(group);
        const shown = shownNotInPlan.has(group.case_id);
        const rows = group.rows.filter(row => row.in_plan || shown);
        return (
          <li key={group.case_id} className="document-case-card">
            <p className="document-case-card-title">{caseHeaderText(group)}</p>
            {rows.filter(row => row.in_plan).map(row => (
              <DocumentCard key={rowKeyOf(row)} {...rest} row={row} group={group} query={query} expanded={open.has(rowKeyOf(row))} />
            ))}
            {hidden.length > 0 && (
              <p className="documents-not-in-plan">
                {`${hidden.join(", ")} not in plan · `}
                <button type="button" className="documents-not-in-plan-toggle" aria-expanded={shown} onClick={() => onToggleNotInPlan(group.case_id)}>{shown ? "hide" : "show"}</button>
              </p>
            )}
            {rows.filter(row => !row.in_plan).map(row => (
              <DocumentCard key={rowKeyOf(row)} {...rest} row={row} group={group} query={query} expanded={open.has(rowKeyOf(row))} />
            ))}
          </li>
        );
      })}
    </ul>
  );
}
