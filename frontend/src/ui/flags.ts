/*
 * Flag artwork for language tags, as plain shape data on a 16 x 12 grid (simplified). Flag
 * colours are fixed national colours, not theme colours, so they live here and not in tokens.css.
 */

export const FLAG_WIDTH = 16;
export const FLAG_HEIGHT = 12;

export type FlagShape =
  | { kind: "rect"; x?: number; y?: number; width: number; height: number; fill: string }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: string }
  | { kind: "path"; d: string; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: "polygon"; points: string; fill: string };

const W = FLAG_WIDTH;
const H = FLAG_HEIGHT;

const rect = (x: number, y: number, width: number, height: number, fill: string): FlagShape => ({ kind: "rect", x, y, width, height, fill });
const field = (fill: string): FlagShape => rect(0, 0, W, H, fill);

/** Points of a five-pointed star (outer radius r). */
function star(cx: number, cy: number, r: number, fill: string): FlagShape {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.4;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return { kind: "polygon", points: points.join(" "), fill };
}

const horizontal = (...colours: string[]): FlagShape[] => colours.map((fill, i) => rect(0, i * (H / colours.length), W, H / colours.length, fill));
const vertical = (...colours: string[]): FlagShape[] => colours.map((fill, i) => rect(i * (W / colours.length), 0, W / colours.length, H, fill));

/** Nordic cross: field, cross and (Norway) an inner cross. */
const nordic = (background: string, cross: string, inner?: string): FlagShape[] => [
  field(background),
  rect(4, 0, inner ? 3 : 2.4, H, cross),
  rect(0, inner ? 4.5 : 4.8, W, inner ? 3 : 2.4, cross),
  ...(inner ? [rect(5, 0, 1, H, inner), rect(0, 5.5, W, 1, inner)] : []),
];

const stripes = (count: number, odd: string, even: string): FlagShape[] =>
  Array.from({ length: count }, (_, i) => rect(0, i * (H / count), W, H / count, i % 2 === 0 ? odd : even));

/** Flag artwork by ISO 3166-1 alpha-2 region code. */
export const FLAGS: Readonly<Record<string, readonly FlagShape[]>> = {
  GB: [
    field("#012169"),
    { kind: "path", d: "M0 0l16 12M16 0L0 12", stroke: "#fff", strokeWidth: 2.4 },
    { kind: "path", d: "M0 0l16 12M16 0L0 12", stroke: "#c8102e", strokeWidth: 0.8 },
    { kind: "path", d: "M8 0v12M0 6h16", stroke: "#fff", strokeWidth: 4 },
    { kind: "path", d: "M8 0v12M0 6h16", stroke: "#c8102e", strokeWidth: 2.4 },
  ],
  US: [...stripes(13, "#b22234", "#fff"), rect(0, 0, 6.4, (H * 7) / 13, "#3c3b6e")],
  DE: horizontal("#000", "#dd0000", "#ffce00"),
  AT: horizontal("#c8102e", "#fff", "#c8102e"),
  NL: horizontal("#ae1c28", "#fff", "#21468b"),
  RU: horizontal("#fff", "#0039a6", "#d52b1e"),
  PL: horizontal("#fff", "#dc143c"),
  UA: horizontal("#0057b7", "#ffd700"),
  HU: horizontal("#ce2939", "#fff", "#477050"),
  FR: vertical("#0055a4", "#fff", "#ef4135"),
  IT: vertical("#009246", "#fff", "#ce2b37"),
  BE: vertical("#000", "#fdda24", "#ef3340"),
  IE: vertical("#169b62", "#fff", "#ff883e"),
  RO: vertical("#002b7f", "#fcd116", "#ce1126"),
  ES: [field("#aa151b"), rect(0, 3, W, 6, "#f1bf00")],
  PT: [field("#da291c"), rect(0, 0, 6.4, H, "#046a38"), { kind: "circle", cx: 6.4, cy: 6, r: 2.2, fill: "#ffe900" }],
  SE: nordic("#006aa7", "#fecc00"),
  DK: nordic("#c8102e", "#fff"),
  FI: nordic("#fff", "#002f6c"),
  NO: nordic("#ba0c2f", "#fff", "#00205b"),
  CH: [field("#da291c"), rect(7, 2.5, 2, 7, "#fff"), rect(4.5, 5, 7, 2, "#fff")],
  CZ: [rect(0, 0, W, 6, "#fff"), rect(0, 6, W, 6, "#d7141a"), { kind: "path", d: "M0 0L8 6L0 12z", fill: "#11457e" }],
  GR: [
    ...stripes(9, "#0d5eaf", "#fff"),
    rect(0, 0, (H * 5) / 9, (H * 5) / 9, "#0d5eaf"),
    rect((H * 2) / 9, 0, H / 9, (H * 5) / 9, "#fff"),
    rect(0, (H * 2) / 9, (H * 5) / 9, H / 9, "#fff"),
  ],
  TR: [
    field("#e30a17"),
    { kind: "circle", cx: 6, cy: 6, r: 3, fill: "#fff" },
    { kind: "circle", cx: 6.8, cy: 6, r: 2.4, fill: "#e30a17" },
    star(10.2, 6, 1.3, "#fff"),
  ],
  JP: [field("#fff"), { kind: "circle", cx: 8, cy: 6, r: 3.6, fill: "#bc002d" }],
  CN: [
    field("#de2910"),
    star(3, 3, 1.9, "#ffde00"),
    star(6, 1.2, 0.6, "#ffde00"),
    star(7, 2.4, 0.6, "#ffde00"),
    star(7, 4, 0.6, "#ffde00"),
    star(6, 5.2, 0.6, "#ffde00"),
  ],
  BR: [
    field("#009c3b"),
    { kind: "path", d: "M8 1.5L14.5 6L8 10.5L1.5 6z", fill: "#ffdf00" },
    { kind: "circle", cx: 8, cy: 6, r: 2.6, fill: "#002776" },
  ],
};
