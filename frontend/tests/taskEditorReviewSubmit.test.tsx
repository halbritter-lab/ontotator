/** Issue 125: a submitted translation review takes the annotation task's post-submit flow (M2 M-6). */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type AssignmentView } from "../src/api/client";
import { TaskEditor } from "../src/tasks/TaskEditor";
import type { TranslationReviewScreenProps } from "../src/translation/TranslationReviewScreen";

const screenProps = vi.hoisted(() => ({ current: null as TranslationReviewScreenProps | null }));
vi.mock("../src/translation/TranslationReviewScreen", () => ({
  TranslationReviewScreen: (props: TranslationReviewScreenProps) => { screenProps.current = props; return <p>Review screen</p>; },
}));
vi.mock("../src/tasks/TaskGuidelines", () => ({
  TaskGuidelines: ({ children }: { children: (guidelines: Record<string, unknown>) => JSX.Element }) => children({}),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); screenProps.current = null; });

const user = { username: "alice", display_name: "Alice", pseudonym: "alice", is_system_admin: false, csrf_token: "csrf" };

async function renderReviewTask() {
  vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ id: 17, task: "translation_review", status: "in_progress", project_key: "proj", held: false, hold_reason: null, lead_correction: false } as unknown as AssignmentView);
  const onNavigate = vi.fn();
  const showToast = vi.fn();
  render(<TaskEditor assignmentId={17} user={user} onNavigate={onNavigate} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} showToast={showToast} />);
  await screen.findByText("Review screen");
  return { onNavigate, showToast, onSubmitted: screenProps.current!.onSubmitted! };
}

it("names the submitted review in a toast and opens the next open task", async () => {
  const { onNavigate, showToast, onSubmitted } = await renderReviewTask();
  act(() => onSubmitted({ label: "case-1 de", assignmentId: 17, next: 18 }));
  expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "case-1 de submitted.", actionLabel: "View result" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "task", assignmentId: 18 });
  // "View result" reopens the submitted review read-only.
  showToast.mock.calls[0][0].onAction();
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "task", assignmentId: 17 });
});

it("opens My tasks after the last task", async () => {
  const { onNavigate, onSubmitted } = await renderReviewTask();
  act(() => onSubmitted({ label: "case-1 de", assignmentId: 17 }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "tasks", status: "all" });
});
