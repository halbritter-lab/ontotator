/**
 * The reviewer's reason for a rejected or queried translation (UX: "Resolve…" and History showed the
 * outcome but not why). Read from the version's translation reviews (`GET …/translation-reviews`); the
 * person comes from the row's work item of that review, never as a code.
 */
import { useEffect, useState } from "react";
import { api, type DocumentRowView, type TranslationReviewRecord } from "../api/client";
import { labelFor } from "../app/labels";
import { categoryLabels } from "../translation/labels";

/** The version whose latest review rejected or queried it (newest first), or null. */
export function reasonDocumentId(row: Pick<DocumentRowView, "versions" | "is_source">): string | null {
  if (row.is_source) return null;
  const versions = [...row.versions].reverse();
  return versions.find(version => version.latest_review_decision === "rejected" || version.latest_review_decision === "query")?.document_id ?? null;
}

/** The latest rejecting or querying review of `documentId`; null while loading, without one or after a failed read. */
export function useReviewReason(projectKey: string, documentId: string | null): TranslationReviewRecord | null {
  const [state, setState] = useState<{ documentId: string; record: TranslationReviewRecord | null } | null>(null);
  useEffect(() => {
    if (!documentId) return;
    let active = true;
    void api.listTranslationReviews(projectKey, documentId).then(records => {
      const latest = [...records].filter(record => record.decision === "rejected" || record.decision === "query")
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1) ?? null;
      if (active) setState({ documentId, record: latest });
    }, () => { if (active) setState({ documentId, record: null }); });
    return () => { active = false; };
  }, [projectKey, documentId]);
  return state && state.documentId === documentId ? state.record : null;
}

/** The reviewer's name from the row's review work item; "The reviewer" when the row does not carry it. */
export function reviewerName(row: Pick<DocumentRowView, "work">, record: Pick<TranslationReviewRecord, "assignment_id">): string {
  const person = row.work.find(item => item.assignment_id === record.assignment_id)?.person;
  return person?.display_name?.trim() || "The reviewer";
}

/** "Omission, Terminology" (empty without categories). */
export function reasonCategories(record: Pick<TranslationReviewRecord, "categories">): string {
  return record.categories.map(category => labelFor(categoryLabels, category)).join(", ");
}

/** "Ana Weber rejected this translation." / "Ana Weber asked a question about this translation." */
export function reasonLead(row: Pick<DocumentRowView, "work">, record: Pick<TranslationReviewRecord, "assignment_id" | "decision">): string {
  const name = reviewerName(row, record);
  return record.decision === "query" ? `${name} asked a question about this translation.` : `${name} rejected this translation.`;
}

/** The quoted reason with its categories, e.g. under "Resolve…" and the History line of the review. */
export function ReviewReason({ record, lead }: { record: TranslationReviewRecord; lead?: string }): JSX.Element {
  const categories = reasonCategories(record);
  return <div className="documents-review-reason">
    {lead && <p>{lead}</p>}
    {record.rationale && <blockquote>{`“${record.rationale}”`}</blockquote>}
    {categories && <p className="cell-secondary">{`Categories: ${categories}`}</p>}
    {!record.rationale && !categories && <p className="cell-secondary">No reason given.</p>}
  </div>;
}
