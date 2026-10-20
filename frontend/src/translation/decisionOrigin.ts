import { textDiffers, type ReviewDecisionCode } from "./reviewRules";

/** The draft form as stored, possibly holding values the typed form does not accept. */
export type RawForm = Readonly<Record<string, unknown>>;
/** Who chose the current decision; client-side only, never stored in the draft. */
export type DecisionOrigin = { kind: "user" } | { kind: "auto"; previous: "accepted_unchanged" | undefined };
export type AutoNote =
  | { kind: "selected"; from: "accepted_unchanged" | undefined }
  | { kind: "reverted"; to: "accepted_unchanged" | undefined };
export interface DecisionState { origin: DecisionOrigin; note: AutoNote | null }

/** The state on open and after a reload: a stored decision counts as chosen by the user. */
export const USER_ORIGIN: DecisionState = Object.freeze({ origin: Object.freeze({ kind: "user" as const }), note: null });

/** No decision chosen yet; any other stored value, even an unknown one, counts as chosen. */
const noDecision = (raw: RawForm): boolean => raw.decision === undefined || raw.decision === null;

/**
 * Query/Rejected: clinical_change true; Accepted with corrections: keeps clinical_change and categories;
 * Accepted unchanged: clinical_change false, categories []. Rationale and unknown raw keys are always kept.
 */
export function chooseDecision(raw: RawForm, decision: ReviewDecisionCode): Record<string, unknown> {
  switch (decision) {
    case "query":
    case "rejected":
      return { ...raw, decision, clinical_change: true };
    case "accepted_corrected":
      return { ...raw, decision };
    case "accepted_unchanged":
      return { ...raw, decision, clinical_change: false, categories: [] };
  }
}

/**
 * Spec A.4: an edit away from the machine text selects "Accepted with corrections" when no decision or
 * Accepted unchanged is chosen; undoing the edit restores the earlier decision while the selection was
 * automatic. Returns the same `state` object when nothing changes, so the live note is announced once.
 */
export function reactToTextEdit(state: DecisionState, raw: RawForm, machineText: string, nextText: string):
  { state: DecisionState; form: Record<string, unknown> } {
  const unchanged = { state, form: raw as Record<string, unknown> };
  if (textDiffers(machineText, nextText)) {
    if (state.origin.kind === "auto") return unchanged;
    const previous = noDecision(raw) ? undefined : raw.decision === "accepted_unchanged" ? "accepted_unchanged" as const : null;
    if (previous === null) return unchanged;
    return {
      state: { origin: { kind: "auto", previous }, note: { kind: "selected", from: previous } },
      form: { ...raw, decision: "accepted_corrected" },
    };
  }
  if (state.origin.kind !== "auto") return unchanged;
  const previous = state.origin.previous;
  const reverted: DecisionState = { origin: { kind: "user" }, note: { kind: "reverted", to: previous } };
  // A decision changed without going through the user's choice keeps it (defensive; the screen resets the origin).
  if (raw.decision !== "accepted_corrected") return { state: USER_ORIGIN, form: raw as Record<string, unknown> };
  if (previous === "accepted_unchanged") return { state: reverted, form: chooseDecision(raw, "accepted_unchanged") };
  const rest: Record<string, unknown> = { ...raw };
  delete rest.decision;
  return { state: reverted, form: rest };
}

export function autoNoteText(note: AutoNote | null): string | null {
  if (!note) return null;
  if (note.kind === "selected") {
    return note.from === "accepted_unchanged"
      ? "Changed from Accepted unchanged because you edited the translation."
      : "Selected because you edited the translation. You can choose another decision.";
  }
  return note.to === "accepted_unchanged"
    ? "Your edits are undone, so the decision is back to Accepted unchanged."
    : "Your edits are undone, so the decision is back to not chosen.";
}
