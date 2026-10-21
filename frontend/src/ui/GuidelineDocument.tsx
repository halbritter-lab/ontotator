import { lazy, Suspense } from "react";
import "./guidelineDocument.css";

const MarkdownBody = lazy(() => import("./MarkdownBody"));

/**
 * A guideline's text: Markdown through the lazily loaded, sanitized renderer (its own chunk),
 * plain text as preformatted text. `headingOffset` (default 1) shifts Markdown headings so that
 * `#` renders one level below the surrounding panel's `h2` (`#` becomes `h3`).
 */
export function GuidelineDocument({ kind, body, headingOffset = 1 }: { kind: "markdown" | "text"; body: string; headingOffset?: number }) {
  if (kind === "text") {
    return (
      <div className="guideline-document">
        <pre className="guideline-text">{body.replace(/\r\n?/g, "\n")}</pre>
      </div>
    );
  }
  return (
    <div className="guideline-document">
      <Suspense fallback={<p className="guideline-loading" role="status">Loading guidelines…</p>}>
        <MarkdownBody body={body} headingOffset={headingOffset} />
      </Suspense>
    </div>
  );
}
