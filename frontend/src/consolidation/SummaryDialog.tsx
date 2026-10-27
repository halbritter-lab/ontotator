/** Summary before submitting the consolidation (X12, T10): the decisions and terms kept twice, then "Submit". When the
 *  server answers with advisory warnings (values by default, modifiers, #57), they are listed in the same dialog and only
 *  "Submit with N warnings" acknowledges them. */
import { errorMessage } from "../admin/errors";
import { Button, Dialog, InlineMessage } from "../ui";
import type { AxisWarning } from "./useConsolidation";

export interface SummaryDialogProps {
  open: boolean;
  summary: string;
  /** R-3: terms the result holds more than once ("More than one finding with the same term: Fatigue."). */
  duplicates?: string | null;
  busy: boolean;
  warning: AxisWarning | null;
  error: unknown;
  /** `acknowledged`: the second click, after the warnings were shown. */
  onSubmit: (acknowledged: boolean) => void;
  onClose: () => void;
}

const findings = (count: number) => count === 1 ? "1 finding has" : `${count} findings have`;

/** The warning lines in plain words; "Some findings have values filled in by default." when the server counts none. */
export function warningLines(warning: AxisWarning): string[] {
  return [
    warning.count > 0 || (!warning.modifiers && !warning.asFinding) ? `${warning.count ? findings(warning.count) : "Some findings have"} values filled in by default, not chosen.` : null,
    warning.asFinding > 0 ? `${warning.asFinding === 1 ? "1 finding uses" : `${warning.asFinding} findings use`} a modifier term (such as Severe) as the finding itself.` : null,
    warning.modifiers > 0 ? `${findings(warning.modifiers)} a modifier warning: a cohort term, or two of one kind.` : null,
  ].filter((line): line is string => line !== null);
}

export function SummaryDialog({ open, summary, duplicates, busy, warning, error, onSubmit, onClose }: SummaryDialogProps): JSX.Element {
  const lines = warning ? warningLines(warning) : [];
  return <Dialog open={open} title="Submit consolidation?" onClose={busy ? undefined : onClose} footer={<>
    <Button onClick={() => { if (!busy) onClose(); }} aria-disabled={busy || undefined}>Back</Button>
    <Button variant="primary" loading={busy} onClick={() => onSubmit(!!warning)}>
      {warning ? `Submit with ${lines.length} ${lines.length === 1 ? "warning" : "warnings"}` : "Submit"}</Button>
  </>}>
    <p>The lead then accepts the result.</p>
    <p className="cons-summary">{summary}</p>
    {duplicates && <InlineMessage tone="warning">{duplicates}</InlineMessage>}
    {warning && <InlineMessage tone="warning" title="Check before you submit">
      <ul className="cons-warning-list">{lines.map(line => <li key={line}>{line}</li>)}</ul>
    </InlineMessage>}
    {!!error && <InlineMessage tone="error">{errorMessage(error)}</InlineMessage>}
  </Dialog>;
}
