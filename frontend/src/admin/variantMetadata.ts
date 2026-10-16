import type { ProjectDocumentSummary, VariantSummary } from "../api/client";

export const originLabels: Record<VariantSummary["origin"], string> = {
  native: "Native", machine_translation: "Machine translation", human_translation: "Human translation", correction: "Correction",
};
export const translationStatusLabels: Record<NonNullable<ProjectDocumentSummary["translation_status"]>, string> = {
  translated: "Translated", automatic_check_failed: "Check failed", ready_for_review: "Ready for review", reviewed: "Reviewed", accepted: "Accepted",
};

/** Display hints only; allocation/current authority always remain server-owned.
 * IDs point to exact predecessors, never inferred newest/opposite-language rows.
 */
export function reviewLanguages(id: string, variants: ReadonlyMap<string, VariantSummary>): readonly string[] | null {
  let current = variants.get(id);
  if (!current) return null;
  const caseId = current.case_id;
  const language = current.language;
  const externalId = current.external_id;
  const seen = new Set<string>();
  while (current.origin === "correction") {
    if (seen.has(current.document_id) || !current.derived_from) return null;
    seen.add(current.document_id);
    const previous = variants.get(current.derived_from);
    if (!previous || previous.case_id !== caseId || previous.language !== language || previous.external_id !== externalId || previous.version >= current.version) return null;
    current = previous;
  }
  if (!["machine_translation", "human_translation"].includes(current.origin) || !current.derived_from) return null;
  const source = variants.get(current.derived_from);
  if (!source || source.case_id !== caseId || seen.has(source.document_id) || source.document_id === current.document_id) return null;
  return [...new Set([source.language, language])];
}
