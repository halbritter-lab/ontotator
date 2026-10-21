import { IconClose } from "./icons";

export interface FilterChipProps {
  /** Visible filter text, e.g. "Language: de". */
  label: string;
  onRemove: () => void;
}

/** An active filter; activating it removes the filter. Named "Remove filter {label}". */
export function FilterChip({ label, onRemove }: FilterChipProps): JSX.Element {
  return <button type="button" className="ui-filter-chip" aria-label={`Remove filter ${label}`} onClick={onRemove}>
    {label}<IconClose className="ui-filter-chip-icon" />
  </button>;
}
