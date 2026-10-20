import { IconCheck } from "./icons";

export interface PlanChipProps {
  kind: "review" | "annotate";
  pressed: boolean;
  /** Accessible name including the row, e.g. "Review, case-0101 · fr". */
  name: string;
  /** While saving the chip keeps focus (aria-disabled) and ignores clicks; the page announces "Saving…". */
  busy?: boolean;
  size?: "table" | "card";
  onToggle: () => void;
}

/** Toggle chip for one work-plan flag of a language row. State is shown by icon and aria-pressed, not colour alone. */
export function PlanChip({ kind, pressed, name, busy = false, size = "table", onToggle }: PlanChipProps): JSX.Element {
  return (
    <button
      type="button"
      className="ui-plan-chip"
      aria-pressed={pressed}
      aria-label={name}
      aria-disabled={busy || undefined}
      data-busy={busy || undefined}
      data-size={size}
      onClick={() => { if (!busy) onToggle(); }}
    >
      {pressed && <IconCheck />}
      <span>{kind === "review" ? "Review" : "Annotate"}</span>
    </button>
  );
}
