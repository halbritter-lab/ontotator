import { forwardRef, useMemo, type ReactNode } from "react";
import { paragraphStarts } from "../variants/paragraphs";
import { diffText, type TextDiffPart } from "./textDiff";
import "./translation.css";

/**
 * Text nodes with hidden paragraph markers for coupled scrolling.
 * Markers address the proposed text: deleted words never advance its coordinates.
 * Without deletions the rendered characters equal `after` exactly.
 */
export function paragraphNodes(after: string, parts: readonly TextDiffPart[], { deletions = true } = {}): ReactNode[] {
  const starts = paragraphStarts(after), nodes: ReactNode[] = [];
  let position = 0, paragraph = 0, key = 0;
  const marker = () => nodes.push(<span key={`p${paragraph}`} aria-hidden="true" data-paragraph={paragraph} data-paragraph-offset={starts[paragraph++]} />);
  for (const part of parts) {
    const chunk = (text: string) => {
      if (!text) return;
      const id = `t${key++}`;
      nodes.push(part.op === "delete" ? <del key={id} data-diff-op={part.op}>{text}</del> : part.op === "insert" ? <ins key={id} data-diff-op={part.op}>{text}</ins> : <span key={id} data-diff-op={part.op}>{text}</span>);
    };
    if (part.op === "delete") { if (deletions) chunk(part.text); continue; }
    const points = Array.from(part.text);
    let offset = 0;
    while (paragraph < starts.length && starts[paragraph] <= position + points.length) {
      const boundary = starts[paragraph] - position;
      chunk(points.slice(offset, boundary).join("")); marker(); offset = boundary;
    }
    chunk(points.slice(offset).join("")); position += points.length;
  }
  while (paragraph < starts.length) marker();
  return nodes;
}

export const DiffView = forwardRef<HTMLDivElement, { before: string; after: string; parts?: readonly TextDiffPart[]; lang?: string }>(function DiffView({ before, after, parts, lang }, ref) {
  const content = useMemo(() => paragraphNodes(after, parts ?? diffText(before, after)), [before, after, parts]);
  return <div ref={ref} className="translation-diff" role="region" aria-label="Text changes" tabIndex={0} lang={lang}>{content}</div>;
});

/** Read-only reading text with paragraph markers, without any editing affordance. */
export const TextView = forwardRef<HTMLDivElement, { text: string; label: string; lang?: string }>(function TextView({ text, label, lang }, ref) {
  const content = useMemo(() => paragraphNodes(text, [{ op: "equal", text }]), [text]);
  return <div ref={ref} className="translation-text" role="region" aria-label={label} tabIndex={0} lang={lang}>{content}</div>;
});
