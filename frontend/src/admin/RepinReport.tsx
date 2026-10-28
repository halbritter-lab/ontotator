import type { RepinReport } from "../api/client";
import { Button } from "../ui";

const REASON_LABELS: Record<string, string> = { replaced_by: "replaced", alt_id: "merged" };
const STATUS_LABELS: Record<string, string> = { obsolete: "obsolete", unknown: "not in the new release" };

/**
 * The dry run of moving a project to another ontology release (#81): what changes, which draft terms are rewritten and
 * which stay for the annotator to change. Submitted work is counted, never changed.
 */
export function RepinReportPanel({ report, busy, onApply, onCancel }: {
  report: RepinReport; busy: boolean; onApply: () => void; onCancel: () => void;
}): JSX.Element {
  const submitted = report.submitted.filter(item => item.annotations > 0);
  return <section className="settings-card" aria-label="Release change check">
    <h3 className="settings-card-title">Check before moving</h3>
    <ul className="settings-card-list" aria-label="Release changes">
      {report.changes.map(change => <li key={change.ontology_id}>{change.ontology_id}: release {change.from_release || change.from_sha256.slice(0, 12)} → {change.to_release || change.to_sha256.slice(0, 12)}</li>)}
      {!report.changes.length && <li>No release changes.</li>}
    </ul>
    <p className="settings-card-text">
      {report.rewrites.length ? `${report.rewrites.length} draft term(s) will be rewritten to their successor.` : "No draft term needs rewriting."}
      {" "}{report.flagged.length ? `${report.flagged.length} draft term(s) stay as they are and must be changed by their annotator before submitting.` : ""}
    </p>
    {report.rewrites.length > 0 && <table className="settings-table" aria-label="Rewritten draft terms">
      <thead><tr><th scope="col">Text</th><th scope="col">Annotator</th><th scope="col">Term</th><th scope="col">Becomes</th><th scope="col">Why</th></tr></thead>
      <tbody>{report.rewrites.map(item => <tr key={`${item.annotator_id}/${item.mode}/${item.annotation_id}/${item.role}/${item.old_term_id}`}>
        <td>{item.document_id}</td><td>{item.annotator_id}</td>
        <td>{item.old_term_id}{item.role === "modifier" ? " (modifier)" : ""}</td>
        <td>{item.new_term_id} {item.new_label}</td><td>{REASON_LABELS[item.reason] ?? item.reason}</td>
      </tr>)}</tbody>
    </table>}
    {report.flagged.length > 0 && <table className="settings-table" aria-label="Draft terms to change by hand">
      <thead><tr><th scope="col">Text</th><th scope="col">Annotator</th><th scope="col">Term</th><th scope="col">Status</th><th scope="col">Suggestions</th></tr></thead>
      <tbody>{report.flagged.map(item => <tr key={`${item.annotator_id}/${item.mode}/${item.annotation_id}/${item.role}/${item.term_id}`}>
        <td>{item.document_id}</td><td>{item.annotator_id}</td>
        <td>{item.term_id}{item.role === "modifier" ? " (modifier)" : ""}</td>
        <td>{STATUS_LABELS[item.status] ?? item.status}</td>
        <td>{[...(item.replaced_by ?? []), ...(item.consider ?? [])].join(", ") || "—"}</td>
      </tr>)}</tbody>
    </table>}
    {submitted.length > 0 && <p className="settings-card-text">
      Submitted work stays as it was submitted, under its release:{" "}
      {submitted.map(item => `${item.ontology_id}: ${item.annotations} submitted finding(s), ${item.rewritable} with a successor, ${item.obsolete} obsolete, ${item.unknown} not in the new release`).join("; ")}.
    </p>}
    <div className="settings-section-actions" role="group" aria-label="Release change">
      <Button variant="primary" loading={busy} onClick={onApply}>Move to this release</Button>
      <Button disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  </section>;
}
