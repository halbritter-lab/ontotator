import { forwardRef, useMemo, type ReactNode } from "react";
import { paragraphStarts } from "../variants/paragraphs";
import { diffText, type TextDiffPart } from "./textDiff";
import "./translation.css";

/** Markers address the proposed text: deleted words never advance its coordinates. */
export const DiffView = forwardRef<HTMLDivElement, { before: string; after: string; parts?: readonly TextDiffPart[] }>(function DiffView({ before, after, parts }, ref) {
  const content = useMemo(() => {
    const starts = paragraphStarts(after), nodes: ReactNode[] = [];
    let position = 0, paragraph = 0, key = 0;
    const marker = () => nodes.push(<span key={`p${paragraph}`} aria-hidden="true" data-paragraph={paragraph} data-paragraph-offset={starts[paragraph++]} />);
    for (const part of parts ?? diffText(before, after)) {
      const chunk = (text: string) => {
        if (!text) return;
        const id = `t${key++}`;
        nodes.push(part.op === "delete" ? <del key={id} data-diff-op={part.op}>{text}</del> : part.op === "insert" ? <ins key={id} data-diff-op={part.op}>{text}</ins> : <span key={id} data-diff-op={part.op}>{text}</span>);
      };
      if (part.op === "delete") { chunk(part.text); continue; }
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
  }, [before, after, parts]);
  return <div ref={ref} className="translation-diff" role="region" aria-label="Text changes" tabIndex={0}>{content}</div>;
});
