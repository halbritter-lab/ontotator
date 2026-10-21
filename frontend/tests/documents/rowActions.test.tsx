import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type DocumentRowView, type NextStepView, type PlanRowResult } from "../../src/api/client";
import { usePlanSaves } from "../../src/documents/PlanChips";
import { RowActionCell } from "../../src/documents/RowActions";
import { Toast, useToast } from "../../src/ui/Toast";
import { notInPlanRow, stepOf } from "./fixtures";
import { scenario7a, scenario7b, stagedRow } from "./tableFixtures";

const onAction = vi.fn();

function Harness({ row }: { row: DocumentRowView }) {
  const { toast, show, dismiss } = useToast();
  const saves = usePlanSaves({ projectKey: "p", onAnnounce: vi.fn(), onChanged: vi.fn(), showToast: show });
  return <>
    <RowActionCell row={row} onAction={onAction} plan={{ groupRevision: 3, saves }} />
    <Toast toast={toast} onDismiss={dismiss} />
  </>;
}

const undecided = (language = "de") => notInPlanRow("case-101", language, {
  next_step: stepOf("decide_plan"), steps: [stepOf("decide_plan")],
  plan_row: { review: false, annotate: false, review_applicable: true, discarded: false, decided: false },
});

beforeEach(() => { onAction.mockReset(); vi.spyOn(api, "patchWorkPlan"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("one button for the first lead-owned step and a +n menu for the others", () => {
  const steps: NextStepView[] = [stepOf("decide_report"), stepOf("annotation_in_progress"), stepOf("assign_annotation"), stepOf("choose_final")];
  const target = stagedRow("case-109", "de", { steps });
  render(<Harness row={target} />);
  const first = screen.getByRole("button", { name: "Decide on report…, case-109 · de" });
  expect(first.textContent).toBe("Decide on report…");
  expect(first.id).toBe("documents-row-case-109-de-action");
  fireEvent.click(first);
  expect(onAction).toHaveBeenLastCalledWith(target, steps[0]);
  const more = screen.getByRole("button", { name: "+2 more actions, case-109 · de" });
  expect(more.textContent).toBe("+2");
  expect(more.getAttribute("aria-haspopup")).toBe("menu");
  fireEvent.click(more);
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Assign annotation…", "Compare results…"]);
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Assign annotation…" }));
  expect(onAction).toHaveBeenLastCalledWith(target, steps[2]);
  // One lead step: no menu; no lead step: nothing.
  cleanup();
  render(<Harness row={stagedRow("case-109", "de", { steps: [stepOf("assign_annotation")] })} />);
  expect(screen.queryByRole("button", { name: /more action/ })).toBeNull();
  cleanup();
  const { container } = render(<Harness row={stagedRow("case-103", "de", { steps: [stepOf("translation_review_in_progress")] })} />);
  expect(container.querySelector("button")).toBeNull();
});

it("Plan… is a secondary button on undecided rows and a quiet text button on not-in-plan rows; none on in-plan rows", () => {
  render(<Harness row={undecided()} />);
  const secondary = screen.getByRole("button", { name: "Plan…, case-101 · de" });
  expect(secondary.textContent).toBe("Plan…");
  expect(secondary.className).toContain("btn-secondary");
  expect(secondary.getAttribute("aria-haspopup")).toBe("dialog");
  expect(secondary.getAttribute("aria-expanded")).toBe("false");
  cleanup();
  render(<Harness row={notInPlanRow("case-101", "en", { is_source: true })} />);
  expect(screen.getByRole("button", { name: "Plan…, case-101 · en" }).className).toContain("btn-quiet");
  cleanup();
  const { container } = render(<Harness row={stagedRow("case-110", "de", { steps: [stepOf("done")] })} />);
  expect(container.querySelector("button")).toBeNull();
});

it("plan popover saves on chip click with Undo toast", async () => {
  const target = undecided();
  const saved: PlanRowResult = {
    case_id: "case-101", language: "de",
    flags: { review: true, annotate: false, review_applicable: true, discarded: false },
    revision: 4,
    undo: { rows: [{ case_id: "case-101", language: "de", review: false, annotate: false, restored_revision: null }], revisions: { "case-101": 4 } },
    withdrawn: [], accepted_document_ids: [],
  };
  vi.mocked(api.patchWorkPlan).mockResolvedValue(saved);
  render(<Harness row={target} />);
  const button = screen.getByRole("button", { name: "Plan…, case-101 · de" });
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  const popover = screen.getByRole("dialog", { name: "Plan, case-101 · de" });
  const review = within(popover).getByRole("button", { name: "Review, case-101 · de" });
  expect(document.activeElement).toBe(review);
  fireEvent.click(review);
  expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-101", "de", { review: true, expected_revision: 3, confirm: false });
  expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();
  // Escape closes and returns focus to the button.
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Plan, case-101 · de" }), { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Plan, case-101 · de" })).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("Accept result… for label_rule accept, Compare results… otherwise", () => {
  render(<Harness row={scenario7a()} />);
  expect(screen.getByRole("button", { name: "Accept result…, case-107 · de" })).toBeTruthy();
  cleanup();
  render(<Harness row={scenario7b()} />);
  expect(screen.getByRole("button", { name: "Compare results…, case-107 · en" })).toBeTruthy();
});
