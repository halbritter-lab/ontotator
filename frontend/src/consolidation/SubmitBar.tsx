/**
 * Progress card of the consolidation view (X12, B5-5, B5-6 mockup 02 variant B): the count, a meter and the main
 * action. While groups are open "Next open group" is primary and Submit stays focusable with `aria-disabled` and a
 * visible reason under it; once every group is decided the card turns green, reads "Ready to submit" and Submit is the one primary.
 */
import { useId } from "react";
import { Button } from "../ui";
import { IconCheck } from "../ui/icons";
import { SUBMIT_LABEL, submitReason } from "./consolidationText";

export interface SubmitBarProps {
  open: number;
  total: number;
  onSubmit: () => void;
  onNextOpen: () => void;
}

export function SubmitBar({ open, total, onSubmit, onNextOpen }: SubmitBarProps): JSX.Element {
  const reasonId = useId();
  const decided = total - open;
  const meter = <div className="cons-progress-meter" aria-hidden="true"><i style={{ width: `${total ? (decided / total) * 100 : 100}%` }} /></div>;
  if (open === 0) return <div className="cons-progress cons-progress--ready">
    <p className="cons-progress-line"><b><IconCheck /> Ready to submit</b><span className="cons-muted">{`${decided} of ${total} ${total === 1 ? "group" : "groups"} decided`}</span></p>
    {meter}
    <Button variant="primary" onClick={onSubmit}>{SUBMIT_LABEL}</Button>
  </div>;
  return <div className="cons-progress">
    <p className="cons-progress-line"><b>{`${open} of ${total} ${total === 1 ? "group" : "groups"} open`}</b><span className="cons-muted">{`${decided} decided`}</span></p>
    {meter}
    <div className="cons-progress-actions">
      <Button variant="primary" onClick={onNextOpen}>Next open group</Button>
      <Button aria-disabled aria-describedby={reasonId} onClick={() => undefined}>{SUBMIT_LABEL}</Button>
    </div>
    <p id={reasonId} className="cons-muted">{submitReason(open)}</p>
  </div>;
}
