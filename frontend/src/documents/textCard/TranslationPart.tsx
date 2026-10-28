import type { ReactNode } from "react";
import type { DocumentRowView } from "../../api/client";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { Button } from "../../ui/Button";
import { RouteLink } from "../RowCells";
import { versionName } from "../labels";
import { TextVersions, type TextVersionsTools } from "../TextVersions";
import { textViewRoute } from "./cardModel";
import { PersonList, useFocusAfterRemoval } from "./PersonRow";
import { assignedLine, WorkPersonRow } from "./WorkPersonRow";

/** The document this text was translated from: follow `derived_from` out of the row's own versions. */
function sourceDocument(row: DocumentRowView, documentId: string): string | null {
  const own = new Map(row.versions.map(version => [version.document_id, version]));
  let from = own.get(documentId)?.derived_from ?? null;
  for (let step = 0; from && own.has(from) && step < row.versions.length; step++) from = own.get(from)!.derived_from;
  return from && !own.has(from) ? from : null;
}

/**
 * Translation part of the text card: one row per open reviewer with their status and the lead's Reassign… and
 * Remove…, the part's actions, then the newest version of each chain with its status and actions; older versions are collapsed.
 */
export function TranslationPart({ row, projectKey, query, canManage, onAssign, onNavigate, onChanged, textVersionTools, now, planControl }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  canManage: boolean;
  onAssign: (row: DocumentRowView, task: "translation_review") => void;
  onNavigate: (route: Route) => void;
  onChanged: () => void;
  textVersionTools?: TextVersionsTools;
  now?: Date;
  /** "Review" On / Off in the header (planned translations). */
  planControl?: ReactNode;
}): JSX.Element {
  const shown = row.versions.find(version => version.document_id === row.open.document_id) ?? row.versions[row.versions.length - 1];
  const native = row.is_source || shown?.origin === "native";
  const source = shown && !native ? sourceDocument(row, shown.document_id) : null;
  // Submitted reviews are listed under their version; the rows are the open ones.
  const reviewers = row.work.filter(item => item.task === "translation_review" && item.moved_to_version == null && item.status !== "submitted");
  const focusAfterRemoval = useFocusAfterRemoval();
  const reviewOf = (documentId: string) => {
    const version = row.versions.find(entry => entry.document_id === documentId);
    return version ? `Review of ${versionName(version.version, version.chain_name, row.parallel_roots)}` : null;
  };
  // Issue 129, U5: a planned review nobody holds yet is the part's one next step (primary, on its own line);
  // Compare with source and the version actions follow as secondary tools.
  const reviewNext = canManage && !native && reviewers.length === 0 && row.stages?.review.state === "unassigned";
  const assignOther = canManage && !native && !reviewNext;
  return <section className="text-card-part" aria-labelledby="text-card-translation">
    <div className="text-card-part-head">
      <h3 id="text-card-translation" className="text-card-part-title">Translation</h3>
      {planControl}
    </div>
    {native && <p>Source text</p>}
    {reviewers.length > 0 && <PersonList label="Translation reviewers">
      {reviewers.map(item => {
        const review = reviewOf(item.document_id);
        const assigned = assignedLine(item, now, !review);
        return <WorkPersonRow key={item.assignment_id} item={item} caseId={row.case_id} canManage={canManage} tools={textVersionTools} onChanged={onChanged}
          onRemoved={focusAfterRemoval} details={review && assigned ? <>{review} · {assigned}</> : review ?? assigned} />;
      })}
    </PersonList>}
    {reviewNext && <div className="text-card-next" role="group" aria-labelledby="text-card-translation-next">
      <p id="text-card-translation-next" className="text-card-next-label"><strong>Next step:</strong> {`assign someone to review this ${shown?.origin === "machine_translation" ? "machine translation" : "translation"}.`}</p>
      <Button variant="primary" size="sm" onClick={() => onAssign(row, "translation_review")}>Assign review…</Button>
    </div>}
    {(assignOther || source) && <div className="text-card-actions">
      {assignOther && <Button size="sm" onClick={() => onAssign(row, "translation_review")}>Assign review…</Button>}
      {source && <RouteLink route={textViewRoute(projectKey, row.case_id, shown!.document_id, query, { compare: source })} onNavigate={onNavigate}
        className="btn btn-secondary btn-sm">Compare with source</RouteLink>}
    </div>}
    <TextVersions row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} tools={textVersionTools} now={now} hideOpenWork collapseOlder />
  </section>;
}
