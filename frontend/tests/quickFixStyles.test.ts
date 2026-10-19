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
  it("keeps no accent-light form focus rule", () => {
    expect(components).not.toMatch(/\.form-select:focus\s*\{[^}]*--accent-light/);
  });
});
