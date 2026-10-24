import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type DocumentRowView, type NextStepView } from "../../src/api/client";
import { RowActionCell } from "../../src/documents/RowActions";
import { Toast, useToast } from "../../src/ui/Toast";
import { notInPlanRow, stepOf } from "./fixtures";
import { scenario7a, scenario7b, stagedRow } from "./tableFixtures";

const onAction = vi.fn();

function Harness({ row }: { row: DocumentRowView }) {
  const { toast, dismiss } = useToast();
  return <>
    <RowActionCell row={row} onAction={onAction} />
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
  const first = screen.getByRole("button", { name: "Decide on report…, case-109 de" });
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

it("one button even when several lead steps remain (the others are in the text card)", () => {
  const steps: NextStepView[] = [stepOf("decide_report"), stepOf("assign_annotation"), stepOf("choose_final")];
  const target = stagedRow("case-109", "de", { steps });
  render(<Harness row={target} />);
  expect(screen.getByRole("button", { name: "Decide on report…, case-109 de" })).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("Open my task is the viewer's next step; Space activates it like a button", () => {
  const onNavigate = vi.fn();
  const mine = stagedRow("case-111", "de", { steps: [stepOf("choose_final")], overrides: { own_open_assignment_id: 41 } });
  render(<RowActionCell row={mine} onAction={onAction} onNavigate={onNavigate} />);
  const task = screen.getByRole("link", { name: "Open my task" });
  expect(task.getAttribute("href")).toBe("#/tasks/41");
  expect(task.className).toContain("btn");
  expect(task.id).toBe("documents-row-case-111-de-action");
  // The lead step is in the text card only: no second control in the row.
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /^Accept result|^Compare results/ })).toBeNull();
  fireEvent.keyDown(task, { key: " " });
  expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 });
});

it("an undecided row's plan step runs onAction (the card); no row plan popover; nothing on not-in-plan or done rows", () => {
  const target = undecided();
  render(<Harness row={target} />);
  const step = screen.getByRole("button", { name: "Plan…, case-101 de" });
  expect(step.getAttribute("aria-haspopup")).toBeNull();
  fireEvent.click(step);
  expect(onAction).toHaveBeenLastCalledWith(target, stepOf("decide_plan"));
  expect(screen.queryByRole("dialog")).toBeNull();
  cleanup();
  const { container } = render(<Harness row={notInPlanRow("case-101", "en", { is_source: true })} />);
  expect(container.querySelector("button")).toBeNull();
  cleanup();
  const done = render(<Harness row={stagedRow("case-110", "de", { steps: [stepOf("done")] })} />);
  expect(done.container.querySelector("button")).toBeNull();
});

it("Accept result… when the final has one submission to choose (final.state choose, submitted 1), Compare results… otherwise", () => {
  render(<Harness row={scenario7a()} />);
  expect(screen.getByRole("button", { name: "Accept result…, case-107 de" })).toBeTruthy();
  cleanup();
  render(<Harness row={scenario7b()} />);
  expect(screen.getByRole("button", { name: "Compare results…, case-107 en" })).toBeTruthy();
});
