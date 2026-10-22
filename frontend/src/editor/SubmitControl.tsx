import { Button } from "../ui/Button";
import { IconCheck } from "../ui/icons";

export interface SubmitControlProps {
  onSubmit: () => void;
  disabled: boolean;
  pending: boolean;
  /** Open items of the submit dialog; the label shows the count while it is above 0. */
  openCount?: number | null;
  /** Goes to the next open item; shown next to the button while items are open. */
  onNextOpen?: () => void;
}

/** Toolbar control that starts the case submission, with the remaining open items. */
export function SubmitControl({ onSubmit, disabled, pending, openCount = null, onNextOpen }: SubmitControlProps) {
  const open = openCount !== null && openCount > 0;
  return (
    <>
      {open && onNextOpen && (
        <Button type="button" size="sm" onClick={onNextOpen}>
          Next open item
        </Button>
      )}
      <Button
        type="button"
        variant="primary" size="sm"
        onClick={onSubmit}
        disabled={disabled}
        aria-busy={pending}
        title={pending ? "Saving changes before submitting" : "Finish and submit case"}
      >
        <IconCheck />
        {open ? `Finish & Submit · ${openCount} open` : "Finish & Submit Case"}
      </Button>
    </>
  );
}
