import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type TaskSummary } from "../src/api/client";
import { DocumentsTabs } from "../src/documents/DocumentsTabs";
import { MyTasks } from "../src/tasks/MyTasks";
import { bar } from "./documents/fixtures";
import { guidelineListing } from "./projectFixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Space on a link styled as a button follows it once, as a button does (V4). */
function pressSpace(link: HTMLElement): boolean {
  return fireEvent.keyDown(link, { key: " " });
}

describe("Space activates a link-styled Open button", () => {
  it("in My tasks", async () => {
    const task: TaskSummary = { assignment_id: 3, workflow_revision: 0, held: false, project_key: "p", project_name: "Project P", document_id: "doc-3", language: "de", task: "annotate", status: "open", updated_at: "2026-10-15T10:30:00Z" } as TaskSummary;
    vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([]));
    vi.spyOn(api, "listMyTasks").mockResolvedValue([task]);
    const onNavigate = vi.fn();
    render(<MyTasks projects={[]} onNavigate={onNavigate} />);
    const [row] = await screen.findAllByTestId("task-row");
    const open = within(row).getByRole("link", { name: "Start" });
    expect(pressSpace(open)).toBe(false); // default (page scroll) prevented
    expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 3 });
  });

  it("on the Documents tab link", () => {
    const onNavigate = vi.fn();
    render(<DocumentsTabs bar={bar({ finals: 2 })} query={{}} projectKey="p" panelId="documents-panel" onNavigate={onNavigate} />);
    const link = screen.getByRole("link", { name: "Export final results…" });
    expect(pressSpace(link)).toBe(false);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
