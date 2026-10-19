import { useRef, useState } from "react";
import type { AnnotationSnapshot, RoundInputView } from "../api/client";
import type { components } from "../api/generated";
import { Button, Select, StatusBadge, Textarea } from "../ui";
import { ErrorNotice } from "../admin/ErrorNotice";
import { TermName } from "../editor/TermName";
import { axisOptionLabel } from "../editor/axisLabels";
import { quoteSegments } from "../editor/AnnotationPanel";

type Resolution = components["schemas"]["RoundInputResolution"];
export function currentRoundInputResolution(input: RoundInputView, resolutions: readonly Resolution[], annotations: readonly AnnotationSnapshot[]) {
  const resolution = resolutions.find(value => value.input_id === input.input_id);
  if (resolution?.outcome === "completed" && !annotations.some(snapshot => snapshot.annotation.annotation_id === resolution.annotation_ref?.annotation_id && snapshot.version === resolution.annotation_ref.version)) return undefined;
  return resolution;
}
interface RoundInputPanelProps {
  inputs: readonly RoundInputView[];
  resolutions: readonly Resolution[];
  annotations: readonly AnnotationSnapshot[];
  documentText: string;
  labelFor: (layer: string, term: string) => string | null;
  onOpenFinding: (annotationId: string) => void;
  onInspectOriginal: (input: RoundInputView) => void;
  onComplete?: (input: RoundInputView, annotationId: string) => Promise<void>;
  onDismiss?: (input: RoundInputView, reason: string) => Promise<void>;
}
function InputRow({ input, index, resolution, ...props }: RoundInputPanelProps & { input: RoundInputView; index: number; resolution?: Resolution }) {
  const [choice, setChoice] = useState(input.target_snapshot?.annotation.annotation_id ?? "");
  const [dismissing, setDismissing] = useState(false), [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const original = input.source_snapshot.annotation;
  const choices = props.annotations.filter(snapshot => snapshot.annotation.layer_id === original.layer_id && snapshot.annotation.type_id === original.type_id);
  const selected = choices.some(snapshot => snapshot.annotation.annotation_id === choice) ? choice : "";
  const run = async (work: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    try { await work(); } catch (failure) { setError(failure); }
    finally { writing.current = false; setBusy(false); }
  };
  return <li data-round-input={input.input_id} data-round-pending={!resolution}>
    <h4><TermName termId={original.term_id} label={props.labelFor(original.layer_id, original.term_id)} /></h4>
    <StatusBadge tone={resolution ? "success" : "warning"}>{resolution?.outcome === "dismissed" ? "Dismissed" : resolution ? "Reviewed" : "Pending review"}</StatusBadge>
    {!resolution && <p>{input.mapping_status === "carried" ? "A starting finding was carried onto this text. Check its evidence and values before completing review." : "The original evidence could not be carried unchanged. Create a finding on the current text, or dismiss this input with a reason."}</p>}
    <Button variant="quiet" onClick={() => props.onInspectOriginal(input)}>Inspect original evidence</Button>
    {original.note && <p className="annotation-note-history">Original annotation note: {original.note}</p>}
    {Object.entries(original.axes_values ?? {}).length > 0 && <p>{Object.entries(original.axes_values ?? {}).map(([axis, value]) => `${axis}: ${axisOptionLabel(value)}${original.axes_defaulted?.includes(axis) ? " (defaulted)" : ""}`).join(" · ")}</p>}
    {resolution?.reason && <p className="annotation-note-history">Dismissal reason: {resolution.reason}</p>}
    {resolution?.annotation_ref && <Button data-round-open onClick={() => props.onOpenFinding(resolution.annotation_ref!.annotation_id)}>Open saved finding</Button>}
    {!resolution && props.onComplete && <>
      <Select id={`round-result-${encodeURIComponent(input.input_id)}`} label={`Result finding for input ${index + 1}`} value={selected} disabled={busy} onChange={event => setChoice(event.target.value)}>
        <option value="">Select a saved finding</option>
        {choices.map(snapshot => {
          const quote = snapshot.evidence.map(evidence => quoteSegments(props.documentText, evidence.mention.segments, 70)).filter(Boolean).join(" … ");
          return <option key={snapshot.annotation.annotation_id} value={snapshot.annotation.annotation_id}>{props.labelFor(snapshot.annotation.layer_id, snapshot.annotation.term_id) ?? snapshot.annotation.term_id} · {quote || "No text span"} · {snapshot.annotation.annotation_id}</option>;
        })}
      </Select>
      {selected && <Button data-round-open disabled={busy} onClick={() => props.onOpenFinding(selected)}>Open saved finding</Button>}
      <Button disabled={busy || !selected} onClick={() => { void run(() => props.onComplete!(input, selected)); }}>Complete carried finding review</Button>
    </>}
    {!resolution && props.onDismiss && <>
      <Button disabled={busy} onClick={() => setDismissing(true)}>Dismiss carried input</Button>
      {dismissing && <form onSubmit={event => { event.preventDefault(); if (reason.trim()) void run(() => props.onDismiss!(input, reason.trim())); }}>
        <Textarea id={`round-dismiss-${encodeURIComponent(input.input_id)}`} label="Reason for dismissing carried input" value={reason} required disabled={busy} onChange={event => setReason(event.target.value)} />
        <Button type="submit" disabled={!reason.trim()} loading={busy}>Save carried input dismissal</Button>
        <Button disabled={busy} onClick={() => setDismissing(false)}>Cancel dismissal</Button>
      </form>}
    </>}
    {error !== undefined && <ErrorNotice error={error} />}
  </li>;
}
export function RoundInputPanel(props: RoundInputPanelProps): JSX.Element | null {
  if (!props.inputs.length) return null;
  const rows = props.inputs.map((input, index) => ({ input, index, resolution: currentRoundInputResolution(input, props.resolutions, props.annotations) }));
  const pending = rows.filter(row => !row.resolution), completed = rows.filter(row => row.resolution);
  const render = ({ input, index, resolution }: typeof rows[number]) => <InputRow key={input.input_id} {...props} input={input} index={index} resolution={resolution} />;
  return <section className="detail-section round-input-panel" aria-label="Review carried findings">
    <details open><summary><h3>Review carried findings ({props.inputs.length})</h3></summary>
      <p role="status">{pending.length} pending · {completed.length} completed</p>
      <p>Every input needs review. Completing text review keeps any unconfirmed clinical values unconfirmed.</p>
      <ol>{pending.map(render)}</ol>
      {completed.length > 0 && <details><summary>Completed carried-input reviews ({completed.length})</summary><ol>{completed.map(render)}</ol></details>}
    </details>
  </section>;
}
