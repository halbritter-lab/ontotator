/** Window event fired after an own action changed a task's status (the "My tasks (n)" counter reloads). */
export const TASKS_CHANGED = "tasks-changed";

export function notifyTasksChanged(): void {
  window.dispatchEvent(new Event(TASKS_CHANGED));
}
