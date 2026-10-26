/**
 * Undo of a plan change (spec D22): restores the exact previous flags and `restored_revision` of
 * every row through `PUT …/work-plans/rows` with `undo: true`. Used by the plan chips, the selection
 * bar quick actions and the plan dialog's toast.
 */
import { api, ApiError, type ConsequencesView, type UndoView } from "../api/client";

export type PlanUndoOutcome =
  | { kind: "done"; revisions: Record<string, number> }
  | { kind: "needs_confirm"; consequences: ConsequencesView }
  | { kind: "changed"; cases: { case_id: string; revision: number }[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function changedCases(details: unknown): { case_id: string; revision: number }[] {
  if (!isRecord(details) || !Array.isArray(details.cases)) return [];
  return details.cases.filter((item): item is { case_id: string; revision: number } => isRecord(item) && typeof item.case_id === "string" && typeof item.revision === "number")
    .map(item => ({ case_id: item.case_id, revision: item.revision }));
}

/** Work assigned since the change would be withdrawn: `needs_confirm`; a newer plan revision: `changed`. Other errors are thrown. */
export async function runPlanUndo(projectKey: string, undo: UndoView, options?: { confirm?: boolean }): Promise<PlanUndoOutcome> {
  // Nothing to restore (a save that changed no row): the server refuses an empty list.
  if (!undo.rows.length) return { kind: "done", revisions: {} };
  try {
    const result = await api.setWorkPlanRows(projectKey, {
      // The server restores `annotation_mode` and `decided` only when the row names them (null clears an override).
      rows: undo.rows.map(row => ({
        case_id: row.case_id, language: row.language, review: row.review, annotate: row.annotate, restored_revision: row.restored_revision ?? null,
        ...(row.annotation_mode !== undefined ? { annotation_mode: row.annotation_mode } : {}),
        ...(row.decided !== undefined ? { decided: row.decided } : {}),
      })),
      expected_revisions: undo.revisions,
      undo: true,
      confirm: options?.confirm ?? false,
    });
    return { kind: "done", revisions: result.revisions };
  } catch (error: unknown) {
    if (error instanceof ApiError && error.code === "WORK_PLAN_CONFIRMATION_REQUIRED" && isRecord(error.details)) {
      return { kind: "needs_confirm", consequences: error.details as unknown as ConsequencesView };
    }
    if (error instanceof ApiError && error.code === "WORK_PLAN_CHANGED") return { kind: "changed", cases: changedCases(error.details) };
    throw error;
  }
}
