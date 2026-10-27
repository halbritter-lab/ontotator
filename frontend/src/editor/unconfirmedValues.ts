import type { AnnotationSnapshot } from "../api/client";
import type { TermInfo } from "./modifiers";

/**
 * Rows of the Submit dialog's "Unconfirmed values" section (annotator acceptance spec F2).
 *
 * Mirrors the server rule `axis_not_chosen` (`domain/project_rules.py`): an axis is open while its
 * value is empty or it is still in `axes_defaulted`. A server warning can add pairs the client did not
 * compute; the server set wins.
 */

export interface UnconfirmedAxisDef {
  id: string;
  label: string;
  options: readonly string[];
}
export interface UnconfirmedValue {
  axisId: string;
  axisLabel: string;
  value: string | null;
  defaulted: boolean;
}
export interface UnconfirmedRow {
  annotationId: string;
  /** Review proposal (immutable snapshot): refKey of its target. */
  targetKey?: string;
  term: string;
  termId: string;
  /** First mark, 40 code points (`quoteSegments`); "" for spanless findings. */
  quote: string;
  /** Open values (empty or defaulted) in the axis order of the type; server-only pairs last. */
  values: UnconfirmedValue[];
  /** Defaulted values still among the axis options; [] when the row cannot be confirmed in one click (also with any empty value). */
  confirmableAxisIds: string[];
  /** Last line of a row without "Confirm"; null for confirmable rows. */
  reason: string | null;
  /** Findings-list key and first mark, for "Go to". */
  listKey: string;
  evidenceId?: string;
}
export const UNCONFIRMED_REASONS = {
  emptyOnly: "Choose a value in the finding.",
  proposal: "Proposal values change only with Edit & Replace.",
  readOnlyLayer: "Read-only layer.",
} as const;
export const pairKey = (annotationId: string, axisId: string): string =>
  `${annotationId}\u001f${axisId}`;
export interface UnconfirmedInput {
  snapshots: readonly AnnotationSnapshot[];
  axes: (snapshot: AnnotationSnapshot) => readonly UnconfirmedAxisDef[];
  targetKeyOf: (snapshot: AnnotationSnapshot) => string | undefined;
  editableLayerIds: readonly string[];
  term: (snapshot: AnnotationSnapshot) => string;
  quote: (snapshot: AnnotationSnapshot) => string;
  evidenceId: (snapshot: AnnotationSnapshot) => string | undefined;
  /** Server warning pairs, only while the warning's draft revision equals the draft's. */
  serverPairs?: readonly { annotationId: string; axis: string }[];
}

const isEmpty = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value === "";

export function unconfirmedRows(input: UnconfirmedInput): UnconfirmedRow[] {
  const serverAxes = new Map<string, string[]>();
  for (const pair of input.serverPairs ?? []) {
    const axes = serverAxes.get(pair.annotationId) ?? [];
    if (!axes.includes(pair.axis)) axes.push(pair.axis);
    serverAxes.set(pair.annotationId, axes);
  }
  return input.snapshots.flatMap((snapshot): UnconfirmedRow[] => {
    const annotation = snapshot.annotation;
    const values = annotation.axes_values ?? {};
    const defaultedIds = new Set(annotation.axes_defaulted ?? []);
    const axes = input.axes(snapshot);
    const valueOf = (axisId: string): string | null => {
      const value = values[axisId];
      return isEmpty(value) ? null : (value as string);
    };
    const open: UnconfirmedValue[] = axes
      .filter(axis => isEmpty(values[axis.id]) || defaultedIds.has(axis.id))
      .map(axis => ({ axisId: axis.id, axisLabel: axis.label, value: valueOf(axis.id), defaulted: defaultedIds.has(axis.id) }));
    for (const axisId of serverAxes.get(annotation.annotation_id) ?? []) {
      if (open.some(value => value.axisId === axisId)) continue;
      const axis = axes.find(candidate => candidate.id === axisId);
      open.push({ axisId, axisLabel: axis?.label ?? axisId, value: valueOf(axisId), defaulted: defaultedIds.has(axisId) });
    }
    if (open.length === 0) return [];
    const targetKey = input.targetKeyOf(snapshot);
    const editable = input.editableLayerIds.includes(annotation.layer_id);
    // An empty value ("Not specified") is no value to confirm (#33): such a row only goes to the finding.
    const hasEmpty = open.some(value => value.value === null);
    const confirmable = targetKey !== undefined || !editable || hasEmpty ? [] : open
      .filter(value => value.defaulted && value.value !== null
        && (axes.find(axis => axis.id === value.axisId)?.options.includes(value.value) ?? false))
      .map(value => value.axisId);
    const reason = targetKey !== undefined ? UNCONFIRMED_REASONS.proposal
      : !editable ? UNCONFIRMED_REASONS.readOnlyLayer
      : confirmable.length === 0 ? UNCONFIRMED_REASONS.emptyOnly
      : null;
    return [{
      annotationId: annotation.annotation_id,
      ...(targetKey !== undefined ? { targetKey } : {}),
      term: input.term(snapshot),
      termId: annotation.term_id,
      quote: input.quote(snapshot),
      values: open,
      confirmableAxisIds: confirmable,
      reason,
      listKey: targetKey !== undefined ? `target:${targetKey}` : `annotation:${annotation.annotation_id}`,
      evidenceId: input.evidenceId(snapshot),
    }];
  });
}

export function rowPairs(rows: readonly UnconfirmedRow[]): Set<string> {
  return new Set(rows.flatMap(row => row.values.map(value => pairKey(row.annotationId, value.axisId))));
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** "Assertion: Present, Experiencer: Patient"; an empty value reads "{Axis}: Not specified". */
/** Number of (finding, axis) pairs: the n of "Submit with {n} unconfirmed values". */
export function valueCount(rows: readonly UnconfirmedRow[]): number {
  return rows.reduce((sum, row) => sum + row.values.length, 0);
}

/**
 * An acknowledgeable modifier warning (R3 `modifier_as_finding`, R10 `cohort_modifier`, R12 `exclusive_modifier_class`).
 * Its `key` ("term:<term id>", "cohort:<term id>", "exclusive:<class>") joins the axis ids in the acknowledged pair set.
 */
export interface ModifierWarning {
  annotationId: string;
  kind: "modifier-as-finding" | "cohort-modifier" | "exclusive-modifiers";
  key: string;
  /** Modifier as finding, cohort: the term's label; exclusive: the labels of the class, sorted. */
  labels: string[];
  exclusiveClass?: "severity" | "onset";
}
export const isModifierWarningKey = (axis: string): boolean => axis.startsWith("term:") || axis.startsWith("cohort:") || axis.startsWith("exclusive:");

/**
 * The server's modifier warnings computed from the draft (`modifier_warnings`, `domain/project_rules.py`):
 * per finding one for a modifier term as its own term, a cohort warning per Frequency modifier, then one per exclusive class with two or more
 * modifiers. Server pairs the client did not compute are added (the server set wins).
 */
export function modifierWarnings(
  snapshots: readonly AnnotationSnapshot[],
  info: (snapshot: AnnotationSnapshot, termId: string) => TermInfo | undefined,
  serverPairs: readonly { annotationId: string; axis: string }[] = [],
): ModifierWarning[] {
  const label = (snapshot: AnnotationSnapshot, termId: string) => info(snapshot, termId)?.label ?? termId;
  const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  const classLabels = (snapshot: AnnotationSnapshot, cls: string) => (snapshot.annotation.modifiers ?? [])
    .filter(modifier => info(snapshot, modifier.term_id)?.exclusiveClass === cls).map(modifier => label(snapshot, modifier.term_id)).sort(byLabel);
  const warnings = snapshots.flatMap((snapshot): ModifierWarning[] => {
    const annotationId = snapshot.annotation.annotation_id;
    const modifiers = snapshot.annotation.modifiers ?? [];
    const termId = snapshot.annotation.term_id;
    const role = info(snapshot, termId)?.role;
    const own: ModifierWarning[] = role === "modifier" || role === "cohort"
      ? [{ annotationId, kind: "modifier-as-finding", key: `term:${termId}`, labels: [label(snapshot, termId)] }] : [];
    const cohort = modifiers.filter(modifier => info(snapshot, modifier.term_id)?.role === "cohort").map((modifier): ModifierWarning => ({
      annotationId, kind: "cohort-modifier", key: `cohort:${modifier.term_id}`, labels: [label(snapshot, modifier.term_id)],
    }));
    const classes = [...new Set(modifiers.flatMap(modifier => info(snapshot, modifier.term_id)?.exclusiveClass ?? []))];
    const exclusive = classes.filter(cls => classLabels(snapshot, cls).length >= 2).map((cls): ModifierWarning => ({
      annotationId, kind: "exclusive-modifiers", key: `exclusive:${cls}`, labels: classLabels(snapshot, cls), exclusiveClass: cls,
    }));
    return [...own, ...cohort, ...exclusive];
  });
  const known = new Set(warnings.map(warning => pairKey(warning.annotationId, warning.key)));
  for (const pair of serverPairs) {
    if (!isModifierWarningKey(pair.axis) || known.has(pairKey(pair.annotationId, pair.axis))) continue;
    known.add(pairKey(pair.annotationId, pair.axis));
    const snapshot = snapshots.find(candidate => candidate.annotation.annotation_id === pair.annotationId);
    const value = pair.axis.slice(pair.axis.indexOf(":") + 1);
    warnings.push(pair.axis.startsWith("term:") || pair.axis.startsWith("cohort:")
      ? { annotationId: pair.annotationId, kind: pair.axis.startsWith("term:") ? "modifier-as-finding" : "cohort-modifier", key: pair.axis,
        labels: [snapshot ? label(snapshot, value) : value] }
      : { annotationId: pair.annotationId, kind: "exclusive-modifiers", key: pair.axis, labels: snapshot ? classLabels(snapshot, value) : [],
        exclusiveClass: value === "onset" ? "onset" : "severity" });
  }
  return warnings;
}

export function modifierWarningPairs(warnings: readonly ModifierWarning[]): Set<string> {
  return new Set(warnings.map(warning => pairKey(warning.annotationId, warning.key)));
}
