import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AssignmentView, type ProblemReportView, type RoundInputView } from "../src/api/client";
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

// B1: kept and updated by editor F8a (round dialogs).
describe("B1 task dialogs: Close in the footer", () => {
  it("puts Close original evidence in the footer", () => {
    vi.spyOn(api, "getVariantText").mockReturnValue(never());
    const annotation = { annotation_id: "a", term_id: "HP:1", layer_id: "l", axes_values: {}, evidence_refs: [], provenance: { actor: { actor_id: "ann-1", kind: "human" } } };
    const input = { source_submission_id: "s", source_ref: { annotation_id: "a", version: "v" }, source_snapshot: { document_id: "d", text_sha256: "h", evidence: [], annotation } } as unknown as RoundInputView;
    render(<RoundInputEvidenceDialog projectKey="p" input={input} onClose={vi.fn()} labelFor={() => null} />);
    notInBody(footer().getByRole("button", { name: "Close original evidence" }));
  });

  it("puts Close in the Work rounds footer and keeps Retry in the body", async () => {
    vi.spyOn(api, "listWorkRounds").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "listRoundSources").mockResolvedValue([]);
    render(<WorkRoundsDialog assignment={assignment} onClose={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} onReload={vi.fn()} />);
    notInBody(footer(screen.getByRole("dialog", { name: "Work rounds" })).getByRole("button", { name: "Close" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry.closest(".ui-dialog-body")).not.toBeNull();
  });
});

// B2: problem-reports WP6 (reporter dialog).
describe("B2 task problem reports: footer actions", () => {
  it("puts New report then Close in the problem dialog footer", async () => {
    const report = { report_id: "r1", assignment_id: 7, reason: "Broken text", state: "open", revision: 1, created_at: "2026-10-19T01:12:00Z",
      events: [], holds: [], held_assignment_ids: [], withdrawable: false, viewer_label: "ann", viewer_is_lead: false, reporter_label: "ann", case_id: "case-7", language: "de" } as unknown as ProblemReportView;
    vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([report]);
    vi.spyOn(api, "getAssignmentMetadata").mockReturnValue(never());
    render(<TaskProblemActions assignment={assignment} onSaveBeforeReport={vi.fn()} onRefresh={vi.fn()} />);
    await screen.findByRole("button", { name: /^Report a text problem.*1 open report$/ });
    fireEvent.click(screen.getByRole("button", { name: /^Report a text problem/ }));
    const dialog = screen.getByRole("dialog", { name: "Problems with case-7 de" });
    const create = footer(dialog).getByRole("button", { name: "New report" });
    const close = footer(dialog).getByRole("button", { name: "Close" });
    notInBody(create); notInBody(close);
    expect(create.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Reload/ })).toBeNull();
  });
});
