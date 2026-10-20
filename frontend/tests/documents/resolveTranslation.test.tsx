import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type DiscardResult, type PlanRowResult } from "../../src/api/client";
import { ResolveTranslation, type ResolveTranslationProps } from "../../src/documents/ResolveTranslation";
import { planRow, stepOf, version } from "./fixtures";

const rejected = () => planRow("case-0101", "de", stepOf("resolve_rejected", { document_id: "case-0101-de" }), {
  versions: [version({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "rejected" })],
});
const notAccepted = () => planRow("case-0101", "de", stepOf("translation_not_accepted", { document_id: "case-0101-de" }), {
  plan_row: { review: false, annotate: true, review_applicable: true, discarded: false },
});

function renderResolve(overrides: Partial<ResolveTranslationProps> = {}) {
  const props: ResolveTranslationProps = {
    mode: "resolve", row: rejected(), projectKey: "p", revision: 3,
    onAssignReview: vi.fn(), onCorrect: vi.fn(), onDone: vi.fn(), onChanged: vi.fn(), onAnnounce: vi.fn(), onCancel: vi.fn(),
    ...overrides,
  };
  render(<ResolveTranslation {...props} />);
  return props;
}

const discarded = (overrides: Partial<DiscardResult> = {}): DiscardResult => ({
  case_id: "case-0101", language: "de", discarded_document_ids: ["case-0101-de"],
  flags: { review: false, annotate: false, review_applicable: true, discarded: true }, revision: 4, withdrawn: [], ...overrides,
});

beforeEach(() => {
  vi.spyOn(api, "discardVariant");
  vi.spyOn(api, "patchWorkPlan");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("offers exactly three options", () => {
  const props = renderResolve();
  const box = screen.getByRole("group", { name: "Resolve rejected translation, case-0101 · de" });
  expect(within(box).getAllByRole("button").map(button => button.textContent)).toEqual([
    "Assign a new review…", "Correct the translation…", "Discard the de translation…", "Cancel",
  ]);
  expect(within(box).queryByText(/accept/i)).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: "Assign a new review…" }));
  expect(props.onAssignReview).toHaveBeenCalled();
  fireEvent.click(within(box).getByRole("button", { name: "Correct the translation…" }));
  expect(props.onCorrect).toHaveBeenCalled();
});

it("discards with a required reason and shows consequences", async () => {
  const consequences = {
    withdrawn: [{ assignment_id: 9, case_id: "case-0101", language: "de", task: "annotate", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }],
    finals_leaving: [], restored: [], open_reports: [],
  };
  vi.mocked(api.discardVariant).mockRejectedValueOnce(new ApiError(409, "confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences)).mockResolvedValueOnce(discarded());
  const props = renderResolve();
  fireEvent.click(screen.getByRole("button", { name: "Discard the de translation…" }));
  const confirm = screen.getByRole("group", { name: "Discard the de translation of case-0101" });
  const discard = within(confirm).getByRole("button", { name: "Discard" });
  expect(discard.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(discard);
  expect(api.discardVariant).not.toHaveBeenCalled();
  fireEvent.change(within(confirm).getByLabelText("Reason (required)"), { target: { value: "Wrong source" } });
  fireEvent.click(discard);
  await waitFor(() => expect(api.discardVariant).toHaveBeenCalledWith("p", "case-0101-de", { reason: "Wrong source", confirm: false }));
  expect(await within(confirm).findByText("1 open annotation will be withdrawn (Ana Weber, ann-0004; draft kept).")).toBeTruthy();
  // The reason stays readable and focusable (read-only, not disabled) while the consequences are shown.
  const reason = within(confirm).getByLabelText("Reason (required)") as HTMLTextAreaElement;
  expect(reason.disabled).toBe(false);
  expect(reason.readOnly).toBe(true);
  expect(reason.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(discard);
  expect(api.discardVariant).toHaveBeenCalledTimes(1);
  fireEvent.click(within(confirm).getByRole("checkbox", { name: "I understand — withdraw the open tasks" }));
  fireEvent.click(discard);
  await waitFor(() => expect(api.discardVariant).toHaveBeenLastCalledWith("p", "case-0101-de", { reason: "Wrong source", confirm: true }));
  await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("The de translation of case-0101 was discarded.", { caseId: "case-0101", revision: 4 }));
});

it("Assign review or accept… offers Turn Review on or the external-review acceptance", async () => {
  const row = notAccepted();
  const saved = { case_id: "case-0101", language: "de", flags: { review: true, annotate: true, review_applicable: true, discarded: false }, revision: 4,
    undo: { rows: [], revisions: {} }, withdrawn: [], accepted_document_ids: [] } as PlanRowResult;
  vi.mocked(api.patchWorkPlan).mockResolvedValue(saved);
  const props = renderResolve({ mode: "not_accepted", row });
  const box = screen.getByRole("group", { name: "Translation not accepted, case-0101 · de" });
  fireEvent.click(within(box).getByRole("button", { name: "Turn Review on" }));
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "de", { review: true, expected_revision: 3, confirm: false }));
  await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Review on for case-0101 · de. Next: Assign translation review.", { caseId: "case-0101", revision: 4 }));

  cleanup();
  vi.mocked(api.patchWorkPlan).mockClear();
  const second = renderResolve({ mode: "not_accepted", row });
  const again = screen.getByRole("group", { name: "Translation not accepted, case-0101 · de" });
  expect(within(again).getByText("This translation was reviewed outside Ontocurator — accept it as it is")).toBeTruthy();
  const accept = within(again).getByRole("button", { name: "Accept and annotate" });
  expect(accept.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(accept);
  expect(api.patchWorkPlan).not.toHaveBeenCalled();
  fireEvent.change(within(again).getByLabelText("Reason (required)"), { target: { value: "Clinic review" } });
  fireEvent.click(accept);
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "de", {
    annotate: true, expected_revision: 3, confirm: false, accept_external_review: { reason: "Clinic review" },
  }));
  await waitFor(() => expect(second.onDone).toHaveBeenCalledWith("case-0101 · de accepted as reviewed outside Ontocurator.", { caseId: "case-0101", revision: 4 }));
});

it("Cancel in the discard step returns to the three options with focus on Discard", async () => {
  const props = renderResolve();
  fireEvent.click(screen.getByRole("button", { name: "Discard the de translation…" }));
  const confirm = screen.getByRole("group", { name: "Discard the de translation of case-0101" });
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(props.onCancel).not.toHaveBeenCalled();
  const box = screen.getByRole("group", { name: "Resolve rejected translation, case-0101 · de" });
  expect(within(box).getAllByRole("button")).toHaveLength(4);
  await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole("button", { name: "Discard the de translation…" })));
});

it("announces Saving… through the page and has no status region of its own", async () => {
  let finish!: (value: PlanRowResult) => void;
  vi.mocked(api.patchWorkPlan).mockImplementation(() => new Promise(done => { finish = done; }));
  const props = renderResolve({ mode: "not_accepted", row: notAccepted() });
  fireEvent.click(screen.getByRole("button", { name: "Turn Review on" }));
  expect(props.onAnnounce).toHaveBeenLastCalledWith("Saving…");
  expect(document.querySelector("[role='status']")).toBeNull();
  await act(async () => {
    finish({ case_id: "case-0101", language: "de", flags: { review: true, annotate: true, review_applicable: true, discarded: false }, revision: 4,
      undo: { rows: [], revisions: {} }, withdrawn: [], accepted_document_ids: [] } as PlanRowResult);
  });
  expect(props.onDone).toHaveBeenCalled();
});

it("reports a plan changed elsewhere with the current revisions and the message", async () => {
  vi.mocked(api.patchWorkPlan).mockRejectedValueOnce(new ApiError(409, "changed", "WORK_PLAN_CHANGED", { cases: [{ case_id: "case-0101", revision: 7 }] }));
  const props = renderResolve({ mode: "not_accepted", row: notAccepted() });
  fireEvent.click(screen.getByRole("button", { name: "Turn Review on" }));
  expect(await screen.findByText("This plan changed. Reloaded the current plan.")).toBeTruthy();
  expect(props.onChanged).toHaveBeenCalledWith("case-0101", 7);
  expect(props.onAnnounce).toHaveBeenLastCalledWith("");
  expect(props.onDone).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});
