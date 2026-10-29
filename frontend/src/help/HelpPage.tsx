import { useEffect, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element, Root, RootContent } from "hast";
import { routeHref } from "../app/router";
import { CHAPTERS, chapterOrder, chapterTitle, imageUrl, resolveLink, slugger } from "./handbook";
import "../ui/guidelineDocument.css";
import "./help.css";

const textOf = (node: Root | RootContent): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(textOf).join("") : "";

/** Gives every heading its GitHub id, so `#anchor` links and contextual help land on it. */
function rehypeHeadingIds() {
  return (tree: Root) => {
    const next = slugger();
    const visit = (node: Root | Element) => node.children.forEach(child => {
      if (child.type !== "element") return;
      if (/^h[1-6]$/.test(child.tagName)) child.properties.id = next(textOf(child));
      else visit(child);
    });
    visit(tree);
  };
}

function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView();
}

const plainClick = (event: MouseEvent) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

function components(chapter: string): Components {
  return {
    a: ({ href, children }) => {
      if (!href) return <>{children}</>;
      const target = resolveLink(href, chapter);
      if (target.kind === "external") return <a href={target.href} target="_blank" rel="noopener noreferrer">{children}</a>;
      if (target.kind === "chapter") return <a href={target.href}>{children}</a>;
      // In-page anchors scroll; the app's hash router never sees them.
      return <a href={routeHref({ name: "help", chapter, section: target.id })} onClick={event => {
        if (!plainClick(event)) return;
        event.preventDefault();
        scrollToSection(target.id);
      }}>{children}</a>;
    },
    img: ({ src, alt }) => {
      const url = src ? imageUrl(src, chapter) : null;
      return url ? <img className="help-image" src={url} alt={alt ?? ""} loading="lazy" /> : <span className="guideline-image-text">{alt ? `Image: ${alt}` : "Image"}</span>;
    },
    table: ({ children }) => <div className="guideline-table-scroll" tabIndex={0} role="region" aria-label="Table"><table>{children}</table></div>,
  };
}

/** The bundled user handbook: chapter list and the chapter, scrolled to `section` when given. */
export default function HelpPage({ chapter = "README", section }: { chapter?: string; section?: string }): JSX.Element {
  const body = CHAPTERS[chapter];
  useEffect(() => {
    if (section) scrollToSection(section);
    else document.getElementById("main")?.scrollTo?.(0, 0);
  }, [chapter, section]);
  return <div className="help-page">
    <nav className="help-chapters" aria-label="Handbook chapters">
      <ul>
        {chapterOrder().map(name => <li key={name}>
          <a href={routeHref({ name: "help", chapter: name })} aria-current={name === chapter ? "page" : undefined}>{chapterTitle(name)}</a>
        </li>)}
      </ul>
    </nav>
    <article className="guideline-document help-document">
      {body === undefined ? <><h1>Chapter not found</h1><p>This handbook has no chapter “{chapter}”. Pick one from the list.</p></>
        : <div className="guideline-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHeadingIds]} skipHtml components={components(chapter)}>{body}</ReactMarkdown>
        </div>}
    </article>
  </div>;
}
