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

const ZWJ = 0x200d;
// Combining marks, variation selectors and emoji skin tones attach to the character before them.
// eslint-disable-next-line no-misleading-character-class -- each code point is matched on its own
const EXTENDS_PREVIOUS = /[\p{M}\u200d\ufe00-\ufe0f\u{1f3fb}-\u{1f3ff}]/u;

/** True when `offset` would cut a visible character in two (accent, joined emoji, surrogate pair). */
function insideCharacter(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  if (isLowSurrogate(text.charCodeAt(offset)) && isHighSurrogate(text.charCodeAt(offset - 1))) return true;
  const next = text.codePointAt(offset);
  if (next !== undefined && EXTENDS_PREVIOUS.test(String.fromCodePoint(next))) return true;
  return text.charCodeAt(offset - 1) === ZWJ;
}

/** Clamp to the text and move back to the start of the visible character the offset falls into. */
function snap(text: string, offset: number): number {
  let position = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  while (insideCharacter(text, position)) position -= 1;
  return position;
}

/**
 * The offset one visible character before (-1) or after (1) `offset`, within the
 * text. A base letter with its combining marks, or a joined emoji, is one step.
 */
export function stepOffset(text: string, offset: number, direction: -1 | 1): number {
  let position = snap(text, offset);
  if (direction === 1) {
    if (position >= text.length) return text.length;
    position += 1;
    while (insideCharacter(text, position)) position += 1;
    return position;
  }
  if (position <= 0) return 0;
  return snap(text, position - 1);
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
