/**
 * One presentation model for the historical-submission dialog. Its entry points deliver two shapes:
 * "View" in My submissions loads a `SubmissionHistoryDetail`; the non-assignment "Submission history"
 * list and "View submitted result" hold raw `Submission` objects.
 */
import type { ReactNode } from "react";
import type { AnnotationSnapshot, Submission, SubmissionHistoryDetail } from "../api/client";
import type { CarriedCheckItem } from "./carried/CarriedChecksReadOnly";
import { deriveCarriedStates, type CarriedInputLike, type ResolutionLike, type SnapshotLike } from "./carried/checkState";
import { carriedOriginLine } from "./carried/instructions";

type EvidenceSnapshot = AnnotationSnapshot["evidence"][number];
type ReviewDecision = Submission["decisions"][number];

export interface HistoricalSubmissionView {
  submissionId: string;
  heading: string;
  documentId: string;
  recordedAt: string;
  annotations: AnnotationSnapshot[];
  evidence: EvidenceSnapshot[];
  decisions: ReviewDecision[];
  checkedLayerIds: string[];
  documentChecked: boolean;
  reanchorInputs: NonNullable<Submission["reanchor_inputs"]>;
  reanchorResolutions: NonNullable<Submission["reanchor_resolutions"]>;
  /** Read-only check states of a carry-forward submission; null when the submission has no round inputs. */
  carried: { items: CarriedCheckItem[] } | null;
}

export function fromSubmission(submission: Submission, heading: string): HistoricalSubmissionView {
  return {
    submissionId: submission.submission_id,
    heading,
    documentId: submission.snapshots[0]?.document_id ?? submission.origin_key.document_id,
    recordedAt: submission.created_at,
    annotations: submission.snapshots,
    evidence: submission.snapshots.flatMap(snapshot => snapshot.evidence),
    decisions: submission.decisions,
    checkedLayerIds: submission.checked_layer_ids ?? [],
    documentChecked: submission.document_checked,
    reanchorInputs: submission.reanchor_inputs ?? [],
    reanchorResolutions: submission.reanchor_resolutions ?? [],
    carried: null,
  };
}

/**
 * Read-only check states of a submitted carry-forward round (historical dialog and case viewer). A
 * submitted round has no open checks; anything not checked or dismissed reads "Check needed".
 */
export function carriedCheckItems(
  inputs: readonly CarriedInputLike[],
  resolutions: readonly ResolutionLike[],
  annotations: readonly SnapshotLike[],
  term: (snapshot: SnapshotLike) => ReactNode,
): CarriedCheckItem[] {
  return deriveCarriedStates(inputs, resolutions, annotations).map(state => ({
    term: term(state.input.target_snapshot ?? state.input.source_snapshot),
    state: state.variant === "checked" || state.variant === "dismissed" ? state.variant : "needed",
    reason: state.resolution?.reason ?? undefined,
    origin: carriedOriginLine(state.input),
  }));
}

export function fromHistoryDetail(detail: SubmissionHistoryDetail, heading: string, termText: (snapshot: SnapshotLike) => string): HistoricalSubmissionView {
  const inputs = detail.round_inputs ?? [];
  const carried = inputs.length === 0 ? null : {
    items: carriedCheckItems(inputs, detail.round_input_resolutions ?? [], detail.annotations, termText),
  };
  return {
    submissionId: detail.summary.submission_id,
    heading,
    documentId: detail.summary.document_id,
    recordedAt: detail.summary.created_at,
    annotations: detail.annotations,
    evidence: detail.evidence,
    decisions: detail.decisions,
    checkedLayerIds: detail.checked_layer_ids,
    documentChecked: detail.document_checked,
    reanchorInputs: detail.reanchor_inputs,
    reanchorResolutions: detail.reanchor_resolutions,
    carried,
  };
}

/** Evidence of one finding: its own snapshot evidence, else the submission's evidence named by its refs. */
export function evidenceOf(view: Pick<HistoricalSubmissionView, "evidence">, snapshot: AnnotationSnapshot): EvidenceSnapshot[] {
  if (snapshot.evidence.length > 0) return snapshot.evidence;
  return (snapshot.annotation.evidence_refs ?? []).flatMap(ref =>
    view.evidence.filter(value => value.mention.evidence_id === ref.evidence_id && value.version === ref.version));
}
