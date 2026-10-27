import { forwardRef, useId, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { TextInput, type TextInputProps } from "./TextInput";

export interface SuggestOption { value: string; label?: string }

export type SuggestInputProps = TextInputProps & {
  /** Shown as given; the caller filters them by the typed text. */
  suggestions: readonly SuggestOption[];
  onPick: (value: string) => void;
};

/**
 * A text field with a suggestion list (ARIA combobox) right under the field, in the field's own box: it scrolls and
 * moves with the field inside dialogs and panels (the native `<datalist>` popup opened detached, #4/#17.2).
 * Arrow keys move the active option, Enter picks it, Escape closes; typing stays free text.
 */
export const SuggestInput = forwardRef<HTMLInputElement, SuggestInputProps>(function SuggestInput(
  { suggestions, onPick, onKeyDown, onFocus, onBlur, onChange, ...props }, ref,
) {
  const listId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = open && suggestions.length > 0 && !props.disabled;
  const activeIndex = shown && active < suggestions.length ? active : -1;
  const pick = (value: string) => { setOpen(false); setActive(-1); onPick(value); };
  const setRef = (element: HTMLInputElement | null) => {
    input.current = element;
    if (typeof ref === "function") ref(element); else if (ref) (ref as MutableRefObject<HTMLInputElement | null>).current = element;
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!shown) { setOpen(true); setActive(event.key === "ArrowDown" ? 0 : suggestions.length - 1); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + suggestions.length) % suggestions.length);
      return;
    }
    if (shown && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); return; }
    if (activeIndex >= 0 && event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation();
      pick(suggestions[activeIndex].value);
      return;
    }
    // Enter on free text commits it (the caller's job): close the list so it no longer covers the controls below.
    if (event.key === "Enter" && !event.nativeEvent.isComposing) { setOpen(false); setActive(-1); }
    onKeyDown?.(event);
  };
  const field = input.current;
  return <div className="suggest-field">
    <TextInput {...props} ref={setRef} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={shown}
      aria-controls={shown ? listId : undefined} aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      onKeyDown={keyDown}
      onFocus={event => { setOpen(true); onFocus?.(event); }}
      onBlur={event => { setOpen(false); setActive(-1); onBlur?.(event); }}
      onChange={event => { setOpen(true); setActive(-1); onChange?.(event); }} />
    {shown && <ul id={listId} role="listbox" aria-label="Suggestions" className="suggest-list"
      style={field ? { top: field.offsetTop + field.offsetHeight + 2, left: field.offsetLeft, minWidth: field.offsetWidth } : undefined}>
      {suggestions.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
        className="suggest-option" onMouseEnter={() => setActive(index)}
        // Keep the focus (and an open draft) in the field; the click picks.
        onMouseDown={event => event.preventDefault()} onClick={() => pick(option.value)}>
        <span className="suggest-option__value">{option.value}</span>{option.label && <span className="suggest-option__label">{option.label}</span>}
      </li>)}
    </ul>}
  </div>;
});
