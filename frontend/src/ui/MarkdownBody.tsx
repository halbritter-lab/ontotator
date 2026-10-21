import { createContext, useContext, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Link schemes that may become a real, clickable link. Everything else renders as text. */
const LINK_SCHEMES = new Set(["http", "https", "mailto"]);

function scheme(url: string): string | null {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? null;
}

/**
 * `defaultUrlTransform` (drops `javascript:`, `vbscript:`, `data:` and other unsafe schemes by
 * returning `""`) narrowed to the allow-list: any other scheme is emptied too. Relative URLs and
 * `#anchors` pass through so the overrides can show them as text.
 */
function guidelineUrlTransform(url: string): string {
  const safe = defaultUrlTransform(url);
  const found = scheme(safe);
  return found !== null && !LINK_SCHEMES.has(found) ? "" : safe;
}

type Target = { kind: "none" } | { kind: "external"; href: string } | { kind: "local"; href: string };

function classify(href: string | undefined): Target {
  if (!href) return { kind: "none" };
  const found = scheme(href);
  if (found !== null && LINK_SCHEMES.has(found)) return { kind: "external", href };
  if (found !== null) return { kind: "none" };
  return { kind: "local", href };
}

const InsideLink = createContext(false);

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <InsideLink.Provider value={true}>
      <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    </InsideLink.Provider>
  );
}

function textOf(children: ReactNode): string | null {
  if (typeof children === "string") return children;
  if (Array.isArray(children) && children.every(child => typeof child === "string")) return children.join("");
  return null;
}

const MarkdownLink: NonNullable<Components["a"]> = ({ href, children }) => {
  const insideLink = useContext(InsideLink);
  const target = classify(href);
  if (target.kind === "external" && !insideLink) return <ExternalLink href={target.href}>{children}</ExternalLink>;
  // GFM footnote references and back-references are in-document anchors: text only, no target noise.
  const footnote = target.kind === "local" && target.href.startsWith("#user-content-fn");
  const showTarget = target.kind === "local" && !footnote && textOf(children) !== target.href;
  return (
    <span className="guideline-link-text">
      {children}
      {showTarget && <span className="guideline-link-target"> ({target.href})</span>}
    </span>
  );
};

const MarkdownImage: NonNullable<Components["img"]> = ({ src, alt }) => {
  const insideLink = useContext(InsideLink);
  const label = alt ? `Image: ${alt}` : "Image";
  const target = classify(src);
  if (target.kind === "external" && !insideLink) return <ExternalLink href={target.href}>{label}</ExternalLink>;
  return <span className="guideline-image-text">{label}</span>;
};

const MarkdownTable: NonNullable<Components["table"]> = ({ children }) => (
  <div className="guideline-table-scroll" tabIndex={0} role="region" aria-label="Table">
    <table>{children}</table>
  </div>
);

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

function headingComponents(headingOffset: number): Components {
  const components: Components = {};
  for (let depth = 1; depth <= 6; depth += 1) {
    // `#` sits one level below the surrounding panel's `h2`, shifted by `headingOffset`.
    const level = Math.min(6, Math.max(1, depth + 1 + headingOffset));
    const Tag = `h${level}` as HeadingTag;
    // Sized by Markdown depth (guideline-heading-n), not by tag level, so the offset changes structure only.
    components[`h${depth}` as HeadingTag] = ({ children }) => <Tag className={`guideline-heading-${depth}`}>{children}</Tag>;
  }
  return components;
}

/**
 * Markdown as React elements only: no raw HTML (shown as text, no raw-HTML plugin), images never
 * loaded, links only for http, https and mailto. Loaded lazily by `GuidelineDocument`.
 */
export default function MarkdownBody({ body, headingOffset = 1 }: { body: string; headingOffset?: number }) {
  return (
    <div className="guideline-markdown" data-testid="guideline-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={guidelineUrlTransform}
        components={{ ...headingComponents(headingOffset), a: MarkdownLink, img: MarkdownImage, table: MarkdownTable }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
