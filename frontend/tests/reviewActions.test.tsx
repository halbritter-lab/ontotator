import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewActions, type TargetProposal } from "../src/editor/ReviewActions";

describe("ReviewActions", () => {
  const sampleTarget: TargetProposal = {
    annotation_id: "prop-1",
    version: "v-prop-1",
    hpo_id: "HP:0001252",
    axes: {
      definition_name: "editor-axes/v1",
      assertion: "present",
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
});
