import { describe, expect, it } from "vitest";
import type { TaskSummary } from "../src/api/client";
import { orderTasks } from "../src/app/caseOrder";

const task = (assignment_id: number, overrides: Partial<TaskSummary> = {}): TaskSummary => ({
  assignment_id,
  workflow_revision: 0, held: false,
  project_key: "project-a",
  project_name: "Project A",
  document_id: `document-${assignment_id}`,
  language: "en",
  task: "annotate",
  status: "open",
  updated_at: "2026-10-15T12:00:00Z",
  ...overrides,
});

describe("orderTasks", () => {
  const tasks = [task(81), task(5), task(23)];

  it.each([
    [0, { next: 5 }],
    [1, { previous: 81, next: 23 }],
    [2, { previous: 5 }],
  ] as const)("returns adjacent assignment IDs at position %i", (index, expected) => {
    expect(orderTasks(tasks, tasks[index])).toEqual(expected);
  });

  it("ignores interleaved tasks outside the exact project and task", () => {
    const current = task(4);
    const mixed = [
      task(2),
      task(100, { project_key: "project-b" }),
      task(101, { task: "review" }),
      current,
      task(102, { project_key: "Project-a" }),
      task(103, { project_key: "project-a-extra" }),
      task(104, { task: "review" }),
      task(6),
    ];
    expect(orderTasks(mixed, current)).toEqual({ previous: 2, next: 6 });
  });

  it("also scopes review navigation to the current project and task", () => {
    const current = task(7, { task: "review" });
    const mixed = [task(1), task(8, { task: "review" }), current, task(9, { task: "review", project_key: "project-b" }), task(2)];
    expect(orderTasks(mixed, current)).toEqual({ previous: 8 });
  });

  it("identifies duplicate document tasks by assignment ID", () => {
    const sameDocument = [task(40, { document_id: "shared" }), task(9, { document_id: "shared" }), task(12)];
    // Fresh server metadata may replace the current object's identity.
    expect(orderTasks(sameDocument, { ...sameDocument[1], updated_at: "2026-10-15T13:00:00Z" }))
      .toEqual({ previous: 40, next: 12 });
  });

  it("returns no navigation for an unknown assignment even when the document matches", () => {
    expect(orderTasks([task(1, { document_id: "shared" }), task(2)], task(99, { document_id: "shared" }))).toEqual({});
  });

  it("does not find the current assignment in a different project or task", () => {
    const current = task(4);
    expect(orderTasks([task(1), task(4, { project_key: "project-b" }), task(5)], current)).toEqual({});
    expect(orderTasks([task(1), task(4, { task: "review" }), task(5)], current)).toEqual({});
  });

  it("keeps incoming server order without sorting IDs or statuses", () => {
    const serverOrder = [
      task(9, { status: "submitted" }),
      task(90, { status: "open" }),
      task(1, { status: "reopened" }),
      task(50, { status: "in_progress" }),
    ];
    expect(orderTasks(serverOrder, serverOrder[1])).toEqual({ previous: 9, next: 1 });
  });

  it("includes submitted tasks as read-only navigation destinations and current tasks", () => {
    const serverOrder = [task(7), task(3, { status: "submitted" }), task(20)];
    expect(orderTasks(serverOrder, serverOrder[0])).toEqual({ next: 3 });
    expect(orderTasks(serverOrder, serverOrder[1])).toEqual({ previous: 7, next: 20 });
    expect(orderTasks(serverOrder, serverOrder[2])).toEqual({ previous: 3 });
  });

  it("returns no neighbors for an empty list or a sole matching task", () => {
    const current = task(1);
    expect(orderTasks([], current)).toEqual({});
    expect(orderTasks([current], current)).toEqual({});
    expect(orderTasks([task(2, { task: "review" }), current], current)).toEqual({});
  });

  it("accepts frozen readonly input without changing tasks, current metadata or order", () => {
    const first = Object.freeze(task(18));
    const middle = Object.freeze(task(2));
    const last = Object.freeze(task(11));
    const readonlyTasks: readonly TaskSummary[] = Object.freeze([first, middle, last]);
    const current = Object.freeze({ ...middle });
    const before = JSON.stringify({ tasks: readonlyTasks, current });
    expect(orderTasks(readonlyTasks, current)).toEqual({ previous: 18, next: 11 });
    expect(JSON.stringify({ tasks: readonlyTasks, current })).toBe(before);
    expect(readonlyTasks[0]).toBe(first);
    expect(readonlyTasks[1]).toBe(middle);
    expect(readonlyTasks[2]).toBe(last);
  });
});
