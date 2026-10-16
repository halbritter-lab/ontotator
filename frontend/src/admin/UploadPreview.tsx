import type { ImportPlan } from "../api/client";
import { InlineMessage } from "../ui";
import { originLabels, translationStatusLabels } from "./variantMetadata";

export function UploadPreview({ plan }: { plan: ImportPlan }): JSX.Element {
  const grouped = new Map<string, NonNullable<ImportPlan["errors"]>>();
  for (const issue of plan.errors ?? []) grouped.set(issue.code, [...(grouped.get(issue.code) ?? []), issue]);
  return <section className="detail-section" aria-label="Upload preview">
    <h3>Preview</h3>
    <p>{plan.counts?.documents_added ?? 0} added · {plan.counts?.documents_skipped ?? 0} unchanged · {plan.documents_only?.length ?? 0} documents only · {plan.proposal_sets?.length ?? 0} proposal sets · {plan.counts?.proposals ?? 0} proposals · {plan.normalised_count} normalised</p>
    {!!plan.variants?.length && <div className="data-table-scroll"><table className="data-table density-compact"><caption>Variants</caption><thead><tr><th scope="col">External ID</th><th scope="col">Language</th><th scope="col">Version</th><th scope="col">Origin</th><th scope="col">Source</th><th scope="col">Planned status</th><th scope="col">Failed checks</th></tr></thead><tbody>{plan.variants.map(variant => <tr key={JSON.stringify([variant.external_id, variant.language, variant.version])}>
      <td>{variant.external_id}</td><td>{variant.language}</td><td>{variant.version}</td><td>{originLabels[variant.origin]}</td><td>{variant.derived_from ? `${variant.derived_from}${variant.derived_in_upload ? " (in this upload)" : ""}` : "—"}</td><td title={variant.status_reason ?? undefined}>{variant.status ? translationStatusLabels[variant.status] : "—"}</td><td>{variant.failed_checks.length ? <ul>{variant.failed_checks.map(code => <li key={code}>{code}</li>)}</ul> : "None"}</td>
    </tr>)}</tbody></table></div>}
    {!plan.committable && <InlineMessage tone="error"><strong>This upload cannot be imported.</strong>
      {[...grouped].map(([code, issues]) => <section key={code}><h4>{code}</h4><ul>{issues.map((issue, index) => <li key={index}>{issue.unit}{issue.annotation_id ? ` · ${issue.annotation_id}` : ""}: {issue.message}</li>)}</ul></section>)}
      {!!plan.collisions?.length && <ul>{plan.collisions.map((item, index) => <li key={index}>{item.document_id}: existing <code title={item.existing_sha256}>{item.existing_sha256.slice(0, 12)}</code> → new <code title={item.new_sha256}>{item.new_sha256.slice(0, 12)}</code></li>)}</ul>}
    </InlineMessage>}
    {!!plan.duplicates?.length && <section><h4>Duplicates</h4><ul>{plan.duplicates.map((item, index) => <li key={index}>{item.document_id}: {item.same_text_as.length ? `same text as ${item.same_text_as.join(", ")}` : "duplicate input"}</li>)}</ul></section>}
    {!!plan.warnings?.length && <section><h4>Warnings</h4><ul>{plan.warnings.map((issue, index) => <li key={index}>{issue.code} · {issue.unit}{issue.annotation_id ? ` · ${issue.annotation_id}` : ""}: {issue.message}</li>)}</ul></section>}
    {!!plan.documents?.some(item => item.normalised) && <section><h4>Text normalization</h4><ul>{plan.documents.filter(item => item.normalised).map((item, index) => <li key={index}>{item.document_id} · {item.label}: normalized to NFC.</li>)}</ul></section>}
    {(plan.proposal_sets ?? []).map((set, index) => <section className="detail-section" key={index}>
      <h4>{set.document_id} · {set.annotation_set_id}</h4>
      <p>{set.set_kind} · {set.action === "already_imported" ? "Already imported" : "New set"} · {set.proposals.annotations.length} proposed · {new Set(set.refused.map(item => item.annotation_id)).size} refused</p>
      {set.actors.map((actor, actorIndex) => <p key={actorIndex}>{actor.kind === "tool" ? "Tool" : "Actor"}: {[actor.name, actor.version, actor.model, actor.run_id].filter(value => typeof value === "string" && value.length).join(" · ") || "No label supplied"}</p>)}
      {set.bundle_id && <p>Bundle: {set.bundle_id}</p>}
      {set.manifest_sha256 && <p>Manifest: <code title={set.manifest_sha256}>{set.manifest_sha256.slice(0, 12)}</code></p>}
      {!!set.refused.length && <details><summary>Refusal rules ({set.refused.length})</summary><ul>{set.refused.map((item, refusalIndex) => <li key={refusalIndex}>{item.annotation_id}: {item.rule} · {Object.entries(item.detail).map(([key, value]) => `${key}: ${value}`).join(", ")}</li>)}</ul></details>}
      {!!Object.keys(set.proposals.notes ?? {}).length && <details><summary>Imported notes</summary><ul>{Object.entries(set.proposals.notes ?? {}).flatMap(([id, notes]) => notes.map((note, noteIndex) => <li key={`${id}-${noteIndex}`}>{id}: {note}</li>))}</ul></details>}
    </section>)}
  </section>;
}
