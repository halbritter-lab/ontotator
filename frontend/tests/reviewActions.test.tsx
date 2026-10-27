import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewActions, type TargetProposal } from "../src/editor/ReviewActions";

describe("ReviewActions", () => {
  it("explains the immutable default rule conflict without changing an unresolved decision", () => {
    const decide = vi.fn();
    render(<ReviewActions target={{ ...sampleTarget, axes_values: { experiencer: "patient" }, axes_defaulted: ["experiencer"] }} requireChosenAxes
      currentDecision={{ decision_id: "d", target: { annotation_id: "prop-1", version: "v-prop-1" }, outcome: "uncertain", reviewer_id: "r", note: "Specialist input needed" }} draftAnnotations={[]} onDecide={decide} />);
    expect(screen.getByRole("alert").textContent).toContain("still block submission");
    expect(screen.queryByRole("button", { name: /Confirm Experiencer/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Reviewer note" })).toHaveProperty("value", "Specialist input needed");
    expect(decide).not.toHaveBeenCalled();
  });
  it("keeps unresolved intent separate from a confirmed decision until explicitly saved", () => {
    vi.useFakeTimers();
    try {
      const decide = vi.fn();
      render(<ReviewActions target={sampleTarget} currentDecision={{ decision_id: "d", target: { annotation_id: "prop-1", version: "v-prop-1" }, outcome: "confirmed", reviewer_id: "r", note: "Saved" }} draftAnnotations={[]} onDecide={decide} />);
      fireEvent.click(screen.getByRole("button", { name: /^Unresolved/ }));
      const note = screen.getByRole("textbox", { name: "Reviewer note" });
      fireEvent.change(note, { target: { value: "Needs specialist review" } });
      act(() => { vi.advanceTimersByTime(1000); }); fireEvent.blur(note);
      expect(decide).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
      expect(decide).toHaveBeenCalledTimes(1);
      expect(decide).toHaveBeenCalledWith({ outcome: "uncertain", replacement: undefined, note: "Needs specialist review" });
    } finally { vi.useRealTimers(); }
  });
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
    expect(screen.getByRole("button", { name: /Unresolved/i })).toBeDefined();

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
    expect(screen.getByRole("button", { name: /Unresolved/i })).toBeDefined();
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
    expect(screen.getByText("Obsolete terms cannot be submitted, including as unresolved. Reject this proposal or replace it with a valid term.")).toBeDefined();
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

  it.each([ ["confirmed", "Confirm"], ["rejected", "Reject"], ["uncertain", "Unresolved"] ])(
    "repeated %s clicks preserve the chosen outcome and reviewer note", (outcome, label) => {
      const onDecide = vi.fn();
      render(<ReviewActions target={sampleTarget} draftAnnotations={[]} onDecide={onDecide}
        currentDecision={{ decision_id: "decision", target: { annotation_id: "prop-1", version: "v-prop-1" },
          outcome, reviewer_id: "reviewer", note: "Keep this note" } as any} />);
      const button = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      fireEvent.click(button);
      if (outcome === "uncertain") fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
      fireEvent.click(button);
      if (outcome === "uncertain") fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
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
    expect(screen.getByLabelText("AI-generated: model-a, automated")).toBeDefined();
    expect(document.querySelector(".review-actions__origin")!.textContent).toBe("AI Source: model-a (tool)");

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
  it("puts the decision buttons before the collapsed source and rules", () => {
    render(<ReviewActions target={{ ...sampleTarget, axes_defaulted: ["assertion"] }} currentDecision={null} draftAnnotations={[]} onDecide={vi.fn()} />);
    const confirm = screen.getByRole("button", { name: /Confirm/ });
    const more = screen.getByText("Source and rules").closest("details")!;
    expect(more.open).toBe(false);
    expect(confirm.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(more.textContent).toContain("This proposal is immutable: its defaulted values cannot be confirmed. Unresolved keeps them.");
    // IDs and the version hash sit in a closed "Technical details" inside (#48 N-21).
    const technical = within(more).getByText("Technical details").closest("details")!;
    expect(technical.open).toBe(false);
    expect(technical.textContent).toContain("v-prop-1");
    expect(more.textContent).toContain("Method");
    expect(more.textContent).toContain("v-prop-1");
    // R-17: the last block of the review, pinned to the pane's bottom by CSS.
    expect(more.parentElement!.lastElementChild).toBe(more);
  });
  it("requires and focuses a reviewer note before setting unresolved", () => {
    const decide = vi.fn();
    render(<ReviewActions target={sampleTarget} currentDecision={null} draftAnnotations={[]} onDecide={decide} />);
    fireEvent.click(screen.getByRole("button", { name: /Unresolved/ }));
    const input = screen.getByRole("textbox", { name: "Reviewer note" });
    expect(decide).not.toHaveBeenCalled(); expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true"); expect(input.hasAttribute("required")).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("reviewer note is required");
    fireEvent.change(input, { target: { value: "  Need specialist input  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
    expect(decide).toHaveBeenCalledWith({ outcome: "uncertain", replacement: undefined, note: "Need specialist input" });
    expect(screen.getByText("Source and rules").closest("details")!.textContent).toContain("Unresolved is a reviewer flag, not clinical uncertainty; it needs a note.");
  });

  it("honors a parent note request and preserves the controlled draft on reset", () => {
    const decide = vi.fn(); const noteChange = vi.fn();
    const decision = { decision_id: "d", target: { annotation_id: "prop-1", version: "v-prop-1" },
      outcome: "confirmed" as const, reviewer_id: "r" };
    const props = { target: sampleTarget, currentDecision: decision, draftAnnotations: [], onDecide: decide, onNoteChange: noteChange };
    const { rerender } = render(<ReviewActions {...props} note="" />);
    rerender(<ReviewActions {...props} note="" requireNote />);
    const input = screen.getByRole("textbox", { name: "Reviewer note" });
    expect(document.activeElement).toBe(input); expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "  Local draft  " } });
    expect(noteChange).toHaveBeenCalledWith("  Local draft  ");
    rerender(<ReviewActions {...props} note="  Local draft  " requireNote />);
    fireEvent.click(screen.getByRole("button", { name: /Reset decision/ }));
    expect(decide).toHaveBeenCalledWith({ outcome: null, replacement: undefined, note: undefined });
    expect((input as HTMLInputElement).value).toBe("  Local draft  ");
  });

  it("keeps a blank unresolved note locally without sending an invalid save", () => {
    vi.useFakeTimers();
    try {
      const decide = vi.fn();
      render(<ReviewActions target={sampleTarget} currentDecision={{ decision_id: "d", target: { annotation_id: "prop-1", version: "v-prop-1" },
        outcome: "uncertain", reviewer_id: "r", note: "Saved note" }} draftAnnotations={[]} onDecide={decide} />);
      const input = screen.getByRole("textbox", { name: "Reviewer note" });
      fireEvent.change(input, { target: { value: "  " } });
      act(() => { vi.advanceTimersByTime(1000); }); fireEvent.blur(input);
      expect(decide).not.toHaveBeenCalled(); expect((input as HTMLInputElement).value).toBe("  ");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(screen.queryByText(/saved automatically/)).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("flushes a delayed note only to its original exact target on rapid selection", () => {
    vi.useFakeTimers();
    try {
      const first = vi.fn(); const second = vi.fn();
      const decision = { decision_id: "d", target: { annotation_id: "prop-1", version: "v-prop-1" },
        outcome: "confirmed" as const, reviewer_id: "r", note: "Saved first" };
      const { rerender } = render(<ReviewActions target={sampleTarget} currentDecision={decision} draftAnnotations={[]} onDecide={first} />);
      fireEvent.change(screen.getByRole("textbox", { name: "Reviewer note" }), { target: { value: "Draft first" } });
      rerender(<ReviewActions target={{ ...sampleTarget, annotation_id: "second", version: "second-version" }}
        currentDecision={{ ...decision, target: { annotation_id: "second", version: "second-version" }, note: "Saved second" }}
        draftAnnotations={[]} onDecide={second} />);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(first).toHaveBeenCalledWith({ outcome: "confirmed", replacement: undefined, note: "Draft first" });
      expect(second).not.toHaveBeenCalled();
      expect((screen.getByRole("textbox", { name: "Reviewer note" }) as HTMLInputElement).value).toBe("Saved second");
    } finally { vi.useRealTimers(); }
  });

  it("offers direct editing without a second manual replacement selector", () => {
    const adopt = vi.fn(); const decide = vi.fn();
    render(<ReviewActions target={sampleTarget} currentDecision={null} onDecide={decide} onAdoptAndEdit={adopt} note="Keep this note"
      draftAnnotations={[{ annotation: { annotation_id: "own", term_id: "HP:0001252" }, version: "v1" } as any]} />);
    expect(screen.queryByRole("button", { name: /Assign replacement from draft/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /replacement/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Edit & Replace/ }));
    expect(adopt).toHaveBeenCalledOnce(); expect(decide).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Reviewer note" }) as HTMLInputElement).value).toBe("Keep this note");
  });

});

describe("ReviewActions: modifiers of a proposal (DN-9 A)", () => {
  const TEXT = "Sehr schwere Krampfanfälle.";
  const target: TargetProposal = { annotation_id: "p", version: "v", term_id: "HP:0001250", provenance: { actor: { actor_id: "tool", kind: "tool" }, method: "automated" }, evidence_count: 1 };
  const source = (modifiers: unknown[]) => ({ schema_version: "ontotator-annotation/v3", version: "v", document_id: "d", text_sha256: "t", ontology_sha256: "o", layer_config_sha256: "l", evidence: [],
    annotation: { annotation_id: "p", document_id: "d", layer_id: "hpo", type_id: "t", term_id: "HP:0001250", axes_values: {}, modifiers,
      provenance: { actor: { actor_id: "tool", kind: "tool" }, method: "automated" } } }) as any;
  const info = (id: string) => id === "HP:0012828" ? { label: "Severe", role: "modifier" as const, exclusiveClass: "severity" as const } : undefined;

  it("shows the read-only chip list without actions", () => {
    render(<ReviewActions target={target} termLabel="Seizure" source={source([{ term_id: "HP:0012828", segments: [{ start: 5, end: 12 }] }])}
      documentText={TEXT} termInfo={info} currentDecision={null} draftAnnotations={[]} onDecide={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Modifiers of Seizure" });
    expect(list.textContent).toBe("Severe “schwere”");
    expect(screen.queryByRole("button", { name: /Actions, Severe/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add modifier…" })).toBeNull();
  });

  it("shows no Modifiers section without modifiers", () => {
    render(<ReviewActions target={target} termLabel="Seizure" source={source([])} documentText={TEXT} termInfo={info}
      currentDecision={null} draftAnnotations={[]} onDecide={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Modifiers" })).toBeNull();
  });
  it("shows the proposal's axis values as colour-coded chips, Defaulted stays a marker (F6)", () => {
    const { container } = render(<ReviewActions target={{ annotation_id: "prop-1", version: "v1", provenance: null, evidence_count: 0,
      axes_values: { assertion: "absent", experiencer: "patient" }, axes_defaulted: ["experiencer"] }}
      currentDecision={null} draftAnnotations={[]} onDecide={vi.fn()} />);
    const chips = [...container.querySelectorAll(".axis-list .axis-value")];
    expect(chips.map(chip => [chip.textContent, chip.className])).toEqual([["Absent", "axis-value axis-value--absent"], ["Patient", "axis-value axis-value--patient"]]);
    expect(chips[1].parentElement!.querySelector(".badge")!.textContent).toBe("Defaulted");
  });
  it("makes each quote of a multi-mention proposal a button that shows its mention (F5)", () => {
    const show = vi.fn();
    const ev = (id: string, start: number, end: number) => ({ version: "e1", mention: { evidence_id: id, annotation_id: "prop-1", segments: [{ start, end }] } }) as any;
    const evidence = [ev("m1", 0, 8), ev("m2", 13, 21)];
    const { rerender } = render(<ReviewActions target={{ annotation_id: "prop-1", version: "v1", provenance: null, evidence_count: 2 }} evidence={evidence} documentText="bleeding and bleeding" onShowMention={show}
      currentDecision={null} draftAnnotations={[]} onDecide={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show mention 2: “bleeding”" }));
    expect(show).toHaveBeenCalledWith(evidence[1]);
    rerender(<ReviewActions target={{ annotation_id: "prop-1", version: "v1", provenance: null, evidence_count: 2 }} evidence={[evidence[0]]} documentText="bleeding and bleeding" onShowMention={show}
      currentDecision={null} draftAnnotations={[]} onDecide={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Show mention/ })).toBeNull();
  });
});
