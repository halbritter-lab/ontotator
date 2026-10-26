// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type BulkResult, type UndoView } from "../../src/api/client";
import { runPlanUndo } from "../../src/documents/planUndo";

const undo: UndoView = {
  rows: [
    { case_id: "case-0101", language: "de", review: false, annotate: false, restored_revision: null },
    { case_id: "case-0108", language: "fr", review: true, annotate: true, restored_revision: 3 },
  ],
  revisions: { "case-0101": 4, "case-0108": 7 },
};
const result: BulkResult = { changed_rows: 2, revisions: { "case-0101": 5, "case-0108": 8 }, undo: { rows: [], revisions: {} }, withdrawn: [] };
const consequences = { withdrawn: [{ assignment_id: 9, case_id: "case-0101", language: "de", task: "translation_review", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }], finals_leaving: [], restored: [], open_reports: [] };

afterEach(() => { vi.restoreAllMocks(); });

describe("runPlanUndo", () => {
  it("sends nothing for an empty undo", async () => {
    const set = vi.spyOn(api, "setWorkPlanRows");
    await expect(runPlanUndo("p", { rows: [], revisions: {} })).resolves.toEqual({ kind: "done", revisions: {} });
    expect(set).not.toHaveBeenCalled();
  });

  it("sends undo: true with restored_revision per row", async () => {
    const set = vi.spyOn(api, "setWorkPlanRows").mockResolvedValue(result);
    await expect(runPlanUndo("p", undo)).resolves.toEqual({ kind: "done", revisions: result.revisions });
    expect(set).toHaveBeenCalledWith("p", {
      rows: [
        { case_id: "case-0101", language: "de", review: false, annotate: false, restored_revision: null },
        { case_id: "case-0108", language: "fr", review: true, annotate: true, restored_revision: 3 },
      ],
      expected_revisions: { "case-0101": 4, "case-0108": 7 },
      undo: true,
      confirm: false,
    });
  });

  it("sends back the annotation mode and the decided state of each row", async () => {
    const set = vi.spyOn(api, "setWorkPlanRows").mockResolvedValue(result);
    await runPlanUndo("p", { rows: [
      { case_id: "case-0101", language: "de", review: false, annotate: true, restored_revision: null, annotation_mode: null, decided: false },
      { case_id: "case-0108", language: "fr", review: true, annotate: true, restored_revision: 3, annotation_mode: "scratch", decided: true },
    ], revisions: undo.revisions });
    expect(set.mock.calls[0][1].rows).toEqual([
      { case_id: "case-0101", language: "de", review: false, annotate: true, restored_revision: null, annotation_mode: null, decided: false },
      { case_id: "case-0108", language: "fr", review: true, annotate: true, restored_revision: 3, annotation_mode: "scratch", decided: true },
    ]);
  });

  it("returns needs_confirm with the consequences on 409 WORK_PLAN_CONFIRMATION_REQUIRED and resends with confirm", async () => {
    const set = vi.spyOn(api, "setWorkPlanRows").mockRejectedValueOnce(new ApiError(409, "Confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences)).mockResolvedValueOnce(result);
    await expect(runPlanUndo("p", undo)).resolves.toEqual({ kind: "needs_confirm", consequences });
    await expect(runPlanUndo("p", undo, { confirm: true })).resolves.toEqual({ kind: "done", revisions: result.revisions });
    expect(set.mock.calls[1][1]).toMatchObject({ undo: true, confirm: true });
  });

  it("returns changed on WORK_PLAN_CHANGED", async () => {
    vi.spyOn(api, "setWorkPlanRows").mockRejectedValue(new ApiError(409, "Changed", "WORK_PLAN_CHANGED", { cases: [{ case_id: "case-0101", revision: 6 }] }));
    await expect(runPlanUndo("p", undo)).resolves.toEqual({ kind: "changed", cases: [{ case_id: "case-0101", revision: 6 }] });
  });

  it("rethrows other errors", async () => {
    const failure = new ApiError(500, "Boom", "INTERNAL");
    vi.spyOn(api, "setWorkPlanRows").mockRejectedValue(failure);
    await expect(runPlanUndo("p", undo)).rejects.toBe(failure);
  });
});
