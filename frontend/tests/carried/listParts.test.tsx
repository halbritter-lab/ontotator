import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CarriedInputLike, CarriedState, CheckVariant, ResolutionLike } from "../../src/editor/carried/checkState";
import { CarriedProgress } from "../../src/editor/carried/CarriedProgress";
import { CarriedRowExtras } from "../../src/editor/carried/CarriedRowExtras";
import { PlaceholderRow } from "../../src/editor/carried/PlaceholderRow";

const input: CarriedInputLike = {
  input_id: "in-1",
  source_submission_id: "sub-1",
  source_snapshot: { annotation: { annotation_id: "a-1", layer_id: "hpo", type_id: "phenotype", term_id: "HP:0001250" }, version: "v1" },
  target_snapshot: null,
  mapping_status: "needs_review",
  source_round_ordinal: 2,
};

function stateOf(variant: CheckVariant, resolution?: ResolutionLike): CarriedState {
  const unchecked = variant === "needed" || variant === "changed" || variant === "removed";
  return { input, index: 0, variant, unchecked, resolution, home: "placeholder", homeId: null, carriedId: null, missing: "mapping_failed" };
}

describe("CarriedRowExtras", () => {
  it.each([
    ["needed", "Check needed"],
    ["changed", "Check needed"],
    ["removed", "Check needed"],
    ["checked", "Checked"],
    ["dismissed", "Dismissed"],
  ] as const)("badge_text_%s", (variant, text) => {
    render(<CarriedRowExtras state={stateOf(variant)} sourceOrdinal={2} instruction={null} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("shows_the_changed_and_removed_lines", () => {
    const { rerender } = render(<CarriedRowExtras state={stateOf("changed")} sourceOrdinal={2} instruction={null} />);
    expect(screen.getByText("Changed after your check")).toBeTruthy();
    rerender(<CarriedRowExtras state={stateOf("removed")} sourceOrdinal={2} instruction={null} />);
    expect(screen.getByText("The linked finding was deleted")).toBeTruthy();
    expect(screen.queryByText("Changed after your check")).toBeNull();
  });

  it("meta_line_for_carried_and_linked_rows", () => {
    const { rerender } = render(<CarriedRowExtras state={stateOf("checked")} sourceOrdinal={2} instruction={null} />);
    expect(screen.getByText("Carried from Round 2")).toBeTruthy();
    rerender(<CarriedRowExtras state={stateOf("checked")} sourceOrdinal={2} instruction={null} linked={[{ term: "Seizure", sourceOrdinal: 2 }]} />);
    expect(screen.getByText("Linked to carried Seizure (Round 2)")).toBeTruthy();
    rerender(
      <CarriedRowExtras
        state={stateOf("checked")}
        sourceOrdinal={2}
        instruction={null}
        linked={[{ term: "Seizure", sourceOrdinal: 2 }, { term: "Fever", sourceOrdinal: 2 }]}
      />,
    );
    expect(screen.getByText("Linked to 2 carried findings")).toBeTruthy();
  });

  it("instruction_only_while_unchecked", () => {
    const instruction = "Check the marked text and the values.";
    const { container, rerender } = render(<CarriedRowExtras state={stateOf("needed")} sourceOrdinal={2} instruction={instruction} />);
    expect(container.querySelector("p.carried-instruction")?.textContent).toBe(instruction);
    rerender(<CarriedRowExtras state={stateOf("checked")} sourceOrdinal={2} instruction={instruction} />);
    expect(screen.queryByText(instruction)).toBeNull();
  });
});

describe("PlaceholderRow", () => {
  const instruction = "Could not be placed on this text. Mark it again, link it or dismiss it.";

  it("is_a_named_button_row", () => {
    const { container } = render(
      <ul><PlaceholderRow state={stateOf("needed")} termLabel={<span>Seizure</span>} termText="Seizure" instruction={instruction} selected={false} onActivate={() => {}} /></ul>,
    );
    const row = screen.getByRole("button", { name: "Seizure, carried, not on this text, check needed" });
    expect(row.getAttribute("data-list-key")).toBe("input:in-1");
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(row.classList.contains("doc-item")).toBe(true);
    expect(screen.getByText("Not on this text")).toBeTruthy();
    expect(screen.getByText("Check needed")).toBeTruthy();
    expect(container.querySelector("p.carried-instruction")?.textContent).toBe(instruction);
  });

  it("enter_space_and_click_activate", () => {
    const onActivate = vi.fn();
    render(<ul><PlaceholderRow state={stateOf("needed")} termLabel="Seizure" termText="Seizure" instruction={instruction} selected onActivate={onActivate} /></ul>);
    const row = screen.getByRole("button", { name: /Seizure, carried/ });
    expect(row.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "a" });
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it("dismissed_row_is_muted_with_truncated_reason", () => {
    const reason = "x".repeat(70);
    render(
      <ul>
        <PlaceholderRow
          state={stateOf("dismissed", { input_id: "in-1", outcome: "dismissed", reason })}
          termLabel="Seizure"
          termText="Seizure"
          instruction={null}
          selected={false}
          onActivate={() => {}}
        />
      </ul>,
    );
    const row = screen.getByRole("button", { name: "Seizure, carried, not on this text, dismissed" });
    expect(row.classList.contains("is-muted")).toBe(true);
    expect(screen.getByText(`Dismissed: ${"x".repeat(60)}`)).toBeTruthy();
    expect(row.querySelector("p.carried-instruction")).toBeNull();
  });

  it("truncates_by_code_points", () => {
    const reason = "😀".repeat(61);
    render(
      <ul>
        <PlaceholderRow state={stateOf("dismissed", { input_id: "in-1", outcome: "dismissed", reason })} termLabel="Seizure" termText="Seizure" instruction={null} selected={false} onActivate={() => {}} />
      </ul>,
    );
    expect(screen.getByText(`Dismissed: ${"😀".repeat(60)}`)).toBeTruthy();
  });

  it("linked_placeholder_names_the_finding", () => {
    render(<ul><PlaceholderRow state={stateOf("checked")} termLabel="Seizure" termText="Seizure" instruction={null} selected={false} onActivate={() => {}} linkedTo="Focal seizure" /></ul>);
    expect(screen.getByRole("button", { name: "Seizure, carried, not on this text, checked" })).toBeTruthy();
    expect(screen.getByText("Linked to Focal seizure")).toBeTruthy();
  });
});

describe("CarriedProgress", () => {
  it("status_text_and_next_button", () => {
    const onNext = vi.fn();
    const { rerender } = render(<CarriedProgress text="0 of 1 checked" showNext onNext={onNext} />);
    expect(screen.getByRole("status").textContent).toBe("0 of 1 checked");
    const next = screen.getByRole("button", { name: /Next unchecked/ });
    expect(next.querySelector("kbd")?.textContent).toBe("N");
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
    rerender(<CarriedProgress text="All carried findings checked" showNext={false} onNext={onNext} />);
    expect(screen.getByRole("status").textContent).toBe("All carried findings checked");
    expect(screen.getByRole("status").querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Next unchecked/ })).toBeNull();
  });
});
