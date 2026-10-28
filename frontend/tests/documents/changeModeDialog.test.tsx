import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type ModeChangePreview, type ModeChangeView } from "../../src/api/client";
import { affectedLine, affectedPeople, ChangeModeDialog, ModeChangeNotice, RestoreModeDialog } from "../../src/documents/ChangeModeDialog";

const anne = { pseudonym: "ann-0001", display_name: "Anne Notator", is_me: false };
const arne = { pseudonym: "ann-0002", display_name: "Arne Notator", is_me: false };
const row = { case_id: "case-7", language: "de" };

const preview = (overrides: Partial<ModeChangePreview> = {}): ModeChangePreview => ({
  case_id: "case-7", language: "de", from_mode: "proposals", to_mode: "scratch", revision: 4,
  submissions: [{ submission_id: "sub-anne", document_id: "case-7-de", mode: "proposal_check", recorded_at: "2026-10-20T10:00:00Z", author: anne }],
  assignments: [
    { assignment_id: 11, document_id: "case-7-de", task: "annotate", status: "submitted", person: anne },
    { assignment_id: 12, document_id: "case-7-de", task: "annotate", status: "in_progress", person: arne },
  ],
  ...overrides,
});

const change = (overrides: Partial<ModeChangeView> = {}): ModeChangeView => ({
  change_id: 3, case_id: "case-7", language: "de", from_mode: "proposals", to_mode: "scratch", reason: "wrong model",
  changed_at: "2026-10-21T09:00:00Z", changed_by: { pseudonym: "lead-1", display_name: "Lea Lead", is_me: true },
  restored_at: null, restored_by: null, revoked_assignment_ids: [11, 12],
  submissions: preview().submissions, restorable: true, restore_blocked: null, ...overrides,
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(found: ModeChangePreview = preview()) {
  vi.spyOn(api, "previewModeChange").mockResolvedValue(found);
  const props = { onCancel: vi.fn(), onChanged: vi.fn() };
  render(<ChangeModeDialog projectKey="demo" row={row} mode="scratch" revision={4} {...props} />);
  return props;
}
const dialog = () => screen.getByRole("dialog", { name: "Change annotation of case-7 de to from scratch?" });
const confirmButton = () => within(dialog()).getByRole("button", { name: "Discard work and change mode" });

describe("affectedPeople", () => {
  it("groups by person, submitted work first", () => {
    const people = affectedPeople(preview());
    expect(people.map(affectedLine)).toEqual([
      "Anne Notator: 1 submission is discarded.",
      "Arne Notator: the unsubmitted assignment is removed.",
    ]);
  });
  it("names consolidations", () => {
    const people = affectedPeople(preview({
      submissions: [{ submission_id: "c", document_id: "d", mode: "review", recorded_at: "2026-10-20T10:00:00Z", author: arne }],
      assignments: [],
    }));
    expect(affectedLine(people[0])).toBe("Arne Notator: 1 consolidation is discarded.");
  });
});

describe("ChangeModeDialog", () => {
  it("names whose submitted work is discarded before anything is sent", async () => {
    const send = vi.spyOn(api, "changeMode");
    setup();
    expect(await within(dialog()).findByText("Submitted work of 1 person is discarded:")).toBeDefined();
    const list = within(dialog()).getByRole("list", { name: "Affected people" });
    expect(within(list).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "Anne Notator: 1 submission is discarded.",
      "Arne Notator: the unsubmitted assignment is removed.",
    ]);
    expect(api.previewModeChange).toHaveBeenCalledWith("demo", { case_id: "case-7", language: "de", mode: "scratch" });
    expect(send).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const send = vi.spyOn(api, "changeMode");
    setup();
    await within(dialog()).findByText(/is discarded/, { selector: "li" });
    fireEvent.click(confirmButton());
    expect(await within(dialog()).findByText("Give a reason for the change.")).toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the exact submissions it warned about", async () => {
    const result = { change: change(), revision: 5 };
    const send = vi.spyOn(api, "changeMode").mockResolvedValue(result);
    const props = setup();
    await within(dialog()).findByText(/is discarded/, { selector: "li" });
    fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: " wrong model " } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onChanged).toHaveBeenCalledWith(result.change, 5));
    expect(send).toHaveBeenCalledWith("demo", {
      case_id: "case-7", language: "de", mode: "scratch", reason: "wrong model",
      expected_revision: 4, expected_submission_ids: ["sub-anne"],
    });
  });

  it("shows the new list when the work changed since the warning", async () => {
    const newer = preview({ submissions: [...preview().submissions,
      { submission_id: "sub-arne", document_id: "case-7-de", mode: "proposal_check", recorded_at: "2026-10-21T10:00:00Z", author: arne }] });
    vi.spyOn(api, "changeMode").mockRejectedValue(new ApiError(409, "stale", "MODE_CHANGE_STALE", newer as unknown as Record<string, unknown>));
    const props = setup();
    await within(dialog()).findByText(/is discarded/, { selector: "li" });
    fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: "x" } });
    fireEvent.click(confirmButton());
    expect(await within(dialog()).findByText("The work on this text changed. Check the new list before you change the mode.")).toBeDefined();
    expect(within(dialog()).getByText("Submitted work of 2 people is discarded:")).toBeDefined();
    expect(within(dialog()).getByText("Arne Notator: 1 submission is discarded.")).toBeDefined();
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it("without submitted work it only removes assignments", async () => {
    setup(preview({ submissions: [] }));
    expect(await within(dialog()).findByText("No submitted work is discarded.")).toBeDefined();
    expect(within(dialog()).getByRole("button", { name: "Change mode" })).toBeDefined();
  });

  it("Cancel sends nothing", async () => {
    const send = vi.spyOn(api, "changeMode");
    const props = setup();
    await within(dialog()).findByText(/is discarded/, { selector: "li" });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("restore", () => {
  it("RestoreModeDialog restores with the plan revision", async () => {
    const restored = { change: change({ restored_at: "2026-10-22T09:00:00Z", restorable: false }), revision: 6 };
    const send = vi.spyOn(api, "restoreModeChange").mockResolvedValue(restored);
    const onRestored = vi.fn();
    render(<RestoreModeDialog projectKey="demo" change={change()} revision={5} onCancel={vi.fn()} onRestored={onRestored} />);
    const box = screen.getByRole("dialog", { name: "Restore discarded work?" });
    expect(within(box).getByText("The work of Anne Notator counts again.")).toBeDefined();
    expect(within(box).getByText("2 removed assignments come back.")).toBeDefined();
    fireEvent.click(within(box).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restored.change, 6));
    expect(send).toHaveBeenCalledWith("demo", 3, 5);
  });

  it("ModeChangeNotice loads only when work was discarded and offers Restore…", async () => {
    const list = vi.spyOn(api, "listModeChanges").mockResolvedValue({ case_id: "case-7", language: "de", changes: [change()] });
    const mode = { mode: "scratch" as const, source: "plan" as const, locked: false, override: "scratch" as const, proposal_count: 3 };
    const { rerender } = render(<ModeChangeNotice projectKey="demo" row={{ ...row, annotation_mode: { ...mode, discarded_count: 0 } }} revision={5} onChanged={vi.fn()} now={new Date("2026-10-28T00:00:00Z")} />);
    expect(list).not.toHaveBeenCalled();
    rerender(<ModeChangeNotice projectKey="demo" row={{ ...row, annotation_mode: { ...mode, discarded_count: 1 } }} revision={5} onChanged={vi.fn()} now={new Date("2026-10-28T00:00:00Z")} />);
    expect(await screen.findByText("Mode changed to from scratch on 21 Oct; discarded work of Anne Notator.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Restore…" }));
    expect(screen.getByRole("dialog", { name: "Restore discarded work?" })).toBeDefined();
  });

  it("ModeChangeNotice says why it cannot restore", async () => {
    vi.spyOn(api, "listModeChanges").mockResolvedValue({ case_id: "case-7", language: "de", changes: [change({ restorable: false, restore_blocked: "ANNOTATION_MODE_LOCKED" })] });
    render(<ModeChangeNotice projectKey="demo" row={{ ...row, annotation_mode: { mode: "scratch", source: "locked", locked: true, override: "scratch", proposal_count: 3, discarded_count: 1 } }} revision={5} onChanged={vi.fn()} />);
    expect(await screen.findByText("New annotation work has started, so the discarded work cannot be restored.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Restore…" })).toBeNull();
  });
});
