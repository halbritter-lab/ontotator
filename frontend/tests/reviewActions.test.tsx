import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewActions, type TargetProposal } from "../src/editor/ReviewActions";

describe("ReviewActions", () => {
  const sampleTarget: TargetProposal = {
    annotation_id: "prop-1",
    version: "v-prop-1",
    term_id: "HP:0001252",
    axes: {
      definition_name: "editor-axes/v1",
      values: {
        assertion: "present",
      },
    },
    provenance: {
      actor: { actor_id: "model-a", kind: "tool" },
      method: "automated",
    },
    evidence_count: 1,
    is_obsolete: false,
  };

  it("renders 4 origin-neutral action buttons identically for human and tool proposals", () => {
    const onDecide = vi.fn();

    const { rerender } = render(
      <ReviewActions
        target={sampleTarget}
        currentDecision={null}
        draftAnnotations={[]}
        onDecide={onDecide}
      />
    );

    expect(screen.getByRole("button", { name: /Confirm|Bestätigen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject|Verwerfen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Edit|Ändern/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Uncertain|Unsicher/i })).toBeDefined();

    // Rerender with human provenance
    const humanTarget: TargetProposal = {
      ...sampleTarget,
      provenance: {
        actor: { actor_id: "dr-meier", kind: "human" },
        method: "manual",
      },
    };

    rerender(
      <ReviewActions
        target={humanTarget}
        currentDecision={null}
        draftAnnotations={[]}
        onDecide={onDecide}
      />
    );

    expect(screen.getByRole("button", { name: /Confirm|Bestätigen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject|Verwerfen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Edit|Ändern/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Uncertain|Unsicher/i })).toBeDefined();
  });

  it("calls onDecide with confirmed when clicking Bestätigen/Confirm", () => {
    const onDecide = vi.fn();

    render(
      <ReviewActions
        target={sampleTarget}
        currentDecision={null}
        draftAnnotations={[]}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Confirm|Bestätigen/i }));

    expect(onDecide).toHaveBeenCalledWith({
      outcome: "confirmed",
      replacement: undefined,
      note: undefined,
    });
  });

  it("disables Bestätigen/Confirm when proposal term is obsolete", () => {
    const obsoleteTarget: TargetProposal = {
      ...sampleTarget,
      is_obsolete: true,
    };

    render(
      <ReviewActions
        target={obsoleteTarget}
        currentDecision={null}
        draftAnnotations={[]}
        onDecide={vi.fn()}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: /Confirm|Bestätigen/i });
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Obsolete term|Veralteter Begriff/i)).toBeDefined();
  });

  it("keeps the chosen outcome when its button is clicked again", () => {
    const onDecide = vi.fn();
    const confirmedDecision = {
      decision_id: "dec-1",
      target: { annotation_id: sampleTarget.annotation_id, version: sampleTarget.version },
      outcome: "confirmed",
      reviewer_id: "rev-1",
    };

    render(
      <ReviewActions
        target={sampleTarget}
        currentDecision={confirmedDecision as any}
        draftAnnotations={[]}
        onDecide={onDecide}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: /Confirm|Bestätigen/i });
    const rejectBtn = screen.getByRole("button", { name: /Reject|Verwerfen/i });

    expect(confirmBtn.getAttribute("aria-pressed")).toBe("true");
    expect(rejectBtn.getAttribute("aria-pressed")).toBe("false");

    // Repeating the explicit choice never resets it
    fireEvent.click(confirmBtn);

    expect(onDecide).toHaveBeenCalledWith({
      outcome: "confirmed",
      replacement: undefined,
      note: undefined,
    });
  });

  it.each([ ["confirmed", "Confirm"], ["rejected", "Reject"], ["uncertain", "Uncertain"] ])(
    "repeated %s clicks preserve the chosen outcome and reviewer note", (outcome, label) => {
      const onDecide = vi.fn();
      render(<ReviewActions target={sampleTarget} draftAnnotations={[]} onDecide={onDecide}
        currentDecision={{ decision_id: "decision", target: { annotation_id: "prop-1", version: "v-prop-1" },
          outcome, reviewer_id: "reviewer", note: "Keep this note" } as any} />);
      const button = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      fireEvent.click(button); fireEvent.click(button);
      expect(onDecide.mock.calls.map(([payload]) => payload)).toEqual([
        { outcome, replacement: undefined, note: "Keep this note" },
        { outcome, replacement: undefined, note: "Keep this note" },
      ]);
    });

  it("continues the recorded replacement when editing an already changed proposal", () => {
    const edit = vi.fn(); const adopt = vi.fn();
    render(<ReviewActions target={sampleTarget} draftAnnotations={[]} onDecide={vi.fn()}
      onEditReplacement={edit} onAdoptAndEdit={adopt}
      currentDecision={{ decision_id: "decision", target: { annotation_id: "prop-1", version: "v-prop-1" },
        outcome: "changed", reviewer_id: "reviewer", replacement: { annotation_id: "exact-copy", version: "exact-version" } }} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/ }));
    expect(edit).toHaveBeenCalledWith("exact-copy"); expect(adopt).not.toHaveBeenCalled();
  });

  it("renders 'Reset decision' button when a decision is present and clicking it calls onDecide with outcome null", () => {
    const onDecide = vi.fn();
    const rejectedDecision = {
      decision_id: "dec-2",
      target: { annotation_id: sampleTarget.annotation_id, version: sampleTarget.version },
      outcome: "rejected",
      reviewer_id: "rev-1",
    };

    const { rerender } = render(
      <ReviewActions
        target={sampleTarget}
        currentDecision={null}
        draftAnnotations={[]}
        onDecide={onDecide}
      />
    );

    // When there is no decision, reset button should not be present
    expect(screen.queryByRole("button", { name: /Reset decision|Auswahl aufheben/i })).toBeNull();

    // Rerender with decision
    rerender(
      <ReviewActions
        target={sampleTarget}
        currentDecision={rejectedDecision as any}
        draftAnnotations={[]}
        onDecide={onDecide}
      />
    );

    const resetBtn = screen.getByRole("button", { name: /Reset decision|Auswahl aufheben/i });
    expect(resetBtn).toBeDefined();

    fireEvent.click(resetBtn);

    expect(onDecide).toHaveBeenCalledWith({
      outcome: null,
      replacement: undefined,
      note: undefined,
    });
  });

  it("marks tool proposals with the AI badge next to the written-out source", () => {
    const { rerender } = render(
      <ReviewActions target={sampleTarget} currentDecision={null} draftAnnotations={[]} onDecide={vi.fn()} />
    );
    expect(screen.getByLabelText("AI-generated: model-a · automated")).toBeDefined();
    expect(screen.getByText(/Method: automated/)).toBeDefined();

    rerender(
      <ReviewActions
        target={{ ...sampleTarget, provenance: { actor: { actor_id: "dr-weber", kind: "human" }, method: "manual" } }}
        currentDecision={null}
        draftAnnotations={[]}
        onDecide={vi.fn()}
      />
    );
    expect(screen.queryByText("AI")).toBeNull();
  });
});
