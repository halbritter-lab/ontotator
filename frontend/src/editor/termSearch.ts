/** Pure helpers of the term search: prefill, match copy and the active hit. */
import type { SearchCandidate } from "../api/client";
import { languageName } from "../translation/labels";

export const PREFILL_MAX = 80;

export const NO_PREFILL_HINT = "Names are searched in English. Type an English name or a code.";

/** Covered text of all segments joined with a space, whitespace collapsed, trimmed, cut at 80 codepoints on a word boundary. */
export function prefillQuery(text: string, segments: readonly { start: number; end: number }[]): string {
  const chars = Array.from(text);
  const joined = segments
    .map((segment) => chars.slice(Math.max(0, segment.start), Math.min(chars.length, segment.end)).join(""))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  const codepoints = Array.from(joined);
  if (codepoints.length <= PREFILL_MAX) return joined;
  const head = codepoints.slice(0, PREFILL_MAX);
  // The cut falls between two words: keep the whole head.
  if (codepoints[PREFILL_MAX] === " ") return head.join("").trim();
  const lastSpace = head.lastIndexOf(" ");
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head).join("").trim();
}

const baseLanguage = (code: string): string => code.split(/[-_]/)[0].toLowerCase();

/** The marked text is always prefilled; for a document language that is not searched (English is),
 * the hint that explains English-only names, else null. */
export function prefillHint(documentLanguage: string, activeLanguages: readonly string[] | undefined): string | null {
  const language = baseLanguage(documentLanguage);
  if (language === "en") return null;
  return (activeLanguages ?? []).some((code) => baseLanguage(code) === language) ? null : NO_PREFILL_HINT;
}

/** Spec B.6 match line; null for label matches or when the match equals the label. */
export function matchLine(
  candidate: Pick<SearchCandidate, "label" | "matched_term" | "match_kind" | "match_language">,
): string | null {
  const kind = candidate.match_kind ?? "";
  const matched = candidate.matched_term;
  if (kind === "label" || !matched || matched === candidate.label) return null;
  if (kind === "id") return "Matched the code";
  if (kind.startsWith("prefix:")) return `Matched the start of “${matched}”`;
  if (kind === "ngram") return `Similar wording “${matched}”`;
  if (kind.startsWith("ngram:") || kind === "translation") {
    const language = candidate.match_language ?? (kind.startsWith("ngram:") ? kind.slice("ngram:".length) : "");
    return language ? `Matched ${languageName(language)} name “${matched}”` : `Matched “${matched}”`;
  }
  if (kind.includes("Synonym")) return `Matched synonym “${matched}”`;
  return `Matched “${matched}”`;
}

/** Index of the first hit Enter may add by default (not obsolete, not a weak match, canAssign), or -1. */
export function firstUsableIndex(candidates: readonly SearchCandidate[], canAssign: boolean): number {
  if (!canAssign) return -1;
  return candidates.findIndex((candidate) => candidate.obsolete !== true && candidate.weak_match !== true);
}
