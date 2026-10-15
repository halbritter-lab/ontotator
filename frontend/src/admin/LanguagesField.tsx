import { useRef, useState } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { TextInput } from "../ui/TextInput";
import { IconClose } from "../ui/icons";

export interface LanguagesFieldProps {
  id: string;
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

const commonCodes = ["de", "en", "es", "fr", "it", "nl", "pt", "pl"];
const invalidCode = "Use a two-letter language code, e.g. de.";
const pendingCode = "Add this language code before saving.";

/** Commit on Enter/Add/blur. Parent forms must retain native validation so
 * requestSubmit cannot silently discard text that has not been committed.
 */
export function LanguagesField({ id, label, value, onChange, disabled = false }: LanguagesFieldProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const validityMessage = (text: string) => {
    const code = text.trim().toLowerCase();
    return !code ? "" : /^[a-z]{2}$/.test(code) ? pendingCode : invalidCode;
  };
  const commit = () => {
    if (disabled) return;
    const code = draft.trim().toLowerCase();
    if (code && !/^[a-z]{2}$/.test(code)) {
      setError(invalidCode);
      inputRef.current?.setCustomValidity(invalidCode);
      return;
    }
    setDraft("");
    setError("");
    inputRef.current?.setCustomValidity("");
    if (code && !value.some((selected) => selected.toLowerCase() === code)) {
      onChange([...value, code]);
    }
  };

  return <div>
    <TextInput ref={inputRef} id={id} label={label} value={draft} disabled={disabled}
      list={`${id}-suggestions`} autoComplete="off" autoCapitalize="none" spellCheck={false}
      hint="Press Enter or Add to add a language." error={error}
      onChange={(event) => {
        setDraft(event.target.value);
        setError("");
        // Even a valid code must be committed before a programmatic
        // requestSubmit; native validation prevents saving the old array.
        event.currentTarget.setCustomValidity(validityMessage(event.target.value));
      }}
      onBlur={commit}
      onInvalid={(event) => setError(event.currentTarget.validationMessage)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        commit();
      }} />
    <datalist id={`${id}-suggestions`}>
      {commonCodes.map((code) => <option key={code} value={code} />)}
    </datalist>
    <div className="toolbar">
      <Button type="button" size="sm" disabled={disabled || !draft.trim()} onClick={commit}>Add language</Button>
      {value.length > 0 && <ul className="language-tokens" aria-label={`${label}: selected languages`}>
        {value.map((code, index) => <li key={`${code}-${index}`} className="language-token">
          <span>{code}</span>
          <IconButton type="button" variant="quiet" size="sm" label={`Remove ${code}`} icon={<IconClose />} disabled={disabled}
            onClick={() => {
              onChange(value.filter((_, selected) => selected !== index));
              inputRef.current?.focus();
            }} />
        </li>)}
      </ul>}
    </div>
  </div>;
}
