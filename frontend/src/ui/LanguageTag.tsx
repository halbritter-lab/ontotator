import type { ReactNode } from "react";
import { FLAG_HEIGHT, FLAG_WIDTH, FLAGS, type FlagShape } from "./flags";

/*
 * Small inline flags for language codes. Emoji flags are not an option: Windows renders
 * them as two letters, and the portable bundle runs without network. The flag is decorative
 * (aria-hidden); the code stays the text, so names and text matchers do not change.
 */

function shape(item: FlagShape, key: number): JSX.Element {
  switch (item.kind) {
    case "rect": return <rect key={key} x={item.x} y={item.y} width={item.width} height={item.height} fill={item.fill} />;
    case "circle": return <circle key={key} cx={item.cx} cy={item.cy} r={item.r} fill={item.fill} />;
    case "path": return <path key={key} d={item.d} fill={item.fill} stroke={item.stroke} strokeWidth={item.strokeWidth} />;
    case "polygon": return <polygon key={key} points={item.points} fill={item.fill} />;
  }
}

/** Region of a language without a region subtag (English is the UK flag). */
const LANGUAGE_REGIONS: Record<string, string> = {
  de: "DE", en: "GB", fr: "FR", es: "ES", it: "IT", nl: "NL", pt: "PT", pl: "PL", sv: "SE", da: "DK", fi: "FI",
  no: "NO", nb: "NO", nn: "NO", cs: "CZ", tr: "TR", el: "GR", ru: "RU", ja: "JP", zh: "CN", uk: "UA", hu: "HU", ro: "RO",
};

/** Region codes people write that are not ISO 3166-1. */
const REGION_ALIASES: Record<string, string> = { UK: "GB" };

/**
 * The flag region for a language code: a known region subtag wins (de-AT → AT, pt-BR → BR,
 * en-US → US), else the base language (en → GB). Undefined when no flag is bundled.
 */
export function languageFlagRegion(code: string): string | undefined {
  const [base = "", ...subtags] = code.trim().split(/[-_]/);
  for (const subtag of subtags) {
    if (!/^[a-z]{2}$/i.test(subtag)) continue;
    const region = REGION_ALIASES[subtag.toUpperCase()] ?? subtag.toUpperCase();
    if (region in FLAGS) return region;
  }
  return LANGUAGE_REGIONS[base.toLowerCase()];
}

/** The flag of a language, decorative (hidden from screen readers); nothing for a code without one. */
export function LanguageFlag({ code, className }: { code: string; className?: string }): JSX.Element | null {
  const region = languageFlagRegion(code);
  if (!region) return null;
  return <svg className={["language-flag", className].filter(Boolean).join(" ")} viewBox={`0 0 ${FLAG_WIDTH} ${FLAG_HEIGHT}`} width={FLAG_WIDTH} height={FLAG_HEIGHT}
    preserveAspectRatio="none" aria-hidden="true" focusable="false" data-flag={region}>{FLAGS[region].map(shape)}</svg>;
}

/** Flag and code ("[flag] de"); `children` replaces the visible code (e.g. upper case or a language name). */
export function LanguageTag({ code, children, className }: { code: string; children?: ReactNode; className?: string }): JSX.Element {
  return <span className={["language-tag", className].filter(Boolean).join(" ")}><LanguageFlag code={code} />{children ?? code}</span>;
}

/**
 * Text that names a language, e.g. "case-0101 de": the flag goes in before the last whole
 * occurrence of the code. The text content stays exactly the text (the flag adds none), and the
 * text stays in the parent element (no wrapper), so text matchers that read an element's own
 * text nodes still find it.
 */
export function LanguageText({ text, code }: { text: string; code: string }): JSX.Element {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...text.matchAll(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g"))];
  const at = matches.length ? matches[matches.length - 1].index : undefined;
  if (at === undefined || !languageFlagRegion(code)) return <>{text}</>;
  return <>{text.slice(0, at)}<LanguageFlag code={code} />{text.slice(at)}</>;
}
