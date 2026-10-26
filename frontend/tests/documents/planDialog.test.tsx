import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type BulkPreview, type BulkResult, type ConsequencesView } from "../../src/api/client";
import { keepLabel, PlanDialog } from "../../src/documents/PlanDialog";

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
const description = (element: HTMLElement) => (element.getAttribute("aria-describedby") ?? "").split(" ").map(id => document.getElementById(id)?.textContent ?? "").join(" ");
const save = (count = 20) => screen.getByRole("button", { name: `Save for ${count} ${count === 1 ? "case" : "cases"}` });
const lastPreviewBody = () => vi.mocked(api.previewWorkPlans).mock.calls.at(-1)![1];

const region = (language: string) => screen.findByRole("region", { name: new RegExp(`^${language.replace(/[()]/g, "\\$&")} In selection`) });
async function radio(language: string, step: "Translation review" | "Annotation", option: string | RegExp): Promise<HTMLInputElement> {
  const group = within(await region(language)).getByRole("group", { name: step });
  return within(group).getByRole("radio", { name: option }) as HTMLInputElement;
}
const choose = async (language: string, step: "Translation review" | "Annotation", option: string | RegExp) => fireEvent.click(await radio(language, step, option));

describe("PlanDialog", () => {
  it("lists each language as a block with its count and the steps in words; the source has no translation review", async () => {
    renderDialog();
    expect(await screen.findByRole("dialog", { name: "Work plan: 20 cases" })).toBeTruthy();
    expect((await region("Source (en)")).textContent).toContain("In selection: 20");
    expect((await region("fr")).textContent).toContain("In selection: 18 of 20");
    expect(within(await region("Source (en)")).queryByRole("group", { name: "Translation review" })).toBeNull();
    const annotation = within(await region("de")).getByRole("group", { name: "Annotation" });
    expect(within(annotation).getAllByRole("radio").map(item => item.getAttribute("value"))).toEqual(["keep", "off", "proposals", "scratch"]);
    expect(description(within(annotation).getByRole("radio", { name: "Annotate from scratch" }))).toContain("annotators start from the plain text");
    expect(description(await radio("de", "Translation review", "On"))).toContain("a person reviews the machine translation before annotation.");
    expect(api.previewWorkPlans).toHaveBeenCalledWith("p", { case_ids: caseIds, languages: {} });
  });

  it("shows the current values of the selection beside No change (F27)", async () => {
    renderDialog();
    expect((await radio("es", "Translation review", /^No change/)).labels?.[0].textContent).toBe("No change (12 planned, 8 not)");
    expect((await radio("de", "Annotation", /^No change/)).labels?.[0].textContent).toBe("No change (20 not planned)");
  });

  it("words No change for every count", () => {
    expect(keepLabel(null)).toBe("No change");
    expect(keepLabel({ on: 0, off: 2 })).toBe("No change (2 not planned)");
    expect(keepLabel({ on: 3, off: 0 })).toBe("No change (3 planned)");
    expect(keepLabel({ on: 12, off: 8 })).toBe("No change (12 planned, 8 not)");
  });

  it("the quick choice fills the selected translations' languages, plans only the selected texts and saves nothing by itself (M-1)", async () => {
    const rows = [{ case_id: "case-0101", language: "de" }, { case_id: "case-0102", language: "en" }];
    vi.mocked(api.previewWorkPlans).mockImplementation(async (_key, body) => body.rows
      ? preview({ cases: 2, languages: [lang("source", 1, null, [0, 1]), lang("de", 1, [0, 1], [0, 1])] }) : preview());
    renderDialog({ rows });
    const quick = await screen.findByRole("group", { name: "Quick choice for the selected translations" });
    fireEvent.click(within(quick).getByRole("button", { name: "Translation review and annotation" }));
    await waitFor(() => expect(lastPreviewBody()).toEqual({ rows, languages: { de: { review: "on", annotate: "on" } } }));
    expect((await radio("de", "Translation review", "On")).checked).toBe(true);
    expect(screen.queryByRole("region", { name: /^fr In selection/ })).toBeNull();
    fireEvent.click(within(quick).getByRole("button", { name: "Annotation only, no translation review" }));
    await waitFor(() => expect(lastPreviewBody()).toEqual({ rows, languages: { de: { annotate: "on" } } }));
    expect(api.saveWorkPlans).not.toHaveBeenCalled();
  });

  it("has no quick choice when the selected texts hold no translation, even if their cases do (M-1)", async () => {
    vi.mocked(api.previewWorkPlans).mockImplementation(async (_key, body) => body.rows
      ? preview({ cases: 2, languages: [lang("source", 2, null, [0, 2])] }) : preview());
    renderDialog({ rows: [{ case_id: "case-0101", language: "en" }, { case_id: "case-0102", language: "en" }] });
    await region("de");
    await waitFor(() => expect(api.previewWorkPlans).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("group", { name: "Quick choice for the selected translations" })).toBeNull();
  });

  it("no lone pills", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    await region("de");
    expect(dialog.querySelector(".plan-chip, .ui-plan-chip, .ui-tristate")).toBeNull();
  });

  it("keeps Save unavailable with a reason while everything is keep", async () => {
    const { onSaved } = renderDialog();
    await region("de");
    expect(save().getAttribute("aria-disabled")).toBe("true");
    expect(save().hasAttribute("disabled")).toBe(false);
    expect(description(save())).toContain("Nothing to change yet.");
    fireEvent.click(save());
    expect(api.saveWorkPlans).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("previews and shows the Will change summary as a live region", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ languages: [lang("de", 20, [0, 20], [0, 20], { will_change: 20 })] }));
    await choose("de", "Translation review", "On");
    await choose("de", "Annotation", "Annotate from scratch");
    await waitFor(() => expect(lastPreviewBody()).toEqual({ case_ids: caseIds, languages: { de: { review: "on", annotate: "on", annotation_mode: "scratch" } } }));
    await waitFor(() => expect(screen.getByText("Will change:").parentElement!.textContent).toBe("Will change: 20 texts."));
    const live = screen.getByText("Will change:").closest("[aria-live]")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect((await region("de")).getAttribute("aria-describedby")).toBe(live.id);
    expect(save().getAttribute("aria-disabled")).toBeNull();
  });

  it("bulk sets the annotation mode and reports locked texts", async () => {
    const { onSaved } = renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ languages: [lang("de", 20, [0, 20], [20, 0], { will_change: 17, mode_locked: 2, mode_no_proposals: 1 })] }));
    vi.mocked(api.saveWorkPlans).mockResolvedValue({ ...result, changed_rows: 17, mode_locked: [{ case_id: "case-0101", language: "de" }, { case_id: "case-0102", language: "de" }], mode_no_proposals: [{ case_id: "case-0103", language: "de" }] });
    await choose("de", "Annotation", "Annotate from proposals");
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ de: { annotate: "on", annotation_mode: "proposals" } }));
    await waitFor(() => expect(screen.getByText("Will change:").parentElement!.textContent).toBe("Will change: 17 texts; 2 kept their mode because the annotation has started; 1 have no tool proposals."));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    await waitFor(() => expect(api.saveWorkPlans).toHaveBeenCalledWith("p", expect.objectContaining({ languages: { de: { annotate: "on", annotation_mode: "proposals" } } })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ changed_rows: 17 }), "17 texts changed; 2 kept their mode because the annotation has started; 1 have no tool proposals."));
  });

  it("switches to the in-dialog confirmation when work is affected and hides the choices", async () => {
    const { onSaved } = renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ consequences: withdrawing, changes: 18 }));
    await choose("fr", "Translation review", "Off");
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ fr: { review: "off" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    const warning = await screen.findByText(/fr has work in 2 of these cases\./);
    expect(warning.closest(".work-plan-warning")!.textContent).toContain("1 open translation review will be withdrawn (Ana Weber (ann-0004)).");
    expect(warning.closest(".work-plan-warning")!.textContent).toContain("1 final result (case-0108 fr) stays in history but is no longer exported.");
    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(api.saveWorkPlans).not.toHaveBeenCalled();
    const confirm = screen.getByRole("checkbox", { name: /I understand — withdraw the open tasks/ });
    expect(save().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((await radio("fr", "Translation review", "Off")).checked).toBe(true);
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
    await choose("fr", "Annotation", "Annotate from scratch");
    expect(await screen.findByText("fr: 12 of 30 translations are not marked as reviewed in the package. Annotation needs an accepted translation.")).toBeTruthy();
    expect(screen.getByText(/18 already marked as reviewed in the package metadata need nothing\./)).toBeTruthy();
    expect(save().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "These translations were reviewed outside Ontocurator — accept them as they are" }));
    expect(save().getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Vendor batch 2026-10" } });
    expect(save().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(api.saveWorkPlans).toHaveBeenCalledWith("p", expect.objectContaining({ languages: { fr: { annotate: "on", annotation_mode: "scratch" } }, accept_external_review: { languages: ["fr"], reason: "Vendor batch 2026-10" }, confirm: false })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("does not offer the acceptance while the rule is off", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ rule_on: false, changes: 18, languages: [lang("fr", 18, [0, 18], [0, 18], { not_accepted: 12 })] }));
    await choose("fr", "Annotation", "Annotate from scratch");
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ fr: { annotate: "on", annotation_mode: "scratch" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    expect(screen.queryByRole("checkbox", { name: /reviewed outside Ontocurator/ })).toBeNull();
  });

  it("keeps a quick-action preset that turns annotation on without a mode", async () => {
    const { onSaved } = renderDialog({ initial: { de: { annotate: "on" } } });
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ de: { annotate: "on" } }));
    expect((await radio("de", "Annotation", "Annotate")).checked).toBe(true);
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 20 }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0].undo.rows[0].restored_revision).toBe(4);
  });

  it("lists open problem reports in the confirmation", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 18, consequences: { ...noConsequences, open_reports: [{ report_id: "r1", case_id: "case-0108", language: "fr", assignment_id: 3, held: true }] } }));
    await choose("fr", "Annotation", "Off (not annotated)");
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ fr: { annotate: "off" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(save());
    expect(await screen.findByText(/1 open problem report \(case-0108 fr, task paused\) stays open under Problem reports\./)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "I understand" })).toBeTruthy();
  });

  it("blocks the external-review acceptance for rejected, queried or in-review translations", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 18, languages: [lang("fr", 18, [0, 18], [0, 18], { not_accepted: 5, not_acceptable: 3, in_review: 1 })] }));
    await choose("fr", "Annotation", "Annotate from scratch");
    expect(await screen.findByText("2 rejected or queried: resolve them first.")).toBeTruthy();
    expect(screen.getByText("1 in review: wait for the review or withdraw it first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /reviewed outside Ontocurator/ }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Vendor" } });
    expect(save().getAttribute("aria-disabled")).toBe("true");
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 18, languages: [lang("fr", 18, [0, 18], [0, 18])] }));
    await choose("fr", "Translation review", "On");
    await waitFor(() => expect(lastPreviewBody().languages).toEqual({ fr: { review: "on", annotate: "on", annotation_mode: "scratch" } }));
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
  });

  it("reloads the preview with a message when the plan changed", async () => {
    renderDialog();
    vi.mocked(api.previewWorkPlans).mockResolvedValue(preview({ changes: 20 }));
    vi.mocked(api.saveWorkPlans).mockRejectedValueOnce(new ApiError(409, "Changed", "WORK_PLAN_CHANGED", { cases: [{ case_id: "case-0101", revision: 3 }] }));
    await choose("de", "Annotation", "Annotate from scratch");
    await waitFor(() => expect(save().getAttribute("aria-disabled")).toBeNull());
    const calls = vi.mocked(api.previewWorkPlans).mock.calls.length;
    fireEvent.click(save());
    expect(await screen.findByText("This plan changed. Reloaded the current plan.")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api.previewWorkPlans).mock.calls.length).toBeGreaterThan(calls));
    expect((await radio("de", "Annotation", "Annotate from scratch")).checked).toBe(true);
  });
});
