/**
 * What the colour of a mark means: the one place that maps a meaning to a palette slot.
 *
 * The palette is `--mark-0-fill` … `--mark-5-fill` in `styles/tokens.css`; the
 * `.run--color-N` block in `styles/screens/editor.css` binds slot N to `--mark-N-fill`. Neither knows
 * what a colour stands for. This module does: today a mark is coloured by its term, so
 * the same term looks the same wherever it appears. To give colours another meaning
 * (by layer, by kind, …) change `MARK_COLOUR_MEANING`, or add a meaning here; the
 * callers pass every attribute a meaning may need and do not change.
 *
 * The state of a mark (own, proposal, reference, negated, selected) is never a colour:
 * it is drawn as a line style or pattern, so it stays readable whatever the colours mean.
 */

/** Number of palette slots (`--mark-0-fill` … `--mark-5-fill`). */
export const MARK_PALETTE_SIZE = 6;

/** What a mark's colour can stand for. */
export type MarkColourMeaning = "term" | "layer" | "kind";

/** The meaning in use. */
export const MARK_COLOUR_MEANING: MarkColourMeaning = "term";

/** Everything a meaning may look at; callers fill in what they know. */
export interface MarkColourSubject {
  termId?: string | null;
  layerId?: string | null;
  kind?: "own" | "target" | "source";
}

/** A stable slot for a key: the same key always gets the same colour. */
export function hashSlot(key: string): number {
  if (!key) return 0;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % MARK_PALETTE_SIZE;
}

/** Fixed slots where a meaning has few, known values. */
const KIND_SLOTS: Record<NonNullable<MarkColourSubject["kind"]>, number> = {
  own: 1,
  target: 0,
  source: 3,
};

const SLOT_BY_MEANING: Record<MarkColourMeaning, (subject: MarkColourSubject) => number> = {
  term: (s) => hashSlot(s.termId ?? ""),
  layer: (s) => hashSlot(s.layerId ?? ""),
  kind: (s) => (s.kind ? KIND_SLOTS[s.kind] : 0),
};

/** The palette slot (0 … MARK_PALETTE_SIZE - 1) of a mark. */
export function markColourSlot(
  subject: MarkColourSubject,
  meaning: MarkColourMeaning = MARK_COLOUR_MEANING,
): number {
  return SLOT_BY_MEANING[meaning](subject);
}
