/**
 * Helpers of the final-result requests (`FinalConfirm.tsx`), shared by the final-result panel. The
 * decision flows (confirmations, focus targets, busy, conflict, network and session rules) are tested
 * on the panel (`finalPanel.test.tsx`) and the page (`documentsPage.test.tsx`).
 */
import { expect, it } from "vitest";
import { AuthError, ConflictError } from "../../src/api/client";
import { barChanges, currentFinalLabel, failureOf, keepRequest, selectionPayload, selectRequest, successMessage } from "../../src/documents/FinalConfirm";
import { bar, final, item, row, submission, submissions, version } from "./fixtures";

it("maps errors, success messages and bar changes", () => {
  expect(failureOf(new AuthError("x", undefined, "NOT_AUTHENTICATED", 401))).toEqual({ kind: "session" });
  expect(failureOf(new ConflictError("x", "OWN_RESULT_NOT_SELECTABLE"))).toEqual({ kind: "conflict", changedBy: null, changedAt: null, ownResult: true });
  expect(failureOf(new Error("offline"))).toEqual({ kind: "error" });
  expect(barChanges(bar({ total: 2, confirm_final: 1 }), bar({ total: 1, confirm_final: 0 }))).toBe("Needs your decision: 1 (was 2). Final result to confirm: 0 (was 1).");
  const base = { rowKey: "c:de", caseId: "c", language: "de", documentId: "d", submissionId: "s", expectedRevision: 1, causeIds: [], triggerId: "t", label: "L", oldLabel: null, stillOpen: null, roundNote: null, own: false, causeLines: [] };
  expect(successMessage({ ...base, kind: "use", waiting: [] })).toBe("L is now the final result.");
  expect(successMessage({ ...base, kind: "keep", waiting: [] })).toBe("Kept L.");
});

it("builds Use, Replace and Keep payloads from the row's state", () => {
  const target = row({ case_id: "c", language: "de", versions: [version({ document_id: "c-de" })] });
  const chosen = submission({ submission_id: "s2", document_id: "c-de" });
  expect(selectionPayload(selectRequest(target, null, chosen, "t"))).toEqual({ document_id: "c-de", submission_id: "s2", expected_revision: 0, acknowledged_cause_ids: [] });
  const withFinal = { ...target, final: final({ case_id: "c", language: "de", document_id: "c-de", submission_id: "s1", revision: 3 }) };
  expect(selectRequest(withFinal, null, chosen, "t").kind).toBe("replace");
  const cause = item({ code: "PLAN_RESTORED", cause_id: "PLAN_RESTORED:c:de:3", category: "confirm-final" });
  const keep = keepRequest({ ...withFinal, issues: [cause] }, submissions("c", "de"), [cause.cause_id], "t");
  expect(selectionPayload(keep)).toEqual({ document_id: "c-de", submission_id: "s1", expected_revision: 3, acknowledged_cause_ids: [cause.cause_id] });
});

it("labels a final result without a recorded time without inventing one", () => {
  const target = row({ case_id: "c", language: "de", versions: [version({ document_id: "c-de" })],
    final: final({ case_id: "c", language: "de", document_id: "c-de", submission_id: "s1", recorded_at: null, selected_at: "2026-10-18T10:05:00Z", updated_at: "2026-10-18T10:05:00Z" }) });
  expect(currentFinalLabel(target, null)).toBe("Annotation · Round 1 · ann-0001 · de v1");
});
