import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationPanel, type AnnotationPanelProps } from "../src/editor/AnnotationPanel";
import { SearchManager } from "../src/editor/searchState";

const axesConfig = [
  { id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: false },
  { id: "experiencer", label: "Subject", options: ["patient", "other"], allow_empty: true },
  { id: "temporality", label: "Temporality", options: ["current", "historical", "future"], allow_empty: true },
];

const props = (overrides: Partial<AnnotationPanelProps> = {}, defaulted = ["assertion", "experiencer", "temporality"]): AnnotationPanelProps => ({
  annotation: {
    annotation: { annotation_id: "a", document_id: "d", layer_id: "l", type_id: "t", term_id: "HP:0001250",
      axes_values: { assertion: "present", experiencer: "patient", temporality: "current" }, axes_defaulted: defaulted,
      evidence_refs: [], provenance: { actor: { actor_id: "u", kind: "human" }, method: "manual" } },
    schema_version: "ontocurator-annotation/v3", evidence: [], document_id: "d", version: "v",
    text_sha256: "t", ontology_sha256: "o", layer_config_sha256: "l",
  },
  allEvidence: {}, workspaceKey: { project_key: "p", document_id: "d", annotator_id: "a", mode: "independent", scope_id: "s", target_set_id: "t" },
  searchManager: new SearchManager({ searchOntology: vi.fn().mockResolvedValue({ search_id: "s", candidates: [] }) } as any),
  selectedEvidenceId: null, axesConfig, termLabel: "Seizure",
  onSelectEvidence: vi.fn(), onUpdateTerm: vi.fn(), onUpdateAxes: vi.fn(), onAttachMention: vi.fn(),
  onDetachMention: vi.fn(), onDeleteAnnotation: vi.fn(), onSetIntent: vi.fn(),
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe("Values block", () => {
  it("renders Values above the note with one row per axis and (required) in text", () => {
    const { container } = render(<AnnotationPanel {...props()} />);
    const heading = screen.getByRole("heading", { name: "Values" });
    const note = screen.getByLabelText("Annotation note");
    expect(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const section = container.querySelector("[data-values-section]")!;
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(section.querySelectorAll("fieldset[data-axis-field]")).toHaveLength(3);
    const legend = section.querySelector('[data-axis-field="assertion"] legend')!;
    expect(legend.textContent).toContain("(required)");
    expect(legend.textContent).not.toContain("*");
    expect(section.querySelector('[data-axis-field="experiencer"] legend')!.textContent).not.toContain("(required)");
  });

  it("marks unconfirmed defaults with a dashed option and the word default", () => {
    const { container } = render(<AnnotationPanel {...props({}, ["assertion", "experiencer"])} />);
    const present = screen.getByRole("radio", { name: "Present · default" }) as HTMLInputElement;
    expect(present.checked).toBe(true);
    expect(present.closest(".axis-option")!.classList.contains("is-default")).toBe(true);
    // A confirmed value is a plain choice.
    const current = screen.getByRole("radio", { name: "Current" }) as HTMLInputElement;
    expect(current.checked).toBe(true);
    expect(current.closest(".axis-option")!.classList.contains("is-default")).toBe(false);
    expect(within(container.querySelector<HTMLElement>("[data-values-section]")!)
      .getAllByText("Defaults are not confirmed until you confirm them or choose another value.")).toHaveLength(1);
  });

  it("Confirm defaults (n) calls onConfirmDefaults with every defaulted axis that has an available value", () => {
    const onConfirmDefaults = vi.fn();
    render(<AnnotationPanel {...props({ onConfirmDefaults })} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm defaults (3)" }));
    expect(onConfirmDefaults).toHaveBeenCalledWith(["assertion", "experiencer", "temporality"],
      { assertion: "present", experiencer: "patient", temporality: "current" });
    expect(screen.queryByRole("button", { name: /Confirm .* value/ })).toBeNull();
  });

  it("counts only the remaining defaults after a value was chosen and sends the choice first", () => {
    const onConfirmDefaults = vi.fn(), onUpdateAxes = vi.fn();
    render(<AnnotationPanel {...props({ onConfirmDefaults, onUpdateAxes })} />);
    fireEvent.click(screen.getByRole("radio", { name: "Absent" }));
    expect(onUpdateAxes).toHaveBeenCalledWith({ assertion: "absent", experiencer: "patient", temporality: "current" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm defaults (2)" }));
    expect(onConfirmDefaults).toHaveBeenCalledWith(["experiencer", "temporality"],
      { assertion: "absent", experiencer: "patient", temporality: "current" });
  });

  it("coalesces arrow-key changes within an axis", () => {
    vi.useFakeTimers();
    const onUpdateAxes = vi.fn();
    render(<AnnotationPanel {...props({ onUpdateAxes })} />);
    const present = screen.getByRole("radio", { name: "Present · default" });
    fireEvent.keyDown(present, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("radio", { name: "Absent" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "Absent" }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("radio", { name: "Uncertain" }));
    expect(onUpdateAxes).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onUpdateAxes).toHaveBeenCalledTimes(1);
    expect(onUpdateAxes).toHaveBeenCalledWith({ assertion: "uncertain", experiencer: "patient", temporality: "current" });
  });

  it("shows the values error inline and keeps the button", () => {
    const { container } = render(<AnnotationPanel {...props({ onConfirmDefaults: vi.fn(), valuesError: "The values could not be confirmed. Try again." })} />);
    const section = container.querySelector<HTMLElement>("[data-values-section]")!;
    expect(within(section).getByRole("alert").textContent).toContain("The values could not be confirmed. Try again.");
    expect(within(section).getByRole("button", { name: "Confirm defaults (3)" })).toBeDefined();
  });

  it("names V as the Values shortcut and hands its flush to axesFlushRef", () => {
    vi.useFakeTimers();
    const onUpdateAxes = vi.fn(), axesFlushRef = { current: null as (() => void) | null };
    const { container, unmount } = render(<AnnotationPanel {...props({ onUpdateAxes, axesFlushRef })} />);
    expect(container.querySelector("[data-values-section]")!.getAttribute("aria-keyshortcuts")).toBe("v");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Present · default" }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("radio", { name: "Absent" }));
    expect(onUpdateAxes).not.toHaveBeenCalled();
    act(() => { axesFlushRef.current!(); });
    expect(onUpdateAxes).toHaveBeenCalledTimes(1);
    unmount();
    expect(axesFlushRef.current).toBeNull();
    expect(onUpdateAxes).toHaveBeenCalledTimes(1);
  });

  it("shows the saved default again when the coalesced save fails", async () => {
    const onUpdateAxes = vi.fn().mockRejectedValue(new Error("refused"));
    render(<AnnotationPanel {...props({ onUpdateAxes })} />);
    fireEvent.click(screen.getByRole("radio", { name: "Absent" }));
    expect(onUpdateAxes).toHaveBeenCalledTimes(1);
    const present = await screen.findByRole("radio", { name: "Present · default" }) as HTMLInputElement;
    expect(present.checked).toBe(true);
  });

  it("opens Change term and focuses the search when searchRequest increments", () => {
    const { rerender } = render(<AnnotationPanel {...props({ searchRequest: 0 })} />);
    expect(screen.queryByRole("combobox", { name: "Search term" })).toBeNull();
    rerender(<AnnotationPanel {...props({ searchRequest: 1 })} />);
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search term" }));
  });

  it("hides Confirm defaults when nothing is defaulted or read-only", () => {
    const { unmount } = render(<AnnotationPanel {...props({ onConfirmDefaults: vi.fn() }, [])} />);
    expect(screen.queryByRole("button", { name: /Confirm defaults/ })).toBeNull();
    expect(screen.queryByText(/Defaults are not confirmed/)).toBeNull();
    unmount();
    render(<AnnotationPanel {...props({ onConfirmDefaults: vi.fn(), readOnly: true })} />);
    expect(screen.queryByRole("button", { name: /Confirm defaults/ })).toBeNull();
  });
});
