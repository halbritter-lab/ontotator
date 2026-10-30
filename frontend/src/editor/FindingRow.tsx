import type { ReactNode } from "react";
import type { AnnotationSnapshot, EditorProposal } from "../api/client";
import { plural } from "../app/labels";
import { StatusBadge } from "../ui/StatusBadge";
import { AxisValue } from "../ui/AxisValue";
import { AiBadge } from "./AiBadge";
import { axisOptionLabel, type findingAxes } from "./axisLabels";
import { TermName } from "./TermName";
import { Kbd } from "../ui/Kbd";
import { sortByLabel } from "./modifiers";
import "./modifiers.css";

/** The row as a target of the attach mode (E-a): its name, and whether it is the focused target. */
export interface AttachTarget {
  /** Modifier term label, e.g. "Severe". */
  term: string;
  active: boolean;
  /** ↑ / ↓ on the row: move to the previous / next target row. */
  onMove: (step: 1 | -1) => void;
}

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
  attachTarget?: AttachTarget;
  /** Convert mode (E-c): this row's finding becomes the modifier; it is no target. */
  convertSource?: boolean;
  /** Pointer over or focus in the row (true) and away again (false): frames the finding's marks. */
  onFrame?: (on: boolean) => void;
  /** An Edit & Replace copy, listed under the proposal it replaces (issue 211). */
  copy?: boolean;
}

/** "Modifiers: Recurrent, Severe" (label order) under a finding or proposal row; nothing without modifiers. */
export function ModifierLine({ modifiers, layerId, termLabel }: {
  modifiers: readonly { term_id: string }[] | null | undefined;
  layerId: string;
  termLabel: (layer: string | undefined, term: string) => string | null;
}) {
  const sorted = sortByLabel(modifiers ?? [], id => {
    const label = termLabel(layerId, id);
    return label ? { label, role: "modifier", exclusiveClass: null } : undefined;
  });
  return sorted.length > 0 ? <p className="mod-lines">Modifiers: {sorted.map((modifier, index) => <span key={modifier.term_id}>
    {index > 0 && ", "}<b>{termLabel(layerId, modifier.term_id) ?? modifier.term_id}</b></span>)}</p> : null;
}

/** One row of the saved findings list in the editor sidebar. */
export function FindingRow({ snapshot: annSnap, selected: isSelected, termLabel, layerName, showLayer, axes, defaulted, proposal, onActivate, children, attachTarget, convertSource, onFrame, copy }: FindingRowProps) {
  const evCount = annSnap.annotation.evidence_refs?.length ?? 0;
  const termId = annSnap.annotation.term_id;
  const layerId = annSnap.annotation.layer_id;
  const findingName = termLabel(layerId, termId) ?? termId;
  const className = ["doc-item", isSelected && !attachTarget && "selected", attachTarget && "mod-target", attachTarget?.active && "mod-target--active"]
    .filter(Boolean).join(" ");
  // The button sits inside the list item: a list may only hold list items (axe "list").
  return (
    <li className={copy ? "doc-list-row doc-list-row--copy" : "doc-list-row"}><div
      data-list-key={`annotation:${annSnap.annotation.annotation_id}`}
      className={className}
      role="button"
      // Attach mode: the target rows have a roving tab stop (the active one).
      tabIndex={attachTarget && !attachTarget.active ? -1 : 0}
      aria-pressed={attachTarget ? undefined : isSelected}
      aria-label={attachTarget ? `Attach ${attachTarget.term} to ${findingName}` : undefined}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); }
        else if (attachTarget && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          attachTarget.onMove(event.key === "ArrowDown" ? 1 : -1);
        }
      }}
      onClick={onActivate}
      onPointerEnter={onFrame && (() => onFrame(true))}
      onPointerLeave={onFrame && (() => onFrame(false))}
      onFocus={onFrame && (() => onFrame(true))}
      onBlur={onFrame && (event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFrame(false); })}
    >
      <div className="doc-id doc-row">
        <TermName termId={termId} label={termLabel(annSnap.annotation.layer_id, termId)} />
        {defaulted && <StatusBadge tone="warning">Defaults to confirm</StatusBadge>}
        {layerName && showLayer && (
          <span className="decision-tag decision-tag--open">{layerName}</span>
        )}
      </div>
      <div className="doc-meta">
        {copy && "Your copy, "}{evCount === 0 ? "Spanless" : plural(evCount, "mention")}
        {" "}<AiBadge provenance={annSnap.annotation.provenance} source={proposal} />
      </div>
      {convertSource && <div className="mod-attach-here">Becomes a modifier of the finding you choose</div>}
      {attachTarget?.active && <div className="mod-attach-here" aria-hidden="true">Attach {attachTarget.term} here <Kbd>Enter</Kbd></div>}
      <ModifierLine modifiers={annSnap.annotation.modifiers} layerId={layerId} termLabel={termLabel} />
      {axes.length > 0 && <dl className="finding-axis-summary" aria-label="Clinical context">
        {axes.map(axis => <div key={axis.id} title={`${axis.label}: ${axisOptionLabel(axis.value)}${annSnap.annotation.axes_defaulted?.includes(axis.id) ? " (defaulted)" : ""}`}>
          <dt>{axis.label}: </dt><dd><AxisValue value={axis.value as string | null | undefined} /></dd>
        </div>)}
      </dl>}
      {children}
    </div></li>
  );
}
