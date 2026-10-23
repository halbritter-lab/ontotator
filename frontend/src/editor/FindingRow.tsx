import type { ReactNode } from "react";
import type { AnnotationSnapshot, EditorProposal } from "../api/client";
import { plural } from "../app/labels";
import { StatusBadge } from "../ui/StatusBadge";
import { AxisValue } from "../ui/AxisValue";
import { AiBadge } from "./AiBadge";
import { axisOptionLabel, type findingAxes } from "./axisLabels";
import { TermName } from "./TermName";

export interface FindingRowProps {
  snapshot: AnnotationSnapshot;
  selected: boolean;
  termLabel: (layer: string | undefined, term: string) => string | null;
  layerName?: string;
  showLayer: boolean;
  axes: ReturnType<typeof findingAxes>;
  defaulted: boolean;
  proposal?: EditorProposal;
  onActivate: () => void;
  /** Rendered after the axis summary. */
  children?: ReactNode;
}

/** One row of the saved findings list in the editor sidebar. */
export function FindingRow({ snapshot: annSnap, selected: isSelected, termLabel, layerName, showLayer, axes, defaulted, proposal, onActivate, children }: FindingRowProps) {
  const evCount = annSnap.annotation.evidence_refs?.length ?? 0;
  const termId = annSnap.annotation.term_id;
  return (
    <li
      data-list-key={`annotation:${annSnap.annotation.annotation_id}`}
      className={`doc-item ${isSelected ? "selected" : ""}`}
      role="button" tabIndex={0} aria-pressed={isSelected}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
      onClick={onActivate}
    >
      <div className="doc-id doc-row">
        <TermName termId={termId} label={termLabel(annSnap.annotation.layer_id, termId)} />
        {defaulted && <StatusBadge tone="warning">Defaults to confirm</StatusBadge>}
        {layerName && showLayer && (
          <span className="decision-tag decision-tag--open">{layerName}</span>
        )}
      </div>
      <div className="doc-meta">
        {evCount === 0 ? "Spanless" : plural(evCount, "mention")}
        {" "}<AiBadge provenance={annSnap.annotation.provenance} source={proposal} />
      </div>
      {axes.length > 0 && <dl className="finding-axis-summary" aria-label="Clinical context">
        {axes.map(axis => <div key={axis.id} title={`${axis.label}: ${axisOptionLabel(axis.value)}${annSnap.annotation.axes_defaulted?.includes(axis.id) ? " (defaulted)" : ""}`}>
          <dt>{axis.label}: </dt><dd><AxisValue value={axis.value as string | null | undefined} />{annSnap.annotation.axes_defaulted?.includes(axis.id) && " (defaulted)"}</dd>
        </div>)}
      </dl>}
      {children}
    </li>
  );
}
