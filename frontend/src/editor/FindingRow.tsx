import type { ReactNode } from "react";
import type { AnnotationSnapshot, EditorProposal } from "../api/client";
import { plural } from "../app/labels";
import { StatusBadge } from "../ui/StatusBadge";
import { AxisValue } from "../ui/AxisValue";
import { AiBadge } from "./AiBadge";
import { axisOptionLabel, type findingAxes } from "./axisLabels";
import { TermName } from "./TermName";
import { Kbd } from "../ui/Kbd";
import { IconTag } from "../ui/icons";
import { quoteOf, sortByLabel } from "./modifiers";
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
  /** Document text, for the quotes of linked modifiers. */
  documentText?: string;
  attachTarget?: AttachTarget;
  /** Pointer over or focus in the row (true) and away again (false): frames the finding's marks. */
  onFrame?: (on: boolean) => void;
}

/** One row of the saved findings list in the editor sidebar. */
export function FindingRow({ snapshot: annSnap, selected: isSelected, termLabel, layerName, showLayer, axes, defaulted, proposal, onActivate, children, documentText = "", attachTarget, onFrame }: FindingRowProps) {
  const evCount = annSnap.annotation.evidence_refs?.length ?? 0;
  const termId = annSnap.annotation.term_id;
  const layerId = annSnap.annotation.layer_id;
  const findingName = termLabel(layerId, termId) ?? termId;
  const modifiers = sortByLabel(annSnap.annotation.modifiers ?? [], id => {
    const label = termLabel(layerId, id);
    return label ? { label, role: "modifier", exclusiveClass: null } : undefined;
  });
  const className = ["doc-item", isSelected && !attachTarget && "selected", attachTarget && "mod-target", attachTarget?.active && "mod-target--active"]
    .filter(Boolean).join(" ");
  return (
    <li
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
        {evCount === 0 ? "Spanless" : plural(evCount, "mention")}
        {" "}<AiBadge provenance={annSnap.annotation.provenance} source={proposal} />
      </div>
      {attachTarget?.active && <div className="mod-attach-here" aria-hidden="true">Attach {attachTarget.term} here <Kbd>Enter</Kbd></div>}
      {modifiers.length > 0 && <ul className="mod-lines" aria-label="Modifiers">
        {modifiers.map(modifier => {
          const quote = modifier.segments?.length ? quoteOf(documentText, modifier.segments) : "";
          return <li key={modifier.term_id} className="mod-line">
            <span aria-hidden="true">↳</span><IconTag />
            <span className="visually-hidden">Modifier: </span>
            <span className="mod-line-term">{termLabel(layerId, modifier.term_id) ?? modifier.term_id}</span>
            {" "}<span className="mod-line-id">{modifier.term_id}</span>
            {quote && <> <span className="mod-line-span">“{quote}”</span></>}
          </li>;
        })}
      </ul>}
      {axes.length > 0 && <dl className="finding-axis-summary" aria-label="Clinical context">
        {axes.map(axis => <div key={axis.id} title={`${axis.label}: ${axisOptionLabel(axis.value)}${annSnap.annotation.axes_defaulted?.includes(axis.id) ? " (defaulted)" : ""}`}>
          <dt>{axis.label}: </dt><dd><AxisValue value={axis.value as string | null | undefined} />{annSnap.annotation.axes_defaulted?.includes(axis.id) && " (defaulted)"}</dd>
        </div>)}
      </dl>}
      {children}
    </li>
  );
}
