import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView, type DiscardResult, type PlanRowResult, type VariantSummary } from "../../src/api/client";
import { ResolveTranslation, type ResolveTranslationProps } from "../../src/documents/ResolveTranslation";
import { planRow, rejectedRow, stepOf, version, work } from "./fixtures";
import { reviewRecord } from "../translationFixtures";

const rejected = () => planRow("case-0101", "de", stepOf("resolve_rejected", { document_id: "case-0101-de" }), {
  versions: [version({ document_id: "case-0101-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "rejected" })],
});
const notAccepted = () => planRow("case-0101", "de", stepOf("translation_not_accepted", { document_id: "case-0101-de" }), {
  plan_row: { review: false, annotate: true, review_applicable: true, discarded: false },
});

function renderResolve(overrides: Partial<ResolveTranslationProps> = {}) {
  const props: ResolveTranslationProps = {
    mode: "resolve", row: rejected(), projectKey: "p", revision: 3,
    onAssignReview: vi.fn(), onNavigate: vi.fn(), onDone: vi.fn(), onChanged: vi.fn(), onAnnounce: vi.fn(), onCancel: vi.fn(),
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
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([]);
  vi.spyOn(api, "discardVariant");
  vi.spyOn(api, "patchWorkPlan");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("offers exactly three options", () => {
  const props = renderResolve();
  const box = screen.getByRole("group", { name: "Resolve rejected translation, case-0101 de" });
  expect(within(box).getAllByRole("button").map(button => button.textContent)).toEqual([
    "Assign a new review…", "Correct the translation…", "Discard the de translation…", "Cancel",
  ]);
  expect(within(box).queryByText(/accept/i)).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: "Assign a new review…" }));
  expect(props.onAssignReview).toHaveBeenCalled();
});

it("Correct the translation… opens the panel", async () => {
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ document_id: "case-0101-de", text_sha256: "sha-v1" } as VariantSummary);
  vi.spyOn(api, "startLeadCorrection").mockResolvedValue({ id: 41 } as AssignmentView);
  const props = renderResolve();
  fireEvent.click(screen.getByRole("button", { name: "Correct the translation…" }));
  expect(screen.queryByRole("group", { name: "Resolve rejected translation, case-0101 de" })).toBeNull();
  const panel = screen.getByRole("group", { name: "Correct the translation, case-0101 de" });
  expect(within(panel).getByText(/You review v1 yourself/)).toBeTruthy();
  expect(props.onNavigate).not.toHaveBeenCalled();
  fireEvent.click(within(panel).getByRole("button", { name: "Open translation review" }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 }));
  expect(api.startLeadCorrection).toHaveBeenCalledWith("p", "case-0101-de", { expected_text_sha256: "sha-v1", confirm_language: false });

  // Cancel returns to the options with focus on "Correct the translation…".
  cleanup();
  renderResolve();
  fireEvent.click(screen.getByRole("button", { name: "Correct the translation…" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Correct the translation, case-0101 de" })).getByRole("button", { name: "Cancel" }));
  const box = screen.getByRole("group", { name: "Resolve rejected translation, case-0101 de" });
  await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole("button", { name: "Correct the translation…" })));
});

it("reads Continue your correction while the lead holds one", () => {
  vi.spyOn(api, "startLeadCorrection");
  const held = rejectedRow("case-0101", "de", { correcting: true });
  const props = renderResolve({ row: { ...held, next_step: stepOf("resolve_rejected", { document_id: "case-0101-de" }) } });
  const box = screen.getByRole("group", { name: "Resolve rejected translation, case-0101 de" });
  expect(within(box).queryByRole("button", { name: "Correct the translation…" })).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: "Continue your correction" }));
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 });
  expect(api.startLeadCorrection).not.toHaveBeenCalled();
});

it("an ordinary open review of the lead (also an annotator) is not their correction", () => {
  const held = rejectedRow("case-0101", "de", { correcting: true });
  const row = { ...held, next_step: stepOf("resolve_rejected", { document_id: "case-0101-de" }), work: held.work.map(item => ({ ...item, lead_correction: false })) };
  renderResolve({ row });
  const box = screen.getByRole("group", { name: "Resolve rejected translation, case-0101 de" });
  expect(within(box).queryByRole("button", { name: "Continue your correction" })).toBeNull();
  expect(within(box).getByRole("button", { name: "Correct the translation…" })).toBeTruthy();
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

it("Assign review or accept… offers Turn translation review on or the external-review acceptance", async () => {
  const row = notAccepted();
  const saved = { case_id: "case-0101", language: "de", flags: { review: true, annotate: true, review_applicable: true, discarded: false }, revision: 4,
    undo: { rows: [], revisions: {} }, withdrawn: [], accepted_document_ids: [] } as PlanRowResult;
  vi.mocked(api.patchWorkPlan).mockResolvedValue(saved);
  const props = renderResolve({ mode: "not_accepted", row });
  const box = screen.getByRole("group", { name: "Translation not accepted, case-0101 de" });
  fireEvent.click(within(box).getByRole("button", { name: "Turn translation review on" }));
  await waitFor(() => expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "de", { review: true, expected_revision: 3, confirm: false }));
  await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Translation review on for case-0101 de. Next: Assign reviewer…", { caseId: "case-0101", revision: 4 }));

  cleanup();
  vi.mocked(api.patchWorkPlan).mockClear();
  const second = renderResolve({ mode: "not_accepted", row });
  const again = screen.getByRole("group", { name: "Translation not accepted, case-0101 de" });
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
  await waitFor(() => expect(second.onDone).toHaveBeenCalledWith("case-0101 de accepted as reviewed outside Ontocurator.", { caseId: "case-0101", revision: 4 }));
});

it("Cancel in the discard step returns to the three options with focus on Discard", async () => {
  const props = renderResolve();
  fireEvent.click(screen.getByRole("button", { name: "Discard the de translation…" }));
  const confirm = screen.getByRole("group", { name: "Discard the de translation of case-0101" });
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(props.onCancel).not.toHaveBeenCalled();
  const box = screen.getByRole("group", { name: "Resolve rejected translation, case-0101 de" });
  expect(within(box).getAllByRole("button")).toHaveLength(4);
  await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole("button", { name: "Discard the de translation…" })));
});

it("announces Saving… through the page and has no status region of its own", async () => {
  let finish!: (value: PlanRowResult) => void;
  vi.mocked(api.patchWorkPlan).mockImplementation(() => new Promise(done => { finish = done; }));
  const props = renderResolve({ mode: "not_accepted", row: notAccepted() });
  fireEvent.click(screen.getByRole("button", { name: "Turn translation review on" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Turn translation review on" }));
  expect(await screen.findByText("This plan changed. Reloaded the current plan.")).toBeTruthy();
  expect(props.onChanged).toHaveBeenCalledWith("case-0101", 7);
  expect(props.onAnnounce).toHaveBeenLastCalledWith("");
  expect(props.onDone).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

// ---- Documents overview O4c: the Resolve panel is inline under the row (Change 13) ----

it("Resolve… renders inline under the row with the lead-correction option", async () => {
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ document_id: "case-0101-de", text_sha256: "sha-v1" } as VariantSummary);
  const { container } = render(<div className="documents-row-notice-slot"><ResolveTranslation mode="resolve" row={rejected()} projectKey="p" revision={3}
    onAssignReview={vi.fn()} onNavigate={vi.fn()} onDone={vi.fn()} onChanged={vi.fn()} onAnnounce={vi.fn()} onCancel={vi.fn()} /></div>);
  const slot = container.firstElementChild as HTMLElement;
  const box = within(slot).getByRole("group", { name: "Resolve rejected translation, case-0101 de" });
  // No stage block or expansion around it: the options are the panel itself.
  expect(box.closest(".stage-block, .expanded-row")).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: "Correct the translation…" }));
  // F1: the lead-correction panel replaces the options in the same inline place.
  const panel = within(slot).getByRole("group", { name: "Correct the translation, case-0101 de" });
  await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole("heading", { name: "Correct the translation, case-0101 de" })));
});

it("focus goes to the inline panel heading (F5)", async () => {
  renderResolve();
  const heading = screen.getByRole("heading", { name: "Resolve rejected translation, case-0101 de" });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(heading.getAttribute("tabindex")).toBe("-1");
  cleanup();
  renderResolve({ mode: "not_accepted", row: notAccepted() });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Translation not accepted, case-0101 de" })));
});

it("heads the options at level 3 under the table and at level 5 in a card (heading order)", () => {
  renderResolve();
  expect(screen.getByRole("heading", { level: 3, name: "Resolve rejected translation, case-0101 de" })).toBeTruthy();
  cleanup();
  renderResolve({ headingLevel: 5 });
  expect(screen.getByRole("heading", { level: 5, name: "Resolve rejected translation, case-0101 de" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Correct the translation…" }));
  expect(screen.getByRole("heading", { level: 5, name: "Correct the translation, case-0101 de" })).toBeTruthy();
});

it("quotes the reviewer's reason and categories above the options, named by the review's work item", async () => {
  vi.mocked(api.listTranslationReviews).mockResolvedValue([
    reviewRecord({ id: 1, assignment_id: 7, decision: "query", rationale: "Older question", created_at: "2026-10-19T08:00:00Z" }),
    reviewRecord({ id: 2, assignment_id: 8, decision: "rejected", rationale: "Dosage is missing", categories: ["omission", "terminology"], created_at: "2026-10-20T08:00:00Z" }),
  ]);
  const row = { ...rejected(), work: [work({ assignment_id: 8, document_id: "case-0101-de", task: "translation_review", status: "submitted", person: { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false } })] };
  renderResolve({ row });
  expect(await screen.findByText("Ana Weber rejected this translation.")).toBeTruthy();
  expect(screen.getByText("“Dosage is missing”")).toBeTruthy();
  expect(screen.getByText("Categories: Omission, Terminology")).toBeTruthy();
  expect(api.listTranslationReviews).toHaveBeenCalledWith("p", "case-0101-de");
  expect(screen.queryByText(/ann-0003/)).toBeNull();
});
