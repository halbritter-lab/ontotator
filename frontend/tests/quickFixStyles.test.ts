import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const editor = read("../src/styles/screens/editor.css");
const components = read("../src/styles/components.css");

describe("quick-fix styles", () => {
  it("draws a sheet-coloured gap and a focus-ring ring around a focused resize handle", () => {
    expect(editor).toMatch(/\.resize-handle:focus-visible::before\s*\{\s*box-shadow:\s*0 0 0 2px var\(--surface-raised\),\s*0 0 0 4px var\(--focus-ring\);\s*\}/);
    expect(editor).not.toMatch(/\.resize-handle:focus-visible::before\s*\{[^}]*--accent-light/);
  });
  // Q8: one `it` per selector; editor F4b deletes them together with the rules once F6b / F8a removed the components.
  it(".round-input-panel ol keeps its markers inside the panel", () => {
    expect(editor).toMatch(/\.round-input-panel ol\s*\{\s*padding-inline-start:\s*var\(--space-5\);\s*\}/);
  });
  it(".work-round-actions ol keeps its markers inside the dialog", () => {
    expect(editor).toMatch(/\.work-round-actions ol\s*\{\s*padding-inline-start:\s*var\(--space-5\);\s*\}/);
  });
  it("keeps no accent-light form focus rule", () => {
    expect(components).not.toMatch(/\.form-select:focus\s*\{[^}]*--accent-light/);
  });
});
