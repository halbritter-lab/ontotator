import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type BulkPreview, type BulkResult, type ConsequencesView, type DocumentRowFilters, type SelectionSummary } from "../../src/api/client";
import { SelectionBar, type SelectionBarProps } from "../../src/documents/SelectionBar";
import { Toast, useToast } from "../../src/ui";

type LanguagePreview = BulkPreview["languages"][number];
const lang = (key: string, cases: number, extra: Partial<LanguagePreview> = {}): LanguagePreview => ({
  key, source_languages: key === "source" ? ["en"] : [], cases_in_selection: cases,
  review: key === "source" ? null : { on: 0, off: cases }, annotate: { on: 0, off: cases },
  will_change: 0, not_accepted: 0, not_acceptable: 0, in_review: 0, marked_in_package: 0, ...extra,
});
const noConsequences: ConsequencesView = { withdrawn: [], finals_leaving: [], restored: [], open_reports: [] };
const preview = (overrides: Partial<BulkPreview> = {}): BulkPreview => ({
  cases: 20, languages: [lang("source", 20), lang("de", 20)], changes: 0, to_assign: {}, consequences: noConsequences, invalid: [],
  revisions: { "case-0101": 1 }, rule_on: true, ...overrides,
});
const caseIds = Array.from({ length: 20 }, (_, index) => `case-${String(101 + index).padStart(4, "0")}`);
const result: BulkResult = {
  changed_rows: 20, revisions: { "case-0101": 2 }, withdrawn: [],
  undo: { rows: caseIds.map(caseId => ({ case_id: caseId, language: "de", review: false, annotate: false, restored_revision: null })), revisions: { "case-0101": 2 } },
};
const summary = (overrides: Partial<SelectionSummary> = {}): SelectionSummary => ({
  cases: 20, steps: [{ task: "translation_review", language: "de", versions: 20, cases: 20 }], skipped: {},
  common: { task: "translation_review", language: "de", versions: 20, cases: 20 }, not_shown: 3, ...overrides,
});
const filters: DocumentRowFilters = { language: "de", segment: "assign" };

beforeEach(() => {
  vi.spyOn(api, "selectionSummary").mockResolvedValue(summary());
  vi.spyOn(api, "saveWorkPlans").mockResolvedValue(result);
  vi.spyOn(api, "previewWorkPlans").mockResolvedValue(preview());
  vi.spyOn(api, "setWorkPlanRows").mockResolvedValue({ ...result, revisions: { "case-0101": 3 } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Harness(props: Partial<SelectionBarProps> & { initial?: readonly string[] }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set(props.initial ?? caseIds));
  const { toast, show, dismiss } = useToast();
  return <div>
    <SelectionBar projectKey="p" ids={ids} filters={filters} onClear={() => setIds(new Set())} onAssign={vi.fn()} showToast={show}
      onAnnounce={vi.fn()} onChanged={vi.fn()} {...props} />
    <Toast toast={toast} onDismiss={dismiss} />
  </div>;
}

const bar = () => screen.getByRole("region", { name: "Selection" });

it("shows count, common next step, hidden count and Clear selection", async () => {
  render(<Harness />);
  expect(within(bar()).getByText("20 cases selected")).toBeTruthy();
  expect(await within(bar()).findByText("· next step: Assign translation review (de)")).toBeTruthy();
  expect(within(bar()).getByText("· 3 not shown with these filters")).toBeTruthy();
  expect(api.selectionSummary).toHaveBeenCalledWith("p", caseIds, filters);
  fireEvent.click(within(bar()).getByRole("button", { name: "Clear selection" }));
  expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
});

it("bulk Undo after an intervening assignment shows the message and the normal confirmation", async () => {
  const onChanged = vi.fn();
  render(<Harness onChanged={onChanged} />);
  fireEvent.click(within(bar()).getByRole("button", { name: "Review + annotate translations" }));
  await screen.findByText("Plan saved for 20 cases · de: review + annotate");
  const consequences: ConsequencesView = { ...noConsequences, withdrawn: [{ assignment_id: 4, case_id: "case-0101", language: "de", task: "translation_review", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }] };
  vi.mocked(api.setWorkPlanRows).mockRejectedValueOnce(new ApiError(409, "confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", consequences as never));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await within(bar()).findByText("Since your change, work was assigned: 1 open translation review (Ana Weber, ann-0004) would be withdrawn.")).toBeTruthy();
  expect(api.setWorkPlanRows).toHaveBeenLastCalledWith("p", expect.objectContaining({ undo: true, confirm: false, expected_revisions: { "case-0101": 2 } }));
  const anyway = within(bar()).getByRole("button", { name: "Undo anyway" });
  fireEvent.click(anyway);
  expect(api.setWorkPlanRows).toHaveBeenCalledTimes(1);
  fireEvent.click(within(bar()).getByLabelText("I understand — withdraw the open tasks"));
  fireEvent.click(anyway);
  await waitFor(() => expect(api.setWorkPlanRows).toHaveBeenLastCalledWith("p", expect.objectContaining({ undo: true, confirm: true })));
  await waitFor(() => expect(within(bar()).queryByText(/Since your change/)).toBeNull());
  expect(onChanged).toHaveBeenCalledTimes(2);
});

it("has Assign… as the page's only primary button", async () => {
  const onAssign = vi.fn();
  render(<Harness onAssign={onAssign} />);
  const primary = [...bar().querySelectorAll(".btn-primary")].map(button => button.textContent);
  expect(primary).toEqual(["Assign…"]);
  expect(within(bar()).getAllByRole("button").map(button => button.textContent)).toEqual(
    ["Assign…", "Review + annotate translations", "Annotate only", "Plan…", "Clear selection"]);
  fireEvent.click(within(bar()).getByRole("button", { name: "Assign…" }));
  expect(onAssign).toHaveBeenCalledOnce();
});

it("Review + annotate translations saves at once without a dialog when nothing is affected", async () => {
  const onRevisions = vi.fn();
  render(<Harness onRevisions={onRevisions} />);
  fireEvent.click(within(bar()).getByRole("button", { name: "Review + annotate translations" }));
  expect(api.saveWorkPlans).toHaveBeenCalledWith("p", { case_ids: caseIds, preset: "review_and_annotate_translations", confirm: false });
  const toast = await screen.findByText("Plan saved for 20 cases · de: review + annotate");
  expect(toast.closest(".ui-toast")?.querySelector("button")?.textContent).toBe("Undo");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onRevisions).toHaveBeenCalledWith({ "case-0101": 2 });
  // The selection stays.
  expect(within(bar()).getByText("20 cases selected")).toBeTruthy();
  // Withdrawn tasks: the toast notes that Undo does not restore them.
  vi.mocked(api.saveWorkPlans).mockResolvedValueOnce({ ...result, withdrawn: [{ assignment_id: 1, case_id: "case-0101", language: "de", task: "annotate", person: { pseudonym: "ann-0004", is_me: false } }] });
  fireEvent.click(within(bar()).getByRole("button", { name: "Annotate only" }));
  expect(await screen.findByText("Undo restores the plan, not withdrawn tasks.")).toBeTruthy();
  expect(screen.getByText("Plan saved for 20 cases · de: annotate")).toBeTruthy();
});

it("Annotate only opens the plan dialog with the acceptance section when translations are not accepted and the rule is on", async () => {
  vi.mocked(api.saveWorkPlans).mockRejectedValueOnce(new ApiError(409, "invalid", "WORK_PLAN_INVALID", { reason: "annotate_not_accepted", rows: [] } as never));
  vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ languages: [lang("source", 20), lang("de", 20, { not_accepted: 12, marked_in_package: 8 })] }));
  render(<Harness />);
  fireEvent.click(within(bar()).getByRole("button", { name: "Annotate only" }));
  const dialog = await screen.findByRole("dialog", { name: "Work plan · 20 cases" });
  expect(api.previewWorkPlans).toHaveBeenCalledWith("p", { case_ids: caseIds, preset: "annotate_only", confirm: false });
  expect(await within(dialog).findByText("de: 12 of 20 translations are not marked as reviewed in the package. Annotation needs an accepted translation.")).toBeTruthy();
  expect(within(dialog).getByLabelText("These translations were reviewed outside Ontocurator — accept them as they are")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Annotate, de, on" })).toBeTruthy();
});

it("opens the plan dialog for Plan… and keeps the selection after save", async () => {
  render(<Harness />);
  fireEvent.click(within(bar()).getByRole("button", { name: "Plan…" }));
  const dialog = await screen.findByRole("dialog", { name: "Work plan · 20 cases" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Review, de, keep" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Annotate, de, keep" }));
  const save = within(dialog).getByRole("button", { name: "Save for 20 cases" });
  await waitFor(() => expect(save.getAttribute("aria-disabled")).toBeNull());
  await act(async () => { fireEvent.click(save); });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByText("Plan saved for 20 cases · de: review + annotate")).toBeTruthy();
  expect(within(bar()).getByText("20 cases selected")).toBeTruthy();
});

it("is a labelled region Selection and bottom-sticky below 700 px", () => {
  const view = render(<Harness />);
  expect(bar().tagName).toBe("SECTION");
  expect(bar().classList.contains("selection-bar--bottom")).toBe(false);
  view.unmount();
  render(<Harness narrow />);
  expect(bar().classList.contains("selection-bar--bottom")).toBe(true);
});
