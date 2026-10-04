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

    expect(screen.getByRole("button", { name: /Bestätigen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Verwerfen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Ändern/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Unsicher/i })).toBeDefined();

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

    expect(screen.getByRole("button", { name: /Bestätigen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Verwerfen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Ändern/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Unsicher/i })).toBeDefined();
  });

  it("calls onDecide with confirmed when clicking Bestätigen", () => {
    const onDecide = vi.fn();

    render(
      <ReviewActions
        target={sampleTarget}
        currentDecision={null}
        draftAnnotations={[]}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Bestätigen/i }));

    expect(onDecide).toHaveBeenCalledWith({
      outcome: "confirmed",
      replacement: undefined,
      note: undefined,
    });
  });

  it("disables Bestätigen when proposal term is obsolete", () => {
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

    const confirmBtn = screen.getByRole("button", { name: /Bestätigen/i });
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Veralteter Begriff kann nicht bestätigt werden/i)).toBeDefined();
  });

  it("indicates active state with aria-pressed on chosen decision button and toggles off to null when clicked again", () => {
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

    const confirmBtn = screen.getByRole("button", { name: /Bestätigen/i });
    const rejectBtn = screen.getByRole("button", { name: /Verwerfen/i });

    expect(confirmBtn.getAttribute("aria-pressed")).toBe("true");
    expect(rejectBtn.getAttribute("aria-pressed")).toBe("false");

    // Clicking already active confirm button toggles it off
    fireEvent.click(confirmBtn);

    expect(onDecide).toHaveBeenCalledWith({
      outcome: null,
      replacement: undefined,
      note: undefined,
    });
  });

  it("renders 'Auswahl aufheben' button when a decision is present and clicking it calls onDecide with outcome null", () => {
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
    expect(screen.queryByRole("button", { name: /Auswahl aufheben/i })).toBeNull();

    // Rerender with decision
    rerender(
      <ReviewActions
        target={sampleTarget}
        currentDecision={rejectedDecision as any}
        draftAnnotations={[]}
        onDecide={onDecide}
      />
    );

    const resetBtn = screen.getByRole("button", { name: /Auswahl aufheben/i });
    expect(resetBtn).toBeDefined();

    fireEvent.click(resetBtn);

    expect(onDecide).toHaveBeenCalledWith({
      outcome: null,
      replacement: undefined,
      note: undefined,
    });
  });
});
