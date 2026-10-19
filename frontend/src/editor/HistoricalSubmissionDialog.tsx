import type { Submission } from "../api/client";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { reanchorKey } from "../variants/ReanchorPanel";
import { TermName } from "./TermName";

const refKey = (r: { annotation_id: string; version: string }) => JSON.stringify([r.annotation_id, r.version]);

/** Read-only view of one earlier submission of this case. */
export function HistoricalSubmissionDialog({ submission: historySubmission, heading, documentText, termLabel, onClose }: {
  submission: Submission;
  heading: string;
  documentText: string;
  termLabel: (layer: string | undefined, term: string) => string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open title="Historical submission" heading={heading} onClose={onClose}>
        <details className="technical-details"><summary>Technical details</summary>
          <p>Submission ID: <code>{historySubmission.submission_id}</code></p>
          <p>Timestamp: {historySubmission.created_at}</p>
        </details>
        <p>
          Verified layers:{" "}
          {historySubmission.checked_layer_ids && historySubmission.checked_layer_ids.length > 0
            ? historySubmission.checked_layer_ids.join(", ")
            : (historySubmission.document_checked ? "Document verified" : "None")}
        </p>
        {historySubmission.snapshots.map(snap => {
          const axesVal = snap.annotation.axes_values ?? (snap.annotation as any).axes?.values;
          return (
            <div key={refKey({annotation_id:snap.annotation.annotation_id,version:snap.version})}>
              <strong><TermName termId={snap.annotation.term_id} label={termLabel(snap.annotation.layer_id, snap.annotation.term_id)} /></strong>
              <p>
                {axesVal && Object.keys(axesVal).length > 0
                  ? Object.entries(axesVal)
                      .map(([k, v]) => `${k}: ${v ?? "Not specified"}`)
                      .join(" · ")
                  : "No axes"}
              </p>
              {snap.evidence.map(ev => <p key={`${ev.mention.evidence_id}:${ev.version}`}>
                {ev.mention.segments.map(seg => Array.from(documentText).slice(seg.start, seg.end).join("")).join(" … ")}
              </p>)}
              <p className="annotation-note-history"><strong>Annotation note: </strong><span>{snap.annotation.note || "No annotation note."}</span></p>
            </div>
          );
        })}
        {historySubmission.decisions.map(decision => <p className="annotation-note-history" key={refKey(decision.target)}>
          {decision.target.annotation_id} ({decision.target.version}): {decision.outcome === "uncertain" ? "Unresolved" : decision.outcome} · Reviewer note: {decision.note || "No reviewer note."}
        </p>)}
        {(historySubmission.reanchor_inputs ?? []).length > 0 && <section aria-label="Re-anchor review history">
          <h3>Findings reviewed after text correction</h3>
          {(historySubmission.reanchor_inputs ?? []).map(item=>{
            const resolution=(historySubmission.reanchor_resolutions ?? []).find(value=>reanchorKey(value.item)===reanchorKey(item));
            return <p key={reanchorKey(item)}>{item.source_ref.annotation_id} ({item.source_ref.version}): {resolution ?
              `${resolution.outcome === "dismissed" ? "Dismissed" : "Re-created"} by ${resolution.reviewer_id}${resolution.reason ? `: ${resolution.reason}` : ""}${resolution.replacement ? ` · Replacement: ${resolution.replacement.annotation_id} (${resolution.replacement.version})` : ""}` : "Pending"}</p>;
          })}
        </section>}
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
    </Dialog>
  );
}
