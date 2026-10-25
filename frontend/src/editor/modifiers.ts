/**
 * Pure helpers for finding modifiers in the editor (spec "Finding modifiers": attach mode,
 * display). Offsets are Unicode code points.
 */
import type { MentionDisplay } from "../spans/adapter";

export interface Seg {
  start: number;
  end: number;
}

export interface ModifierLike {
  term_id: string;
  segments?: readonly Seg[];
}

export interface TermInfo {
  label: string;
  role: "finding" | "modifier" | "cohort";
  exclusiveClass: "severity" | "onset" | null;
}

export const COHORT_TAG = "Cohort term";

/** Search roots of "+ Add modifier…" (`within`): Clinical modifier and Frequency. */
export const MODIFIER_ROOTS = ["HP:0012823", "HP:0040279"] as const;

const DISPLAY_PREFIX = "mod:";

export function modifierDisplayId(annotationId: string, termId: string): string {
  return `${DISPLAY_PREFIX}${annotationId}:${termId}`;
}

/** The annotation id holds no ":"; everything after it is the term id (which does). */
export function parseModifierDisplayId(id: string): { annotationId: string; termId: string } | null {
  if (!id.startsWith(DISPLAY_PREFIX)) return null;
  const rest = id.slice(DISPLAY_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { annotationId: rest.slice(0, cut), termId: rest.slice(cut + 1) };
}

/** [start, end) code points of the sentence around `offset`. */
export function sentenceBounds(text: string, offset: number): [number, number] {
  const chars = Array.from(text);
  const at = Math.max(0, Math.min(offset, chars.length));
  const isBreak = (i: number) => chars[i] === "\n" || chars[i] === "\r";
  const ends = (i: number) => /[.!?]/.test(chars[i]) && (i + 1 >= chars.length || /\s/.test(chars[i + 1]));
  let start = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (isBreak(i) || ends(i)) {
      start = i + 1;
      break;
    }
  }
  let end = chars.length;
  for (let i = at; i < chars.length; i += 1) {
    if (isBreak(i)) {
      end = i;
      break;
    }
    if (ends(i)) {
      end = i + 1;
      break;
    }
  }
  return [start, end];
}

export interface AttachFinding {
  annotationId: string;
  term: string;
  termId: string;
  segments: readonly Seg[];
  quote: string;
}

export interface AttachCandidate extends AttachFinding {
  distance: number;
  after: boolean;
}

/** Findings with a mention segment in the mark's sentence, nearest first; on a tie the one after the mark. */
export function attachCandidates(text: string, mark: Seg, findings: readonly AttachFinding[]): AttachCandidate[] {
  const [from, to] = sentenceBounds(text, mark.start);
  const gap = (s: Seg) => (s.start >= mark.end ? s.start - mark.end : mark.start >= s.end ? mark.start - s.end : 0);
  return findings
    .map((finding, index) => {
      const inside = finding.segments.filter((s) => s.start < to && s.end > from);
      if (!inside.length) return null;
      const nearest = inside.reduce((best, s) => (gap(s) < gap(best) ? s : best));
      return { ...finding, distance: gap(nearest), after: nearest.start >= mark.end, index };
    })
    .filter((c): c is AttachCandidate & { index: number } => c !== null)
    .sort((a, b) => a.distance - b.distance || Number(b.after) - Number(a.after) || a.index - b.index)
    .map(({ index: _index, ...candidate }) => candidate);
}

/** The text of segments, several joined by " … ". */
export function quoteOf(text: string, segments: readonly Seg[] = []): string {
  const chars = Array.from(text);
  return segments.map((s) => chars.slice(s.start, s.end).join("")).join(" … ");
}

/** "Severe · “schwere”", "Recurrent", "Frequent · “oft” · Cohort term". */
export function chipText(label: string, quote: string | null, role: TermInfo["role"]): string {
  return [label, quote ? `“${quote}”` : null, role === "cohort" ? COHORT_TAG : null].filter(Boolean).join(" · ");
}

/** "Two severities" / "Two onsets" lines for a finding's modifiers, in that order. */
export function exclusiveWarnings(
  modifiers: readonly ModifierLike[],
  info: (termId: string) => TermInfo | undefined,
): string[] {
  const count = (cls: "severity" | "onset") => modifiers.filter((m) => info(m.term_id)?.exclusiveClass === cls).length;
  return [count("severity") > 1 ? "Two severities" : null, count("onset") > 1 ? "Two onsets" : null].filter(
    (w): w is string => w !== null,
  );
}

/** Labels sorted case-insensitively (D-d). */
export function sortByLabel<T extends ModifierLike>(
  modifiers: readonly T[],
  info: (termId: string) => TermInfo | undefined,
): T[] {
  const label = (m: T) => info(m.term_id)?.label ?? m.term_id;
  return [...modifiers].sort(
    (a, b) => label(a).localeCompare(label(b), undefined, { sensitivity: "base" }) || a.term_id.localeCompare(b.term_id),
  );
}

/** Mark displays for the modifier segments of the given findings. */
export function modifierMarks(
  findings: readonly {
    annotationId: string;
    term: string;
    termId: string;
    colorIndex: number;
    modifiers: readonly ModifierLike[];
  }[],
  text: string,
  info: (termId: string) => TermInfo | undefined,
): MentionDisplay[] {
  const length = Array.from(text).length;
  return findings.flatMap((finding) =>
    finding.modifiers.flatMap((modifier) => {
      // Segments outside this text (another text version) are not drawn.
      const segments = (modifier.segments ?? []).filter((s) => s.end <= length).map((s) => ({ ...s }));
      if (!segments.length) return [];
      return [{
        evidence_id: modifierDisplayId(finding.annotationId, modifier.term_id),
        segments,
        kind: "modifier" as const,
        colorIndex: finding.colorIndex,
        label: `${info(modifier.term_id)?.label ?? modifier.term_id}, modifier of ${finding.term}`,
      }];
    }),
  );
}

/** "Seizure, modifiers: Recurrent, Severe (“schwere”)" (label order, D-d); null without modifiers. */
export function findingDescription(
  term: string,
  modifiers: readonly ModifierLike[],
  text: string,
  info: (termId: string) => TermInfo | undefined,
): string | null {
  if (!modifiers.length) return null;
  const parts = sortByLabel(modifiers, info).map((m) => {
    const label = info(m.term_id)?.label ?? m.term_id;
    return m.segments?.length ? `${label} (“${quoteOf(text, m.segments)}”)` : label;
  });
  return `${term}, modifiers: ${parts.join(", ")}`;
}
