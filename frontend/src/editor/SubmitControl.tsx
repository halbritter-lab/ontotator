import { Button } from "../ui/Button";
import { IconCheck } from "../ui/icons";

/** Toolbar control that starts the case submission. */
export function SubmitControl({ onSubmit, disabled, pending }: { onSubmit: () => void; disabled: boolean; pending: boolean }) {
  return (
    <Button
      type="button"
      variant="primary" size="sm"
      onClick={onSubmit}
      disabled={disabled}
      aria-busy={pending}
      title={pending ? "Saving changes before submitting" : "Finish and submit case"}
    >
      <IconCheck />
      Finish & Submit Case
    </Button>
  );
}
