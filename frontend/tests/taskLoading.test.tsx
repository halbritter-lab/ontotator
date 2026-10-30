import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView } from "../src/api/client";
import { TaskEditor } from "../src/tasks/TaskEditor";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const user = { username: "alice", display_name: "Alice", pseudonym: "alice", is_system_admin: false, csrf_token: "csrf" };
const never = () => new Promise<never>(() => {});

it("Opening task… is a calm status line, not an info notice", () => {
  vi.spyOn(api, "getAssignmentMetadata").mockReturnValue(never());
  const { container } = render(<TaskEditor assignmentId={1} user={user} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("Opening task…");
  expect(status.classList.contains("task-loading")).toBe(true);
  expect(container.querySelector(".notice-info")).toBeNull();
});

it("a waiting task's direct URL says what it waits for (issue 213)", async () => {
  vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ id: 1, task: "annotate" } as AssignmentView);
  vi.spyOn(api, "openAssignment").mockRejectedValue(new ApiError(409, "waiting", "TASK_WAITING_FOR_TRANSLATION_REVIEW"));
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  render(<TaskEditor assignmentId={1} user={user} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  expect((await screen.findByRole("heading", { name: "Waiting for translation review" }))).toBeDefined();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByRole("link", { name: "My tasks" })).toBeDefined();
});

it("Opening translation review… is a calm status line, not an info notice", () => {
  vi.spyOn(api, "openTranslationReview").mockReturnValue(never());
  const { container } = render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("Opening translation review…");
  expect(status.classList.contains("task-loading")).toBe(true);
  expect(container.querySelector(".notice-info")).toBeNull();
});
