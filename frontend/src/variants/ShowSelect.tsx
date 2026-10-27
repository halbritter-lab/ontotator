import type { TextLayerEntry } from '../api/client';
import { layerKey } from './useTextLayers';

const GROUPS: readonly (readonly [string, readonly TextLayerEntry['kind'][]])[] = [
  ['Proposals', ['proposals']], ['Annotations', ['submission', 'person', 'own']], ['Result', ['final']],
];

export interface ShowSelectProps {
  entries: readonly TextLayerEntry[];
  /** Layer key (`text`, `proposals`, `{kind}:{id}`). */
  value: string;
  onChange: (key: string) => void;
  /** Label of a chosen key that is not an entry (an older submission opened from the history). */
  otherLabel?: string;
}

/** The text view's "Show" choice; entries the viewer may not open stay greyed with their reason (spec §4). */
/** "Not accepted yet." → "not accepted yet": the reason reads as an aside to the label. */
const unavailableReason = (reason: string | null | undefined): string => {
  const text = (reason ?? '').replace(/\.$/, '');
  return text.charAt(0).toLowerCase() + text.slice(1);
};

export function ShowSelect({ entries, value, onChange, otherLabel }: ShowSelectProps): JSX.Element {
  const listed = value === 'text' || entries.some(entry => entry.available && entry.ref && layerKey(entry.ref) === value);
  return <select className="form-select" aria-label="Show" value={value} onChange={event => onChange(event.target.value)}>
    <optgroup label="Text"><option value="text">Text only</option></optgroup>
    {GROUPS.map(([label, kinds]) => {
      const rows = entries.filter(entry => kinds.includes(entry.kind));
      return rows.length > 0 && <optgroup key={label} label={label}>
        {rows.map((entry, index) => entry.available && entry.ref
          ? <option key={index} value={layerKey(entry.ref)}>{entry.label}</option>
          : <option key={index} value="" disabled>{`${entry.label} (${unavailableReason(entry.reason)})`}</option>)}
      </optgroup>;
    })}
    {!listed && <option value={value}>{otherLabel ?? 'Unavailable'}</option>}
  </select>;
}
