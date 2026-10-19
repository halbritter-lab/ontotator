import { rowKeyOf, type CarriedState } from "./carried/checkState";

/** Everything the submit dialog lists and the toolbar counts as still open. */
export type OpenItemKind = "carried" | "evidence" | "reanchor" | "unconfirmed-values" | "review-target" | "defaulted";

export interface OpenItem {
  key: string;
  kind: OpenItemKind;
  /** Blocking items prevent submission; warnings (unconfirmed, defaulted values) do not. */
  blocking: boolean;
  term: string;
  line: string;
  /** Findings-list row to select; null for items that live elsewhere (re-anchor rows). */
  listKey: string | null;
  /** Selector of the inspector control that resolves the item. */
  focus: string;
  /** Unconfirmed or defaulted values: the axis to focus. */
  axisId?: string;
  /** First evidence of the finding: the mark to scroll the text to. */
  evidenceId?: string;
}

export interface OpenItemsInput {
  carried: { state: CarriedState; term: string; instruction: string; evidenceId?: string }[];
  evidence: { annotationId: string; term: string; reason: string; remedy: string; focus: string; targetKey?: string; evidenceId?: string }[];
  reanchor: { key: string; term: string }[];
  /** Axis warning entries, the first unconfirmed axis per finding. */
  unconfirmed: { annotationId: string; term: string; axisId: string; axisLabel: string; values?: string; targetKey?: string; evidenceId?: string }[];
  openTargets: { key: string; term: string; evidenceId?: string }[];
  defaulted: { annotationId: string; term: string; axisId: string; targetKey?: string; evidenceId?: string }[];
}

const AXIS_FOCUS = "[data-axis-field]";
const findingKey = (annotationId: string, targetKey?: string) => targetKey ? `target:${targetKey}` : `annotation:${annotationId}`;

/** Open items in dialog order: carried, evidence issues, re-anchor, review targets, unconfirmed values, defaulted. */
export function collectOpenItems(input: OpenItemsInput): OpenItem[] {
  const unconfirmedIds = new Set(input.unconfirmed.map(entry => entry.annotationId));
  return [
    ...input.carried.map(({ state, term, instruction, evidenceId }): OpenItem => ({
      key: `carried:${state.input.input_id}`, kind: "carried", blocking: true, term, line: instruction,
      listKey: rowKeyOf(state), focus: "[data-carried-primary]", evidenceId,
    })),
    ...input.evidence.map((entry): OpenItem => ({
      key: `evidence:${entry.targetKey ?? entry.annotationId}`, kind: "evidence", blocking: true, term: entry.term,
      line: `${entry.reason} ${entry.remedy}`, listKey: findingKey(entry.annotationId, entry.targetKey), focus: entry.focus,
      evidenceId: entry.evidenceId,
    })),
    ...input.reanchor.map((entry): OpenItem => ({
      key: `reanchor:${entry.key}`, kind: "reanchor", blocking: true, term: entry.term,
      line: "Changed text: re-create this finding or dismiss it with a reason.", listKey: null, focus: "[data-reanchor-item] button",
    })),
    ...input.openTargets.map((entry): OpenItem => ({
      key: `review-target:${entry.key}`, kind: "review-target", blocking: true, term: entry.term,
      line: "Review proposal not decided yet.", listKey: `target:${entry.key}`, focus: ".decision-btn", evidenceId: entry.evidenceId,
    })),
    ...input.unconfirmed.map((entry): OpenItem => ({
      key: `unconfirmed:${entry.targetKey ?? entry.annotationId}`, kind: "unconfirmed-values", blocking: false, term: entry.term,
      line: entry.values ? `Not confirmed: ${entry.values}.` : `${entry.axisLabel} is not confirmed.`,
      listKey: findingKey(entry.annotationId, entry.targetKey), focus: AXIS_FOCUS, axisId: entry.axisId, evidenceId: entry.evidenceId,
    })),
    ...input.defaulted.filter(entry => !unconfirmedIds.has(entry.annotationId)).map((entry): OpenItem => ({
      key: `defaulted:${entry.targetKey ?? entry.annotationId}`, kind: "defaulted", blocking: false, term: entry.term,
      line: "Default values: confirm them or choose values.",
      listKey: findingKey(entry.annotationId, entry.targetKey), focus: AXIS_FOCUS, axisId: entry.axisId, evidenceId: entry.evidenceId,
    })),
  ];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const KIND_ORDER: OpenItemKind[] = ["carried", "evidence", "reanchor", "review-target", "unconfirmed-values", "defaulted"];
const PHRASES: Record<OpenItemKind, (n: number) => string> = {
  carried: n => plural(n, "carried finding still needs a check", "carried findings still need a check"),
  evidence: n => plural(n, "finding needs attention", "findings need attention"),
  reanchor: n => plural(n, "finding after text correction is still pending", "findings after text correction are still pending"),
  "review-target": n => plural(n, "review proposal is still open", "review proposals are still open"),
  "unconfirmed-values": n => plural(n, "finding has unconfirmed clinical values", "findings have unconfirmed clinical values"),
  defaulted: n => plural(n, "annotation has defaulted axis values", "annotations have defaulted axis values"),
};
const BLOCKED: Partial<Record<OpenItemKind, (n: number) => string>> = {
  carried: n => `Check ${plural(n, "carried finding", "carried findings")} before submitting.`,
  evidence: n => `Resolve ${plural(n, "finding that needs", "findings that need")} attention before submitting.`,
  reanchor: n => `Re-create or dismiss ${plural(n, "finding", "findings")} after text correction before submitting.`,
  "review-target": () => "Decide every review proposal before submitting.",
};
const countOf = (items: readonly OpenItem[], kind: OpenItemKind) => items.filter(item => item.kind === kind).length;

/** One summary line, e.g. "1 carried finding still needs a check". Empty without open items. */
export function summaryLine(items: readonly OpenItem[]): string {
  return KIND_ORDER.filter(kind => countOf(items, kind) > 0).map(kind => PHRASES[kind](countOf(items, kind))).join(", ");
}

/** Why "Submit case" is unavailable because of open items: the first blocking kind's sentence. */
export function submitBlockedReason(items: readonly OpenItem[]): string | null {
  const kind = KIND_ORDER.find(value => items.some(item => item.kind === value && item.blocking));
  return kind ? BLOCKED[kind]?.(countOf(items, kind)) ?? null : null;
}

/**
 * The item "Next open item" goes to: after the last visited item while it is still selected,
 * else after the items of the current selection; wraps. Null without open items.
 */
export function nextOpenItem(items: readonly OpenItem[], selectedListKey: string | null, lastKey: string | null): OpenItem | null {
  if (!items.length) return null;
  const last = lastKey === null ? -1 : items.findIndex(item => item.key === lastKey);
  let start = 0;
  if (last >= 0 && selectedListKey !== null && items[last].listKey === selectedListKey) start = last + 1;
  else if (selectedListKey !== null) {
    const matching = items.map((item, index) => item.listKey === selectedListKey ? index : -1).filter(index => index >= 0);
    if (matching.length) start = matching[matching.length - 1] + 1;
  }
  return items[start % items.length];
}
