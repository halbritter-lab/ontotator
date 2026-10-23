/** Submit of the consolidation view (X12): while groups are open the button stays focusable with `aria-disabled`, a reason and "Next open group". */
import { useId } from "react";
import { Button } from "../ui";
import { SUBMIT_LABEL, submitReason } from "./consolidationText";

export interface SubmitBarProps {
  open: number;
  onSubmit: () => void;
  onNextOpen: () => void;
}

export function SubmitBar({ open, onSubmit, onNextOpen }: SubmitBarProps): JSX.Element {
  const reasonId = useId();
  if (open === 0) return <div className="cons-submit"><Button variant="primary" onClick={onSubmit}>{SUBMIT_LABEL}</Button></div>;
  return <div className="cons-submit">
    <Button variant="primary" aria-disabled aria-describedby={reasonId} onClick={() => undefined}>{SUBMIT_LABEL}</Button>
    <Button onClick={onNextOpen}>Next open group</Button>
    <p id={reasonId} className="action-reason">{submitReason(open)}</p>
  </div>;
}
