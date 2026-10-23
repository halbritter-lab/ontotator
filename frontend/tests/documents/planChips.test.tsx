import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type BulkResult, type DocumentRowView, type PlanRowResult } from "../../src/api/client";
import { PlanChips, PlanRowNotice, usePlanSaves } from "../../src/documents/PlanChips";
import { rowKeyOf } from "../../src/documents/RowCells";
import { Toast, useToast } from "../../src/ui/Toast";
import { planRow, stepOf } from "./fixtures";

const fr = () => planRow("case-0101", "fr", stepOf("assign_translation_review"));
const de = () => planRow("case-0101", "de", stepOf("assign_translation_review"));
const en = () => planRow("case-0101", "en", stepOf("assign_annotation"), { is_source: true, plan_row: { review: false, annotate: true, review_applicable: false, discarded: false } });

const onChanged = vi.fn();

function Harness({ rows, revision = 3 }: { rows: DocumentRowView[]; revision?: number }) {
  const { toast, show, dismiss } = useToast();
  const [message, setMessage] = useState("");
  const saves = usePlanSaves({ projectKey: "p", onAnnounce: setMessage, onChanged, showToast: show });
  return <>
    {rows.map(row => <div key={rowKeyOf(row)} data-testid={rowKeyOf(row)}>
      <PlanChips row={row} groupRevision={revision} saves={saves} />
      <PlanRowNotice row={row} saves={saves} />
    </div>)}
    <Toast toast={toast} onDismiss={dismiss} />
    <p data-testid="live" aria-live="polite">{message}</p>
  </>;
}

function result(row: DocumentRowView, flags: { review: boolean; annotate: boolean }, revision: number, overrides: Partial<PlanRowResult> = {}): PlanRowResult {
  return {
    case_id: row.case_id, language: row.language,
    flags: { ...flags, review_applicable: !row.is_source, discarded: false },
    revision,
    undo: { rows: [{ case_id: row.case_id, language: row.language, review: row.plan_row!.review, annotate: row.plan_row!.annotate, restored_revision: null }], revisions: { [row.case_id]: revision } },
    withdrawn: [],
    accepted_document_ids: [],
    ...overrides,
  };
}

const bulk = (revisions: Record<string, number>): BulkResult => ({ revisions, withdrawn: [], undo: { rows: [], revisions: {} } } as unknown as BulkResult);
const chip = (name: string) => screen.getByRole("button", { name });
const live = () => screen.getByTestId("live");

beforeEach(() => {
  onChanged.mockReset();
  vi.spyOn(api, "patchWorkPlan");
  vi.spyOn(api, "setWorkPlanRows");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("toggles and saves with one click and shows the undo toast", async () => {
  const row = fr();
  vi.mocked(api.patchWorkPlan).mockResolvedValue(result(row, { review: false, annotate: true }, 4));
  render(<Harness rows={[row]} />);
  expect(chip("Translation review, case-0101 fr").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(chip("Translation review, case-0101 fr"));
  expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "fr", { review: false, expected_revision: 3, confirm: false });
  const toast = await screen.findByText("fr of case-0101: Translation review off");
  expect(within(toast.closest(".ui-toast") as HTMLElement).getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(chip("Translation review, case-0101 fr").getAttribute("aria-pressed")).toBe("false");
  expect(onChanged).toHaveBeenCalled();
});

it("adds the withdrawn-task note to the toast", async () => {
  const row = fr();
  vi.mocked(api.patchWorkPlan).mockResolvedValue(result(row, { review: false, annotate: true }, 4, {
    withdrawn: [{ assignment_id: 9, case_id: "case-0101", language: "fr", task: "translation_review", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }],
  }));
  render(<Harness rows={[row]} />);
  fireEvent.click(chip("Translation review, case-0101 fr"));
  expect(await screen.findByText("Undo restores the plan, not withdrawn tasks.")).toBeTruthy();
});

it("undo restores the previous flags with the returned revision", async () => {
  const row = fr();
  const saved = result(row, { review: false, annotate: true }, 4);
  vi.mocked(api.patchWorkPlan).mockResolvedValue(saved);
  vi.mocked(api.setWorkPlanRows).mockResolvedValue(bulk({ "case-0101": 5 }));
  render(<Harness rows={[row]} />);
  fireEvent.click(chip("Translation review, case-0101 fr"));
  const undoButton = await screen.findByRole("button", { name: "Undo" });
  act(() => { undoButton.focus(); });
  fireEvent.click(undoButton);
  expect(live().textContent).toBe("Saving…");
  await waitFor(() => expect(api.setWorkPlanRows).toHaveBeenCalledWith("p", {
    rows: [{ case_id: "case-0101", language: "fr", review: true, annotate: true, restored_revision: null }],
    expected_revisions: { "case-0101": 4 }, undo: true, confirm: false,
  }));
  await waitFor(() => expect(chip("Translation review, case-0101 fr").getAttribute("aria-pressed")).toBe("true"));
  expect(live().textContent).toBe("Plan change undone.");
  await waitFor(() => expect(document.activeElement).toBe(chip("Translation review, case-0101 fr")));
  // The next save uses the revision returned by the undo.
  vi.mocked(api.patchWorkPlan).mockResolvedValue(result(row, { review: false, annotate: true }, 6));
  fireEvent.click(chip("Translation review, case-0101 fr"));
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-0101", "fr", { review: false, expected_revision: 5, confirm: false }));
});

it("undo after an intervening assignment shows the message and the normal confirmation", async () => {
  const row = fr();
  vi.mocked(api.patchWorkPlan).mockResolvedValue(result(row, { review: true, annotate: true }, 4, {
    undo: { rows: [{ case_id: "case-0101", language: "fr", review: false, annotate: true, restored_revision: null }], revisions: { "case-0101": 4 } },
  }));
  const consequences = { withdrawn: [{ assignment_id: 9, case_id: "case-0101", language: "fr", task: "translation_review", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }], finals_leaving: [], restored: [], open_reports: [] };
  vi.mocked(api.setWorkPlanRows).mockRejectedValueOnce(new ApiError(409, "confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences)).mockResolvedValue(bulk({ "case-0101": 6 }));
  render(<Harness rows={[{ ...row, plan_row: { ...row.plan_row!, review: false } }]} />);
  fireEvent.click(chip("Translation review, case-0101 fr"));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Since your change, work was assigned: 1 open translation review (Ana Weber, ann-0004) would be withdrawn.")).toBeTruthy();
  const box = screen.getByRole("group", { name: "Undo the plan change" });
  const undoAnyway = within(box).getByRole("button", { name: "Undo anyway" });
  expect(undoAnyway.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(within(box).getByRole("checkbox", { name: "I understand — withdraw the open tasks" }));
  fireEvent.click(undoAnyway);
  await waitFor(() => expect(api.setWorkPlanRows).toHaveBeenLastCalledWith("p", expect.objectContaining({ undo: true, confirm: true })));
  await waitFor(() => expect(screen.queryByRole("group", { name: "Undo the plan change" })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(chip("Translation review, case-0101 fr")));
});

it("serialises two quick toggles on one case and sends the revision of the first response", async () => {
  const rowFr = fr();
  const rowDe = de();
  let resolveFirst!: (value: PlanRowResult) => void;
  vi.mocked(api.patchWorkPlan)
    .mockImplementationOnce(() => new Promise(done => { resolveFirst = done; }))
    .mockResolvedValueOnce(result(rowDe, { review: true, annotate: false }, 5));
  render(<Harness rows={[rowFr, rowDe]} />);
  fireEvent.click(chip("Translation review, case-0101 fr"));
  fireEvent.click(chip("Annotate, case-0101 de"));
  expect(api.patchWorkPlan).toHaveBeenCalledTimes(1);
  expect(chip("Translation review, case-0101 fr").getAttribute("aria-disabled")).toBe("true");
  expect(chip("Annotate, case-0101 de").getAttribute("aria-disabled")).toBe("true");
  await act(async () => { resolveFirst(result(rowFr, { review: false, annotate: true }, 4)); });
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledTimes(2));
  expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-0101", "de", { annotate: false, expected_revision: 4, confirm: false });
  expect(await screen.findByText("de of case-0101: Annotate off")).toBeTruthy();
  expect(screen.queryByText("This plan changed. Reloaded the current plan.")).toBeNull();
});

it("announces Saving… in the page's shared polite region", async () => {
  const row = fr();
  vi.mocked(api.patchWorkPlan).mockImplementation(() => new Promise(() => {}));
  render(<Harness rows={[row]} />);
  fireEvent.click(chip("Annotate, case-0101 fr"));
  expect(live().textContent).toBe("Saving…");
  // No status region per chip.
  expect(screen.getByTestId("case-0101:fr").querySelector("[role='status']")).toBeNull();
});

it("opens an inline confirmation with consequences instead of saving", async () => {
  const row = fr();
  const consequences = {
    withdrawn: [{ assignment_id: 9, case_id: "case-0101", language: "fr", task: "annotate", person: { pseudonym: "ann-0004", display_name: "Annotator", is_me: false } }],
    finals_leaving: [{ case_id: "case-0101", language: "fr" }], restored: [], open_reports: [],
  };
  vi.mocked(api.patchWorkPlan)
    .mockRejectedValueOnce(new ApiError(409, "confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences))
    .mockResolvedValueOnce(result(row, { review: true, annotate: false }, 4));
  render(<Harness rows={[row]} />);
  fireEvent.click(chip("Annotate, case-0101 fr"));
  const box = await screen.findByRole("group", { name: "Change the plan of case-0101 fr" });
  expect(within(box).getByText("1 open annotation will be withdrawn (Annotator, ann-0004; draft kept).")).toBeTruthy();
  expect(within(box).getByText("1 final result (case-0101 fr) stays in history but is no longer exported.")).toBeTruthy();
  expect(screen.queryByText(/fr of case-0101/)).toBeNull();
  const save = within(box).getByRole("button", { name: "Save" });
  fireEvent.click(save);
  expect(api.patchWorkPlan).toHaveBeenCalledTimes(1);
  fireEvent.click(within(box).getByRole("checkbox", { name: "I understand — withdraw the open tasks" }));
  fireEvent.click(save);
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-0101", "fr", { annotate: false, expected_revision: 3, confirm: true }));
  expect(await screen.findByText("fr of case-0101: Annotate off")).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Change the plan of case-0101 fr" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(chip("Annotate, case-0101 fr")));
});

it("offers the external-review acceptance for an invalid combination", async () => {
  const row = fr();
  expect(row.plan_row).toMatchObject({ review: true, annotate: true });
  vi.mocked(api.patchWorkPlan)
    .mockRejectedValueOnce(new ApiError(422, "invalid", "WORK_PLAN_INVALID", { reason: "annotate_not_accepted", rows: [{ case_id: "case-0101", language: "fr" }] }))
    .mockResolvedValueOnce(result(row, { review: false, annotate: true }, 4));
  render(<Harness rows={[row]} />);
  fireEvent.click(chip("Translation review, case-0101 fr"));
  const box = await screen.findByRole("group", { name: "Annotate without review" });
  expect(within(box).getByText("This translation was reviewed outside Ontocurator — accept it as it is")).toBeTruthy();
  const accept = within(box).getByRole("button", { name: "Accept and annotate" });
  expect(accept.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(accept);
  expect(api.patchWorkPlan).toHaveBeenCalledTimes(1);
  fireEvent.change(within(box).getByLabelText("Reason (required)"), { target: { value: "Reviewed by the clinic" } });
  fireEvent.click(accept);
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-0101", "fr", {
    review: false, expected_revision: 3, confirm: false, accept_external_review: { reason: "Reviewed by the clinic" },
  }));
  await waitFor(() => expect(screen.queryByRole("group", { name: "Annotate without review" })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(chip("Translation review, case-0101 fr")));
});

it("keeps focus while saving and shows an inline error with Retry", async () => {
  const row = fr();
  let fail!: (error: unknown) => void;
  vi.mocked(api.patchWorkPlan).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValueOnce(result(row, { review: false, annotate: true }, 4));
  render(<Harness rows={[row]} />);
  const review = chip("Translation review, case-0101 fr");
  review.focus();
  fireEvent.click(review);
  expect(document.activeElement).toBe(review);
  expect(review.getAttribute("aria-disabled")).toBe("true");
  expect(review.hasAttribute("disabled")).toBe(false);
  fireEvent.click(review);
  expect(api.patchWorkPlan).toHaveBeenCalledTimes(1);
  await act(async () => { fail(new Error("offline")); });
  expect(document.activeElement).toBe(review);
  const alert = await within(screen.getByTestId("case-0101:fr")).findByRole("alert");
  expect(alert.textContent).toContain("Could not save the plan");
  fireEvent.click(within(screen.getByTestId("case-0101:fr")).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledTimes(2));
  expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-0101", "fr", { review: false, expected_revision: 3, confirm: false });
  expect(await screen.findByText("fr of case-0101: Translation review off")).toBeTruthy();
});

it("reloads after a stale revision with the message", async () => {
  const row = fr();
  vi.mocked(api.patchWorkPlan).mockRejectedValueOnce(new ApiError(409, "changed", "WORK_PLAN_CHANGED", { cases: [{ case_id: "case-0101", revision: 7 }] }))
    .mockResolvedValueOnce(result(row, { review: false, annotate: true }, 8));
  render(<Harness rows={[row]} />);
  fireEvent.click(chip("Translation review, case-0101 fr"));
  expect(await screen.findByText("This plan changed. Reloaded the current plan.")).toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
  fireEvent.click(chip("Translation review, case-0101 fr"));
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-0101", "fr", { review: false, expected_revision: 7, confirm: false }));
});

it("shows only Annotate on the source row", () => {
  render(<Harness rows={[en()]} />);
  expect(chip("Annotate, case-0101 en").getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: "Translation review, case-0101 en" })).toBeNull();
});

it("sends a queued second save after a 409 confirmation and the confirmed save with the latest revision", async () => {
  const rowFr = fr();
  const rowDe = de();
  const consequences = { withdrawn: [], finals_leaving: [{ case_id: "case-0101", language: "fr" }], restored: [], open_reports: [] };
  let rejectFirst!: (error: unknown) => void;
  vi.mocked(api.patchWorkPlan)
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
    .mockResolvedValueOnce(result(rowDe, { review: true, annotate: false }, 4))
    .mockResolvedValueOnce(result(rowFr, { review: true, annotate: false }, 5));
  render(<Harness rows={[rowFr, rowDe]} />);
  fireEvent.click(chip("Annotate, case-0101 fr"));
  fireEvent.click(chip("Annotate, case-0101 de"));
  expect(api.patchWorkPlan).toHaveBeenCalledTimes(1);
  await act(async () => { rejectFirst(new ApiError(409, "confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences)); });
  // The queued save runs once the first request settled, still with the page's revision.
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledTimes(2));
  expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-0101", "de", { annotate: false, expected_revision: 3, confirm: false });
  expect(await screen.findByText("de of case-0101: Annotate off")).toBeTruthy();
  const box = screen.getByRole("group", { name: "Change the plan of case-0101 fr" });
  fireEvent.click(within(box).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenLastCalledWith("p", "case-0101", "fr", { annotate: false, expected_revision: 4, confirm: true }));
  expect(await screen.findByText("fr of case-0101: Annotate off")).toBeTruthy();
});

it("keeps a chip busy while a second request for it is queued", async () => {
  const row = fr();
  let resolveFirst!: (value: PlanRowResult) => void;
  vi.mocked(api.patchWorkPlan)
    .mockImplementationOnce(() => new Promise(done => { resolveFirst = done; }))
    .mockImplementationOnce(() => new Promise(() => {}));
  render(<Harness rows={[row]} />);
  fireEvent.click(chip("Annotate, case-0101 fr"));
  fireEvent.click(chip("Translation review, case-0101 fr"));
  await act(async () => { resolveFirst(result(row, { review: true, annotate: false }, 4)); });
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledTimes(2));
  expect(chip("Translation review, case-0101 fr").getAttribute("aria-disabled")).toBe("true");
  expect(chip("Annotate, case-0101 fr").getAttribute("aria-disabled")).toBeNull();
});
