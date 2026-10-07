/**
 * Edge logic for resizing a mention segment. All offsets are UTF-16 offsets
 * into the document text (the span editor's unit), not codepoints.
 */

export interface Span {
  start: number;
  end: number;
}

export type Edge = "start" | "end";

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Clamp to the text and move off the middle of a surrogate pair (backwards). */
function snap(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  if (
    clamped > 0 && clamped < text.length
    && isLowSurrogate(text.charCodeAt(clamped)) && isHighSurrogate(text.charCodeAt(clamped - 1))
  ) {
    return clamped - 1;
  }
  return clamped;
}

/** The offset one codepoint before (-1) or after (1) `offset`, within the text. */
export function stepOffset(text: string, offset: number, direction: -1 | 1): number {
  const from = snap(text, offset);
  if (direction === 1) {
    if (from >= text.length) return text.length;
    return from + (isHighSurrogate(text.charCodeAt(from)) && from + 1 < text.length ? 2 : 1);
  }
  if (from <= 0) return 0;
  return from - (from >= 2 && isLowSurrogate(text.charCodeAt(from - 1)) ? 2 : 1);
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

function isWordAt(text: string, offset: number): boolean {
  const codepoint = text.codePointAt(offset);
  return codepoint !== undefined && WORD_CHAR.test(String.fromCodePoint(codepoint));
}

/**
 * The next position in `direction` where word characters (letters, digits)
 * meet other characters; the text bounds count as boundaries.
 */
export function wordBoundary(text: string, offset: number, direction: -1 | 1): number {
  let position = stepOffset(text, offset, direction);
  while (position > 0 && position < text.length) {
    const before = isWordAt(text, stepOffset(text, position, -1));
    const after = isWordAt(text, position);
    if (before !== after) break;
    position = stepOffset(text, position, direction);
  }
  return position;
}

function trimToVisible(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && !text[start].trim()) start += 1;
  while (end > start && !text[end - 1].trim()) end -= 1;
  return end > start ? { start, end } : null;
}

function mergeTouching(spans: Span[]): Span[] {
  const sorted = spans.map((s) => ({ ...s })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push(span);
  }
  return merged;
}

const sameSpans = (a: Span[], b: Span[]) =>
  a.length === b.length && a.every((span, i) => span.start === b[i].start && span.end === b[i].end);

/**
 * Move one edge of `segments[index]` to `offset`.
 *
 * The moved edge cannot cross the other edge (the segment keeps at least one
 * codepoint), whitespace at the edges is trimmed, and a segment that touches or
 * overlaps another segment of the same mention merges with it. Returns the new
 * segments (sorted), or null when the result equals the input.
 */
export function resizeSegment(
  text: string,
  segments: Span[],
  index: number,
  edge: Edge,
  offset: number,
): Span[] | null {
  const segment = segments[index];
  if (!segment) return null;
  const target = snap(text, offset);
  const moved: Span = edge === "start"
    ? { start: Math.min(target, stepOffset(text, segment.end, -1)), end: segment.end }
    : { start: segment.start, end: Math.max(target, stepOffset(text, segment.start, 1)) };
  const trimmed = trimToVisible(text, moved);
  if (!trimmed) return null;
  const result = mergeTouching(segments.map((s, i) => (i === index ? trimmed : s)));
  return sameSpans(result, mergeTouching(segments)) ? null : result;
}
