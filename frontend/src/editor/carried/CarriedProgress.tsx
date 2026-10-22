import { Button, IconCheck, Kbd } from "../../ui";
import "./carried-list.css";

/** Sidebar progress line of a carry-forward round plus the quiet "Next unchecked" button (N). */
export function CarriedProgress({ text, showNext, onNext }: {
  /** From `progressText`, e.g. "2 of 5 checked, 1 dismissed". */
  text: string;
  /** True while any input is unchecked; false shows the "all done" check icon. */
  showNext: boolean;
  onNext: () => void;
}): JSX.Element {
  return (
    <div className="carried-progress">
      <p className="carried-progress__status" role="status">
        {!showNext && <IconCheck />}
        {text}
      </p>
      {showNext && (
        <Button size="sm" aria-keyshortcuts="N" onClick={onNext}>
          Next unchecked <Kbd>N</Kbd>
        </Button>
      )}
    </div>
  );
}
