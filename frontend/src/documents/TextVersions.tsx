import { forwardRef, type ReactNode } from "react";
import type { AssignmentView, DocumentRowView, DocumentVersionView, Member, VariantSummary } from "../api/client";
import { AssignmentActions } from "../admin/AssignmentActions";
import { assignmentStatusLabels, labelFor, taskLabels } from "../app/labels";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { personLabel as identityLabel, type PersonRef } from "../app/identity";
import { formatTime, personLabel } from "../app/submissionLabels";
import { Button, Checkbox, StatusBadge, type StatusTone } from "../ui";
import { TranslationCorrectionAction } from "../variants/TranslationCorrectionAction";
import { originLabels } from "../admin/variantMetadata";
import { statusBadgeText, versionName } from "./labels";
import { isPlainClick, rowName } from "./RowCells";

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

/** Acceptance record of a translation version (spec "Annotate without review: acceptance record"). */
export interface VersionAcceptance {
  source: "package" | "lead" | "override";
  reason?: string | null;
  accepted_at?: string | null;
  accepted_by?: PersonRef | null;
  /** Package metadata (`translation.review`), kept only as given. */
  reviewer?: string | null;
  reviewed_at?: string | null;
}

/** Discard record of a text version (spec "Discarding a language version"). */
export interface VersionDiscard {
  reason?: string | null;
  discarded_at?: string | null;
  discarded_by?: PersonRef | null;
}

/**
 * Records the expanded row reads from a `DocumentVersionView` when the API sends them
 * (`acceptance`, `discarded`); both stay optional so rows without them render unchanged.
 */
export interface VersionRecords {
  acceptance?: VersionAcceptance | null;
  discarded?: VersionDiscard | null;
}

export function acceptanceOf(version: DocumentVersionView): VersionAcceptance | null {
  return (version as DocumentVersionView & VersionRecords).acceptance ?? null;
}

/** A version is discarded by its own record or because every version of the row is discarded. */
export function isDiscarded(row: Pick<DocumentRowView, "plan_row">, version: DocumentVersionView): boolean {
  return !!row.plan_row?.discarded || !!(version as DocumentVersionView & VersionRecords).discarded;
}

const dateOnly = (iso: string, now?: Date) => formatTime(iso, { now }).split(", ")[0];

/**
 * "Accepted: reviewed outside Ontocurator, Project lead (ann-0002), 20 Oct, 11:40, {reason}",
 * "Accepted: marked as reviewed in the package, R. Roe, 1 Oct".
 */
export function acceptanceLabel(acceptance: VersionAcceptance, now?: Date): string {
  if (acceptance.source === "package") {
    const given = [acceptance.reviewer?.trim(), acceptance.reviewed_at ? dateOnly(acceptance.reviewed_at, now) : null].filter(Boolean).join(", ");
    return ["Accepted: marked as reviewed in the package", given].filter(Boolean).join(", ");
  }
  const what = acceptance.source === "lead" ? "Accepted: reviewed outside Ontocurator" : "Accepted: without review at import";
  return [what, acceptance.accepted_by ? identityLabel(acceptance.accepted_by) : null, acceptance.accepted_at ? formatTime(acceptance.accepted_at, { now }) : null,
    acceptance.reason?.trim()].filter(Boolean).join(", ");
}

/** "Discarded, Project lead (ann-0002), 19 Oct, 08:00, {reason}"; "Discarded" without a record. */
export function discardLabel(version: DocumentVersionView, now?: Date): string {
  const record = (version as DocumentVersionView & VersionRecords).discarded;
  if (!record) return "Discarded";
  return ["Discarded", record.discarded_by ? identityLabel(record.discarded_by) : null, record.discarded_at ? formatTime(record.discarded_at, { now }) : null,
    record.reason?.trim()].filter(Boolean).join(", ");
}

function badgeTone(version: DocumentVersionView): StatusTone {
  if (version.accepted_without_review || version.translation_status === "accepted") return "success";
  if (version.translation_status === "automatic_check_failed") return "warning";
  if (version.translation_status === "reviewed" && ["rejected", "query"].includes(version.latest_review_decision ?? "")) return "warning";
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
  /** Reference time for the current-year rule (tests). */
  now?: Date;
}

/** Child rows per text version of a row: origin, status with review decision, chain name, work and version actions. */
export const TextVersions = forwardRef<HTMLUListElement, TextVersionsProps>(function TextVersions({ row, projectKey, query, onNavigate, tools, now }, ref) {
  const documents = Object.keys(query).length ? { documents: query } : {};
  const chooseInVersions = row.bulk.mode === "choose_in_versions";
  return <ul ref={ref} className="text-versions">
    {row.versions.map(version => {
      const name = versionName(version.version, version.chain_name, row.parallel_roots);
      const badge = statusBadgeText(version.translation_status, version.latest_review_decision, version.accepted_without_review);
      const view: Route = { name: "projectCase", key: projectKey, caseId: row.case_id, variant: version.document_id, ...documents };
      // Moved tasks (text change, "Move to v2") stay listed on their old version as history.
      const work = [...row.work, ...(row.moved_work ?? [])].filter(item => item.document_id === version.document_id);
      const variant = tools?.variants.get(version.document_id);
      const fullName = `${name} of ${rowName(row)}`;
      const checkboxId = `text-version-select-${encodeURIComponent(version.document_id)}`;
      const discarded = isDiscarded(row, version);
      const acceptance = acceptanceOf(version);
      let actions: ReactNode = null;
      if (tools) {
        actions = <>
          {variant && <TranslationCorrectionAction projectKey={projectKey} variant={variant} username={tools.username} requiredLanguages={tools.requiredLanguages(version.document_id)} />}
          {version.translation_status != null && tools.onShowTranslationReviews && <Button size="sm" aria-label={`Translation reviews for ${name}`} onClick={() => tools.onShowTranslationReviews?.(version.document_id)}>Translation reviews</Button>}
        </>;
      }
      return <li key={version.document_id} className="text-version">
        <div className="text-version-head">
          {chooseInVersions && tools?.onToggleBulk && <Checkbox id={checkboxId} label={<span className="visually-hidden">Select {fullName} for assignment</span>}
            checked={tools.bulkSelected?.has(version.document_id) ?? false} onChange={() => tools.onToggleBulk?.(version.document_id)} />}
          <span className="text-version-name">{name}</span>
          <span className="text-version-origin">{originText(version, row)}</span>
          {badge && <StatusBadge tone={badgeTone(version)}>{badge}</StatusBadge>}
          {discarded && <StatusBadge tone="neutral">Discarded</StatusBadge>}
          <span className="text-version-chain">{version.chain_name}</span>
          {!version.matches_filter && <span className="cell-secondary">Does not match the filters</span>}
        </div>
        {acceptance && <p className="text-version-record">{acceptanceLabel(acceptance, now)}</p>}
        {discarded && discardLabel(version, now) !== "Discarded" && <p className="text-version-record">{discardLabel(version, now)}</p>}
        {work.length > 0 && <ul className="text-version-work" aria-label={`Assignments on ${name}`}>
          {work.map(item => {
            const moved = item.moved_to_version ?? null;
            const assignment = moved == null ? tools?.assignments.find(entry => entry.id === item.assignment_id && entry.document_id === version.document_id && !entry.revoked_at) : undefined;
            return <li key={item.assignment_id}>
              <span>{personLabel(item.author_label, item.is_me, item.person)}, {labelFor(taskLabels, item.task)}, {moved != null ? `moved to v${moved}` : labelFor(assignmentStatusLabels, item.status)}</span>
              {item.held && <> <StatusBadge tone="warning">Paused</StatusBadge></>}
              {assignment && tools && <AssignmentActions assignment={assignment} members={tools.members} onChanged={tools.onAssignmentsChanged} />}
            </li>;
          })}
        </ul>}
        <div className="text-version-actions">
          <a href={routeHref(view)} aria-label={`View text ${fullName}`} onClick={event => {
            if (!isPlainClick(event)) return;
            event.preventDefault(); onNavigate(view);
          }}>View text</a>
          {actions}
        </div>
      </li>;
    })}
  </ul>;
});
