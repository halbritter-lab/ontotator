import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModifiersSection, type ModifiersSectionProps } from "../src/editor/ModifiersSection";
import { SearchManager } from "../src/editor/searchState";
import type { TermInfo } from "../src/editor/modifiers";

const TEXT = "Wiederholt schwere Krampfanfälle, oft.";
const INFO: Record<string, TermInfo> = {
  "HP:0012828": { label: "Severe", role: "modifier", exclusiveClass: "severity" },
  "HP:0012825": { label: "Mild", role: "modifier", exclusiveClass: "severity" },
  "HP:0031796": { label: "Recurrent", role: "modifier", exclusiveClass: null },
  "HP:0040282": { label: "Frequent", role: "cohort", exclusiveClass: null },
};
const key = { project_key: "pkg", document_id: "doc", annotator_id: "a", mode: "independent" as const, scope_id: "s", target_set_id: "t" };
const SEVERE = { term_id: "HP:0012828", segments: [{ start: 11, end: 18 }] };

const renderSection = (props: Partial<ModifiersSectionProps> = {}, searchOntology = vi.fn().mockResolvedValue({ search_id: "s1", candidates: [] })) => {
  const all: ModifiersSectionProps = {
    finding: "Seizure", modifiers: [SEVERE], text: TEXT, termInfo: id => INFO[id],
    onAdd: vi.fn().mockResolvedValue(undefined), onLinkSpan: vi.fn(), onRemoveSpan: vi.fn(), onRemove: vi.fn(),
    searchProps: { searchManager: new SearchManager({ searchOntology } as any), annotationId: "a1", workspaceKey: key, layerId: "hpo", debounceMs: 0 },
    ...props,
  };
  render(<ModifiersSection {...all} />);
  return { ...all, searchOntology };
};
const chips = () => [...screen.getByRole("list", { name: "Modifiers of Seizure" }).querySelectorAll("li")];
const menuItems = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: `Actions, ${name}` }));
  return (await screen.findAllByRole("menuitem")).map(item => item.textContent);
};

afterEach(cleanup);

describe("ModifiersSection", () => {
  it("has a Modifiers heading in its section and chips in label order", () => {
    renderSection({ modifiers: [SEVERE, { term_id: "HP:0031796" }, { term_id: "HP:0040282", segments: [{ start: 34, end: 37 }] }] });
    const section = document.querySelector("[data-modifiers-section]") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 3, name: "Modifiers" })).toBeDefined();
    expect(chips().map(chip => chip.textContent)).toEqual(["Frequent “oft” · Cohort term", "Recurrent" + "no text span · Link a text span", "Severe “schwere”"]);
    expect(chips()[0].querySelector(".mod-cohort")!.textContent).toBe("Cohort term");
  });

  it("an unlinked row offers Link a text span inline (mockup 01 A)", () => {
    const props = renderSection({ modifiers: [SEVERE, { term_id: "HP:0031796" }] });
    fireEvent.click(within(chips()[0]).getByRole("button", { name: "Link a text span" }));
    expect(props.onLinkSpan).toHaveBeenCalledWith("HP:0031796");
    expect(within(chips()[1]).queryByRole("button", { name: "Link a text span" })).toBeNull();
  });

  it("warns about two of one exclusive class", () => {
    renderSection({ modifiers: [SEVERE, { term_id: "HP:0012825" }] });
    expect(screen.getByText("Two severities").className).toContain("mod-warning");
  });

  it("offers span actions by state", async () => {
    renderSection({ modifiers: [SEVERE, { term_id: "HP:0031796" }] });
    expect(await menuItems("Severe")).toEqual(["Change text span…", "Remove text span", "Remove modifier"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(await menuItems("Recurrent")).toEqual(["Link a text span…", "Remove modifier"]);
  });

  it("menu actions call back with the term", async () => {
    const props = renderSection();
    await menuItems("Severe");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove modifier" }));
    expect(props.onRemove).toHaveBeenCalledWith("HP:0012828");
  });

  it("+ Add modifier… searches modifiers; Enter adds and returns focus with a status", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s1", candidates: [
      { term_id: "HP:0031796", label: "Recurrent", rank: 1, role: "modifier" }] });
    const props = renderSection({}, searchOntology);
    fireEvent.click(screen.getByRole("button", { name: "+ Add modifier…" }));
    const input = screen.getByRole("combobox", { name: "Search modifier" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Severity, onset, pattern…");
    fireEvent.change(input, { target: { value: "rec" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(searchOntology.mock.calls[0][0].within).toEqual(["HP:0012823", "HP:0040279"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onAdd).toHaveBeenCalledWith("HP:0031796", "Recurrent", "modifier");
    const status = await screen.findByText("Added Recurrent to Seizure. Link a text span?");
    expect(status.closest('[role="status"]')).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Add modifier…" })));
    fireEvent.click(screen.getByRole("button", { name: "Link a text span" }));
    expect(props.onLinkSpan).toHaveBeenCalledWith("HP:0031796");
  });

  it("without a link action the status only names the added modifier", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s1", candidates: [
      { term_id: "HP:0031796", label: "Recurrent", rank: 1, role: "modifier" }] });
    renderSection({ onLinkSpan: undefined }, searchOntology);
    fireEvent.click(screen.getByRole("button", { name: "+ Add modifier…" }));
    const input = screen.getByRole("combobox", { name: "Search modifier" });
    fireEvent.change(input, { target: { value: "rec" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByText("Added Recurrent to Seizure.")).closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText(/Link a text span/)).toBeNull();
  });

  it("read-only shows the chips without actions", () => {
    renderSection({ readOnly: true });
    expect(chips().map(chip => chip.textContent)).toEqual(["Severe “schwere”"]);
    expect(screen.queryByRole("button", { name: /Actions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add modifier…" })).toBeNull();
  });

  it("takes another chip wording (consolidation)", () => {
    renderSection({ readOnly: true, chipText: (label, quote) => quote ? `${label} “${quote}”` : label });
    expect(chips()[0].textContent).toBe("Severe “schwere”");
  });
});
