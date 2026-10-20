// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("has no inline styles or glyph icons in the inspector and the search", () => {
  for (const file of ["../src/editor/AnnotationPanel.tsx", "../src/editor/SearchPanel.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/style=\{/);
    expect(source).not.toMatch(/[↳✓]/);
  }
});
