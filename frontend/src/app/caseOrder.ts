import type { DocumentSummary } from "../api/client";

/**
 * Whether a case can be opened in the current mode. The server only sets
 * ``has_review_inputs`` for review mode, where cases without proposals cannot be opened.
 */
export const canOpenCase = (doc: DocumentSummary): boolean => doc.has_review_inputs !== false;

/** The nearest case before (-1) or after (1) the current one, in package order, that can be opened. */
export function adjacentCase(
  documents: DocumentSummary[],
  currentDocumentId: string,
  step: 1 | -1,
): DocumentSummary | null {
  const index = documents.findIndex((d) => d.document_id === currentDocumentId);
  if (index < 0) return null;
  for (let i = index + step; i >= 0 && i < documents.length; i += step) {
    if (canOpenCase(documents[i])) return documents[i];
  }
  return null;
}
