/**
 * Pasted case IDs (spec "Select by case IDs…"): separators are newline, comma, semicolon, space and
 * tab; each ID is trimmed and NFKC-normalised; empty entries and duplicates are dropped (first wins).
 */
export function parseCaseIds(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.normalize("NFKC").split(/[\n\r,; \t]+/)) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}
