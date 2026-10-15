// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contrast,
  deltaE2000,
  deltaE2000Lab,
  parseColourTokens,
  simulate,
  type Deficiency,
} from "./support/colour";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = parseColourTokens(readFileSync(resolve(here, "../src/styles/tokens.css"), "utf8"));

const token = (name: string): string => {
  const value = tokens[name];
  if (!value) throw new Error(`Missing colour token ${name}`);
  return value;
};

const SURFACES = ["--surface", "--surface-raised", "--surface-sunken"];
const STATES = ["--accent", "--success", "--warning", "--danger"];
const FILLS = [0, 1, 2, 3, 4, 5].map((n) => `--mark-${n}-fill`);
const DEFICIENCIES: Deficiency[] = ["protan", "deutan", "tritan"];

const pairs = <T,>(items: T[]): Array<[T, T]> =>
  items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as [T, T]));

/** Every failing combination, so a failure names all offenders at once. */
function below(
  combos: Array<[string, string]>,
  measure: (a: string, b: string) => number,
  floor: number,
): string[] {
  return combos
    .map(([a, b]) => [a, b, measure(token(a), token(b))] as const)
    .filter(([, , value]) => value < floor)
    .map(([a, b, value]) => `${a} / ${b}: ${value.toFixed(2)}`);
}

const cross = (as: string[], bs: string[]): Array<[string, string]> =>
  as.flatMap((a) => bs.map((b) => [a, b] as [string, string]));

describe("design tokens", () => {
  it("colour_helpers_match_reference_values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(Math.round(contrast("#777777", "#ffffff") * 100) / 100).toBe(4.48);
    // Sharma, Wu & Dalal (2005), test pair 1.
    expect(deltaE2000Lab([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    for (const d of DEFICIENCIES) expect(simulate("#ffffff", d)).toBe("#ffffff");
  });

  it("text_meets_aa_on_every_surface", () => {
    expect(below(cross(["--text", "--text-muted"], SURFACES), contrast, 4.5)).toEqual([]);
  });

  it("state_text_meets_aa", () => {
    const onSurfaces = cross(STATES, ["--surface", "--surface-raised"]);
    const onOwnLight = STATES.map((s) => [s, `${s}-light`] as [string, string]);
    const onAccent: Array<[string, string]> = [
      ["--on-accent", "--accent"],
      ["--on-accent", "--accent-hover"],
    ];
    const textOnLight = cross(["--text"], STATES.map((s) => `${s}-light`));
    expect(below([...onSurfaces, ...onOwnLight, ...onAccent, ...textOnLight], contrast, 4.5)).toEqual([]);
  });

  it("text_on_marks_meets_aa", () => {
    expect(below(cross(["--text"], FILLS), contrast, 4.5)).toEqual([]);
  });

  it("non_text_contrast", () => {
    expect(below(cross(["--focus-ring", "--border-strong"], SURFACES), contrast, 3)).toEqual([]);
    expect(
      below(cross(["--mark-line", "--mark-selected"], ["--surface-raised", ...FILLS]), contrast, 3),
    ).toEqual([]);
  });

  it("mark_fills_are_distinct_for_normal_vision", () => {
    expect(below(pairs(FILLS), deltaE2000, 12)).toEqual([]);
    expect(below(cross(FILLS, ["--surface-raised"]), deltaE2000, 10)).toEqual([]);
  });

  it("mark_fills_are_distinct_under_colour_vision_deficiencies", () => {
    for (const d of DEFICIENCIES) {
      const simulated = (a: string, b: string) => deltaE2000(simulate(a, d), simulate(b, d));
      expect(below(pairs(FILLS), simulated, 8), d).toEqual([]);
    }
  });
});
