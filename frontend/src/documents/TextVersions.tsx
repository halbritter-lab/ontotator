import { forwardRef, type ReactNode } from "react";
import type { AssignmentView, DocumentRowView, DocumentVersionView, Member, VariantSummary } from "../api/client";
import { AssignmentActions } from "../admin/AssignmentActions";
import { assignmentStatusLabels, labelFor, taskLabels } from "../app/labels";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { personLabel } from "../app/submissionLabels";
import { Button, Checkbox, StatusBadge, type StatusTone } from "../ui";
import { TranslationCorrectionAction } from "../variants/TranslationCorrectionAction";
import { originLabels } from "../admin/variantMetadata";
import { statusBadgeText, versionName } from "./labels";
import { isPlainClick } from "./SubmissionsTable";

/** Page-level data the version actions need; without it Text versions is read-only. */
export interface TextVersionsTools {
  username: string;
  assignments: readonly AssignmentView[];
  members: Member[];
  /** Variant metadata by document id (correct translation). */
  variants: ReadonlyMap<string, VariantSummary>;
  /** Languages a translation reviewer needs (`reviewLanguages`). */
  requiredLanguages: (documentId: string) => readonly string[] | null;
  onAssignmentsChanged: () => void;
  /** Opens the translation review history of a version. */
  onShowTranslationReviews?: (documentId: string) => void;
  /** Per-version bulk selection (rows that show "Choose in Text versions"). */
  bulkSelected?: ReadonlySet<string>;
  onToggleBulk?: (documentId: string) => void;
}

/** Review decisions are stored as `rejected` / `query`; the badge helper expects `queried`. */
export function normalizedDecision(decision: string | null): string | null {
  return decision === "query" ? "queried" : decision;
}

function badgeTone(version: DocumentVersionView): StatusTone {
  if (version.accepted_without_review || version.translation_status === "accepted") return "success";
  if (version.translation_status === "automatic_check_failed") return "warning";
  if (version.translation_status === "reviewed" && ["rejected", "query", "queried"].includes(version.latest_review_decision ?? "")) return "warning";
  return "info";
}

function originText(version: DocumentVersionView, row: DocumentRowView): string {
  if (version.origin === "correction" && version.derived_from) {
    const parent = row.versions.find(entry => entry.document_id === version.derived_from);
    if (parent) return `Correction of ${versionName(parent.version, parent.chain_name, row.parallel_roots)}`;
  }
  return labelFor(originLabels, version.origin);
}

export interface TextVersionsProps {
  row: DocumentRowView;
  projectKey: string;
  /** Current Documents query, kept on case links as `documents_*`. */
  query: ProjectDocumentsQuery;
  onNavigate: (route: Route) => void;
  tools?: TextVersionsTools;
}

/** Child rows per text version of a row: origin, status with review decision, chain name, work and version actions. */
export const TextVersions = forwardRef<HTMLUListElement, TextVersionsProps>(function TextVersions({ row, projectKey, query, onNavigate, tools }, ref) {
  const documents = Object.keys(query).length ? { documents: query } : {};
  const chooseInVersions = row.bulk.mode === "choose_in_versions";
  return <ul ref={ref} className="text-versions">
    {row.versions.map(version => {
      const name = versionName(version.version, version.chain_name, row.parallel_roots);
      const badge = statusBadgeText(version.translation_status, normalizedDecision(version.latest_review_decision), version.accepted_without_review);
      const view: Route = { name: "projectCase", key: projectKey, caseId: row.case_id, variant: version.document_id, ...documents };
      const work = row.work.filter(item => item.document_id === version.document_id);
      const variant = tools?.variants.get(version.document_id);
      const checkboxId = `text-version-select-${encodeURIComponent(version.document_id)}`;
      let actions: ReactNode = null;
      if (tools) {
        actions = <>
          {variant && <TranslationCorrectionAction projectKey={projectKey} variant={variant} username={tools.username} requiredLanguages={tools.requiredLanguages(version.document_id)} />}
          {version.translation_status != null && tools.onShowTranslationReviews && <Button size="sm" aria-label={`Translation reviews for ${name}`} onClick={() => tools.onShowTranslationReviews?.(version.document_id)}>Translation reviews</Button>}
        </>;
      }
      return <li key={version.document_id} className="text-version">
        <div className="text-version-head">
          {chooseInVersions && tools?.onToggleBulk && <Checkbox id={checkboxId} label={<span className="visually-hidden">Select {name} for assignment</span>}
            checked={tools.bulkSelected?.has(version.document_id) ?? false} onChange={() => tools.onToggleBulk?.(version.document_id)} />}
          <span className="text-version-name">{name}</span>
          <span className="text-version-origin">{originText(version, row)}</span>
          {badge && <StatusBadge tone={badgeTone(version)}>{badge}</StatusBadge>}
          <span className="text-version-chain">{version.chain_name}</span>
          {!version.matches_filter && <span className="cell-secondary">Does not match the filters</span>}
        </div>
        {work.length > 0 && <ul className="text-version-work" aria-label={`Assignments on ${name}`}>
          {work.map(item => {
            const assignment = tools?.assignments.find(entry => entry.id === item.assignment_id && entry.document_id === version.document_id && !entry.revoked_at);
            return <li key={item.assignment_id}>
              <span>{personLabel(item.author_label, item.is_me)} · {labelFor(taskLabels, item.task)} · {labelFor(assignmentStatusLabels, item.status)}</span>
              {item.held && <> <StatusBadge tone="warning">Paused</StatusBadge></>}
              {assignment && tools && <AssignmentActions assignment={assignment} members={tools.members} onChanged={tools.onAssignmentsChanged} />}
            </li>;
          })}
        </ul>}
        <div className="text-version-actions">
          <a href={routeHref(view)} aria-label={`View text ${name}`} onClick={event => {
            if (!isPlainClick(event)) return;
            event.preventDefault(); onNavigate(view);
          }}>View text</a>
          {actions}
        </div>
      </li>;
    })}
  </ul>;
});
