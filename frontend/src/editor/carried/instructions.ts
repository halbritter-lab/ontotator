/**
 * Pure wording for carried findings: list instruction lines (spec section 1), the inspector's
 * "What to check" lines (section 2) and the exception-path reasons (section 3).
 */
import type { CarriedInputLike, CheckVariant } from "./checkState";

export interface WhatToCheckContext {
  /** Round number of the source submission; null when unknown. */
  sourceOrdinal: number | null;
  /** Text version the source submission was made on; null when unknown. */
  sourceVersion: number | null;
  currentVersion: number;
  language: string;
  hasEvidence: boolean;
  /** The carried finding sits on the same text (hash) as its source. */
  sameText: boolean;
}

export type InstructionWhere = "carried" | "linked" | "placeholder:mapping_failed" | "placeholder:deleted";

/** "Round 2", or "the earlier round" when the source round is unknown. */
export const roundName = (ordinal: number | null | undefined): string => (ordinal ? `Round ${ordinal}` : "the earlier round");

/** The one instruction line of an unchecked row; null for checked and dismissed rows. */
export function instructionLine(ctx: WhatToCheckContext, variant: CheckVariant, where: InstructionWhere): string | null {
  if (variant === "checked" || variant === "dismissed") return null;
  if (where === "placeholder:mapping_failed") return "Could not be placed on this text. Mark it again, link it or dismiss it.";
  if (where === "placeholder:deleted") return "You deleted the carried finding. Link another finding or dismiss it.";
  if (variant === "changed") return "Changed after your check. Check it again.";
  // "removed" with the carried finding still present: the badge line says the link was deleted;
  // the instruction is the carried finding's own data line.
  if (!ctx.hasEvidence) return "No text span. Check that it still applies to this text.";
  if (ctx.sameText) return "Check the marked text and the values.";
  return `The text changed since ${roundName(ctx.sourceOrdinal)}. Check the marked text and the values.`;
}

/** "What to check" → "Text span". */
export function textSpanLine(ctx: WhatToCheckContext): string {
  const round = roundName(ctx.sourceOrdinal);
  if (!ctx.hasEvidence) return `None. This finding had no text span in ${round} either.`;
  if (ctx.sameText) return `Same text as in ${round} (${ctx.language} v${ctx.currentVersion}).`;
  const versions = ctx.sourceVersion !== null && ctx.sourceVersion !== ctx.currentVersion ? ` (v${ctx.sourceVersion} → v${ctx.currentVersion})` : "";
  return `The text was corrected since ${round}${versions}. The span was moved; check that it still covers the finding.`;
}

/** "What to check" → "Values"; `defaultedAxisLabels` are the display labels of defaulted axes. */
export function valuesLines(defaultedAxisLabels: readonly string[]): string[] {
  const lines = ["Carried unchanged. Carrying does not confirm values."];
  if (defaultedAxisLabels.length) lines.push(`Not confirmed: ${defaultedAxisLabels.join(", ")}.`);
  return lines;
}

/** List meta line of a carried row, e.g. "Carried from Round 2". */
export const carriedFromLine = (ordinal: number | null): string => (ordinal ? `Carried from Round ${ordinal}` : "Carried from an earlier submission");

/** Meta line of a finding that inputs were linked to through the exception path. */
export function linkedMetaLine(sources: readonly { term: string; sourceOrdinal: number | null }[]): string {
  if (sources.length === 1) {
    const [source] = sources;
    return source.sourceOrdinal ? `Linked to carried ${source.term} (Round ${source.sourceOrdinal})` : `Linked to carried ${source.term}`;
  }
  return `Linked to ${sources.length} carried findings`;
}

const DISMISSED_REASON_LENGTH = 60;

/** Muted line of a dismissed placeholder row (first 60 characters of the reason). */
export function dismissedLine(reason: string): string {
  const text = reason.trim();
  return `Dismissed: ${Array.from(text).slice(0, DISMISSED_REASON_LENGTH).join("")}`;
}

const REASON_SENTENCES: Readonly<Record<string, string>> = {
  ambiguous_evidence: "Its text appears more than once in this text, so it could not be placed automatically.",
  changed_segment: "Its text was changed by the correction, so it could not be placed automatically.",
  changed_cue: "Its text was changed by the correction, so it could not be placed automatically.",
  missing_evidence: "Its original text span could not be read reliably, so it could not be placed automatically.",
  evidence_version_mismatch: "Its original text span could not be read reliably, so it could not be placed automatically.",
  evidence_source_mismatch: "Its original text span could not be read reliably, so it could not be placed automatically.",
  invalid_bounds: "Its original text span could not be read reliably, so it could not be placed automatically.",
  source_text_mismatch: "Its original text span could not be read reliably, so it could not be placed automatically.",
};

/** Exception-path reason why no carried finding exists (stored `review_reason` when known). */
export function missingReason(missing: "mapping_failed" | "deleted", reviewReason: string | null | undefined): string {
  if (missing === "deleted") return "You deleted the carried finding in this round.";
  return (reviewReason && Object.hasOwn(REASON_SENTENCES, reviewReason) ? REASON_SENTENCES[reviewReason] : null) ?? "Its text span could not be found in this text.";
}

/** Builds the context for the instruction and "What to check" lines from an input and the open text. */
export function whatToCheckContext(input: CarriedInputLike, currentDocument: { version: number; language: string; text_sha256: string }): WhatToCheckContext {
  const snapshot = input.target_snapshot ?? input.source_snapshot;
  const sameText = input.target_snapshot
    ? input.target_snapshot.text_sha256 === input.source_snapshot.text_sha256
    : input.source_snapshot.text_sha256 === currentDocument.text_sha256;
  return {
    sourceOrdinal: input.source_round_ordinal ?? null,
    sourceVersion: input.source_version ?? null,
    currentVersion: currentDocument.version,
    language: currentDocument.language,
    hasEvidence: (snapshot.annotation.evidence_refs?.length ?? 0) > 0,
    sameText,
  };
}
