import { rowKeyOf, type CarriedState } from "./carried/checkState";
import type { ModifierWarning } from "./unconfirmedValues";

/** Everything the submit dialog lists and the toolbar counts as still open. */
export type OpenItemKind = "carried" | "evidence" | "reanchor" | "unconfirmed-values" | "review-target" | "defaulted"
  | "modifier-as-finding" | "cohort-modifier" | "exclusive-modifiers";

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
  /** First mark's text (shortened), shown after the term in the Submit dialog. */
  quote?: string;
}

export interface OpenItemsInput {
  carried: { state: CarriedState; term: string; instruction: string; evidenceId?: string }[];
  evidence: { annotationId: string; term: string; reason: string; remedy: string; focus: string; targetKey?: string; evidenceId?: string; quote?: string }[];
  reanchor: { key: string; term: string }[];
  /** Axis warning entries, the first unconfirmed axis per finding. */
  unconfirmed: { annotationId: string; term: string; axisId: string; axisLabel: string; values?: string; targetKey?: string; evidenceId?: string }[];
  openTargets: { key: string; term: string; evidenceId?: string; quote?: string }[];
  defaulted: { annotationId: string; term: string; axisId: string; targetKey?: string; evidenceId?: string }[];
  /** Acknowledgeable modifier warnings (R3, R10, R12; `modifierWarnings`): `term` is the finding's label. */
  modifierWarnings?: (ModifierWarning & { term: string; targetKey?: string; evidenceId?: string; quote?: string })[];
}

const AXIS_FOCUS = "[data-axis-field]";
const findingKey = (annotationId: string, targetKey?: string) => targetKey ? `target:${targetKey}` : `annotation:${annotationId}`;

const MODIFIERS_FOCUS = "[data-modifiers-section] button";
/** "Severe is a modifier term. Keep it only if it names the finding itself." / "Frequent is a cohort term." / "Two severities: Mild, Severe." */
export function modifierWarningLine(warning: ModifierWarning): string {
  if (warning.kind === "modifier-as-finding") return `${warning.labels[0] ?? "The term"} is a modifier term. Keep it only if it names the finding itself.`;
  if (warning.kind === "cohort-modifier") return `${warning.labels[0] ?? "A modifier"} is a cohort term.`;
  const two = warning.exclusiveClass === "onset" ? "Two onsets" : "Two severities";
  return warning.labels.length ? `${two}: ${warning.labels.join(", ")}.` : `${two}.`;
}

/**
 * Open items in dialog order: carried, evidence issues, re-anchor, review targets, unconfirmed values,
 * defaulted, modifier warnings.
 */
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
      evidenceId: entry.evidenceId, quote: entry.quote,
    })),
    ...input.reanchor.map((entry): OpenItem => ({
      key: `reanchor:${entry.key}`, kind: "reanchor", blocking: true, term: entry.term,
      line: "Changed text: re-create this finding or dismiss it with a reason.", listKey: null, focus: "[data-reanchor-item] button",
    })),
    ...input.openTargets.map((entry): OpenItem => ({
      key: `review-target:${entry.key}`, kind: "review-target", blocking: true, term: entry.term,
      line: "Accept, reject or mark unresolved.", listKey: `target:${entry.key}`, focus: ".decision-btn", evidenceId: entry.evidenceId, quote: entry.quote,
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
    ...(input.modifierWarnings ?? []).map((entry): OpenItem => ({
      key: `${entry.kind}:${entry.annotationId}:${entry.key}`, kind: entry.kind, blocking: false, term: entry.term,
      line: modifierWarningLine(entry), listKey: findingKey(entry.annotationId, entry.targetKey),
      focus: entry.kind === "modifier-as-finding" ? "[data-turn-into-modifier]" : MODIFIERS_FOCUS, evidenceId: entry.evidenceId, quote: entry.quote,
    })),
  ];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const KIND_ORDER: OpenItemKind[] = ["carried", "evidence", "reanchor", "review-target", "unconfirmed-values",
  "defaulted", "modifier-as-finding", "cohort-modifier", "exclusive-modifiers"];
const BLOCKED: Partial<Record<OpenItemKind, (n: number) => string>> = {
  carried: n => `Check ${plural(n, "carried finding", "carried findings")} before submitting.`,
  evidence: n => `Resolve ${plural(n, "finding that needs", "findings that need")} attention before submitting.`,
  reanchor: n => `Re-create or dismiss ${plural(n, "finding", "findings")} after text correction before submitting.`,
  "review-target": () => "Decide every proposal before submitting.",
};
const countOf = (items: readonly OpenItem[], kind: OpenItemKind) => items.filter(item => item.kind === kind).length;

/** Acknowledgeable modifier warnings: the Submit dialog's "Modifier warnings" section. */
export const MODIFIER_WARNING_KINDS: readonly OpenItemKind[] = ["modifier-as-finding", "cohort-modifier", "exclusive-modifiers"];
/** Kinds the Submit dialog shows in its own "Values not chosen yet" and "Modifier warnings" groups, not in the generic ones. */
export const DIALOG_HIDDEN_KINDS: readonly OpenItemKind[] = ["defaulted", "unconfirmed-values", ...MODIFIER_WARNING_KINDS];

/** The open items the Submit dialog lists; the toolbar's "Next open item" keeps every kind. */
export function dialogItems(items: readonly OpenItem[]): OpenItem[] {
  return items.filter(item => !DIALOG_HIDDEN_KINDS.includes(item.kind));
}

/**
 * Why "Submit text" is unavailable because of open items: the first blocking kind's sentence, then
 * `blockingValues` unconfirmed values when the project requires chosen axes.
 */
export function submitBlockedReason(items: readonly OpenItem[], blockingValues = 0): string | null {
  const kind = KIND_ORDER.find(value => items.some(item => item.kind === value && item.blocking));
  const reason = kind ? BLOCKED[kind]?.(countOf(items, kind)) ?? null : null;
  return reason ?? (blockingValues > 0 ? `Confirm or choose ${plural(blockingValues, "value", "values")} before submitting.` : null);
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
