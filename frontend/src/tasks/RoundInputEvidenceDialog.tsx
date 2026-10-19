import { useEffect, useState, type ReactNode } from "react";
import { api, type RoundInputView } from "../api/client";
import { Button, Dialog, InlineMessage } from "../ui";
import { ErrorNotice } from "../admin/ErrorNotice";
import { ReadOnlyAnnotationView } from "../variants/ReadOnlyAnnotationView";
import { axisOptionLabel } from "../editor/axisLabels";
import { quoteSegments } from "../editor/AnnotationPanel";
import { Time } from "../app/Time";
import "./workRounds.css";

/** "assertion" → "Assertion"; snapshots carry axis IDs, not the profile labels. */
const axisName = (id: string): string => {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
};

export function RoundInputEvidenceDialog({ projectKey, input, onClose, labelFor, sourceName }: {
  projectKey: string; input: RoundInputView; onClose: () => void; labelFor: (layer: string | undefined, term: string) => string | null;
  /** "Round 2"; defaults to the input's source round, else "an earlier round". */
  sourceName?: string;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null), [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true; setText(null); setError(undefined);
    void api.getVariantText(projectKey, input.source_snapshot.document_id).then(value => {
      if (value.text_sha256 !== input.source_snapshot.text_sha256) throw new Error("The exact original evidence text is unavailable.");
      if (active) setText(value.text);
    }).catch(failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [projectKey, input]);
  const snapshot = input.source_snapshot, annotation = snapshot.annotation;
  const name = sourceName ?? (input.source_round_ordinal ? `Round ${input.source_round_ordinal}` : null);
  const version = [input.source_language ?? "", input.source_version != null ? `v${input.source_version}` : ""].filter(Boolean).join(" ");
  const meta: ReactNode[] = [input.source_recorded_at ? <>Submitted <Time iso={input.source_recorded_at} /></> : "Submitted"];
  if (version) meta.push(version);
  meta.push(annotation.provenance.actor.actor_id);
  const evidence = (annotation.evidence_refs ?? []).flatMap(ref => snapshot.evidence.filter(value => value.mention.evidence_id === ref.evidence_id && value.version === ref.version));
  const spanless = evidence.length === 0;
  const quotes = text === null ? [] : evidence.map(value => quoteSegments(text, value.mention.segments)).filter(Boolean);
  const textView = text === null ? null : <ReadOnlyAnnotationView text={text} annotations={[snapshot]} evidence={snapshot.evidence} labelFor={labelFor} />;
  return <Dialog open title={`Original finding from ${name ?? "an earlier round"}`} onClose={onClose} size="lg" footer={<Button onClick={onClose}>Close original evidence</Button>}>
    <p className="round-evidence__meta">{meta.map((part, index) => <span key={index}>{index > 0 && " · "}{part}</span>)}</p>
    <ul className="round-evidence__facts">
      <li className="round-evidence__term">{labelFor(annotation.layer_id, annotation.term_id) ?? annotation.term_id}</li>
      {Object.entries(annotation.axes_values ?? {}).map(([axis, value]) => <li key={axis}>{`${axisName(axis)}: ${axisOptionLabel(value)}`}</li>)}
      {annotation.note && <li className="round-evidence__note">{`Note: ${annotation.note}`}</li>}
      {spanless ? <li>{`This finding had no text span in ${name ?? "the earlier round"}.`}</li>
        : quotes.map((quote, index) => <li key={index} className="round-evidence__quote">{`Quote: ${quote}`}</li>)}
    </ul>
    {error !== undefined ? <ErrorNotice error={error} /> : text === null ? <InlineMessage tone="info">Loading the original text…</InlineMessage>
      : spanless ? <details className="round-evidence__text"><summary>{`Show ${name ?? "original"} text`}</summary>{textView}</details> : textView}
    <details className="round-evidence__technical">
      <summary>Technical details</summary>
      <dl>
        <dt>Submission</dt><dd><code>{input.source_submission_id}</code></dd>
        <dt>Original finding</dt><dd><code>{input.source_ref.annotation_id}</code></dd>
        <dt>Version</dt><dd><code>{input.source_ref.version}</code></dd>
      </dl>
    </details>
  </Dialog>;
}
