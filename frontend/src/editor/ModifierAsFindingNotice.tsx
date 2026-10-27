import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";

export interface ModifierAsFindingNoticeProps {
  /** Label of the modifier term the finding stands on, e.g. "Severe". */
  term: string;
  readOnly: boolean;
  /** Starts the attach mode in convert mode (E-c). */
  onTurn: () => void;
}

/** R3: a modifier term as the finding's own term. Allowed (some name a finding, e.g. Stillbirth); the submit warns. */
export function ModifierAsFindingNotice({ term, readOnly, onTurn }: ModifierAsFindingNoticeProps) {
  return (
    <InlineMessage tone="warning">
      <p>{term} is a modifier term. Keep it only if it names the finding itself; otherwise turn it into a modifier of another finding.</p>
      {!readOnly && <Button type="button" size="sm" data-turn-into-modifier onClick={onTurn}>Turn into modifier…</Button>}
    </InlineMessage>
  );
}
