import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "../src/api/generated";
import { hiddenCount, HiddenAxisValuesField, type HiddenAxisValuesFieldProps } from "../src/admin/HiddenAxisValuesField";

type Axis = components["schemas"]["AxisDefinition"];
const axis = (id: string, options: string[], label = id === "assertion" ? "Status" : "Confidence"): Axis => ({ id, label, options, allow_empty: true });
const profile: HiddenAxisValuesFieldProps["profile"] = {
  schema: "ontotator-task-profile/v1", profile_id: "test/v1", version: "1",
  ontologies: [{ ontology_id: "hp", label: "HPO", release: "2026", sha256: "a".repeat(64), format: "obo-graph-json" }],
  default_layer_id: "layer-a",
  layers: [
    { layer_id: "layer-a", label: "Findings", ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "first", annotation_types: [
      { type_id: "first", label: "First", evidence_policy: "optional", axes: [axis("assertion", ["present", "absent"])] },
      { type_id: "second", label: "Second", evidence_policy: "optional", axes: [axis("assertion", ["absent", "uncertain"]), axis("confidence", ["high", "low"])] },
    ] },
    { layer_id: "layer-b", label: "Findings", ontology_id: "hp", access: "reference", default_visible: true, default_type_id: "third", annotation_types: [
      { type_id: "third", label: "Third", evidence_policy: "optional", axes: [axis("assertion", ["possible", "confirmed"])] },
    ] },
  ],
};

const layerGroup = (id: string) => screen.getByRole("group", { name: `Findings (${id})` });
const axisGroup = (layer: string, id: string) => within(layerGroup(layer)).getByRole("group", { name: id === "assertion" ? "Status" : "Confidence" });
/** The toggle of a value: pressed = shown (D7 B). */
const toggle = (group: HTMLElement, name: string) => within(group).getByRole("button", { name }) as HTMLButtonElement;
const shown = (button: HTMLElement) => button.getAttribute("aria-pressed") === "true";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("values annotators can choose (shown-value toggles, M-8c)", () => {
  it("enumerates all layers/types and unions shared-axis options once in profile order", () => {
    render(<HiddenAxisValuesField profile={profile} axisDefaults={{}} value={{}} onChange={vi.fn()} />);
    const first = axisGroup("layer-a", "assertion");
    expect(within(first).getAllByRole("button").map(button => button.textContent)).toEqual(["Present", "Absent", "Uncertain"]);
    expect(within(first).getAllByRole("button").every(shown)).toBe(true);
    expect(within(axisGroup("layer-a", "confidence")).getAllByRole("button")).toHaveLength(2);
    expect(within(axisGroup("layer-b", "assertion")).getAllByRole("button")).toHaveLength(2);
    // Several layers: one heading each.
    expect(screen.getAllByRole("heading", { level: 4 }).map(heading => heading.textContent)).toEqual(["Findings", "Findings"]);
  });

  it("protects only the actual server-resolved default, which need not be the first option", () => {
    const change = vi.fn();
    render(<HiddenAxisValuesField profile={profile} axisDefaults={{ "layer-a": { assertion: "absent" } }} value={{}} onChange={change} />);
    const group = axisGroup("layer-a", "assertion");
    const actualDefault = toggle(group, "Absent");
    expect(actualDefault.disabled).toBe(true);
    expect(actualDefault.title).toBe("The default value cannot be hidden");
    fireEvent.click(actualDefault);
    expect(change).not.toHaveBeenCalled();
    expect(toggle(group, "Present").disabled).toBe(false);
    expect(toggle(axisGroup("layer-b", "assertion"), "Possible").disabled).toBe(false);
  });

  it("lets generic profiles hide their first option without guessing a default", () => {
    const change = vi.fn();
    render(<HiddenAxisValuesField profile={profile} axisDefaults={{}} value={{}} onChange={change} />);
    fireEvent.click(toggle(axisGroup("layer-a", "assertion"), "Present"));
    expect(change).toHaveBeenCalledWith({ "layer-a": { assertion: ["present"] } });
  });

  it("toggles options off and on using controlled props and immutable map copies", () => {
    const change = vi.fn();
    const original = Object.freeze({
      "layer-a": Object.freeze({ assertion: Object.freeze(["legacy"]), confidence: Object.freeze(["low"]) }),
      "layer-b": Object.freeze({ assertion: Object.freeze(["confirmed"]) }),
      "unknown-layer": Object.freeze({ "unknown-axis": Object.freeze(["kept"]) }),
    });
    // Frozen read-only fixture is passed as its structurally generated mutable
    // input contract; no mutation is permitted by this behavioral test.
    const value = original as unknown as HiddenAxisValuesFieldProps["value"];
    const props = { profile, axisDefaults: {}, onChange: change };
    const view = render(<HiddenAxisValuesField {...props} value={value} />);
    const button = () => toggle(axisGroup("layer-a", "assertion"), "Uncertain");
    expect(shown(button())).toBe(true);
    fireEvent.click(button());
    const added = change.mock.calls[0][0] as HiddenAxisValuesFieldProps["value"];
    expect(added).toEqual({ ...value, "layer-a": { assertion: ["legacy", "uncertain"], confidence: ["low"] } });
    expect(added).not.toBe(value);
    expect(added["layer-a"]).not.toBe(value["layer-a"]);
    expect(added["layer-b"]).toBe(value["layer-b"]);
    expect(added["unknown-layer"]).toBe(value["unknown-layer"]);
    expect(value["layer-a"].assertion).toEqual(["legacy"]);
    expect(shown(button())).toBe(true);
    view.rerender(<HiddenAxisValuesField {...props} value={added} />);
    expect(shown(button())).toBe(false);
    expect(hiddenCount(added)).toBe(5);
    fireEvent.click(button());
    expect(change.mock.calls[1][0]).toEqual(value);
    expect(added["layer-a"].assertion).toEqual(["legacy", "uncertain"]);
  });

  it("preserves unrelated and unknown axes in the layer being edited", () => {
    const change = vi.fn();
    const value = { "layer-a": { assertion: ["present"], "unknown-axis": ["custom"] } };
    render(<HiddenAxisValuesField profile={profile} axisDefaults={{}} value={value} onChange={change} />);
    expect(shown(toggle(axisGroup("layer-a", "assertion"), "Present"))).toBe(false);
    fireEvent.click(toggle(axisGroup("layer-a", "confidence"), "High"));
    expect(change).toHaveBeenCalledWith({ "layer-a": { assertion: ["present"], "unknown-axis": ["custom"], confidence: ["high"] } });
    expect(value).toEqual({ "layer-a": { assertion: ["present"], "unknown-axis": ["custom"] } });
  });

  it("disables every option and prevents changes when the field is disabled", () => {
    const change = vi.fn();
    render(<HiddenAxisValuesField profile={profile} axisDefaults={{}} value={{}} onChange={change} disabled />);
    for (const button of screen.getAllByRole("button") as HTMLButtonElement[]) {
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(change).not.toHaveBeenCalled();
  });

  it.each([
    { layers: [] },
    { layers: profile.layers.map(layer => ({ ...layer, annotation_types: [{ type_id: "no-axes", label: "No axes", evidence_policy: "optional" as const }] })) },
  ])("explains when the profile has no available axis options", ({ layers }) => {
    render(<HiddenAxisValuesField profile={{ ...profile, layers }} axisDefaults={{}} value={{}} onChange={vi.fn()} />);
    expect(screen.getByText("This profile has no values to limit.")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
