import type { ReactNode } from "react";
import type { DocumentRowView } from "../../api/client";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { languageName } from "../../translation/labels";
import { Button } from "../../ui/Button";
import { RouteLink } from "../RowCells";
import { TextVersions, type TextVersionsTools } from "../TextVersions";
import { AssignmentChip } from "./AssignmentChip";
import { textViewRoute } from "./cardModel";

const ORIGIN_WORDS = { machine_translation: "machine translation", human_translation: "human translation", correction: "correction" } as const;
const CHECKED = new Set(["ready_for_review", "reviewed", "accepted"]);

/** The document this text was translated from: follow `derived_from` out of the row's own versions. */
function sourceDocument(row: DocumentRowView, documentId: string): string | null {
  const own = new Map(row.versions.map(version => [version.document_id, version]));
  let from = own.get(documentId)?.derived_from ?? null;
  for (let step = 0; from && own.has(from) && step < row.versions.length; step++) from = own.get(from)!.derived_from;
  return from && !own.has(from) ? from : null;
}

/** Translation part of the text card: version and origin, automatic check, reviewers, actions, versions. */
export function TranslationPart({ row, projectKey, query, sourceLanguage, canManage, onAssign, onRequestCorrection, onNavigate, onChanged, textVersionTools, now, planControl }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  sourceLanguage?: string | null;
  canManage: boolean;
  onAssign: (row: DocumentRowView, task: "translation_review") => void;
  onRequestCorrection?: (row: DocumentRowView) => void;
  onNavigate: (route: Route) => void;
  onChanged: () => void;
  textVersionTools?: TextVersionsTools;
  now?: Date;
  /** "Review" On / Off in the header (planned translations). */
  planControl?: ReactNode;
}): JSX.Element {
  const shown = row.versions.find(version => version.document_id === row.open.document_id) ?? row.versions[row.versions.length - 1];
  const native = row.is_source || shown?.origin === "native";
  const from = sourceLanguage ? ` from ${languageName(sourceLanguage)}` : "";
  const origin = shown && !native ? `Version ${shown.version}, ${ORIGIN_WORDS[shown.origin as keyof typeof ORIGIN_WORDS]}${shown.origin === "correction" ? "" : from}` : "Source text";
  const check = native || !shown?.translation_status ? null
    : shown.translation_status === "automatic_check_failed" ? "Automatic check failed" : CHECKED.has(shown.translation_status) ? "Automatic check passed" : null;
  const source = shown && !native ? sourceDocument(row, shown.document_id) : null;
  const reviewers = row.work.filter(item => item.task === "translation_review" && item.moved_to_version == null);
  return <section className="text-card-part" aria-labelledby="text-card-translation">
    <div className="text-card-part-head">
      <h3 id="text-card-translation" className="text-card-part-title">Translation</h3>
      {planControl}
    </div>
    <p>{origin}</p>
    {check && <p className="text-card-muted">{check}</p>}
    {reviewers.length > 0 && <div className="text-card-chips">
      {reviewers.map(item => <AssignmentChip key={item.assignment_id} item={item} caseId={row.case_id} canRemove={false} onChanged={onChanged} now={now} />)}
    </div>}
    <div className="text-card-actions">
      {canManage && !native && <Button size="sm" onClick={() => onAssign(row, "translation_review")}>Assign reviewer…</Button>}
      {source && <RouteLink route={textViewRoute(projectKey, row.case_id, shown!.document_id, query, { compare: source })} onNavigate={onNavigate}
        className="btn btn-secondary btn-sm">Compare with source</RouteLink>}
      {canManage && onRequestCorrection && !native && <Button size="sm" onClick={() => onRequestCorrection(row)}>Request correction…</Button>}
    </div>
    <TextVersions row={row} projectKey={projectKey} query={query} onNavigate={onNavigate} tools={textVersionTools} now={now} hideOpenWork />
  </section>;
}
