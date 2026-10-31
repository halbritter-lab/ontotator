import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView } from "../../src/api/client";
import { HandleTextChangeDialog } from "../../src/documents/HandleTextChangeDialog";
import { openOnOldText, preview, V2 } from "./textChangeFixtures";

const assignment = { id: 41, workflow_revision: 7 } as AssignmentView;

beforeEach(() => {
  vi.spyOn(api, "previewTextChange").mockResolvedValue(preview({ findings: 3, placed: 2, unplaced: 1 }));
  vi.spyOn(api, "listAssignments").mockResolvedValue([assignment]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(options: Parameters<typeof openOnOldText>[0] = {}) {
  const { row, step } = openOnOldText(options);
  const props = { onClose: vi.fn(), onDone: vi.fn(), onReload: vi.fn(), onDecideReport: vi.fn() };
  render(<HandleTextChangeDialog projectKey="demo" row={row} step={step} {...props} />);
  return props;
}
const dialog = () => screen.getByRole("dialog", { name: "Handle text change: case-112 de" });
const apply = () => within(dialog()).getByRole("button", { name: "Apply" });

describe("HandleTextChangeDialog", () => {
  it("title Handle text change: case-112 de and the three options with Move to v2 preselected", async () => {
    setup();
    expect(within(dialog()).getByText("Tom Reis has an open annotation on v1. The text is now v2.")).toBeDefined();
    const move = screen.getByRole("radio", { name: "Move to v2" }) as HTMLInputElement;
    expect(move.checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Let Tom Reis finish on v1" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "Withdraw" }) as HTMLInputElement).checked).toBe(false);
    await screen.findByText(/could not be placed/);
  });

  it("work from proposals offers only Withdraw, preselected, and asks no preview", async () => {
    const resolve = vi.spyOn(api, "resolveTextChange").mockResolvedValue({} as AssignmentView);
    const props = setup({ mode: "proposals" });
    expect((screen.getByRole("radio", { name: "Withdraw" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("radio", { name: "Move to v2" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Let Tom Reis finish on v1" })).toBeNull();
    expect(within(dialog()).getByText("Tom Reis checks tool proposals that were made for the text of v1. The proposals mark places in that text, so they cannot be moved to v2, and the task cannot either. That is why Withdraw is the only choice.")).toBeDefined();
    expect(within(dialog()).getByText("Next: click Apply to withdraw the task, then assign an annotation of v2.")).toBeDefined();
    expect(api.previewTextChange).not.toHaveBeenCalled();
    fireEvent.click(apply());
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(41, { resolution: "withdrawn", target_document_id: V2, expected_workflow_revision: 7 }));
    expect(props.onDone).toHaveBeenCalledWith("Tom Reis’s task is withdrawn. v2 needs a new annotation.");
  });

  it("a task on a later correction that does not count offers only Withdraw", () => {
    setup({ onVersion: 3 });
    expect((screen.getByRole("radio", { name: "Withdraw" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("radio", { name: "Move to v2" })).toBeNull();
    expect(within(dialog()).getByText(/The correction v3 was not accepted/)).toBeDefined();
  });

  it("shows Checking… then {k} of {m} findings could not be placed from the preview", async () => {
    setup();
    expect(within(dialog()).getByText("Checking…")).toBeDefined();
    expect(await screen.findByText("1 of 3 findings could not be placed and need Tom Reis’s decision.")).toBeDefined();
    expect(screen.queryByText("Checking…")).toBeNull();
    expect(api.previewTextChange).toHaveBeenCalledWith("demo", { assignment_id: 41, target_document_id: V2 });
  });

  it("Apply calls move-to-version, text-change-resolution finish_then_carry or withdrawn", async () => {
    const move = vi.spyOn(api, "moveToVersion").mockResolvedValue({ assignment: {} as AssignmentView, round: null });
    const resolve = vi.spyOn(api, "resolveTextChange").mockResolvedValue({} as AssignmentView);
    let props = setup();
    await screen.findByText(/could not be placed/);
    fireEvent.click(apply());
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Tom Reis continues on v2."));
    expect(move).toHaveBeenCalledWith(41, expect.objectContaining({ target_document_id: V2, expected_workflow_revision: 7, request_id: expect.any(String) }));
    expect(api.listAssignments).toHaveBeenCalledWith("demo", { document_id: "case-112-de-v1" });
    cleanup();

    props = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Let Tom Reis finish on v1" }));
    fireEvent.click(apply());
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(41, { resolution: "finish_then_carry", target_document_id: V2, expected_workflow_revision: 7 }));
    expect(props.onDone).toHaveBeenCalledWith("Tom Reis finishes on v1. The result is carried to v2 when they submit.");
    cleanup();

    props = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Withdraw" }));
    fireEvent.click(apply());
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(41, { resolution: "withdrawn", target_document_id: V2, expected_workflow_revision: 7 }));
    expect(props.onDone).toHaveBeenCalledWith("Tom Reis’s task is withdrawn. v2 needs a new annotation.");
  });

  it("move asks before annotating an unreviewed translation, then resends with the acknowledgement", async () => {
    const move = vi.spyOn(api, "moveToVersion")
      .mockRejectedValueOnce(new ApiError(409, "x", "TRANSLATION_NOT_REVIEWED"))
      .mockResolvedValueOnce({ assignment: {} as AssignmentView, round: null });
    const props = setup();
    await screen.findByText(/could not be placed/);
    fireEvent.click(apply());
    expect(await screen.findByText("Translation not reviewed yet.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Annotate before the review is accepted" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Tom Reis continues on v2."));
    expect(move).toHaveBeenNthCalledWith(1, 41, expect.objectContaining({ confirm_unreviewed_translation: false }));
    expect(move).toHaveBeenNthCalledWith(2, 41, expect.objectContaining({ confirm_unreviewed_translation: true }));
  });

  it("held task shows the paused sentence, a Decide on report… link and no primary", () => {
    const props = setup({ held: true });
    expect(within(dialog()).getByText("Tom Reis’s task is paused by a problem report. Decide the report first.")).toBeDefined();
    expect(within(dialog()).queryByRole("button", { name: "Apply" })).toBeNull();
    expect(within(dialog()).queryByRole("radio")).toBeNull();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Decide on report…" }));
    expect(props.onDecideReport).toHaveBeenCalled();
    expect(api.previewTextChange).not.toHaveBeenCalled();
  });

  it("TEXT_CHANGE_CHANGED shows The text or the task changed. Reloaded. and keeps the choice", async () => {
    vi.spyOn(api, "resolveTextChange").mockRejectedValue(new ApiError(409, "changed", "TEXT_CHANGE_CHANGED"));
    const props = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Withdraw" }));
    fireEvent.click(apply());
    expect(await within(dialog()).findByText("The text or the task changed. Reloaded.")).toBeDefined();
    expect(props.onReload).toHaveBeenCalled();
    expect(props.onDone).not.toHaveBeenCalled();
    expect((screen.getByRole("radio", { name: "Withdraw" }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(api.previewTextChange).toHaveBeenCalledTimes(2));
  });

  it("radio descriptions linked by aria-describedby; Apply uses aria-disabled while busy", async () => {
    let finish: (value: AssignmentView) => void = () => undefined;
    vi.spyOn(api, "resolveTextChange").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    setup();
    const move = screen.getByRole("radio", { name: "Move to v2" });
    const described = (move.getAttribute("aria-describedby") ?? "").split(" ").map(id => document.getElementById(id)?.textContent).join(" ");
    expect(described).toContain("Tom Reis continues on the corrected text. Their draft findings are carried and marked “check after text change”.");
    const withdraw = screen.getByRole("radio", { name: "Withdraw" });
    expect(document.getElementById(withdraw.getAttribute("aria-describedby")!)?.textContent).toBe("Tom Reis’s task ends. Nothing of the draft is carried to v2; v2 needs a new annotation.");
    fireEvent.click(withdraw);
    fireEvent.click(apply());
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBe("true"));
    expect(apply().hasAttribute("disabled")).toBe(false);
    fireEvent.click(apply());
    expect(api.resolveTextChange).toHaveBeenCalledTimes(1);
    finish({} as AssignmentView);
  });
});
