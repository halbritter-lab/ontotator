import { useId } from "react";
import { IconCheck, IconClose } from "./icons";

export type TriState = "keep" | "on" | "off";

export interface TriStateButtonProps {
  value: TriState;
  /** Title when the selected items differ, e.g. "12 on, 8 off"; the cell then shows "mixed" instead of "keep". */
  mixed?: string;
  /** Cell name without the state, e.g. "Review, fr". */
  label: string;
  describedBy?: string;
  disabled?: boolean;
  onChange: (next: TriState) => void;
}

const order: Record<TriState, TriState> = { keep: "on", on: "off", off: "keep" };

/** keep → on → off → keep */
export const nextTriState = (value: TriState): TriState => order[value];

/** A cell of a bulk plan matrix that cycles keep, on and off; the state is always shown as text. */
export function TriStateButton({ value, mixed, label, describedBy, disabled = false, onChange }: TriStateButtonProps): JSX.Element {
  const hintId = `tristate-hint-${useId().replace(/:/g, "")}`;
  const shown = value === "keep" && mixed ? "mixed" : value;
  return (
    <>
      <button
        type="button"
        className="ui-tristate"
        data-state={shown}
        aria-label={`${label}, ${shown}`}
        aria-describedby={[hintId, describedBy].filter(Boolean).join(" ")}
        aria-disabled={disabled || undefined}
        title={value === "keep" ? mixed : undefined}
        onClick={() => { if (!disabled) onChange(nextTriState(value)); }}
      >
        {value === "on" && <IconCheck />}
        {value === "off" && <IconClose />}
        <span>{shown}</span>
      </button>
      <span id={hintId} hidden>Click to change: keep, on, off.</span>
    </>
  );
}
