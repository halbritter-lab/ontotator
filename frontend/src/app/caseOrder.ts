import type { DocumentSummary } from "../api/client";

/**
 * Whether a case can be opened in the current mode. The server only sets
 * All documents are reviewable, including checked-negative cases with no proposals.
 */
export const canOpenCase = (_doc: DocumentSummary): boolean => true;

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

const ID_SEPARATORS = ":/_.-";

/**
 * The prefix all IDs share, cut back to a separator so no ID loses part of a segment.
 * Returns "" for fewer than two IDs or a prefix shorter than ``minLength``: hiding it
 * would not make the IDs easier to tell apart.
 */
export function sharedIdPrefix(ids: string[], minLength = 8): string {
  if (ids.length < 2) return "";
  let prefix = ids[0];
  for (const id of ids.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < id.length && prefix[i] === id[i]) i++;
    prefix = prefix.slice(0, i);
  }
  let cut = prefix.length;
  while (cut > 0 && !ID_SEPARATORS.includes(prefix[cut - 1])) cut--;
  // Never swallow a whole ID (one ID may be a prefix of another).
  while (cut > 0 && ids.some((id) => id.length <= cut)) {
    cut--;
    while (cut > 0 && !ID_SEPARATORS.includes(prefix[cut - 1])) cut--;
  }
  return cut >= minLength ? prefix.slice(0, cut) : "";
}
