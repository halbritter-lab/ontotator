import { Fragment, useEffect, useState } from "react";
import { AxisValue } from "../ui/AxisValue";
import { api } from "../api/client";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { InlineMessage } from "../ui/InlineMessage";
import { reanchorKey } from "../variants/ReanchorPanel";
import { CarriedChecksReadOnly } from "./carried/CarriedChecksReadOnly";
import { evidenceOf, type HistoricalSubmissionView } from "./historicalSubmission";
import { TermName } from "./TermName";

const refKey = (r: { annotation_id: string; version: string }) => JSON.stringify([r.annotation_id, r.version]);

/**
 * The text the quotes are cut from. A submission on another text version fetches that text;
 * null while loading, undefined when it cannot be loaded.
 */
function useSubmissionText(view: HistoricalSubmissionView, documentText: string, currentDocumentId?: string, projectKey?: string): string | null | undefined {
  const other = !!projectKey && !!currentDocumentId && view.documentId !== currentDocumentId;
  const [state, setState] = useState<{ documentId: string; text: string | undefined } | null>(null);
  useEffect(() => {
    if (!other || !projectKey) return;
    let active = true;
    setState(null);
    api.getVariantText(projectKey, view.documentId).then(
      value => { if (active) setState({ documentId: view.documentId, text: value.text }); },
      () => { if (active) setState({ documentId: view.documentId, text: undefined }); },
    );
    return () => { active = false; };
  }, [other, projectKey, view.documentId]);
  if (!other) return documentText;
  return state?.documentId === view.documentId ? state.text : null;
}

/** Read-only view of one earlier submission of this case. */
export function HistoricalSubmissionDialog({ view, documentText, currentDocumentId, projectKey, termLabel, onClose }: {
  view: HistoricalSubmissionView;
  /** Text of the open document; used when the submission is on the same text version. */
  documentText: string;
  currentDocumentId?: string;
  /** Needed to fetch the text of a submission on another text version. */
  projectKey?: string;
  termLabel: (layer: string | undefined, term: string) => string | null;
  onClose: () => void;
}) {
  const text = useSubmissionText(view, documentText, currentDocumentId, projectKey);
  return (
    <Dialog open title="Historical submission" heading={view.heading} onClose={onClose}
      footer={<Button type="button" variant="secondary" onClick={onClose}>Close</Button>}>
        <details className="technical-details"><summary>Technical details</summary>
          <p>Submission ID: <code>{view.submissionId}</code></p>
          <p>Timestamp: {view.recordedAt}</p>
        </details>
        <p>
          Verified layers:{" "}
          {view.checkedLayerIds.length > 0
            ? view.checkedLayerIds.join(", ")
            : (view.documentChecked ? "Document verified" : "None")}
        </p>
        {text === null && <InlineMessage tone="info">Loading the submitted text…</InlineMessage>}
        {text === undefined && <InlineMessage tone="warning">The submitted text is unavailable, so quotes cannot be shown.</InlineMessage>}
        {view.annotations.map(snap => {
          const axesVal = snap.annotation.axes_values ?? (snap.annotation as any).axes?.values;
          return (
            <div key={refKey({annotation_id:snap.annotation.annotation_id,version:snap.version})}>
              <strong><TermName termId={snap.annotation.term_id} label={termLabel(snap.annotation.layer_id, snap.annotation.term_id)} /></strong>
              <p>
                {axesVal && Object.keys(axesVal).length > 0
                  ? Object.entries(axesVal).map(([k, v], index) => <Fragment key={k}>{index > 0 && ", "}{k}: <AxisValue value={v as string | null} /></Fragment>)
                  : "No axes"}
              </p>
              {typeof text === "string" && evidenceOf(view, snap).map(ev => <p key={`${ev.mention.evidence_id}:${ev.version}`}>
                {ev.mention.segments.map(seg => Array.from(text).slice(seg.start, seg.end).join("")).join(" … ")}
              </p>)}
              <p className="annotation-note-history"><strong>Annotation note: </strong><span>{snap.annotation.note || "No annotation note."}</span></p>
            </div>
          );
        })}
        {view.carried && <CarriedChecksReadOnly items={view.carried.items} />}
        {view.decisions.map(decision => <p className="annotation-note-history" key={refKey(decision.target)}>
          {decision.target.annotation_id} ({decision.target.version}): {decision.outcome === "uncertain" ? "Unresolved" : decision.outcome}, Reviewer note: {decision.note || "No reviewer note."}
        </p>)}
        {view.reanchorInputs.length > 0 && <section aria-label="Re-anchor review history">
          <h3>Findings reviewed after text correction</h3>
          {view.reanchorInputs.map(item=>{
            const resolution=view.reanchorResolutions.find(value=>reanchorKey(value.item)===reanchorKey(item));
            return <p key={reanchorKey(item)}>{item.source_ref.annotation_id} ({item.source_ref.version}): {resolution ?
              `${resolution.outcome === "dismissed" ? "Dismissed" : "Re-created"} by ${resolution.reviewer_id}${resolution.reason ? `: ${resolution.reason}` : ""}${resolution.replacement ? `, Replacement: ${resolution.replacement.annotation_id} (${resolution.replacement.version})` : ""}` : "Pending"}</p>;
          })}
        </section>}
    </Dialog>
  );
}
