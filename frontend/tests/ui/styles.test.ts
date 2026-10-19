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
