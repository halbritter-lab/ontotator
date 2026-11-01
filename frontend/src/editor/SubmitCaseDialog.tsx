import { useCallback, useEffect, useId, useRef, useState } from "react";
import { plural } from "../app/labels";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ModifierWarningsSection } from "./ModifierWarningsSection";
import { SubmitGroup } from "./SubmitGroup";
import { dialogItems, MODIFIER_WARNING_KINDS, submitBlockedReason, type OpenItem, type OpenItemKind } from "./openItems";
import { UnconfirmedValuesSection } from "./UnconfirmedValuesSection";
import { valueCount, type UnconfirmedRow } from "./unconfirmedValues";
import "./submitDialog.css";

/** At most this many open items are listed; the rest are reached with "Next open item". */
const LISTED_ITEMS = 5;

/** Group headings of the blocking items, in dialog order. */
const GROUPS: readonly [OpenItemKind, string][] = [
  ["carried", "Carried findings to check"],
  ["evidence", "Findings that need attention"],
  ["reanchor", "Findings after text correction"],
  ["review-target", "Proposals not decided"],
];

/**
 * "1 finding, nothing open." / "2 findings. 1 thing is still open:"; with proposals left Unresolved (issue 248):
 * "34 findings, 1 unresolved, nothing open."
 */
export function summaryText(findings: number, open: number, unresolved = 0): string {
  const counted = plural(findings, "finding") + (unresolved > 0 ? `, ${unresolved} unresolved` : "");
  if (open === 0) return `${counted}, nothing open.`;
  return `${counted}. ${open === 1 ? "1 thing is" : `${open} things are`} still open:`;
}

/** What the dialog's summary counts as open; the header's "Finish & submit (N open)" uses the same number. */
export function submitOpenCount(items: readonly OpenItem[], unconfirmed: readonly UnconfirmedRow[]): number {
  return dialogItems(items).length + unconfirmed.length + items.filter(item => MODIFIER_WARNING_KINDS.includes(item.kind)).length;
}

/** Label of the primary button: acknowledgeable warnings are submitted only with an explicit "Submit with N warnings". */
export function submitLabel(warnings: number): string {
  return warnings > 0 ? `Submit with ${plural(warnings, "warning")}` : "Submit text";
}

export interface SubmitCaseDialogProps {
  open: boolean;
  /** The text's name, as in the header and the breadcrumb. */
  textName: string;
  /** Findings that will be submitted (results in review modes, saved findings otherwise). */
  findingCount: number;
  /** Of `findingCount`, the proposals submitted as Unresolved (named in the summary, issue 248). */
  unresolvedCount?: number;
  /** Everything still open, in dialog order (`collectOpenItems`). */
  items: readonly OpenItem[];
  /** Findings with empty or defaulted values (`unconfirmedRows`), shown in their own group. */
  unconfirmed: readonly UnconfirmedRow[];
  /** Project rule `require_chosen_axes` (`view.require_chosen_axes`): open values block instead of warning. */
  requireChosenAxes: boolean;
  /** Why "Confirm as shown" is unavailable (queue conflict, error, offline), else null. */
  confirmUnavailableReason: string | null;
  /** One set_axes for the row; resolves false (never rejects) when nothing was confirmed. */
  onConfirmValues: (row: UnconfirmedRow) => Promise<boolean>;
  /** Polite status from the submit flow, e.g. "The unconfirmed values changed. Check the list again.";
   *  `count` changes on every announcement so a repeated text is read again. */
  submitStatus: { text: string; count: number } | null;
  saving: boolean;
  readOnly: boolean;
  /** Closes the dialog and goes to the item: selects it, scrolls to its mark and focuses its control. */
  onGoTo: (item: OpenItem) => void;
  /** "Go to" of a values row: like `onGoTo`, at the row's first open axis. */
  onGoToRow: (row: UnconfirmedRow) => void;
  /** `acknowledged`: "Submit with N warnings" was clicked for the warnings the dialog lists. */
  onConfirm: (acknowledged: boolean) => void;
  onCancel: () => void;
}

/** Final confirmation before a text is submitted: one summary line, then only what is still open, each with its action. */
export function SubmitCaseDialog({
  open, textName, findingCount, unresolvedCount = 0, items: allItems, unconfirmed, requireChosenAxes, confirmUnavailableReason, onConfirmValues,
  submitStatus, saving, readOnly, onGoTo, onGoToRow, onConfirm, onCancel,
}: SubmitCaseDialogProps) {
  const reasonId = useId();
  const [announcement, setAnnouncement] = useState<{ count: number } | null>(null);
  useEffect(() => { if (!open) setAnnouncement(null); }, [open]);
  const submitButton = useRef<HTMLButtonElement>(null);
  // No confirmable row left to focus: the primary button.
  const focusAfterRows = useCallback(() => submitButton.current?.focus(), []);

  // Values and modifier warnings have their own groups; the generic groups keep the blocking kinds.
  const items = dialogItems(allItems);
  const modifierWarnings = allItems.filter(item => MODIFIER_WARNING_KINDS.includes(item.kind));
  const warnings = (requireChosenAxes ? 0 : unconfirmed.length) + modifierWarnings.length;
  const blockedReason = readOnly ? "This text is read-only."
    : submitBlockedReason(items, requireChosenAxes ? valueCount(unconfirmed) : 0);
  const openCount = submitOpenCount(allItems, unconfirmed);
  let listed = 0;
  const groups = GROUPS.map(([kind, heading]) => {
    const rows = items.filter(item => item.kind === kind).slice(0, Math.max(0, LISTED_ITEMS - listed));
    listed += rows.length;
    return { kind, heading, rows };
  }).filter(group => group.rows.length > 0);

  const submit = () => {
    if (blockedReason) {
      // Re-mounting the text makes screen readers read the same sentence again.
      setAnnouncement(previous => ({ count: (previous?.count ?? 0) + 1 }));
      return;
    }
    onConfirm(warnings > 0);
  };

  return (
    <Dialog open={open} title="Submit text" heading={<>Submit {textName}?</>} onClose={onCancel}
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
          {blockedReason ? "Submit text" : submitLabel(warnings)}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </>}>
      <p className="submit-summary">{summaryText(findingCount, openCount, unresolvedCount)}</p>
      {/* Always mounted: the values group moves the focus on and announces after its last row is confirmed. */}
      <div className={openCount > 0 ? "submit-open" : undefined}>
        {groups.map(group => <SubmitGroup key={group.kind} heading={group.heading}>
          {group.rows.map(item => <li key={item.key} className="submit-item" data-open-item={item.kind}>
            <span className="submit-item__what"><strong>{item.term}</strong>{item.quote && <> <span className="submit-item__quote">“{item.quote}”</span></>}</span>
            <span className="submit-item__actions">
              <Button size="sm" aria-label={`Go to ${item.term}`} onClick={() => onGoTo(item)}>Go to</Button>
            </span>
            <span className="submit-item__line">{item.line}</span>
          </li>)}
        </SubmitGroup>)}
        {items.length > listed && <p className="submit-item__line submit-open__more">and {items.length - listed} more</p>}
        <UnconfirmedValuesSection rows={unconfirmed}
          confirmUnavailableReason={confirmUnavailableReason} onConfirmValues={onConfirmValues}
          onGoTo={onGoToRow} onEmpty={focusAfterRows} blocking={requireChosenAxes} />
        <ModifierWarningsSection items={modifierWarnings} onGoTo={onGoTo} />
      </div>
      {/* The rule is said once: the blocking reason, else the text check (the reason re-mounts on a blocked click). */}
      <div aria-live="assertive" data-submit-announcer>
        {blockedReason
          ? <p key={announcement?.count ?? 0} id={reasonId} className="form-hint" data-submit-blocked-reason>{blockedReason}</p>
          : <p className="form-hint" data-submit-checked-text>
            Submitting also says you checked the whole text for further findings.{openCount === 0 && " Afterwards the submission is read-only; to change it, start a new work round under More › Work rounds."}
          </p>}
      </div>
      <div className="visually-hidden" aria-live="polite" data-submit-status>
        {submitStatus && <span key={submitStatus.count}>{submitStatus.text}</span>}
      </div>
    </Dialog>
  );
}
