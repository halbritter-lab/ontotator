import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { InlineMessage } from "../ui/InlineMessage";
import { axisOptionLabel } from "./axisLabels";
import { dialogItems, submitBlockedReason, summaryLine, type OpenItem } from "./openItems";
import { UnconfirmedValuesSection } from "./UnconfirmedValuesSection";
import { valueCount, type UnconfirmedRow } from "./unconfirmedValues";
import "./submitDialog.css";

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
  /** Findings with empty or defaulted values (`unconfirmedRows`), shown in their own section. */
  unconfirmed: readonly UnconfirmedRow[];
  /** Project rule `require_chosen_axes` (`view.require_chosen_axes`): rows block, no checkbox. */
  requireChosenAxes: boolean;
  /** Why "Confirm" is unavailable (queue conflict, error, offline), else null. */
  confirmUnavailableReason: string | null;
  /** One set_axes for the row; resolves false (never rejects) when nothing was confirmed. */
  onConfirmValues: (row: UnconfirmedRow) => Promise<boolean>;
  acknowledged: boolean;
  setAcknowledged: (checked: boolean) => void;
  /** Polite status from the submit flow, e.g. "The unconfirmed values changed. Check the list again." */
  submitStatus: string | null;
  textChecked: boolean;
  saving: boolean;
  readOnly: boolean;
  setTextChecked: (checked: boolean) => void;
  /** Closes the dialog and goes to the item: selects it, scrolls to its mark and focuses its control. */
  onGoTo: (item: OpenItem) => void;
  /** "Go to" of an unconfirmed row: like `onGoTo`, at the row's first open axis. */
  onGoToRow: (row: UnconfirmedRow) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Final confirmation before a case is submitted, listing everything that blocks or warns. */
export function SubmitCaseDialog({
  open, documentId, reviewMode, resultCount, confirmedCount, unresolvedDecisionCount, savedFindingsCount,
  reviewTargetCount, openReviewTargetCount, pendingReanchorCount, unresolvedReanchorCount, items: allItems,
  unconfirmed, requireChosenAxes, confirmUnavailableReason, onConfirmValues, acknowledged, setAcknowledged, submitStatus,
  textChecked, saving, readOnly, setTextChecked, onGoTo, onGoToRow, onConfirm, onCancel,
}: SubmitCaseDialogProps) {
  const reasonId = useId();
  const [announcement, setAnnouncement] = useState<{ text: string; count: number } | null>(null);
  useEffect(() => { if (!open) setAnnouncement(null); }, [open]);
  const textCheckedInput = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  // No confirmable row left to focus: "Entire text checked" while unchecked, else "Submit case".
  const focusAfterRows = useCallback(() => {
    const input = textCheckedInput.current;
    (input && !input.checked ? input : submitButton.current)?.focus();
  }, []);

  // Defaulted and unconfirmed values have their own section; the generic list keeps the other kinds.
  const items = dialogItems(allItems);
  const n = valueCount(unconfirmed);
  const rowsRemain = unconfirmed.length > 0;
  const showAcknowledgement = rowsRemain && !requireChosenAxes;
  const blockedReason = readOnly ? "This case is read-only."
    : submitBlockedReason(items, requireChosenAxes ? n : 0)
    ?? (!textChecked ? "Confirm that the entire text was checked before submitting."
      : rowsRemain && !acknowledged ? `Confirm the values or tick “Submit with ${n} unconfirmed values” before submitting.`
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
          ref={submitButton}
          type="button"
          variant="primary"
          loading={saving}
          aria-disabled={blockedReason ? true : undefined}
          aria-describedby={blockedReason ? reasonId : undefined}
          onClick={submit}
        >
          Submit case
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
      <UnconfirmedValuesSection rows={unconfirmed} optionLabel={axisOptionLabel}
        confirmUnavailableReason={confirmUnavailableReason} onConfirmValues={onConfirmValues}
        onGoTo={onGoToRow} onEmpty={focusAfterRows} />
      {showAcknowledgement && <div className="submit-ack">
        <Checkbox id="submit-axis-warning" label={`Submit with ${n} unconfirmed values`}
          hint="Acknowledging does not confirm the values; they stay marked as defaults."
          checked={acknowledged} disabled={saving} onChange={event => setAcknowledged(event.target.checked)} />
      </div>}
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.9rem" }}>
        <input
          ref={textCheckedInput}
          type="checkbox"
          checked={textChecked}
          onChange={(e) => setTextChecked(e.target.checked)}
        />
        <span>Entire text checked for further findings</span>
      </label>
      {blockedReason && <p id={reasonId} className="form-hint" data-submit-blocked-reason>{blockedReason}</p>}
      <div className="visually-hidden" aria-live="polite" data-submit-status>
        {submitStatus && <span>{submitStatus}</span>}
      </div>
      <div className="visually-hidden" aria-live="assertive" data-submit-announcer>
        {announcement && <span key={announcement.count}>{announcement.text}</span>}
      </div>
    </Dialog>
  );
}
