export type PathTone = "done" | "now" | "later" | "optional";
export interface PathSegment { id: string; title: string; state: string; tone: PathTone }
export interface StagePathProps {
  segments: readonly PathSegment[];
  /** The segment shown below (dark blue); none on the consolidation screen. */
  current?: string;
  onSelect?: (id: string) => void;
  label?: string; // default "Text path"
}

const TONE_WORDS: Readonly<Record<PathTone, string>> = { done: ", done", now: ", needs work now", later: ", later", optional: ", optional" };

/** The path of a text (Translation, Annotation, Finalization) as arrow segments; the tone is also said in words. */
export function StagePath({ segments, current, onSelect, label = "Text path" }: StagePathProps): JSX.Element {
  return <nav aria-label={label}>
    <ol className="stage-path">
      {segments.map((segment) => {
        const isCurrent = segment.id === current;
        const className = `stage-path-seg stage-path-seg--${segment.tone}${isCurrent ? " stage-path-seg--current" : ""}`;
        const content = <>
          <span className="stage-path-title">{segment.title}</span>{" "}
          <span className="stage-path-state">{segment.state}</span>
          <span className="visually-hidden">{TONE_WORDS[segment.tone]}</span>
        </>;
        return <li key={segment.id}>
          {onSelect
            ? <button type="button" className={className} aria-current={isCurrent ? "step" : undefined} onClick={() => onSelect(segment.id)}>{content}</button>
            : <span className={className}>{content}</span>}
        </li>;
      })}
    </ol>
  </nav>;
}
