/** Summary before submitting the consolidation (X12, T10): the decisions, then "Submit"; an advisory axis warning asks for an acknowledgement. */
import { useState } from "react";
import { errorMessage } from "../admin/errors";
import { Button, Checkbox, Dialog, InlineMessage } from "../ui";
import type { AxisWarning } from "./useConsolidation";

export interface SummaryDialogProps {
  open: boolean;
  summary: string;
  busy: boolean;
  warning: AxisWarning | null;
  error: unknown;
  onSubmit: (acknowledged: boolean) => void;
  onClose: () => void;
}

export function SummaryDialog({ open, summary, busy, warning, error, onSubmit, onClose }: SummaryDialogProps): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);
  const blocked = !!warning && !acknowledged;
  return <Dialog open={open} title="Submit consolidation?" onClose={busy ? undefined : onClose} footer={<>
    <Button onClick={() => { if (!busy) onClose(); }} aria-disabled={busy || undefined}>Back</Button>
    <Button variant="primary" loading={busy} aria-disabled={blocked || undefined}
      onClick={() => { if (!blocked) onSubmit(acknowledged); }}>Submit</Button>
  </>}>
    <p>The lead then accepts the result.</p>
    <p className="cons-summary">{summary}</p>
    {warning && <>
      <InlineMessage tone="warning">{warning.count === 1 ? "1 finding has" : `${warning.count || "Some"} findings have`} values that were filled in by default, not chosen. Check them before you submit.</InlineMessage>
      <Checkbox id="cons-axis-ack" label="I checked these values" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
    </>}
    {!!error && <InlineMessage tone="error">{errorMessage(error)}</InlineMessage>}
  </Dialog>;
}
