import type { AnnotationSnapshot } from "../api/client";
import type { components } from "../api/generated";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { InlineMessage } from "../ui/InlineMessage";
import { axisOptionLabel } from "./axisLabels";
import { TermName } from "./TermName";

const refKey = (r: { annotation_id: string; version: string }) => JSON.stringify([r.annotation_id, r.version]);

export interface SubmissionIssue {
  snapshot: AnnotationSnapshot;
  reason: string;
  remedy: string;
  focus: string;
}

export interface SubmitCaseDialogProps {
  open: boolean;
  documentId: string;
  reviewMode: boolean;
  completionResults: AnnotationSnapshot[];
  confirmedCount: number;
  unresolvedDecisionCount: number;
  savedFindingsCount: number;
  reviewTargetCount: number;
  openReviewTargetCount: number;
  pendingReanchorCount: number;
  unresolvedReanchorCount: number;
  pendingCarriedCount: number;
  defaultedCount: number;
  submissionIssues: SubmissionIssue[];
  axisWarning: { warnings: { annotationId: string; axis: string }[] } | null;
  axisWarningAcknowledged: boolean;
  textChecked: boolean;
  saving: boolean;
  readOnly: boolean;
  layers: components["schemas"]["WorkspaceView"]["layers"];
  termLabel: (layer: string | undefined, term: string) => string | null;
  setTextChecked: (checked: boolean) => void;
  setAxisWarningAcknowledged: (acknowledged: boolean) => void;
  onReviewEvidenceIssue: (snapshot: AnnotationSnapshot, focus: string) => void;
  onReviewPendingReanchor: () => void;
  onReviewCarried: () => void;
  onReviewDefaulted: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Final confirmation before a case is submitted, listing everything that blocks or warns. */
export function SubmitCaseDialog({
  open, documentId, reviewMode, completionResults, confirmedCount, unresolvedDecisionCount, savedFindingsCount,
  reviewTargetCount, openReviewTargetCount, pendingReanchorCount, unresolvedReanchorCount, pendingCarriedCount,
  defaultedCount, submissionIssues, axisWarning, axisWarningAcknowledged, textChecked, saving, readOnly, layers,
  termLabel, setTextChecked, setAxisWarningAcknowledged, onReviewEvidenceIssue, onReviewPendingReanchor,
  onReviewCarried, onReviewDefaulted, onConfirm, onCancel,
}: SubmitCaseDialogProps) {
  return (
      <Dialog open={open} title="Submit case" heading={<>Submit case {documentId}?</>} onClose={onCancel}>
        <ul style={{ margin: "8px 0 12px", paddingLeft: 18, fontSize: "0.9rem" }}>
          {reviewMode ? (
            <li>
              {completionResults.length} annotation(s) will be submitted
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
        {submissionIssues.length > 0 && <InlineMessage tone="error">
          <p>{submissionIssues.length} finding(s) need attention before submission.</p>
          <ul>{submissionIssues.map(({snapshot, reason, remedy, focus}) => <li key={refKey({ annotation_id: snapshot.annotation.annotation_id, version: snapshot.version })}>
            <Button variant="quiet" onClick={() => onReviewEvidenceIssue(snapshot, focus)}><TermName termId={snapshot.annotation.term_id ?? snapshot.annotation.annotation_id} label={termLabel(snapshot.annotation.layer_id, snapshot.annotation.term_id ?? snapshot.annotation.annotation_id)} />: {reason}</Button><p>{remedy}</p>
          </li>)}</ul>
        </InlineMessage>}
        {unresolvedReanchorCount > 0 && <InlineMessage tone="error">
          <p>{unresolvedReanchorCount} finding(s) after text correction must be re-created or dismissed with a reason.</p>
          <Button onClick={onReviewPendingReanchor}>Review pending findings after text correction</Button>
        </InlineMessage>}
        {pendingCarriedCount > 0 && <InlineMessage tone="error">
          <p>{pendingCarriedCount} carried finding(s) still need review before submission.</p>
          <Button onClick={onReviewCarried}>Review carried findings</Button>
        </InlineMessage>}
        {defaultedCount > 0 && <InlineMessage tone="warning">
          <p>{defaultedCount} {defaultedCount === 1 ? "annotation has" : "annotations have"} defaulted axis values.</p>
          <Button onClick={onReviewDefaulted}>Review defaulted annotations</Button>
        </InlineMessage>}
        {axisWarning && <InlineMessage tone="warning" title="Review unconfirmed clinical values">
          <p>These values have not been explicitly confirmed. Continuing records acknowledgement of this warning; it keeps the clinical values and their defaulted status unchanged.</p>
          <ul>{axisWarning.warnings.map(({ annotationId, axis }) => {
            const snapshot = completionResults.find(value => value.annotation.annotation_id === annotationId);
            const definition = layers?.find(layer => layer.layer_id === snapshot?.annotation.layer_id)?.annotation_types.find(type => type.type_id === snapshot?.annotation.type_id)?.axes?.find(value => value.id === axis);
            return <li key={`${annotationId}/${axis}`}>{snapshot ? termLabel(snapshot.annotation.layer_id, snapshot.annotation.term_id) ?? snapshot.annotation.term_id : annotationId}: {definition?.label ?? axis} = {axisOptionLabel(snapshot?.annotation.axes_values?.[axis])}</li>;
          })}</ul>
          <Checkbox id="submit-axis-warning" label="Submit with these unconfirmed values" checked={axisWarningAcknowledged} disabled={saving} onChange={event => setAxisWarningAcknowledged(event.target.checked)} />
        </InlineMessage>}
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={textChecked}
            onChange={(e) => setTextChecked(e.target.checked)}
          />
          <span>Entire text checked for further findings</span>
        </label>
        {reviewMode && openReviewTargetCount > 0 && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: "0.85rem" }}>
            Decide every review proposal before submitting.
          </p>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            disabled={readOnly || !textChecked || (axisWarning !== null && !axisWarningAcknowledged) || submissionIssues.length > 0 || unresolvedReanchorCount > 0 || pendingCarriedCount > 0 || (reviewMode && openReviewTargetCount > 0)}
            onClick={onConfirm}
          >
            {axisWarning ? "Continue and submit" : "Submit case"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Dialog>
  );
}
