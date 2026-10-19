import { useEffect, useId, useState } from "react";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { InlineMessage } from "../ui/InlineMessage";
import { submitBlockedReason, summaryLine, type OpenItem } from "./openItems";

/** At most this many open items are listed; the rest are reached with "Next open item". */
const LISTED_ITEMS = 5;

export interface SubmitCaseDialogProps {
  open: boolean;
  documentId: string;
  reviewMode: boolean;
  resultCount: number;
  confirmedCount: number;
  unresolvedDecisionCount: number;
  savedFindingsCount: number;
  reviewTargetCount: number;
  openReviewTargetCount: number;
  pendingReanchorCount: number;
  unresolvedReanchorCount: number;
  /** Everything still open, in dialog order (`collectOpenItems`). */
  items: readonly OpenItem[];
  axisWarning: { warnings: { annotationId: string; axis: string }[] } | null;
  axisWarningAcknowledged: boolean;
  textChecked: boolean;
  saving: boolean;
  readOnly: boolean;
  setTextChecked: (checked: boolean) => void;
  setAxisWarningAcknowledged: (acknowledged: boolean) => void;
  /** Closes the dialog and goes to the item: selects it, scrolls to its mark and focuses its control. */
  onGoTo: (item: OpenItem) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Final confirmation before a case is submitted, listing everything that blocks or warns. */
export function SubmitCaseDialog({
  open, documentId, reviewMode, resultCount, confirmedCount, unresolvedDecisionCount, savedFindingsCount,
  reviewTargetCount, openReviewTargetCount, pendingReanchorCount, unresolvedReanchorCount, items, axisWarning,
  axisWarningAcknowledged, textChecked, saving, readOnly, setTextChecked, setAxisWarningAcknowledged, onGoTo,
  onConfirm, onCancel,
}: SubmitCaseDialogProps) {
  const reasonId = useId();
  const [announcement, setAnnouncement] = useState<{ text: string; count: number } | null>(null);
  useEffect(() => { if (!open) setAnnouncement(null); }, [open]);

  const blockedReason = readOnly ? "This case is read-only."
    : submitBlockedReason(items)
    ?? (!textChecked ? "Confirm that the entire text was checked before submitting."
      : axisWarning !== null && !axisWarningAcknowledged ? "Confirm “Submit with these unconfirmed values” before submitting."
      : null);
  const blocking = items.some(item => item.blocking);
  const firstCarried = items.find(item => item.kind === "carried");
  const listed = items.slice(0, LISTED_ITEMS);

  const submit = () => {
    if (blockedReason) {
      // Re-mounting the text makes screen readers read the same sentence again.
      setAnnouncement(previous => ({ text: blockedReason, count: (previous?.count ?? 0) + 1 }));
      return;
    }
    onConfirm();
  };

  return (
    <Dialog open={open} title="Submit case" heading={<>Submit case {documentId}?</>} onClose={onCancel}
      footer={<>
        <Button
          type="button"
          variant="primary"
          loading={saving}
          aria-disabled={blockedReason ? true : undefined}
          aria-describedby={blockedReason ? reasonId : undefined}
          onClick={submit}
        >
          {axisWarning ? "Continue and submit" : "Submit case"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </>}>
      <ul style={{ margin: "8px 0 12px", paddingLeft: 18, fontSize: "0.9rem" }}>
        {reviewMode ? (
          <li>
            {resultCount} annotation(s) will be submitted
            ({confirmedCount} confirmed proposal(s), {unresolvedDecisionCount} unresolved with reviewer flags, {savedFindingsCount} saved findings)
          </li>
        ) : (
          <li>{savedFindingsCount} annotation(s) in this case</li>
        )}
        {reviewMode && (
          <li>
            {reviewTargetCount - openReviewTargetCount} of {reviewTargetCount} review proposal(s) decided
            {openReviewTargetCount > 0 && <strong style={{ color: "var(--danger)" }}> – {openReviewTargetCount} still open</strong>}
          </li>
        )}
        {pendingReanchorCount > 0 && <li>{unresolvedReanchorCount} finding(s) after text correction still pending</li>}
      </ul>
      {items.length > 0 && <InlineMessage tone={blocking ? "error" : "warning"}>
        <p>{summaryLine(items)}</p>
        {firstCarried && <Button variant="secondary" size="sm" onClick={() => onGoTo(firstCarried)}>Go to first unchecked</Button>}
        <ul style={{ paddingLeft: 18 }}>
          {listed.map(item => <li key={item.key} data-open-item={item.kind}>
            <strong>{item.term}</strong> <span>{item.line}</span>{" "}
            <Button variant="quiet" size="sm" onClick={() => onGoTo(item)}>Go to {item.term}</Button>
          </li>)}
        </ul>
        {items.length > LISTED_ITEMS && <p>and {items.length - LISTED_ITEMS} more</p>}
      </InlineMessage>}
      {axisWarning && <InlineMessage tone="warning" title="Review unconfirmed clinical values">
        <p>These values have not been explicitly confirmed. Continuing records acknowledgement of this warning; it keeps the clinical values and their defaulted status unchanged.</p>
        <Checkbox id="submit-axis-warning" label="Submit with these unconfirmed values" checked={axisWarningAcknowledged} disabled={saving} onChange={event => setAxisWarningAcknowledged(event.target.checked)} />
      </InlineMessage>}
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.9rem" }}>
        <input
          type="checkbox"
          checked={textChecked}
          onChange={(e) => setTextChecked(e.target.checked)}
        />
        <span>Entire text checked for further findings</span>
      </label>
      {blockedReason && <p id={reasonId} className="form-hint" data-submit-blocked-reason>{blockedReason}</p>}
      <div className="visually-hidden" aria-live="assertive" data-submit-announcer>
        {announcement && <span key={announcement.count}>{announcement.text}</span>}
      </div>
    </Dialog>
  );
}
