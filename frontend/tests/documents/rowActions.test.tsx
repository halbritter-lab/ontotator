import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

beforeEach(() => { onAction.mockReset(); vi.spyOn(api, "patchWorkPlan"); vi.spyOn(api, "setWorkPlanRows"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("one next-step button", () => {
  const steps: NextStepView[] = [stepOf("decide_report"), stepOf("annotation_in_progress")];
  const target = stagedRow("case-109", "de", { steps });
  render(<Harness row={target} />);
  const first = screen.getByRole("button", { name: "Decide on report…, case-109 · de" });
  expect(first.textContent).toBe("Decide on report…");
  expect(first.id).toBe("documents-row-case-109-de-action");
  fireEvent.click(first);
  expect(onAction).toHaveBeenLastCalledWith(target, steps[0]);
  // annotation_in_progress is no lead step: one button, no menu, no "+n".
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(document.body.textContent).not.toMatch(/\+\d/);
  cleanup();
  const { container } = render(<Harness row={stagedRow("case-103", "de", { steps: [stepOf("translation_review_in_progress")] })} />);
  expect(container.querySelector("button")).toBeNull();
});

it("More menu when several actions remain", () => {
  const steps: NextStepView[] = [stepOf("decide_report"), stepOf("assign_annotation"), stepOf("choose_final")];
  const target = stagedRow("case-109", "de", { steps });
  render(<Harness row={target} />);
  expect(screen.getByRole("button", { name: "Decide on report…, case-109 · de" })).toBeTruthy();
  const more = screen.getByRole("button", { name: "More actions, case-109 de" });
  expect(more.textContent).toBe("More");
  expect(more.querySelector("svg")).not.toBeNull();
  expect(more.getAttribute("aria-haspopup")).toBe("menu");
  fireEvent.click(more);
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Assign annotation…", "Compare results…"]);
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Assign annotation…" }));
  expect(onAction).toHaveBeenLastCalledWith(target, steps[1]);
});

it("Open my task is the viewer's next step; Space activates it like a button", () => {
  const onNavigate = vi.fn();
  const mine = stagedRow("case-111", "de", { steps: [stepOf("choose_final")], overrides: { own_open_assignment_id: 41 } });
  render(<RowActionCell row={mine} onAction={onAction} onNavigate={onNavigate} />);
  const task = screen.getByRole("link", { name: "Open my task" });
  expect(task.getAttribute("href")).toBe("#/tasks/41");
  expect(task.className).toContain("btn");
  expect(task.id).toBe("documents-row-case-111-de-action");
  // The lead step moves into More.
  expect(screen.getByRole("button", { name: "More actions, case-111 de" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Accept result|^Compare results/ })).toBeNull();
  fireEvent.keyDown(task, { key: " " });
  expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 });
});

it("Plan… is a secondary button on undecided rows and on not-in-plan rows (never a text link); none on in-plan rows", () => {
  render(<Harness row={undecided()} />);
  const secondary = screen.getByRole("button", { name: "Plan…, case-101 · de" });
  expect(secondary.textContent).toBe("Plan…");
  expect(secondary.className).toContain("btn-secondary");
  expect(secondary.getAttribute("aria-haspopup")).toBe("dialog");
  expect(secondary.getAttribute("aria-expanded")).toBe("false");
  cleanup();
  render(<Harness row={notInPlanRow("case-101", "en", { is_source: true })} />);
  expect(screen.getByRole("button", { name: "Plan…, case-101 · en" }).className).toContain("btn-secondary");
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
  // Undecided: each flag is a pair of options, neither pressed.
  const reviewGroup = within(popover).getByRole("group", { name: "Translation review, case-101 · de" });
  const review = within(reviewGroup).getByRole("button", { name: "Translation review" });
  expect(within(reviewGroup).getByRole("button", { name: "No translation review" }).getAttribute("aria-pressed")).toBe("false");
  expect(review.getAttribute("aria-pressed")).toBe("false");
  expect(within(reviewGroup).getByText("Not decided yet")).toBeTruthy();
  expect(document.activeElement).toBe(review);
  fireEvent.click(review);
  expect(api.patchWorkPlan).toHaveBeenCalledWith("p", "case-101", "de", { review: true, expected_revision: 3, confirm: false });
  expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();
  // Escape closes and returns focus to the button.
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Plan, case-101 · de" }), { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Plan, case-101 · de" })).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("Accept result… when the final has one submission to choose (final.state choose, submitted 1), Compare results… otherwise", () => {
  render(<Harness row={scenario7a()} />);
  expect(screen.getByRole("button", { name: "Accept result…, case-107 · de" })).toBeTruthy();
  cleanup();
  render(<Harness row={scenario7b()} />);
  expect(screen.getByRole("button", { name: "Compare results…, case-107 · en" })).toBeTruthy();
});

it("plan popover stays open when a save moves the row into the plan; closing focuses the row's action", async () => {
  vi.mocked(api.patchWorkPlan).mockResolvedValue({
    case_id: "case-101", language: "de",
    flags: { review: true, annotate: false, review_applicable: true, discarded: false },
    revision: 4,
    undo: { rows: [{ case_id: "case-101", language: "de", review: false, annotate: false, restored_revision: null }], revisions: { "case-101": 4 } },
    withdrawn: [], accepted_document_ids: [],
  });
  const { rerender } = render(<Harness row={undecided()} />);
  const button = screen.getByRole("button", { name: "Plan…, case-101 · de" });
  fireEvent.click(button);
  const popover = screen.getByRole("dialog", { name: "Plan, case-101 · de" });
  expect(button.getAttribute("aria-controls")).toBe("documents-row-case-101-de-plan");
  expect(document.getElementById("documents-row-case-101-de-plan")).not.toBeNull();
  expect(popover.contains(document.getElementById("documents-row-case-101-de-plan"))).toBe(true);
  fireEvent.click(within(within(popover).getByRole("group", { name: "Translation review, case-101 · de" })).getByRole("button", { name: "Translation review" }));
  expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();
  // The reload: the row is in the plan now, its first lead step is no longer "Plan…".
  rerender(<Harness row={stagedRow("case-101", "de", { steps: [stepOf("assign_translation_review")] })} />);
  const still = screen.getByRole("dialog", { name: "Plan, case-101 · de" });
  expect(still).toBe(popover);
  expect(still.contains(document.activeElement)).toBe(true);
  // Escape closes it; the Plan… button is gone, so focus goes to the row's action button.
  fireEvent.keyDown(still, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Plan, case-101 · de" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Plan…, case-101 · de" })).toBeNull();
  expect(document.activeElement?.id).toBe("documents-row-case-101-de-action");
  expect(document.activeElement?.textContent).toBe("Assign review…");
});

it("Don't annotate on an undecided row records the decision without turning anything on", async () => {
  vi.mocked(api.setWorkPlanRows).mockResolvedValue({ changed_rows: 1, revisions: { "case-101": 4 }, withdrawn: [],
    undo: { rows: [{ case_id: "case-101", language: "de", review: false, annotate: false, restored_revision: null }], revisions: { "case-101": 4 } } });
  render(<Harness row={undecided()} />);
  fireEvent.click(screen.getByRole("button", { name: "Plan…, case-101 · de" }));
  const annotate = screen.getByRole("group", { name: "Annotate, case-101 · de" });
  fireEvent.click(within(annotate).getByRole("button", { name: "Don't annotate" }));
  await waitFor(() => expect(api.setWorkPlanRows).toHaveBeenCalledWith("p", {
    rows: [{ case_id: "case-101", language: "de", review: false, annotate: false }], expected_revisions: { "case-101": 3 }, undo: false, confirm: false,
  }));
  expect(api.patchWorkPlan).not.toHaveBeenCalled();
  expect(await screen.findByText("de of case-101: Annotate off")).toBeTruthy();
  // Decided now: the popover shows the row's chips.
  expect(screen.getByRole("button", { name: "Annotate, case-101 · de" }).getAttribute("aria-pressed")).toBe("false");
});
