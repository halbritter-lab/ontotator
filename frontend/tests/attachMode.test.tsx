import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachModePanel, type AttachModePanelProps } from "../src/editor/AttachModePanel";

const SEIZURE = { annotationId: "seizure", term: "Seizure", termId: "HP:0001250", segments: [{ start: 19, end: 32 }], quote: "Krampfanfälle", distance: 1, after: true };

const renderPanel = (props: Partial<AttachModePanelProps> = {}) => {
  const all: AttachModePanelProps = {
    termLabel: "Severe", termId: "HP:0012828", markQuote: "schwere", nearest: SEIZURE, focused: null,
    existing: () => undefined, noFindings: false, onAttach: vi.fn(), onReplace: vi.fn(), onCancel: vi.fn(), ...props,
  };
  render(<AttachModePanel {...all} />);
  return all;
};

afterEach(cleanup);

describe("AttachModePanel", () => {
  it("names the modifier, the nearest finding and attaches to it", () => {
    const props = renderPanel();
    const region = screen.getByRole("region", { name: "Attach Severe" });
    expect(region.querySelector("h2")!.textContent).toBe("SevereModifier");
    expect(screen.getByText("HP:0012828 · “schwere”")).toBeDefined();
    expect(screen.getByText("Severe describes a finding. Choose it in the findings list or in the text.")).toBeDefined();
    expect(screen.getByText("Nearest in this sentence:").parentElement!.textContent).toBe("Nearest in this sentence: Seizure · “Krampfanfälle”");
    fireEvent.click(screen.getByRole("button", { name: "Attach to Seizure" }));
    expect(props.onAttach).toHaveBeenCalledWith("seizure");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("without a nearest finding: the line and no Attach button", () => {
    renderPanel({ nearest: null });
    expect(screen.getByText("No finding in this sentence. Choose one in the findings list or in the text.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Attach to/ })).toBeNull();
  });

  it("links the mark when the finding has the term without a span", () => {
    const props = renderPanel({ existing: () => ({ segmentsQuote: null }) });
    fireEvent.click(screen.getByRole("button", { name: "Link “schwere” to Severe" }));
    expect(props.onAttach).toHaveBeenCalledWith("seizure");
  });

  it("offers Replace text span when the focused target has another span", () => {
    const props = renderPanel({ nearest: null, focused: SEIZURE, existing: () => ({ segmentsQuote: "sehr schwere" }) });
    expect(screen.getByText("Seizure already has Severe (“sehr schwere”). Attaching replaces its text span.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Replace text span" }));
    expect(props.onReplace).toHaveBeenCalledWith("seizure");
    expect(props.onAttach).not.toHaveBeenCalled();
  });

  it("without any finding: create the finding first, only OK", () => {
    const props = renderPanel({ noFindings: true, nearest: null });
    expect(screen.getByText("Severe is a modifier. Create the finding first, then add Severe under Modifiers.")).toBeDefined();
    expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["OK"]);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(props.onCancel).toHaveBeenCalled();
  });
});
