import { useEffect, useRef, useState } from "react";
import { api, type SubmissionHistorySummary } from "../api/client";
import { Button, Checkbox, InlineMessage, Select } from "../ui";
import { ErrorNotice } from "../admin/ErrorNotice";
import { notifyFinalSelectionChanged, useFinalSelectionState } from './finalSelectionState';

interface Props { projectKey: string; documentId: string; caseId: string; language: string; rows: SubmissionHistorySummary[] }
export function FinalResultSelector(props: Props): JSX.Element {
  return <FinalResultContent key={JSON.stringify([props.projectKey, props.documentId, props.caseId, props.language])} {...props} />;
}
function FinalResultContent({ projectKey, documentId, caseId, language, rows }: Props): JSX.Element {
  const projection = useFinalSelectionState(projectKey);
  const [stale, setStale] = useState(false);
  const state = stale ? undefined : projection.state;
  const [chosen, setChosen] = useState("");
  const [keepReviewed, setKeepReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const active = useRef(false);
  const writing = useRef(false);
  const eligibleRows = rows.filter(row => row.document_id === documentId);
  const eligibleChoice = eligibleRows.some(row => row.submission_id === chosen);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => { setChosen(''); setKeepReviewed(false); }, [projection.identity]);
  const selected = state?.selections.find(item => item.case_id === caseId && item.language === language);
  const finiteCodes = new Set(['SELECTED_ROUND_ABANDONED', 'SELECTED_ROUND_SUPERSEDED', 'SELECTED_RESULT_REVISED', 'SELECTED_TEXT_CORRECTED']);
  const finiteCauses = state?.warnings.filter(warning => warning.case_id === caseId && warning.language === language && finiteCodes.has(warning.code) && warning.cause_id) ?? [];
  const canReaffirm = selected?.document_id === documentId && eligibleRows.some(row => row.submission_id === selected.submission_id) && finiteCauses.length > 0;
  const save = async (reaffirm = false) => {
    if (!state || writing.current || (reaffirm ? !canReaffirm || !keepReviewed : !eligibleChoice)) return;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      await api.selectFinalResult(projectKey, { document_id: documentId, submission_id: reaffirm ? selected!.submission_id : chosen, expected_revision: selected?.revision ?? 0, acknowledged_cause_ids: reaffirm ? finiteCauses.map(warning => warning.cause_id!) : [] });
      notifyFinalSelectionChanged(projectKey);
    } catch (err) { if (active.current) { setError(err); setStale(true); setChosen(''); setKeepReviewed(false); } }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  return <section className="detail-section" aria-label="Final result selection"><h3>Final result · {language}</h3>
    {selected ? <p role="status">Selected: {selected.submission_id} · text {selected.document_id}</p> : state && <p>No final result selected for this text and language.</p>}
    <p>Choose an exact submitted result. A later submission will not replace this choice.</p>
    {!state && error == null && projection.error == null && <InlineMessage tone="info">Loading final selection…</InlineMessage>}
    {(error ?? projection.error) != null && <><ErrorNotice error={error ?? projection.error} /><Button disabled={busy} onClick={() => { setError(undefined); setStale(false); setChosen(''); projection.reload(); }}>Reload final selection</Button></>}
    {canReaffirm && <div className="detail-section" aria-label="Review selected result changes">
      <p>The selected result has changed context. Review these changes before deciding to keep it:</p>
      <ul>{finiteCauses.map(warning => <li key={warning.id}>{warning.reason}</li>)}</ul>
      <Checkbox id={`keep-final-${encodeURIComponent(documentId)}`} label="I reviewed these changes and want to keep the exact selected result" checked={keepReviewed} disabled={busy} onChange={event => setKeepReviewed(event.target.checked)} />
      <Button disabled={!keepReviewed || busy} loading={busy} onClick={() => { void save(true); }}>Keep selected result after review</Button>
      <p>This records your selection decision. Open reports, pauses and source reviews remain separate.</p>
    </div>}
    {eligibleRows.length ? <><Select id={`final-result-${encodeURIComponent(documentId)}`} label="Submitted result" value={eligibleChoice ? chosen : ''} disabled={busy || !state} onChange={event => setChosen(event.target.value)}>
      <option value="">Choose a result</option>{eligibleRows.map(row => <option key={row.submission_id} value={row.submission_id}>{row.author_label} · {row.created_at} · {row.submission_id}</option>)}
    </Select><Button disabled={!eligibleChoice || !state || busy} loading={busy} onClick={() => { void save(); }}>{selected ? "Replace final selection" : "Select final result"}</Button></> : <InlineMessage tone="info">Submit an annotation result before selecting it.</InlineMessage>}
  </section>;
}
