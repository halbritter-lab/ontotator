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

it("has one Values rule set without pills or transitions", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  for (const file of ["../src/styles/components.css", "../src/styles/base.css"]) {
    expect(read(file)).not.toMatch(/\.axis-(option|options|field)\b/);
  }
  const editor = read("../src/styles/screens/editor.css");
  const start = editor.indexOf("/* Values block");
  const end = editor.indexOf("/* End of Values block */");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const block = editor.slice(start, end);
  // Every .axis-option rule lives in this one block.
  expect(editor.slice(0, start) + editor.slice(end)).not.toMatch(/\.axis-option/);
  expect(block).not.toContain("9999px");
  expect(block).not.toMatch(/transition:\s*all/);
  expect(block).toContain('[data-values-layout="boxes"]');
  expect(block).toContain('[data-values-layout="stacked"]');
  expect(block).toContain("@media (forced-colors: active)");
  expect(block).toContain("Highlight");
  expect(block).toContain("CanvasText");
  expect(block).not.toMatch(/line-clamp|text-overflow:\s*ellipsis/);
});
