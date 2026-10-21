import { forwardRef, useMemo, type ChangeEvent, type CompositionEvent, type FocusEvent } from "react";
import { paragraphNodes } from "./DiffView";
import { diffText } from "./textDiff";
import "./translation.css";

export interface TranslationEditorProps {
  id: string;
  labelledBy: string;
  describedBy?: string;
  machineText: string;
  value: string;
  lang?: string;
  readOnly?: boolean;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  /** Blur, composition start and end of the textarea, so a caller can defer work during IME composition. */
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd?: (event: CompositionEvent<HTMLTextAreaElement>) => void;
}

/**
 * The single editable translation surface. The textarea grows with its text inside
 * one scrollport; a hidden mirror behind it lays out the same characters, marks text
 * that differs from the machine translation and carries the paragraph markers that
 * coupled scrolling reads. The mirror never shows text of its own.
 */
export const TranslationEditor = forwardRef<HTMLDivElement, TranslationEditorProps>(function TranslationEditor(
  { id, labelledBy, describedBy, machineText, value, lang, readOnly = false, disabled = false, onChange, onBlur, onCompositionStart, onCompositionEnd }, ref,
) {
  const mirror = useMemo(() => paragraphNodes(value, diffText(machineText, value), { deletions: false }), [machineText, value]);
  return <div ref={ref} className="translation-editor">
    <div className="translation-editor-sizer">
      <div className="translation-editor-mirror" aria-hidden="true">{mirror}{"​"}</div>
      <textarea id={id} className="translation-editor-input" aria-labelledby={labelledBy} aria-describedby={describedBy}
        value={value} lang={lang} readOnly={readOnly} disabled={disabled} onChange={onChange}
        onBlur={onBlur} onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd} />
    </div>
  </div>;
});
