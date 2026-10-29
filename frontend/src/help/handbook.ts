/**
 * The user handbook (docs/handbook/*.md and its images), bundled at build time so it works without
 * internet. Chapters are inlined as text; images stay separate asset files, loaded only when shown.
 */
import { routeHref } from "../app/router";

const GITHUB_DOCS = "https://github.com/halbritter-lab/ontotator/blob/main";
/** A stand-in origin to resolve relative Markdown links against the repository layout. */
const BASE = "https://handbook.invalid/docs/handbook/";

const sources = import.meta.glob<string>("../../../docs/handbook/*.md", { query: "?raw", import: "default", eager: true });
const imageUrls = import.meta.glob<string>("../../../docs/handbook/images/*", { query: "?url", import: "default", eager: true });

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Chapter name (file name without `.md`, e.g. `README`, `lead`) → Markdown. */
export const CHAPTERS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(sources).map(([path, text]) => [fileName(path).replace(/\.md$/, ""), text]));
const IMAGES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(imageUrls).map(([path, url]) => [`images/${fileName(path)}`, url]));

/** The chapter's first `# ` heading, else its name. */
export function chapterTitle(chapter: string): string {
  return /^# +(.+)$/m.exec(CHAPTERS[chapter] ?? "")?.[1].trim() ?? chapter;
}

/** README first, then the chapters in the order README links them, then the rest by name. */
export function chapterOrder(): string[] {
  const linked = [...(CHAPTERS.README ?? "").matchAll(/\]\(([A-Za-z0-9_-]+)\.md[)#]/g)].map(match => match[1]);
  return [...new Set(["README", ...linked, ...Object.keys(CHAPTERS).sort()])].filter(name => name in CHAPTERS);
}

/** GitHub's heading anchor: lower case, punctuation and symbols dropped, each space a hyphen (github-slugger). */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

/** Repeated headings get `-1`, `-2`, … as on GitHub. */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return text => {
    const base = slug(text);
    let id = base;
    while (seen.has(id)) {
      const count = seen.get(base)! + 1;
      seen.set(base, count);
      id = `${base}-${count}`;
    }
    seen.set(id, 0);
    return id;
  };
}

export type HelpTarget =
  | { kind: "anchor"; id: string }
  | { kind: "chapter"; href: string }
  | { kind: "external"; href: string };

/** Where a Markdown link of `chapter` leads: in-page, another bundled chapter, or outside (new tab). */
export function resolveLink(href: string, chapter: string): HelpTarget {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "external", href };
  const url = new URL(href, `${BASE}${chapter}.md`);
  const id = decodeURIComponent(url.hash.slice(1));
  const name = /^\/docs\/handbook\/([A-Za-z0-9_-]+)\.md$/.exec(url.pathname)?.[1];
  if (name && name in CHAPTERS) {
    if (name === chapter && id) return { kind: "anchor", id };
    return { kind: "chapter", href: routeHref({ name: "help", chapter: name, ...(id ? { section: id } : {}) }) };
  }
  return { kind: "external", href: `${GITHUB_DOCS}${url.pathname}${url.hash}` };
}

/** The bundled URL of a relative image path, or null when it is not part of the handbook. */
export function imageUrl(src: string, chapter: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  const path = new URL(src, `${BASE}${chapter}.md`).pathname.replace(/^\/docs\/handbook\//, "");
  return IMAGES[path] ?? null;
}
