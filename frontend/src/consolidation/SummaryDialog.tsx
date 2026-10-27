/** Summary before submitting the consolidation (X12, T10): the decisions and terms kept twice, then one "Submit". */
import { errorMessage } from "../admin/errors";
import { Button, Dialog, InlineMessage } from "../ui";

export interface SummaryDialogProps {
  open: boolean;
  summary: string;
  /** R-3: terms the result holds more than once ("More than one finding with the same term: Fatigue."). */
  duplicates?: string | null;
  busy: boolean;
  error: unknown;
  onSubmit: () => void;
  onClose: () => void;
}

export function SummaryDialog({ open, summary, duplicates, busy, error, onSubmit, onClose }: SummaryDialogProps): JSX.Element {
  return <Dialog open={open} title="Submit consolidation?" onClose={busy ? undefined : onClose} footer={<>
    <Button onClick={() => { if (!busy) onClose(); }} aria-disabled={busy || undefined}>Back</Button>
    <Button variant="primary" loading={busy} onClick={onSubmit}>Submit</Button>
  </>}>
    <p>The lead then accepts the result.</p>
    <p className="cons-summary">{summary}</p>
    {duplicates && <InlineMessage tone="warning">{duplicates}</InlineMessage>}
    {!!error && <InlineMessage tone="error">{errorMessage(error)}</InlineMessage>}
  </Dialog>;
}
