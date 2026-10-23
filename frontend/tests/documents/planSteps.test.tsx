import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type DocumentRowView, type PlanRowResult } from "../../src/api/client";
import { usePlanSaves } from "../../src/documents/PlanChips";
import { PlanSteps, TextPlanDialog, type PlanStepsValue } from "../../src/documents/PlanSteps";

type AnnotationModeView = NonNullable<DocumentRowView["annotation_mode"]>;
type PlanRow = DocumentRowView;
import { Toast, useToast } from "../../src/ui/Toast";
import { planRow, stepOf } from "./fixtures";

const mode = (overrides: Partial<AnnotationModeView> = {}): AnnotationModeView => ({ mode: "proposals", source: "project", locked: false, override: null, proposal_count: 12, ...overrides });
const de = (annotationMode: AnnotationModeView | null = mode(), planOverride: "proposals" | "scratch" | null = null): PlanRow => ({
  ...planRow("case-0101", "de", stepOf("assign_annotation"), { plan_row: { review: true, annotate: true, review_applicable: true, discarded: false, annotation_mode: planOverride } }),
  annotation_mode: annotationMode,
});
const en = (): PlanRow => ({
  ...planRow("case-0101", "en", stepOf("assign_annotation"), { is_source: true, plan_row: { review: false, annotate: true, review_applicable: false, discarded: false } }),
  annotation_mode: mode(),
});

function Steps({ row, initial = { review: true, annotate: true, mode: "project" } }: { row: PlanRow; initial?: PlanStepsValue }) {
  const [value, setValue] = useState(initial);
  return <><PlanSteps row={row} value={value} onChange={setValue} /><output data-testid="value">{JSON.stringify(value)}</output></>;
}
const group = (name: string) => screen.getByRole("group", { name });
const radio = (step: string, name: string | RegExp) => within(group(step)).getByRole("radio", { name }) as HTMLInputElement;
const description = (element: HTMLElement) => (element.getAttribute("aria-describedby") ?? "").split(" ").map(id => document.getElementById(id)?.textContent ?? "").join(" ");
const value = () => JSON.parse(screen.getByTestId("value").textContent!) as PlanStepsValue;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PlanSteps", () => {
  it("lists translation review and annotation in words with an explanation", () => {
    render(<Steps row={de()} />);
    expect(radio("Translation review", "On").checked).toBe(true);
    expect(description(radio("Translation review", "On"))).toBe("On: a person reviews the machine translation before annotation.");
    expect(description(radio("Translation review", "Off"))).toBe("Off: the translation is annotated as it is.");
    expect(within(group("Annotation")).getAllByRole("radio").map(item => (item as HTMLInputElement).labels?.[0].textContent))
      .toEqual(["Off (not annotated)", "Annotate from proposals (project setting)", "Annotate from scratch"]);
    expect(description(radio("Annotation", /^Annotate from proposals/))).toBe("Annotate from proposals: each annotator confirms, rejects or corrects the 12 tool proposals and adds the findings the tool missed.");
    expect(description(radio("Annotation", "Annotate from scratch"))).toBe("Annotate from scratch: annotators start from the plain text and do not see the proposals.");
    fireEvent.click(radio("Annotation", "Annotate from scratch"));
    expect(value()).toEqual({ review: true, annotate: true, mode: "scratch" });
    fireEvent.click(radio("Annotation", "Off (not annotated)"));
    expect(value().annotate).toBe(false);
  });

  it("from proposals is unavailable without proposals with the reason", () => {
    render(<Steps row={de(mode({ mode: "scratch", source: "no_proposals", proposal_count: 0 }))} />);
    const proposals = radio("Annotation", "Annotate from proposals");
    expect(proposals.getAttribute("aria-disabled")).toBe("true");
    expect(proposals.hasAttribute("disabled")).toBe(false);
    expect(description(proposals)).toContain("This text has no tool proposals, so it is annotated from scratch.");
    fireEvent.click(proposals);
    expect(value().mode).toBe("project");
    expect(radio("Annotation", "Annotate from scratch").checked).toBe(true);
  });

  it("mode is unavailable while locked with the reason", () => {
    render(<Steps row={de(mode({ source: "locked", locked: true }))} />);
    const scratch = radio("Annotation", "Annotate from scratch");
    expect(scratch.getAttribute("aria-disabled")).toBe("true");
    expect(description(scratch)).toContain("The annotation of this text has already started this way, so it cannot change.");
    expect(radio("Annotation", "Annotate from proposals").getAttribute("aria-disabled")).toBeNull();
    expect(radio("Annotation", "Annotate from proposals").checked).toBe(true);
    fireEvent.click(scratch);
    expect(value().mode).toBe("project");
  });

  it("the project setting is marked", () => {
    render(<Steps row={de(mode({ mode: "scratch", source: "plan", override: "scratch" }), "scratch")} initial={{ review: true, annotate: true, mode: "scratch" }} />);
    expect(screen.queryByText(/\(project setting\)/)).toBeNull();
    expect(radio("Annotation", "Annotate from scratch").checked).toBe(true);
    cleanup();
    render(<Steps row={de()} />);
    expect(radio("Annotation", "Annotate from proposals (project setting)").checked).toBe(true);
    fireEvent.click(radio("Annotation", "Annotate from scratch"));
    fireEvent.click(radio("Annotation", /^Annotate from proposals/));
    expect(value().mode).toBe("project");
  });

  it("the source text has no translation review step", () => {
    render(<Steps row={en()} initial={{ review: false, annotate: true, mode: "project" }} />);
    expect(screen.queryByRole("group", { name: "Translation review" })).toBeNull();
    expect(group("Annotation")).toBeTruthy();
  });
});

describe("TextPlanDialog", () => {
  const onClose = vi.fn();
  function Harness({ row }: { row: PlanRow }) {
    const { toast, show, dismiss } = useToast();
    const saves = usePlanSaves({ projectKey: "p", onAnnounce: () => undefined, onChanged: () => undefined, showToast: show });
    return <><TextPlanDialog row={row} groupRevision={3} saves={saves} onClose={onClose} /><Toast toast={toast} onDismiss={dismiss} /></>;
  }
  const result = (): PlanRowResult => ({
    case_id: "case-0101", language: "de", revision: 4, withdrawn: [], accepted_document_ids: [],
    flags: { review: false, annotate: true, review_applicable: true, discarded: false, annotation_mode: "scratch" },
    undo: { rows: [{ case_id: "case-0101", language: "de", review: true, annotate: true, restored_revision: 3, annotation_mode: null }], revisions: { "case-0101": 4 } },
  });
  const save = () => screen.getByRole("button", { name: "Save" });
  beforeEach(() => { onClose.mockReset(); vi.spyOn(api, "patchWorkPlan"); });

  it("saves the flags and the changed mode in one request and shows the Undo toast", async () => {
    vi.mocked(api.patchWorkPlan).mockResolvedValue(result());
    render(<Harness row={de()} />);
    expect(screen.getByRole("dialog", { name: "Plan for case-0101 de" })).toBeTruthy();
    expect(save().getAttribute("aria-disabled")).toBe("true");
    expect(description(save())).toBe("Nothing to change yet.");
    fireEvent.click(radio("Translation review", "Off"));
    fireEvent.click(radio("Annotation", "Annotate from scratch"));
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.patchWorkPlan).toHaveBeenCalledTimes(1);
    expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "de", { review: false, annotate: true, annotation_mode: "scratch", expected_revision: 3, confirm: false });
    expect(await screen.findByText("de of case-0101: plan saved")).toBeTruthy();
  });

  it("sends no mode when only the flags changed", async () => {
    vi.mocked(api.patchWorkPlan).mockResolvedValue(result());
    render(<Harness row={de()} />);
    fireEvent.click(radio("Translation review", "Off"));
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-0101", "de", { review: false, annotate: true, expected_revision: 3, confirm: false });
  });

  it("a refused mode shows the reason and keeps the dialog open with the choices", async () => {
    vi.mocked(api.patchWorkPlan).mockRejectedValue(new ApiError(409, "Locked", "ANNOTATION_MODE_LOCKED"));
    render(<Harness row={de()} />);
    fireEvent.click(radio("Annotation", "Annotate from scratch"));
    fireEvent.click(save());
    expect(await screen.findByText("The annotation of this text has already started this way, so it cannot change.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(radio("Annotation", "Annotate from scratch").checked).toBe(true);
  });

  it("asks for the confirmation of the consequences and resends with confirm", async () => {
    vi.mocked(api.patchWorkPlan)
      .mockRejectedValueOnce(new ApiError(409, "Confirm", "WORK_PLAN_CONFIRMATION_REQUIRED", {
        withdrawn: [{ assignment_id: 1, case_id: "case-0101", language: "de", task: "annotate", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }], finals_leaving: [], restored: [], open_reports: [],
      }))
      .mockResolvedValueOnce(result());
    render(<Harness row={de()} />);
    fireEvent.click(radio("Annotation", "Off (not annotated)"));
    fireEvent.click(save());
    expect(await screen.findByText("1 open annotation will be withdrawn (Ana Weber, ann-0004; draft kept).")).toBeTruthy();
    expect(save().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand — withdraw the open tasks" }));
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(api.patchWorkPlan).mock.calls[1][3]).toEqual({ review: true, annotate: false, expected_revision: 3, confirm: true });
  });
});
