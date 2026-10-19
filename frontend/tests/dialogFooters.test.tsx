import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AssignmentView, type RoundInputView } from "../src/api/client";
import { RoundInputEvidenceDialog } from "../src/tasks/RoundInputEvidenceDialog";
import { WorkRoundsDialog } from "../src/tasks/WorkRoundsDialog";
import { TaskProblemActions } from "../src/tasks/TaskProblemActions";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const never = <T,>() => new Promise<T>(() => undefined);
/** The footer of the open dialog; header buttons (editor F1) are never matched. */
const footer = (dialog: HTMLElement = screen.getByRole("dialog")) => {
  const actions = dialog.querySelector<HTMLElement>(":scope > .modal-actions");
  expect(actions, "dialog has a footer").not.toBeNull();
  return within(actions!);
};
const notInBody = (button: HTMLElement) => expect(button.closest(".ui-dialog-body")).toBeNull();
const assignment = { id: 7, task: "annotate", project_key: "p", document_id: "d", held: false, hold_reason: null, workflow_revision: 0 } as unknown as AssignmentView;

// B1: obsolete after editor F8a (F8a deletes this block).
describe("B1 task dialogs: Close in the footer", () => {
  it("puts Close original evidence in the footer", () => {
    vi.spyOn(api, "getVariantText").mockReturnValue(never());
    const input = { source_submission_id: "s", source_snapshot: { document_id: "d", text_sha256: "h", evidence: [] } } as unknown as RoundInputView;
    render(<RoundInputEvidenceDialog projectKey="p" input={input} onClose={vi.fn()} labelFor={() => null} />);
    notInBody(footer().getByRole("button", { name: "Close original evidence" }));
  });

  it("puts Close in the Work rounds footer and keeps Retry in the body", async () => {
    vi.spyOn(api, "listWorkRounds").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "listRoundSources").mockResolvedValue([]);
    render(<WorkRoundsDialog assignment={assignment} onClose={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} onReload={vi.fn()} />);
    notInBody(footer(screen.getByRole("dialog", { name: "Work rounds" })).getByRole("button", { name: "Close" }));
    const retry = await screen.findByRole("button", { name: "Retry round list" });
    expect(retry.closest(".ui-dialog-body")).not.toBeNull();
  });
});

// B2: obsolete after problem-reports WP6 (WP6 deletes this block).
describe("B2 task problem reports: footer actions", () => {
  it("puts Reload my reports then Close reports in the footer, both disabled while busy", async () => {
    vi.spyOn(api, "listProblemReports").mockReturnValue(never());
    vi.spyOn(api, "getAssignmentMetadata").mockReturnValue(never());
    render(<TaskProblemActions assignment={assignment} onSaveBeforeReport={vi.fn()} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "My problem reports" }));
    const dialog = screen.getByRole("dialog", { name: "Task problem reports" });
    const reload = footer(dialog).getByRole("button", { name: "Reload my reports" });
    const close = footer(dialog).getByRole("button", { name: "Close reports" });
    notInBody(reload); notInBody(close);
    expect(reload.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((close as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Task problem reports" })).toBeDefined();
  });
});
