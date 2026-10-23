import { useId, type ReactNode } from "react";
import type { DocumentRowView } from "../../api/client";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import { RouteLink } from "../RowCells";
import { finalizationState, textViewRoute } from "./cardModel";

/** Finalization part of the text card: what happens next, the decision block, the final result. */
export function FinalizationPart({ row, projectKey, query, decision, onNavigate, now }: {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  /** The decision block (Compare results…, Consolidate…, Accept result…). */
  decision?: ReactNode;
  onNavigate: (route: Route) => void;
  now: Date;
}): JSX.Element {
  const id = useId();
  const detail = row.stages?.annotation.detail;
  const target = detail?.target ?? detail?.total;
  const waiting = finalizationState(row, now).state === "waiting";
  return <section className="text-card-part" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-card-part-title">Finalization</h3>
    {waiting && <p className="text-card-muted">
      {`Starts when all ${target ? `${target} ` : ""}annotations are submitted: compare the results, consolidate the differences, then accept the result.`}
    </p>}
    {decision}
    {row.final && <p>
      <RouteLink route={textViewRoute(projectKey, row.case_id, row.final.document_id, query, { show: `final:${row.final.submission_id}` })} onNavigate={onNavigate}
        className="btn btn-secondary btn-sm">Open result</RouteLink>
    </p>}
  </section>;
}
