import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../../src/styles/components.css");
const tokens = read("../../src/styles/tokens.css");

it("declares_forced_colors_rules_for_final_marker_badges_focus_and_segments", () => {
  const block = css.slice(css.indexOf("@media (forced-colors: active)"));
  expect(css).toContain("@media (forced-colors: active)");
  for (const selector of [".final-row", ".status-pill", ":focus-visible", ".segment[aria-current=\"page\"]"]) expect(block).toContain(selector);
});

it("forced_colors_focus_overrides_the_class_level_focus_selectors", () => {
  const block = css.slice(css.indexOf("@media (forced-colors: active)"));
  const rule = [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(match => match[1].includes(".btn:focus-visible"));
  expect(rule?.[2]).toMatch(/outline: 2px solid Highlight/);
  for (const selector of [".btn:focus-visible", ".form-control:focus-visible", ".form-select:focus-visible", ".shell-nav-link:focus-visible",
    ".shell-reading-navigation > summary:focus-visible", ".document-tree summary:focus-visible", ".shell-project-link:focus-visible"]) {
    expect(rule?.[1]).toContain(selector);
  }
});

it("disables_disclosure_motion_under_reduced_motion", () => {
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.disclosure-chevron[\s\S]*transition: none/);
});

it("busy_buttons_look_unavailable_without_native_disabled", () => {
  expect(css).toMatch(/\.btn\[aria-disabled="true"\]/);
});

it("declares_inline_confirm_rules", () => {
  expect(css).toContain(".inline-confirm {");
  expect(css).toContain(".inline-confirm-actions");
});

it("uses_only_defined_tokens", () => {
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const used = [...css.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]);
  expect(used.filter(name => !defined.has(name))).toEqual([]);
});

it("imports_the_documents_screen_stylesheets", () => {
  const index = read("../../src/styles/index.css");
  for (const name of ["documents-table", "documents-cards", "documents-expanded"]) {
    expect(index).toContain(`@import "./screens/${name}.css";`);
    expect(read(`../../src/styles/screens/${name}.css`)).toBeTypeOf("string");
  }
});

it("declares_plan_chip_tristate_and_toast_rules", () => {
  expect(css).toMatch(/\.ui-plan-chip[^{]*\{[^}]*min-height: 24px/);
  expect(css).toMatch(/\.ui-plan-chip\[aria-pressed="true"\]\s*\{[^}]*background: var\(--success-light\)/);
  expect(css).toMatch(/\.ui-plan-chip\[aria-pressed="true"\]\s*\{[^}]*border-color: var\(--success\)/);
  expect(css).toContain(".ui-tristate {");
  expect(css).toContain(".ui-toast-region {");
  expect(css).toContain(".data-table-group-select");
});

it("gives_pressed_chips_a_canvastext_border_under_forced_colors", () => {
  const blocks = [...css.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)].map(match => match[1]).join("\n");
  expect(blocks).toMatch(/\.ui-plan-chip\[aria-pressed="true"\][^{]*\{[^}]*border: [^;]*CanvasText/);
});

it("shows_the_toast_without_animation_under_reduced_motion", () => {
  expect(css).toMatch(/\.ui-toast \{[^}]*animation:/);
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map(match => match[1]).join("\n");
  expect(blocks).toMatch(/\.ui-toast \{[^}]*animation: none/);
});

it("imports_the_lead_workflow_screen_stylesheets", () => {
  const index = read("../../src/styles/index.css");
  for (const name of ["work-plan", "assign", "progress", "selection"]) {
    expect(index).toContain(`@import "./screens/${name}.css";`);
    expect(read(`../../src/styles/screens/${name}.css`)).toBeTypeOf("string");
  }
});
