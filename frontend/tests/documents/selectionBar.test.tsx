import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type BulkPreview, type BulkResult, type ConsequencesView, type DocumentRowFilters, type SelectionSummary } from "../../src/api/client";
import { SelectionBar, SUMMARY_DELAY_MS, type SelectionBarProps } from "../../src/documents/SelectionBar";
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
/** One de text per case. */
const textKeys = caseIds.map(caseId => `${caseId}:de`);
const rows = caseIds.map(caseId => ({ case_id: caseId, language: "de" }));
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
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set(props.initial ?? textKeys));
  const { toast, show, dismiss } = useToast();
  return <div>
    <SelectionBar projectKey="p" keys={keys} filters={filters} onClear={() => setKeys(new Set())} onAssign={vi.fn()} showToast={show}
      onAnnounce={vi.fn()} onChanged={vi.fn()} {...props} />
    <Toast toast={toast} onDismiss={dismiss} />
  </div>;
}

const bar = () => screen.getByRole("region", { name: "Selection" });

it("shows count, common next step, hidden count and Clear selection", async () => {
  render(<Harness />);
  expect(within(bar()).getByText("20 texts in 20 cases selected")).toBeTruthy();
  expect(await within(bar()).findByText(", next step: Assign translation review (de)")).toBeTruthy();
  expect(within(bar()).getByText(", 3 not shown with these filters")).toBeTruthy();
  expect(api.selectionSummary).toHaveBeenCalledWith("p", { rows }, filters);
  fireEvent.click(within(bar()).getByRole("button", { name: "Clear selection" }));
  expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
});

it("counts texts in cases", () => {
  render(<Harness initial={["case-0101:en", "case-0101:de", "case-0102:de"]} />);
  expect(within(bar()).getByText("3 texts in 2 cases selected")).toBeTruthy();
});

it("hidden with one selected text", async () => {
  render(<Harness initial={["case-0101:de"]} />);
  expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  await new Promise(resolve => setTimeout(resolve, SUMMARY_DELAY_MS + 20));
  expect(api.selectionSummary).not.toHaveBeenCalled();
});

it("shown with two", () => {
  render(<Harness initial={["case-0101:de", "case-0102:de"]} />);
  expect(within(bar()).getByText("2 texts in 2 cases selected")).toBeTruthy();
});

it("keeps three stable actions; the plan presets live in Plan… (M-1)", () => {
  render(<Harness initial={["case-0101:de", "case-0102:de"]} />);
  expect(within(bar()).getAllByRole("button").map(button => button.textContent)).toEqual(["Assign…", "Plan…", "Clear selection"]);
  expect(bar().textContent).not.toMatch(/\bReview\b|Annotation review|Independent annotation|Translation review and annotation/);
});

it("sends rows to selection-summary", async () => {
  render(<Harness initial={["case-0101:en", "case-0101:de", "case-0102:de"]} />);
  const selected = [{ case_id: "case-0101", language: "en" }, { case_id: "case-0101", language: "de" }, { case_id: "case-0102", language: "de" }];
  await waitFor(() => expect(api.selectionSummary).toHaveBeenCalledWith("p", { rows: selected }, filters));
});

/** Plan… → quick choice → Save: the former one-click presets. */
async function planWithPreset(preset: string) {
  fireEvent.click(within(bar()).getByRole("button", { name: "Plan…" }));
  const dialog = await screen.findByRole("dialog", { name: "Work plan: 20 cases" });
  fireEvent.click(await within(dialog).findByRole("button", { name: preset }));
  const save = within(dialog).getByRole("button", { name: "Save for 20 cases" });
  await waitFor(() => expect(save.getAttribute("aria-disabled")).toBeNull());
  await act(async () => { fireEvent.click(save); });
}

it("bulk Undo after an intervening assignment shows the message and the normal confirmation", async () => {
  const onChanged = vi.fn();
  render(<Harness onChanged={onChanged} />);
  await planWithPreset("Translation review and annotation");
  await screen.findByText("20 texts changed.");
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
  expect(within(bar()).getAllByRole("button").map(button => button.textContent)).toEqual(["Assign…", "Plan…", "Clear selection"]);
  fireEvent.click(within(bar()).getByRole("button", { name: "Assign…" }));
  expect(onAssign).toHaveBeenCalledOnce();
});

it("a preset save from the plan dialog shows the Undo toast and keeps the selection", async () => {
  const onRevisions = vi.fn();
  render(<Harness onRevisions={onRevisions} />);
  await planWithPreset("Translation review and annotation");
  expect(api.saveWorkPlans).toHaveBeenCalledWith("p", expect.objectContaining({ rows, languages: { de: { review: "on", annotate: "on" } } }));
  expect(vi.mocked(api.saveWorkPlans).mock.calls[0][1]).not.toHaveProperty("case_ids");
  const toast = await screen.findByText("20 texts changed.");
  expect(toast.closest(".ui-toast")?.querySelector("button")?.textContent).toBe("Undo");
  expect(onRevisions).toHaveBeenCalledWith({ "case-0101": 2 });
  expect(within(bar()).getByText("20 texts in 20 cases selected")).toBeTruthy();
});

it("a plan save that changes nothing says why and offers no Undo", async () => {
  const empty: BulkResult = { changed_rows: 0, revisions: {}, withdrawn: [], undo: { rows: [], revisions: {} }, skipped_rows: rows };
  vi.mocked(api.saveWorkPlans).mockResolvedValueOnce(empty);
  render(<Harness />);
  await planWithPreset("Annotation only, no translation review");
  expect(await within(bar()).findByText("Nothing changed: the selected texts are source texts; these plan actions apply to translations only.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(api.setWorkPlanRows).not.toHaveBeenCalled();
});

it("opens the plan dialog for Plan… and keeps the selection after save", async () => {
  render(<Harness />);
  fireEvent.click(within(bar()).getByRole("button", { name: "Plan…" }));
  const dialog = await screen.findByRole("dialog", { name: "Work plan: 20 cases" });
  const de = await within(dialog).findByRole("region", { name: /^de In selection/ });
  fireEvent.click(within(within(de).getByRole("group", { name: "Translation review" })).getByRole("radio", { name: "On" }));
  fireEvent.click(within(within(de).getByRole("group", { name: "Annotation" })).getByRole("radio", { name: "Annotate from scratch" }));
  const save = within(dialog).getByRole("button", { name: "Save for 20 cases" });
  await waitFor(() => expect(save.getAttribute("aria-disabled")).toBeNull());
  await act(async () => { fireEvent.click(save); });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByText("20 texts changed.")).toBeTruthy();
  expect(within(bar()).getByText("20 texts in 20 cases selected")).toBeTruthy();
});

it("is a labelled region Selection with compact actions below 700 px", () => {
  const view = render(<Harness />);
  expect(bar().tagName).toBe("SECTION");
  expect(bar().classList.contains("selection-bar--narrow")).toBe(false);
  view.unmount();
  render(<Harness narrow />);
  expect(bar().classList.contains("selection-bar--narrow")).toBe(true);
});

it("reserves its height at the page bottom while shown and releases it on clear", async () => {
  render(<Harness />);
  expect(document.documentElement.style.getPropertyValue("--selection-bar-space")).toMatch(/^\d+px$/);
  fireEvent.click(within(bar()).getByRole("button", { name: "Clear selection" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Selection" })).toBeNull());
  expect(document.documentElement.style.getPropertyValue("--selection-bar-space")).toBe("");
});
