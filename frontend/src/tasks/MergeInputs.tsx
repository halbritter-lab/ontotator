import { useRef, useState } from "react";
import type { AnnotationSnapshot, RoundInputView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, Select, Textarea } from "../ui";

export function MergeInputs({ inputs, annotations, labelFor, onMerge }: { inputs: readonly RoundInputView[]; annotations: readonly AnnotationSnapshot[]; labelFor: (layer: string, term: string) => string | null; onMerge: (ids: string[], outputId: string, note?: string) => Promise<void> }): JSX.Element | null {
  const [selected, setSelected] = useState<string[]>([]), [output, setOutput] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(), [done, setDone] = useState(false);
  const writing = useRef(false);
  if (inputs.length < 2) return null;
  const chosen = inputs.filter(value => selected.includes(value.input_id));
  const compatible = annotations.filter(value => chosen.length >= 2 && chosen.every(input => input.source_snapshot.annotation.layer_id === value.annotation.layer_id && input.source_snapshot.annotation.type_id === value.annotation.type_id));
  const valid = compatible.some(value => value.annotation.annotation_id === output);
  const merge = async () => {
    if (writing.current || chosen.length < 2 || !valid) return;
    writing.current = true; setBusy(true); setError(undefined); setDone(false);
    try { await onMerge(chosen.map(value => value.input_id), output, note.trim() || undefined); setSelected([]); setOutput(""); setDone(true); }
    catch (failure) { setError(failure); }
    finally { writing.current = false; setBusy(false); }
  };
  return <details className="merge-inputs"><summary>Merge overlapping submitted findings</summary>
    <p>First save the combined finding on this text. Select each exact input it replaces, then link that saved finding. This records merged provenance and resolves those review decisions together.</p>
    <fieldset><legend>Inputs to merge</legend>{inputs.map((value, index) => <Checkbox id={`merge-input-${encodeURIComponent(value.input_id)}`} key={value.input_id} label={`Input ${index + 1}: ${labelFor(value.source_snapshot.annotation.layer_id, value.source_snapshot.annotation.term_id) ?? value.source_snapshot.annotation.term_id}${value.source_submission_id ? ` · ${value.source_submission_id}` : ""}`} checked={selected.includes(value.input_id)} disabled={busy} onChange={event => { setSelected(ids => event.target.checked ? [...ids, value.input_id] : ids.filter(id => id !== value.input_id)); setDone(false); }} />)}</fieldset>
    <Select id="merge-output" label="Saved merged finding" value={valid ? output : ""} disabled={busy} onChange={event => setOutput(event.target.value)}>
      <option value="">Select a saved compatible finding</option>{compatible.map(value => <option key={value.annotation.annotation_id} value={value.annotation.annotation_id}>{labelFor(value.annotation.layer_id, value.annotation.term_id) ?? value.annotation.term_id} · {value.annotation.annotation_id}</option>)}
    </Select>
    <Textarea id="merge-note" label="Merge note" value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
    {error !== undefined && <ErrorNotice error={error} />}{done && <p role="status">Merged finding saved. Review the remaining inputs and check the layer before submitting.</p>}
    <Button loading={busy} disabled={chosen.length < 2 || !valid} onClick={() => { void merge(); }}>Merge selected inputs into saved finding</Button>
  </details>;
}
