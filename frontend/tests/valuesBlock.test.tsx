import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    schema_version: "ontotator-annotation/v3", evidence: [], document_id: "d", version: "v",
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
    const note = screen.getByLabelText("Note");
    expect(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const section = container.querySelector("[data-values-section]")!;
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(section.querySelectorAll("fieldset[data-axis-field]")).toHaveLength(3);
    const legend = section.querySelector('[data-axis-field="assertion"] legend')!;
    expect(legend.textContent).toContain("(required)");
    expect(legend.textContent).not.toContain("*");
    expect(section.querySelector('[data-axis-field="experiencer"] legend')!.textContent).not.toContain("(required)");
  });

  it("shows human labels for the family member and unknown subject options", () => {
    const config = axesConfig.map(axis => axis.id === "experiencer"
      ? { ...axis, options: ["patient", "family_member", "other", "unknown"] } : axis);
    const { container } = render(<AnnotationPanel {...props({ axesConfig: config })} />);
    const field = within(container.querySelector<HTMLElement>('[data-axis-field="experiencer"]')!);
    expect(field.getByRole("option", { name: "Family member" })).toBeDefined();
    expect(field.getByRole("option", { name: "Unknown" })).toBeDefined();
    expect(field.queryByText("family_member")).toBeNull();
    expect(field.queryByText("unknown")).toBeNull();
  });

  it("renders each axis as one segmented group with the label cell first", () => {
    const { container } = render(<AnnotationPanel {...props({}, ["assertion", "experiencer"])} />);
    const field = container.querySelector<HTMLElement>('[data-axis-field="temporality"]')!;
    expect(field.firstElementChild!.tagName).toBe("LEGEND");
    const group = field.querySelector<HTMLElement>(".axis-options")!;
    const segments = Array.from(group.children);
    expect(segments).toHaveLength(4);
    for (const segment of segments) {
      expect(segment.tagName).toBe("LABEL");
      expect(segment.classList.contains("axis-option")).toBe(true);
      expect(segment.querySelector('input[type="radio"]')).not.toBeNull();
    }
    expect(within(field).getAllByRole("radio").map(radio => (radio as HTMLInputElement).value)).toEqual(["", "current", "historical", "future"]);
    const present = screen.getByRole("radio", { name: "Present (default)" }) as HTMLInputElement;
    expect(present.checked).toBe(true);
    expect(present.closest(".axis-option")!.classList.contains("is-default")).toBe(true);
    // A confirmed value is a plain choice.
    const current = screen.getByRole("radio", { name: "Current" }) as HTMLInputElement;
    expect(current.checked).toBe(true);
    expect(current.closest(".axis-option")!.classList.contains("is-default")).toBe(false);
  });

  it("an empty axis keeps “Not specified” unfilled: it is no confirmed choice (#33)", () => {
    const base = props({}, []);
    base.annotation!.annotation.axes_values = { assertion: "present", experiencer: null, temporality: "current" } as never;
    const { container } = render(<AnnotationPanel {...base} />);
    const empty = screen.getByRole("radio", { name: "Not specified (no value chosen)" }) as HTMLInputElement;
    expect(empty.checked).toBe(true);
    expect(empty.closest(".axis-option")!.classList.contains("is-unset")).toBe(true);
    // A chosen value elsewhere leaves that axis's "Not specified" a plain, unchecked segment.
    const other = container.querySelector<HTMLInputElement>('[data-axis-field="temporality"] input[value=""]')!;
    expect(other.checked).toBe(false);
    expect(other.closest(".axis-option")!.classList.contains("is-unset")).toBe(false);
  });

  it("shows the Default tag in the label cell and keeps ' (default)' in the radio's accessible name", () => {
    const { container } = render(<AnnotationPanel {...props({}, ["assertion", "experiencer"])} />);
    expect(screen.getByRole("radio", { name: "Present (default)" })).toBeDefined();
    const assertion = container.querySelector<HTMLElement>('[data-axis-field="assertion"]')!;
    expect(assertion.querySelector(".axis-legend .axis-default-tag")!.textContent).toBe("Default");
    const segment = assertion.querySelector<HTMLElement>(".axis-option.is-default")!;
    const hidden = segment.querySelector(".visually-hidden")!;
    expect(hidden.textContent).toBe(" (default)");
    expect(Array.from(segment.querySelectorAll("span:not(.visually-hidden)")).map(span => span.textContent)).toEqual(["Present"]);
    expect(container.querySelector('[data-axis-field="temporality"] .axis-default-tag')).toBeNull();
    expect(container.querySelectorAll(".axis-default-tag")).toHaveLength(2);
  });

  it("hint names the click", () => {
    const { container } = render(<AnnotationPanel {...props({ onConfirmDefaults: vi.fn() })} />);
    const section = container.querySelector<HTMLElement>("[data-values-section]")!;
    const hint = section.querySelector<HTMLElement>(".form-hint")!;
    expect(hint.textContent).toBe("Click a highlighted default or “Confirm defaults” to confirm it.");
    expect(hint.querySelector("kbd")).toBeNull();
    expect(screen.queryByText(/Defaults are not confirmed/)).toBeNull();
  });

  it("Confirm defaults sits on the Values heading row before the first axis", () => {
    const { container } = render(<AnnotationPanel {...props({ onConfirmDefaults: vi.fn() })} />);
    const button = screen.getByRole("button", { name: "Confirm defaults (3)" });
    const heading = screen.getByRole("heading", { name: "Values" });
    expect(button.parentElement!.classList.contains("values-heading-row")).toBe(true);
    expect(heading.parentElement).toBe(button.parentElement);
    const firstFieldset = container.querySelector("[data-values-section] fieldset")!;
    expect(button.compareDocumentPosition(firstFieldset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("click on the checked default confirms that axis", () => {
    const onConfirmDefaults = vi.fn(), onUpdateAxes = vi.fn();
    render(<AnnotationPanel {...props({ onConfirmDefaults, onUpdateAxes })} />);
    fireEvent.click(screen.getByRole("radio", { name: "Present (default)" }));
    expect(onConfirmDefaults).toHaveBeenCalledTimes(1);
    expect(onConfirmDefaults).toHaveBeenCalledWith(["assertion"],
      { assertion: "present", experiencer: "patient", temporality: "current" }, { moveFocus: false });
    expect(onUpdateAxes).not.toHaveBeenCalled();
  });

  it("Space on the checked default confirms that axis once", () => {
    const onConfirmDefaults = vi.fn();
    render(<AnnotationPanel {...props({ onConfirmDefaults })} />);
    const patient = screen.getByRole("radio", { name: "Patient (default)" });
    fireEvent.keyDown(patient, { key: " " });
    // A click the browser synthesises for the same key press does not confirm twice.
    fireEvent.click(patient, { detail: 0 });
    expect(onConfirmDefaults).toHaveBeenCalledTimes(1);
    expect(onConfirmDefaults).toHaveBeenCalledWith(["experiencer"],
      { assertion: "present", experiencer: "patient", temporality: "current" }, { moveFocus: false });
  });

  it("a held Space or a double click sends one confirm until it has settled", async () => {
    let settle!: () => void;
    const onConfirmDefaults = vi.fn(() => new Promise<void>(resolve => { settle = resolve; }));
    render(<AnnotationPanel {...props({ onConfirmDefaults })} />);
    const patient = screen.getByRole("radio", { name: "Patient (default)" });
    fireEvent.keyDown(patient, { key: " " });
    fireEvent.keyDown(patient, { key: " ", repeat: true });
    fireEvent.keyDown(patient, { key: " ", repeat: true });
    expect(onConfirmDefaults).toHaveBeenCalledTimes(1);
    const present = screen.getByRole("radio", { name: "Present (default)" });
    fireEvent.click(present, { detail: 1 });
    fireEvent.click(present, { detail: 2 });
    expect(onConfirmDefaults).toHaveBeenCalledTimes(2);
    expect(onConfirmDefaults).toHaveBeenLastCalledWith(["assertion"], expect.anything(), { moveFocus: false });
    // Once the confirm has settled (e.g. it failed), a new click may try again.
    await act(async () => { settle(); });
    fireEvent.click(present, { detail: 1 });
    expect(onConfirmDefaults).toHaveBeenCalledTimes(3);
  });

  it("a dropdown default has its own Confirm (#149)", () => {
    const onConfirmDefaults = vi.fn(), onUpdateAxes = vi.fn();
    const config = axesConfig.map(axis => axis.id === "experiencer"
      ? { ...axis, options: ["patient", "mother", "father", "sibling", "other"] } : axis);
    const { container } = render(<AnnotationPanel {...props({ onConfirmDefaults, onUpdateAxes, axesConfig: config })} />);
    const field = container.querySelector<HTMLElement>('[data-axis-field="experiencer"]')!;
    expect(field.querySelector("select")).not.toBeNull();
    fireEvent.click(within(field).getByRole("button", { name: "Confirm Subject: Patient" }));
    expect(onConfirmDefaults).toHaveBeenCalledTimes(1);
    expect(onConfirmDefaults).toHaveBeenCalledWith(["experiencer"],
      { assertion: "present", experiencer: "patient", temporality: "current" }, { moveFocus: false });
    expect(onUpdateAxes).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field.querySelector("select"));
    expect(container.querySelector("[data-values-section] .form-hint")!.textContent)
      .toBe("Click a highlighted default, Confirm next to a list, or “Confirm defaults” to confirm it.");
  });

  it("no dropdown Confirm for a chosen value or when read-only", () => {
    const config = axesConfig.map(axis => axis.id === "experiencer"
      ? { ...axis, options: ["patient", "mother", "father", "sibling", "other"] } : axis);
    const { container, unmount } = render(<AnnotationPanel {...props({ onConfirmDefaults: vi.fn(), axesConfig: config }, ["assertion"])} />);
    expect(container.querySelector('[data-axis-field="experiencer"] [data-confirm-axis]')).toBeNull();
    unmount();
    const readOnly = render(<AnnotationPanel {...props({ onConfirmDefaults: vi.fn(), axesConfig: config, readOnly: true })} />);
    expect(readOnly.container.querySelector("[data-confirm-axis]")).toBeNull();
  });

  it("click on a checked non-default value does nothing", () => {
    const onConfirmDefaults = vi.fn(), onUpdateAxes = vi.fn();
    render(<AnnotationPanel {...props({ onConfirmDefaults, onUpdateAxes }, ["assertion", "experiencer"])} />);
    fireEvent.click(screen.getByRole("radio", { name: "Current" }));
    expect(onConfirmDefaults).not.toHaveBeenCalled();
    expect(onUpdateAxes).not.toHaveBeenCalled();
  });

  it("no click handler when read-only or the default is unavailable", () => {
    const onConfirmDefaults = vi.fn();
    const { unmount } = render(<AnnotationPanel {...props({ onConfirmDefaults, readOnly: true })} />);
    fireEvent.click(screen.getByRole("radio", { name: "Present (default)" }));
    expect(onConfirmDefaults).not.toHaveBeenCalled();
    unmount();
    // A defaulted value that is no longer among the options is not a confirmable default.
    const config = axesConfig.map(axis => axis.id === "temporality" ? { ...axis, options: ["historical", "future"] } : axis);
    const { container } = render(<AnnotationPanel {...props({ onConfirmDefaults, axesConfig: config }, ["temporality"])} />);
    const radio = within(container.querySelector<HTMLElement>('[data-axis-field="temporality"]')!)
      .getByRole("radio", { name: "current (current unavailable value)" });
    fireEvent.click(radio);
    expect(onConfirmDefaults).not.toHaveBeenCalled();
  });

  it("read-only: the Default tags alone, without a hint, key or button", () => {
    const { container } = render(<AnnotationPanel {...props({ readOnly: true, onConfirmDefaults: vi.fn() })} />);
    expect(container.querySelector("[data-values-section] .form-hint")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm defaults/ })).toBeNull();
    expect(container.querySelectorAll(".axis-default-tag")).toHaveLength(3);
  });

  it("keeps an unavailable stored value as the last disabled chosen segment", () => {
    const base = props({}, []);
    base.annotation!.annotation.axes_values = { assertion: "unknown", experiencer: "patient", temporality: "current" };
    const { container } = render(<AnnotationPanel {...base} />);
    const group = container.querySelector<HTMLElement>('[data-axis-field="assertion"] .axis-options')!;
    const last = group.lastElementChild as HTMLElement;
    expect(group.children).toHaveLength(4);
    expect(last.textContent).toBe("unknown (current unavailable value)");
    const radio = within(last).getByRole("radio") as HTMLInputElement;
    expect(radio.checked).toBe(true);
    expect(radio.disabled).toBe(true);
  });

  it("renders a one-option axis as a one-segment radio group", () => {
    const config = [{ id: "assertion", label: "Assertion", options: ["present"], allow_empty: false }];
    const { container } = render(<AnnotationPanel {...props({ axesConfig: config }, [])} />);
    const field = screen.getByRole("group", { name: /Assertion/ });
    expect(field.querySelectorAll(".axis-options > .axis-option")).toHaveLength(1);
    expect((within(field).getByRole("radio", { name: "Present" }) as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector("select")).toBeNull();
  });

  it("a Select for more than four options: the Default tag, and ' (default)' only in its accessible name", () => {
    const config = axesConfig.map(axis => axis.id === "experiencer"
      ? { ...axis, options: ["patient", "family_member", "other", "unknown"] } : axis);
    const { container } = render(<AnnotationPanel {...props({ axesConfig: config }, ["experiencer"])} />);
    const field = container.querySelector<HTMLElement>('[data-axis-field="experiencer"]')!;
    expect(field.querySelector(".axis-options")).toBeNull();
    expect(within(field).getByRole("option", { name: "Patient" })).toBeDefined();
    expect(within(field).getByRole("combobox", { name: "Subject (default)" })).toBeDefined();
    expect(field.querySelector(".axis-legend .axis-default-tag")!.textContent).toBe("Default");
  });

  it("a required axis without a value shows no chosen segment and no Default tag", () => {
    const base = props({}, ["assertion"]);
    base.annotation!.annotation.axes_values = { assertion: null, experiencer: "patient", temporality: "current" };
    const { container } = render(<AnnotationPanel {...base} />);
    const field = container.querySelector<HTMLElement>('[data-axis-field="assertion"]')!;
    expect(within(field).getAllByRole("radio").some(radio => (radio as HTMLInputElement).checked)).toBe(false);
    expect(field.querySelector("legend")!.textContent).toContain("(required)");
    expect(field.querySelector(".axis-default-tag")).toBeNull();
    expect(field.textContent).not.toContain("(default)");
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
    const present = screen.getByRole("radio", { name: "Present (default)" });
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
    fireEvent.keyDown(screen.getByRole("radio", { name: "Present (default)" }), { key: "ArrowRight" });
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
    const present = await screen.findByRole("radio", { name: "Present (default)" }) as HTMLInputElement;
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
    expect(screen.queryByText(/Highlighted values are defaults/)).toBeNull();
    unmount();
    render(<AnnotationPanel {...props({ onConfirmDefaults: vi.fn(), readOnly: true })} />);
    expect(screen.queryByRole("button", { name: /Confirm defaults/ })).toBeNull();
  });
});

describe("Values block layout", () => {
  const geometry = { section: 600, label: 40, span: 40, padding: 0 };
  const observers: ResizeObserverCallback[] = [];
  const getComputedStyleOriginal = window.getComputedStyle;

  beforeEach(() => {
    Object.assign(geometry, { section: 600, label: 40, span: 40, padding: 0 });
    observers.length = 0;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { observers.push(callback); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) { return this.matches("[data-values-section]") ? geometry.section : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.matches(".axis-option")) return geometry.label;
        if (this.matches(".axis-option > span:not(.visually-hidden)")) return geometry.span;
        return 0;
      },
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
      const style = getComputedStyleOriginal(element, pseudo);
      if (element.matches(".axis-option")) {
        style.paddingLeft = `${geometry.padding}px`;
        style.paddingRight = `${geometry.padding}px`;
      }
      return style;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as any).clientWidth;
    delete (HTMLElement.prototype as any).scrollWidth;
  });

  const resize = (section: number) => {
    geometry.section = section;
    act(() => { for (const callback of observers) callback([], {} as ResizeObserver); });
  };
  const layoutOf = (container: HTMLElement) => container.querySelector("[data-values-section]")!.getAttribute("data-values-layout");

  it("writes data-values-layout on the section and keeps selection and focus when it changes", () => {
    const { container } = render(<AnnotationPanel {...props({}, ["assertion", "experiencer"])} />);
    expect(layoutOf(container)).toBe("row");
    const present = screen.getByRole("radio", { name: "Present (default)" }) as HTMLInputElement;
    present.focus();
    // Widest control: four segments of 40 px plus 5 px outline and separators = 165 px.
    resize(260);
    expect(layoutOf(container)).toBe("stacked");
    resize(100);
    expect(layoutOf(container)).toBe("boxes");
    expect((screen.getByRole("radio", { name: "Present (default)" }) as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(present);
    expect((screen.getByRole("radio", { name: "Current" }) as HTMLInputElement).checked).toBe(true);
  });

  it("measures the inner span plus padding, not the stretched segment", () => {
    const config = [{ id: "assertion", label: "Assertion", options: ["present"], allow_empty: false }];
    Object.assign(geometry, { label: 200, span: 60, padding: 8 });
    // Required: 60 + 8 + 8 + 2 = 78 px. Row cell = section − 96 − 8.
    geometry.section = 182;
    const { container } = render(<AnnotationPanel {...props({ axesConfig: config }, [])} />);
    expect(layoutOf(container)).toBe("row");
    resize(181);
    expect(layoutOf(container)).toBe("stacked");
    resize(190);
    expect(layoutOf(container)).toBe("row");
  });

  it("in boxes the legend shows the same Default tag as the other layouts", () => {
    const { container } = render(<AnnotationPanel {...props({}, ["assertion", "experiencer"])} />);
    resize(100);
    expect(layoutOf(container)).toBe("boxes");
    const assertion = container.querySelector<HTMLElement>('[data-axis-field="assertion"] .axis-legend')!;
    expect(assertion.querySelector(".axis-default-tag")!.textContent).toBe("Default");
    expect(container.querySelector('[data-axis-field="temporality"] .axis-default-tag')).toBeNull();
    expect(container.querySelectorAll(".axis-default-tag")).toHaveLength(2);
    expect(container.querySelector(".axis-default-suffix")).toBeNull();
    expect(screen.getByRole("radio", { name: "Present (default)" })).toBeDefined();
  });

  it("re-measures when the selection changes, so a value that turns bold is measured bold", () => {
    const config = [{ id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: false }];
    // A checked segment is bold and wider: present 60 px, absent 80 px; unchecked 50 px.
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.matches(".axis-option > span:not(.visually-hidden)")) return 0;
        const checked = this.parentElement!.querySelector<HTMLInputElement>("input")!.checked;
        return !checked ? 50 : this.textContent === "Absent" ? 80 : 60;
      },
    });
    // Present selected: 60 + 50 + 3 = 113 px fits the row cell (217 − 96 − 8).
    geometry.section = 217;
    const { container } = render(<AnnotationPanel {...props({ axesConfig: config }, [])} />);
    expect(layoutOf(container)).toBe("row");
    // Absent selected: 50 + 80 + 3 = 133 px no longer fits the row cell, without any resize.
    fireEvent.click(screen.getByRole("radio", { name: "Absent" }));
    expect(layoutOf(container)).toBe("stacked");
  });

  it("does not switch while the section has no width", () => {
    geometry.section = 0;
    const { container } = render(<AnnotationPanel {...props()} />);
    expect(layoutOf(container)).toBe("row");
  });
});
