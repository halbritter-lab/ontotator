// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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
const src = resolve(here, "../src");
const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "vendor") return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });

// CSS named colours, excluding the permitted transparent/currentColor/inherit.
const namedColours = new Set(`aliceblue antiquewhite aqua aquamarine azure beige bisque black
blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral
cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen
darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon
darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink
deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro
ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo
ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
yellowgreen`.split(/\s+/));

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
  it("no_colour_literals_in_components", () => {
    const offenders = filesUnder(src).filter((path) => path.endsWith(".tsx")).flatMap((path) => {
      const matches = readFileSync(path, "utf8").match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
      return matches ? [`${relative(src, path)}: ${matches.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("no_legacy_token_names_remain", () => {
    const legacy = /--(?:bg-primary|bg-surface|bg-secondary|border-color|text-main|primary[\w-]*|span-[\w-]*)\b/g;
    const offenders = filesUnder(src).flatMap((path) => {
      const matches = readFileSync(path, "utf8").match(legacy);
      return matches ? [`${relative(src, path)}: ${[...new Set(matches)].join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("only_tokens_css_declares_colours", () => {
    const offenders = filesUnder(resolve(src, "styles"))
      .filter((path) => path.endsWith(".css") && path !== resolve(src, "styles/tokens.css"))
      .flatMap((path) => {
        const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        const literals = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [];
        const named: string[] = [];
        for (const declaration of css.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)/g)) {
          if (!/^(?:color|background(?:-color|-image)?|border(?:-[\w-]+)?|outline(?:-color)?|(?:box|text)-shadow|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|scrollbar-color)$/i.test(declaration[1])) continue;
          const value = declaration[2].replace(/--[\w-]+/g, "").replace(/["'][^"']*["']/g, "");
          named.push(...(value.match(/\b[a-z]+\b/gi) ?? []).filter((word) => namedColours.has(word.toLowerCase())));
        }
        const matches = [...literals, ...named];
        return matches.length ? [`${relative(src, path)}: ${[...new Set(matches)].join(", ")}`] : [];
      });
    expect(offenders).toEqual([]);
  });

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
    // The resize-handle focus ring sits on the sheet and next to every mark fill (Q7).
    expect(below(cross(["--focus-ring"], ["--surface-raised", ...FILLS]), contrast, 3)).toEqual([]);
  });

  /*
   * Mark fills are soft highlighters over the lower half of the line (T6a Task 1,
   * second iteration). The state of a mark is told by its line style or pattern
   * (solid, dashed, dotted, hatch, frame; see browser/design.spec.ts), so the fills
   * only have to keep neighbouring terms apart, not carry meaning. Floors, CIEDE2000:
   * - normal vision, pairwise >= 10 (was 12): clearly different side by side
   *   (a just-noticeable difference is about 1-2, "obviously different" about 5);
   * - every fill against the sheet >= 10: a mark is visible without its line;
   * - simulated protan, deutan and tritan dichromacy (Machado 2009, severity 1),
   *   pairwise >= 4 (was 8): no two slots collapse into the same colour. Light,
   *   low-chroma fills cannot reach 8 under dichromacy without becoming heavy
   *   again, which is what the user rejected; the line styles are the guarantee.
   */
  it("mark_fills_are_distinct_for_normal_vision", () => {
    expect(below(pairs(FILLS), deltaE2000, 10)).toEqual([]);
    expect(below(cross(FILLS, ["--surface-raised"]), deltaE2000, 10)).toEqual([]);
  });

  it("mark_fills_are_distinct_under_colour_vision_deficiencies", () => {
    for (const d of DEFICIENCIES) {
      const simulated = (a: string, b: string) => deltaE2000(simulate(a, d), simulate(b, d));
      expect(below(pairs(FILLS), simulated, 4), d).toEqual([]);
    }
  });
  /*
   * Consolidation person lanes (frontend/src/consolidation/TextPane.tsx): each lane
   * aliases an existing token. The underline is a non-text graphic (>= 3:1 on the
   * sheet and on the shaded "kept" background). Lanes 1 and 2 (the usual two
   * people) must stay apart under every dichromacy; every lane also has its own
   * line style, which is the guarantee for lanes 3 and 4.
   */
  it("consolidation_lane_lines", () => {
    const css = readFileSync(resolve(here, "../src/styles/tokens.css"), "utf8");
    const LANES = ["--accent", "--warning", "--success", "--mark-line"];
    LANES.forEach((alias, index) => {
      expect(css).toContain(`--lane-${index + 1}-line: var(${alias});`);
    });
    expect(below(cross(LANES, ["--surface-raised", "--surface-sunken"]), contrast, 3)).toEqual([]);
    expect(deltaE2000(token(LANES[0]), token(LANES[1]))).toBeGreaterThan(20);
    for (const d of DEFICIENCIES) {
      expect(deltaE2000(simulate(token(LANES[0]), d), simulate(token(LANES[1]), d)), d).toBeGreaterThan(10);
    }
  });
});
