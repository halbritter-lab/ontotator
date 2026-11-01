/**
 * Sentences of a review text and the reviewer's checked-sentence marks (issue 256).
 * Marks are a working aid only: each side of the review is marked on its own, and a
 * mark names a sentence by its index and a short hash of its text, so an edited
 * sentence is "changed since checked" and a new text never shows wrong marks.
 */

export interface Sentence {
  index: number;
  /** UTF-16 offsets of the sentence without its surrounding white space. */
  start: number;
  end: number;
  text: string;
  hash: string;
}
export interface StoredMark { index: number; hash: string }
export interface StoredMarks { source: StoredMark[]; translation: StoredMark[] }
export type MarkState = { kind: "checked" } | { kind: "stale"; hash: string } | null;
export type Side = keyof StoredMarks;

/** A short, stable hash of a sentence (FNV-1a, 32 bit), ignoring runs of white space. */
export function sentenceHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text.trim().replace(/\s+/gu, " ")) {
    const point = char.codePointAt(0) ?? 0;
    for (const byte of [point & 0xff, (point >>> 8) & 0xff, (point >>> 16) & 0xff]) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

type Segment = { index: number; segment: string };
type SegmentText = (line: string) => Iterable<Segment>;

/** Sentence ends for texts where Intl.Segmenter is missing: . ! ? … with closing quotes or brackets. */
function regexSegments(line: string): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  for (const match of line.matchAll(/[.!?…。！？]+["'”’»)\]]*\s+/gu)) {
    const end = (match.index ?? 0) + match[0].length;
    segments.push({ index: start, segment: line.slice(start, end) });
    start = end;
  }
  if (start < line.length) segments.push({ index: start, segment: line.slice(start) });
  return segments;
}

function segmenterFor(lang: string | undefined, useSegmenter: boolean): SegmentText {
  const Segmenter = useSegmenter ? (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter : undefined;
  if (!Segmenter) return regexSegments;
  let segmenter: Intl.Segmenter;
  try { segmenter = new Segmenter(lang || undefined, { granularity: "sentence" }); }
  catch { try { segmenter = new Segmenter(undefined, { granularity: "sentence" }); } catch { return regexSegments; } }
  return line => segmenter.segment(line);
}

/**
 * The sentences of a text in its language. Every line break ends a sentence, so a
 * sentence never spans paragraphs; a text of one long paragraph still splits into its
 * sentences. White space between sentences belongs to none of them.
 */
export function splitSentences(text: string, lang?: string, { segmenter: useSegmenter = true } = {}): Sentence[] {
  const segment = segmenterFor(lang, useSegmenter);
  const sentences: Sentence[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    for (const part of segment(line)) {
      const lead = part.segment.length - part.segment.trimStart().length;
      const body = part.segment.trim();
      if (!body) continue;
      const start = lineStart + part.index + lead;
      sentences.push({ index: sentences.length, start, end: start + body.length, text: body, hash: sentenceHash(body) });
    }
    lineStart += line.length + 1;
  }
  return sentences;
}

/**
 * The state of every sentence from the stored marks: a mark whose hash matches the
 * sentence at its index checks it; else the nearest free sentence with that hash
 * (text moved by an edit); else the sentence now at its index is "changed since checked".
 */
export function resolveMarks(sentences: readonly Sentence[], marks: readonly StoredMark[]): MarkState[] {
  const states: MarkState[] = sentences.map(() => null);
  const rest: StoredMark[] = [];
  for (const mark of marks) {
    if (sentences[mark.index]?.hash === mark.hash && !states[mark.index]) states[mark.index] = { kind: "checked" };
    else rest.push(mark);
  }
  const unmatched: StoredMark[] = [];
  for (const mark of rest) {
    let best = -1;
    for (const sentence of sentences) {
      if (sentence.hash !== mark.hash || states[sentence.index]) continue;
      if (best < 0 || Math.abs(sentence.index - mark.index) < Math.abs(best - mark.index)) best = sentence.index;
    }
    if (best >= 0) states[best] = { kind: "checked" };
    else unmatched.push(mark);
  }
  for (const mark of unmatched) {
    if (mark.index < sentences.length && !states[mark.index]) states[mark.index] = { kind: "stale", hash: mark.hash };
  }
  return states;
}

/** The marks to store for these states: checked ones with today's hash, stale ones with the old one. */
export function storedMarks(sentences: readonly Sentence[], states: readonly MarkState[]): StoredMark[] {
  const marks: StoredMark[] = [];
  states.forEach((state, index) => {
    if (state?.kind === "checked" && sentences[index]) marks.push({ index, hash: sentences[index].hash });
    else if (state?.kind === "stale") marks.push({ index, hash: state.hash });
  });
  return marks;
}

export const isChecked = (state: MarkState | undefined): boolean => state?.kind === "checked";

/** Toggles one sentence: a checked one is unmarked, an unchecked or changed one is checked. */
export function toggled(states: readonly MarkState[], index: number): MarkState[] {
  return states.map((state, i) => i === index ? (isChecked(state) ? null : { kind: "checked" }) : state);
}

/** Sets every sentence from `from` to `to` (either order) to checked or unchecked. */
export function withRange(states: readonly MarkState[], from: number, to: number, checked: boolean): MarkState[] {
  const low = Math.min(from, to), high = Math.max(from, to);
  return states.map((state, i) => i < low || i > high ? state : checked ? { kind: "checked" } : null);
}

/** "Source 6 of 10 · Translation 5 of 11 sentences checked". */
export const checkedSummary = (source: { checked: number; total: number }, translation: { checked: number; total: number }): string =>
  `Source ${source.checked} of ${source.total} · Translation ${translation.checked} of ${translation.total} sentences checked`;
