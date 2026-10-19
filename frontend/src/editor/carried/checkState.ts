/**
 * Pure check-state rules for carried inputs (spec "Terms"). Structural types only, so this module
 * does not depend on the generated API types; the check state is always derived, never stored.
 */

export interface SnapshotLike {
  annotation: {
    annotation_id: string;
    layer_id: string;
    type_id: string;
    term_id: string;
    evidence_refs?: readonly unknown[] | null;
    axes_values?: Record<string, unknown> | null;
    axes_defaulted?: readonly string[] | null;
    note?: string | null;
  };
  version: string;
  text_sha256?: string | null;
}

export interface CarriedInputLike {
  input_id: string;
  source_submission_id: string;
  source_snapshot: SnapshotLike;
  target_snapshot: SnapshotLike | null;
  mapping_status: "carried" | "needs_review";
  review_reason?: string | null;
  source_round_ordinal?: number | null;
  source_recorded_at?: string | null;
  source_language?: string | null;
  source_version?: number | null;
}

export interface ResolutionLike {
  input_id: string;
  outcome: "completed" | "dismissed";
  annotation_ref?: { annotation_id: string; version: string } | null;
  reason?: string | null;
}

/** "needed", "changed" and "removed" are the three "Check needed" variants (unchecked). */
export type CheckVariant = "needed" | "changed" | "removed" | "checked" | "dismissed";

export interface CarriedState {
  input: CarriedInputLike;
  /** Position in the round's input order. */
  index: number;
  variant: CheckVariant;
  unchecked: boolean;
  resolution?: ResolutionLike;
  /** Which list row shows this input: the carried finding, a linked finding, or a placeholder row. */
  home: "carried" | "linked" | "placeholder";
  /** Annotation ID of the home row; null for a placeholder row. */
  homeId: string | null;
  /** The carried finding's ID while it still exists in the draft. */
  carriedId: string | null;
  /** Why no carried finding exists; null while it exists. */
  missing: "mapping_failed" | "deleted" | null;
}

const isUnchecked = (variant: CheckVariant) => variant === "needed" || variant === "changed" || variant === "removed";

export function deriveCarriedStates(
  inputs: readonly CarriedInputLike[],
  resolutions: readonly ResolutionLike[],
  annotations: readonly SnapshotLike[],
): CarriedState[] {
  const byId = new Map(annotations.map(snapshot => [snapshot.annotation.annotation_id, snapshot]));
  return inputs.map((input, index) => {
    const resolution = resolutions.find(value => value.input_id === input.input_id);
    const carriedRef = input.target_snapshot?.annotation.annotation_id ?? null;
    const carriedId = carriedRef !== null && byId.has(carriedRef) ? carriedRef : null;
    const missing = carriedId ? null : input.target_snapshot ? ("deleted" as const) : ("mapping_failed" as const);
    let variant: CheckVariant = "needed";
    let home: CarriedState["home"] = carriedId ? "carried" : "placeholder";
    let homeId = carriedId;
    if (resolution?.outcome === "dismissed") variant = "dismissed";
    else if (resolution?.outcome === "completed" && resolution.annotation_ref) {
      const linked = byId.get(resolution.annotation_ref.annotation_id);
      if (!linked) variant = "removed";
      else {
        variant = linked.version === resolution.annotation_ref.version ? "checked" : "changed";
        homeId = linked.annotation.annotation_id;
        home = homeId === carriedRef ? "carried" : "linked";
      }
    }
    return { input, index, variant, unchecked: isUnchecked(variant), resolution, home, homeId, carriedId, missing };
  });
}

/** List key (`data-list-key`) of the row that shows the input. */
export const rowKeyOf = (state: Pick<CarriedState, "homeId" | "input">): string =>
  state.homeId ? `annotation:${state.homeId}` : `input:${state.input.input_id}`;

/** Sidebar progress line, e.g. "2 of 5 checked, 1 dismissed". */
export function progressText(states: readonly Pick<CarriedState, "variant" | "unchecked">[]): string {
  if (!states.some(state => state.unchecked)) return "All carried findings checked";
  const checked = states.filter(state => state.variant === "checked").length;
  const dismissed = states.filter(state => state.variant === "dismissed").length;
  return `${checked} of ${states.length} checked${dismissed ? `, ${dismissed} dismissed` : ""}`;
}

/** Next open key after `current` in list order (wrapping); `direction` -1 goes backwards. */
export function nextUncheckedKey(order: readonly string[], open: ReadonlySet<string>, current: string | null, direction: 1 | -1): string | null {
  if (!order.some(key => open.has(key))) return null;
  const start = current === null ? -1 : order.indexOf(current);
  const length = order.length;
  for (let step = 1; step <= length; step++) {
    // From "no selection" (-1) backwards, the first step lands on the last row.
    const position = start === -1 && direction === -1 ? length - step : start + direction * step;
    const key = order[((position % length) + length) % length];
    if (open.has(key)) return key;
  }
  return null;
}

export interface CheckStateBadge {
  tone: "warning" | "success" | "neutral";
  label: "Check needed" | "Checked" | "Dismissed";
  /** Extra line for the "changed" and "removed" variants. */
  line: string | null;
}

/** Badge text, `StatusBadge` tone and extra line for a check state (spec "Terms" table). */
export function checkStateBadge(variant: CheckVariant): CheckStateBadge {
  switch (variant) {
    case "checked":
      return { tone: "success", label: "Checked", line: null };
    case "dismissed":
      return { tone: "neutral", label: "Dismissed", line: null };
    case "changed":
      return { tone: "warning", label: "Check needed", line: "Changed after your check" };
    case "removed":
      return { tone: "warning", label: "Check needed", line: "The linked finding was deleted" };
    default:
      return { tone: "warning", label: "Check needed", line: null };
  }
}

/**
 * Row keys of the findings list (spec section 1: carried findings lead the list): one row per
 * carried input in round-input order (its carried finding while it exists, else its placeholder
 * row), then every other finding in draft order. `annotationIds` is the draft order.
 */
export function carriedListOrder(
  states: readonly Pick<CarriedState, "input" | "carriedId">[],
  annotationIds: readonly string[],
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => { if (!seen.has(key)) { seen.add(key); keys.push(key); } };
  for (const state of states) push(state.carriedId ? `annotation:${state.carriedId}` : `input:${state.input.input_id}`);
  for (const id of annotationIds) push(`annotation:${id}`);
  return keys;
}

/**
 * Axes to send as chosen when a carried finding is re-created ("Mark in text"): the original's
 * non-empty values that were not defaulted, limited to the axes of the target type.
 */
export function carriedChosenAxisIds(source: SnapshotLike["annotation"], axisIds: readonly string[]): string[] {
  const defaulted = new Set(source.axes_defaulted ?? []);
  const values = source.axes_values ?? {};
  return axisIds.filter(axis => {
    const value = values[axis];
    return value !== null && value !== undefined && value !== "" && !defaulted.has(axis);
  });
}
