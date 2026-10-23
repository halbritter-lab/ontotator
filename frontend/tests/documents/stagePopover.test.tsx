import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type DocumentRowView } from "../../src/api/client";
import { StagePopover } from "../../src/documents/StagePopover";
import type { StageName } from "../../src/documents/stageLabels";
import { submission, submissions, work } from "./fixtures";
import { ana, cell, stagedRow } from "./tableFixtures";

const NOW = new Date("2026-10-21T12:00:00Z");

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language, {
    submissions: ["ann-0011", "ann-0012", "ann-0013", "ann-0014"].map((author, index) => submission({
      submission_id: `s-${index}`, document_id: "case-108-de", author_label: author, recorded_at: `2026-10-1${index + 1}T10:00:00Z`,
    })),
  }));
});

function row(): DocumentRowView {
  return stagedRow("case-108", "de", {
    stages: { review: cell("accepted", "done", { note: "unchanged" }), annotation: cell("submitted", "done", { submitted: 4, total: 4 }) },
    overrides: {
      work: [
        work({ assignment_id: 1, document_id: "case-108-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana }),
        ...[11, 12, 13, 14].map(id => work({ assignment_id: id, document_id: "case-108-de", status: "submitted", author_label: `ann-00${id}` })),
      ],
    },
  });
}

function Harness({ stage, actions, onOpenDetails = vi.fn(), value = row() }: {
  stage: StageName; actions?: ReactNode; onOpenDetails?: () => void; value?: DocumentRowView;
}): JSX.Element {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button ref={anchor} type="button" onClick={() => setOpen(true)}>Stage cell</button>
    {open && <StagePopover row={value} stage={stage} projectKey="p" anchorRef={anchor} now={NOW} actions={actions}
      onClose={() => setOpen(false)} onOpenDetails={() => { setOpen(false); onOpenDetails(); }} />}
  </>;
}

const openPopover = () => fireEvent.click(screen.getByRole("button", { name: "Stage cell" }));

describe("StagePopover", () => {
  it("lists the stage's 3 newest events, newest first, and no other stage", async () => {
    render(<Harness stage="annotation" />);
    openPopover();
    const dialog = screen.getByRole("dialog", { name: "Annotation activity, case-108 · de" });
    expect(within(dialog).getByText("Loading activity…")).toBeTruthy();
    const list = await within(dialog).findByRole("list", { name: "Latest annotation activity" });
    const items = within(list).getAllByRole("listitem").map(entry => entry.textContent ?? "");
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("ann-0014");
    expect(items[1]).toContain("ann-0013");
    expect(items[2]).toContain("ann-0012");
    expect(dialog.textContent).not.toContain("ann-0011");
    expect(dialog.textContent).not.toContain("Ana Weber");
  });

  it("shows the stage's admin actions and Open full details", () => {
    const onOpenDetails = vi.fn();
    render(<Harness stage="review" onOpenDetails={onOpenDetails} actions={<button type="button">Request correction…</button>} />);
    openPopover();
    const dialog = screen.getByRole("dialog", { name: "Translation activity, case-108 · de" });
    // Review lines need no submissions.
    expect(within(dialog).getAllByRole("listitem")[0].textContent).toContain("Ana Weber");
    expect(api.getRowSubmissions).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Request correction…" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open full details" }));
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when the stage has no activity yet", () => {
    render(<Harness stage="final" />);
    openPopover();
    const dialog = screen.getByRole("dialog", { name: "Finalization activity, case-108 · de" });
    expect(within(dialog).getByText("No finalization activity yet.")).toBeTruthy();
    expect(within(dialog).queryByRole("list")).toBeNull();
  });

  it("Escape closes it and returns focus to the stage cell", () => {
    render(<Harness stage="review" />);
    openPopover();
    const dialog = screen.getByRole("dialog", { name: "Translation activity, case-108 · de" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stage cell" }));
  });

  it("falls back to the work items when the submissions fail", async () => {
    vi.mocked(api.getRowSubmissions).mockRejectedValue(new Error("offline"));
    render(<Harness stage="annotation" />);
    openPopover();
    const list = await screen.findByRole("list", { name: "Latest annotation activity" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });
});
