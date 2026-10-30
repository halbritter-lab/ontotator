import type { AxisDefinition } from "./AnnotationPanel";
import { axisOptionLabel, findingAxes } from "./axisLabels";

/** One side of an Edit & Replace comparison, already resolved to display text. */
export interface ReplacementSide {
  term: string;
  axes: Record<string, string | null | undefined>;
  /** Quotes of the mentions, in text order. */
  quotes: readonly string[];
  note?: string | null;
  /** Modifier identity (as `modifiersKey`), compared only. */
  modifiers: string;
}

const quoted = (quotes: readonly string[]) => quotes.length ? quotes.map(quote => `“${quote}”`).join(", ") : "no text span";

/**
 * What the replacement changed against its proposal (issue 198), in display words: "Term: Weight loss → Cachexia",
 * "Assertion: Present → Absent", "Text: “weight loss” → “loss”", "Note changed", "Modifiers changed". Empty when the
 * copy is still identical, so a "Replaced by" with the same name says what makes it different.
 */
export function replacementChanges(proposal: ReplacementSide, copy: ReplacementSide, axesConfig?: readonly AxisDefinition[]): string[] {
  const changes: string[] = [];
  if (proposal.term !== copy.term) changes.push(`Term: ${proposal.term} → ${copy.term}`);
  const before = findingAxes(proposal.axes, axesConfig);
  const after = new Map(findingAxes(copy.axes, axesConfig).map(axis => [axis.id, axis]));
  for (const axis of before) {
    const was = axisOptionLabel(axis.value), now = axisOptionLabel(after.get(axis.id)?.value);
    if (was !== now) changes.push(`${axis.label}: ${was} → ${now}`);
  }
  for (const [id, axis] of after) {
    if (!before.some(item => item.id === id) && axis.value != null) changes.push(`${axis.label}: ${axisOptionLabel(undefined)} → ${axisOptionLabel(axis.value)}`);
  }
  if (quoted(proposal.quotes) !== quoted(copy.quotes)) changes.push(`Text: ${quoted(proposal.quotes)} → ${quoted(copy.quotes)}`);
  if ((proposal.note ?? "").trim() !== (copy.note ?? "").trim()) changes.push("Note changed");
  if (proposal.modifiers !== copy.modifiers) changes.push("Modifiers changed");
  return changes;
}
