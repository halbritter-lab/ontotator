import { StatusBadge } from "../../ui";
import { checkStateBadge, type CarriedState, type CheckVariant } from "./checkState";
import { carriedFromLine, linkedMetaLine } from "./instructions";
import "./carried-list.css";

export interface LinkedSource {
  term: string;
  sourceOrdinal: number | null;
}

/** Check-state badge ("Check needed" / "Checked" / "Dismissed"); text and shape, never colour alone. */
export function CarriedStateBadge({ variant }: { variant: CheckVariant }): JSX.Element {
  const badge = checkStateBadge(variant);
  return <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>;
}

/**
 * Extra content of a finding row that shows carried inputs: badge, "changed"/"removed" line,
 * meta line ("Carried from Round 2" or "Linked to …") and, while unchecked, the instruction line.
 * `linked` lists the inputs linked to this finding through the exception path.
 */
export function CarriedRowExtras({ state, sourceOrdinal, origin, instruction, linked }: {
  state: Pick<CarriedState, "variant" | "unchecked">;
  sourceOrdinal: number | null;
  /** Meta line instead of "Carried from Round n" (e.g. "Check after text change"). */
  origin?: string;
  instruction: string | null;
  linked?: readonly LinkedSource[];
}): JSX.Element {
  const { line } = checkStateBadge(state.variant);
  const meta = linked && linked.length > 0 ? linkedMetaLine(linked) : origin ?? carriedFromLine(sourceOrdinal);
  return (
    <div className="carried-extras">
      <div className="carried-extras__badge"><CarriedStateBadge variant={state.variant} /></div>
      {line && <p className="carried-extras__line">{line}</p>}
      <p className="carried-meta">{meta}</p>
      {state.unchecked && instruction && <p className="carried-instruction">{instruction}</p>}
    </div>
  );
}
