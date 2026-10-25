import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModifierAsFindingNotice } from "../src/editor/ModifierAsFindingNotice";

afterEach(cleanup);

describe("ModifierAsFindingNotice", () => {
  it("names the modifier and offers “Turn into modifier…”", () => {
    const onTurn = vi.fn();
    const { container } = render(<ModifierAsFindingNotice term="Severe" readOnly={false} onTurn={onTurn} />);
    expect(screen.getByText("Severe is a modifier. Turn it into a modifier of another finding.")).toBeDefined();
    const button = screen.getByRole("button", { name: "Turn into modifier…" });
    expect(container.querySelector("[data-turn-into-modifier]")).toBe(button);
    fireEvent.click(button);
    expect(onTurn).toHaveBeenCalledTimes(1);
  });

  it("read-only shows the text without the button", () => {
    render(<ModifierAsFindingNotice term="Severe" readOnly onTurn={vi.fn()} />);
    expect(screen.getByText("Severe is a modifier. Turn it into a modifier of another finding.")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
