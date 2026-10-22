import { IconClose } from "./icons";
import { LanguageText } from "./LanguageTag";

export interface FilterChipProps {
  /** Visible filter text, e.g. "Language: de". */
  label: string;
  /** Language code the label names: its flag goes in before the code (the text stays the label). */
  language?: string;
  onRemove: () => void;
}

/** An active filter; activating it removes the filter. Named "Remove filter {label}". */
export function FilterChip({ label, language, onRemove }: FilterChipProps): JSX.Element {
  return <button type="button" className="ui-filter-chip" aria-label={`Remove filter ${label}`} onClick={onRemove}>
    {language ? <LanguageText text={label} code={language} /> : label}<IconClose className="ui-filter-chip-icon" />
  </button>;
}
