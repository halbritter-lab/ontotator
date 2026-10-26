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

it("keeps the system background on a hovered segment in forced colours", () => {
  const editor = readFileSync(new URL("../src/styles/screens/editor.css", import.meta.url), "utf8");
  const hover = ".values-section .axis-option:not(:has(input:disabled)):not(:has(input:checked)):hover";
  const forced = editor.slice(editor.indexOf("@media (forced-colors: active)", editor.indexOf("/* Values block")));
  const rule = forced.slice(forced.indexOf(hover));
  expect(forced.indexOf(hover)).toBeGreaterThan(0);
  expect(rule.slice(0, rule.indexOf("}"))).toContain("background: Canvas;");
  // The forced-colours rule comes after the regular hover rule, so it wins at equal specificity.
  expect(editor.lastIndexOf(hover)).toBeGreaterThan(editor.indexOf(hover));
});

it("lets a handle drag reach the text under the pending mark bar", () => {
  const editor = readFileSync(new URL("../src/styles/screens/editor.css", import.meta.url), "utf8");
  // The bar is a sibling after the text pane: during a drag it must not catch the pointer.
  const rule = editor.match(/\.center-pane:has\(\.text-container\.resizing\) ~ \.pending-mark-bar \{([^}]*)\}/);
  expect(rule?.[1]).toMatch(/pointer-events: none/);
  expect(rule?.[1]).toMatch(/opacity: 0\.4/);
});

it("the text card's grid for technical details never reaches the editor's Source and rules disclosure (R-5)", () => {
  const css = readFileSync(new URL("../src/documents/textCard/textCard.css", import.meta.url), "utf8");
  expect(css).not.toMatch(/(^|[\s,}])\.technical-details\b/m);
});
