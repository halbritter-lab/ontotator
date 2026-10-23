import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type BulkPreview, type BulkResult, type ConsequencesView } from "../../src/api/client";
import { PlanDialog } from "../../src/documents/PlanDialog";

type LanguagePreview = BulkPreview["languages"][number];
const lang = (key: string, cases: number, review: [number, number] | null, annotate: [number, number], extra: Partial<LanguagePreview> = {}): LanguagePreview => ({
  key, source_languages: key === "source" ? ["en"] : [], cases_in_selection: cases,
  review: review && { on: review[0], off: review[1] }, annotate: { on: annotate[0], off: annotate[1] },
  will_change: 0, not_accepted: 0, not_acceptable: 0, in_review: 0, marked_in_package: 0, ...extra,
});
const noConsequences: ConsequencesView = { withdrawn: [], finals_leaving: [], restored: [], open_reports: [] };
const preview = (overrides: Partial<BulkPreview> = {}): BulkPreview => ({
  cases: 20,
  languages: [lang("source", 20, null, [0, 20]), lang("de", 20, [0, 20], [0, 20]), lang("fr", 18, [0, 18], [0, 18]), lang("es", 20, [12, 8], [0, 20])],
  changes: 0, to_assign: {}, consequences: noConsequences, invalid: [], revisions: { "case-0101": 1 }, rule_on: true, ...overrides,
});
const result: BulkResult = {
  changed_rows: 20, revisions: { "case-0101": 2 }, withdrawn: [],
  undo: { rows: [{ case_id: "case-0101", language: "de", review: false, annotate: true, restored_revision: 4 }], revisions: { "case-0101": 2 } },
};
const caseIds = Array.from({ length: 20 }, (_, index) => `case-${String(101 + index).padStart(4, "0")}`);
const withdrawing: ConsequencesView = {
  withdrawn: [{ assignment_id: 1, case_id: "case-0101", language: "fr", task: "translation_review", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }],
  finals_leaving: [{ case_id: "case-0108", language: "fr" }], restored: [], open_reports: [],
};

beforeEach(() => {
  vi.spyOn(api, "previewWorkPlans").mockResolvedValue(preview());
  vi.spyOn(api, "saveWorkPlans").mockResolvedValue(result);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderDialog(props: Partial<Parameters<typeof PlanDialog>[0]> = {}) {
  const onSaved = vi.fn(); const onClose = vi.fn();
  render(<PlanDialog projectKey="p" caseIds={caseIds} onClose={onClose} onSaved={onSaved} {...props} />);
  return { onSaved, onClose };
}
const cell = (name: RegExp | string) => screen.findByRole("button", { name });
const description = (element: HTMLElement) => (element.getAttribute("aria-describedby") ?? "").split(" ").map(id => document.getElementById(id)?.textContent ?? "").join(" ");
const save = (count = 20) => screen.getByRole("button", { name: `Save for ${count} ${count === 1 ? "case" : "cases"}` });
const lastPreviewBody = () => vi.mocked(api.previewWorkPlans).mock.calls.at(-1)![1];

describe("PlanDialog", () => {
  it("lists languages in the selection with counts and source rows without review", async () => {
    renderDialog();
    expect(await screen.findByRole("dialog", { name: "Work plan · 20 cases" })).toBeTruthy();
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map(item => item.textContent);
    expect(headers).toEqual(["Language", "In selection", "Translation review", "Annotate"]);
    const rows = within(table).getAllByRole("row").slice(1).map(row => Array.from(row.querySelectorAll("th,td")).map(item => item.textContent));
    expect(rows[0].slice(0, 3)).toEqual(["Source (en)", "20", "–"]);
    expect(rows[1].slice(0, 2)).toEqual(["de · MT", "20"]);
    expect(rows[2].slice(0, 2)).toEqual(["fr · MT", "18 of 20"]);
    expect(api.previewWorkPlans).toHaveBeenCalledWith("p", { case_ids: caseIds, languages: {} });
  });

  it("labels each cell with its column for the stacked narrow layout", async () => {
    renderDialog();
    const table = await screen.findByRole("table");
    const labels = within(table).getAllByRole("row").slice(1).map(row => Array.from(row.querySelectorAll("td")).map(item => item.getAttribute("data-label")));
    expect(labels.every(row => row.join("|") === "In selection|Translation review|Annotate")).toBe(true);
  });

  it("cycles cells and shows mixed with its title", async () => {
    renderDialog();
    const review = await cell("Translation review, de, keep");
    fireEvent.click(review);
    expect(review.getAttribute("aria-label")).toBe("Translation review, de, on");
    fireEvent.click(review);
    expect(review.getAttribute("aria-label")).toBe("Translation review, de, off");
    fireEvent.click(review);
    expect(review.getAttribute("aria-label")).toBe("Translation review, de, keep");
    const mixed = await cell("Translation review, es, mixed");
    expect(mixed.getAttribute("title")).toBe("12 on, 8 off");
    expect(mixed.textContent).toBe("mixed");
  });

  it("keeps Save unavailable with a reason while everything is keep", async () => {
    const { onSaved } = renderDialog();
    await cell("Translation review, de, keep");
    expect(save().getAttribute("aria-disabled")).toBe("true");
    expect(save().hasAttribute("disabled")).toBe(false);
    expect(description(save())).toContain("Nothing to change yet.");
    fireEvent.click(save());
    expect(api.saveWorkPlans).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("previews and shows the Will change summary as a live region", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ to_assign: { translation_review: 20, annotate: 20 }, changes: 40 }));
    fireEvent.click(await cell("Translation review, de, keep"));
    fireEvent.click(await cell("Annotate, de, keep"));
    await waitFor(() => expect(lastPreviewBody()).toEqual({ case_ids: caseIds, languages: { de: { review: "on", annotate: "on" } } }));
    const summary = await screen.findByText(/de in 20 cases → translation review, then annotate after the review is accepted\./);
    const region = summary.closest("[aria-live]")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toContain("Will change:");
    expect(region.textContent).toContain("20 translation reviews and 20 annotations become \"to assign\".");
    expect((await cell("Translation review, de, on")).getAttribute("aria-describedby")).toContain(region.id);
    expect(save().getAttribute("aria-disabled")).toBeNull();
  });

  it("switches to the in-dialog confirmation when work is affected", async () => {
    const { onSaved } = renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ consequences: withdrawing, changes: 18 }));
    fireEvent.click(await cell("Translation review, fr, keep"));
    fireEvent.click(await cell("Translation review, fr, on"));
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ fr: { review: "off" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    const warning = await screen.findByText(/fr has work in 2 of these cases\./);
    expect(warning.closest(".work-plan-warning")!.textContent).toContain("1 open translation review will be withdrawn (Ana Weber (ann-0004)).");
    expect(warning.closest(".work-plan-warning")!.textContent).toContain("1 final result (case-0108 · fr) stays in history but is no longer exported.");
    expect(api.saveWorkPlans).not.toHaveBeenCalled();
    const confirm = screen.getByRole("checkbox", { name: /I understand — withdraw the open tasks/ });
    expect(save().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await cell("Translation review, fr, off")).toBeTruthy();
    fireEvent.click(save());
    fireEvent.click(await screen.findByRole("checkbox", { name: /I understand — withdraw the open tasks/ }));
    expect(confirm.isConnected).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(api.saveWorkPlans).toHaveBeenCalledWith("p", { case_ids: caseIds, languages: { fr: { review: "off" } }, expected_revisions: { "case-0101": 1 }, confirm: true }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("requires the external-review acceptance with a reason when annotate is on without review", async () => {
    const { onSaved } = renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({
      languages: [lang("source", 20, null, [0, 20]), lang("fr", 30, [0, 30], [0, 30], { not_accepted: 12, marked_in_package: 18 })], cases: 30, changes: 30,
    }));
    fireEvent.click(await cell("Annotate, fr, keep"));
    expect(await screen.findByText("fr: 12 of 30 translations are not marked as reviewed in the package. Annotation needs an accepted translation.")).toBeTruthy();
    expect(screen.getByText(/18 already marked as reviewed in the package metadata need nothing\./)).toBeTruthy();
    expect(screen.getByText(/The acceptance is recorded with your name, the reason and the time\./)).toBeTruthy();
    expect(save().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "These translations were reviewed outside Ontocurator — accept them as they are" }));
    expect(save().getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Vendor batch 2026-10" } });
    expect(save().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(api.saveWorkPlans).toHaveBeenCalledWith("p", expect.objectContaining({ languages: { fr: { annotate: "on" } }, accept_external_review: { languages: ["fr"], reason: "Vendor batch 2026-10" }, confirm: false })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("does not offer the acceptance while the rule is off", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ rule_on: false, changes: 18, languages: [lang("fr", 18, [0, 18], [0, 18], { not_accepted: 12 })] }));
    fireEvent.click(await cell("Annotate, fr, keep"));
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ fr: { annotate: "on" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    expect(screen.queryByRole("checkbox", { name: /reviewed outside Ontocurator/ })).toBeNull();
  });

  it("reports the saved result with an undo payload and keeps the selection", async () => {
    const { onSaved, onClose } = renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 40 }));
    fireEvent.click(await cell("Translation review, de, keep"));
    fireEvent.click(await cell("Annotate, de, keep"));
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ de: { review: "on", annotate: "on" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result, "Plan saved for 20 cases · de: translation review and annotation"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("passes the undo payload with restored_revision to onSaved", async () => {
    const { onSaved } = renderDialog({ initial: { de: { annotate: "on" } } });
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ de: { annotate: "on" } }));
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 20 }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0].undo.rows[0].restored_revision).toBe(4);
  });

  it("shows the current values instead of keep for a single case and toggles on and off", async () => {
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ cases: 1, languages: [lang("source", 1, null, [0, 1]), lang("de", 1, [1, 0], [0, 1])] }));
    renderDialog({ caseIds: ["case-0101"] });
    const review = await cell("Translation review, de, on");
    expect(review.textContent).toBe("on");
    expect(review.querySelector("svg")).toBeTruthy();
    const annotate = await cell("Annotate, de, off");
    expect(save(1).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(annotate);
    expect(annotate.getAttribute("aria-label")).toBe("Annotate, de, on");
    fireEvent.click(annotate);
    expect(annotate.getAttribute("aria-label")).toBe("Annotate, de, off");
    fireEvent.click(annotate);
    fireEvent.click(review);
    expect(review.getAttribute("aria-label")).toBe("Translation review, de, off");
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ source: { annotate: "off" }, de: { review: "off", annotate: "on" } }));
    expect(screen.queryByRole("button", { name: /keep$/ })).toBeNull();
  });

  it("renders the confirmation table as read-only text", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ consequences: withdrawing, changes: 18 }));
    fireEvent.click(await cell("Translation review, de, keep"));
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ de: { review: "on" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    await screen.findByRole("checkbox", { name: /I understand/ });
    const table = screen.getByRole("table");
    expect(within(table).queryAllByRole("button")).toEqual([]);
    const de = within(table).getAllByRole("row").find(row => row.textContent?.startsWith("de"))!;
    expect(within(de).getAllByRole("cell").map(item => item.textContent)).toEqual(["20", "on", "keep"]);
  });

  it("lists open problem reports in the confirmation", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 18, consequences: { ...noConsequences, open_reports: [{ report_id: "r1", case_id: "case-0108", language: "fr", assignment_id: 3, held: true }] } }));
    fireEvent.click(await cell("Annotate, fr, keep"));
    fireEvent.click(await cell("Annotate, fr, on"));
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ fr: { annotate: "off" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    expect(await screen.findByText(/1 open problem report \(case-0108 · fr, task paused\) stays open under Problem reports\./)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "I understand" })).toBeTruthy();
  });

  it("blocks the external-review acceptance for rejected, queried or in-review translations", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 18, languages: [lang("fr", 18, [0, 18], [0, 18], { not_accepted: 5, not_acceptable: 3, in_review: 1 })] }));
    fireEvent.click(await cell("Annotate, fr, keep"));
    expect(await screen.findByText("2 rejected or queried: resolve them first.")).toBeTruthy();
    expect(screen.getByText("1 in review: wait for the review or withdraw it first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /reviewed outside Ontocurator/ }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Vendor" } });
    expect(save().getAttribute("aria-disabled")).toBe("true");
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 18, languages: [lang("fr", 18, [0, 18], [0, 18])] }));
    fireEvent.click(await cell("Translation review, fr, keep"));
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ fr: { review: "on", annotate: "on" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
  });

  it("reloads the preview with a message when the plan changed", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 20 }));
    vi.mocked(api.saveWorkPlans).mockRejectedValueOnce(new ApiError(409, "Changed", "WORK_PLAN_CHANGED", { cases: [{ case_id: "case-0101", revision: 3 }] }));
    fireEvent.click(await cell("Annotate, de, keep"));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    const calls = vi.mocked(api.previewWorkPlans).mock.calls.length;
    fireEvent.click(save());
    expect(await screen.findByText("This plan changed. Reloaded the current plan.")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api.previewWorkPlans).mock.calls.length).toBeGreaterThan(calls));
    expect((await cell("Annotate, de, on"))).toBeTruthy();
  });
});
