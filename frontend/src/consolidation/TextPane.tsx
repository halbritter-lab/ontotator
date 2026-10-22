/**
 * Read-only clinical text of the consolidation view (acceptance fixes U12, U13, X18): one underline lane per
 * person in a fixed order (lane 1 closest to the text, distinct offset, hue and line style), a neutral background on
 * kept findings, a frame on the selected group. Selecting text offers "Add finding".
 */
import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { ConsolidationGroupView, ConsolidationPersonView } from "../api/client";
import { laneLegend, laneOf, lanesOf, MAX_LANES } from "./lanes";

export interface AddedFinding {
  annotationId: string;
  spans: [number, number][];
  label: string;
}

export interface TextRange { start: number; end: number }

export interface TextPaneProps {
  text: string;
  groups: readonly ConsolidationGroupView[];
  people: readonly ConsolidationPersonView[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  added?: readonly AddedFinding[];
  /** Called with the selected codepoint range, or null when the selection is gone. */
  onTextSelection?: (range: TextRange | null) => void;
  /** Toolbar content above the text ("Add finding", "Hide text"). */
  toolbar?: ReactNode;
  reducedMotion?: boolean;
}

/**
 * One person lane's underline: its own hue (`--lane-N-line`) and its own line style, so lanes stay apart without
 * colour (lane 1 solid, 2 dashed, 3 dotted, 4 double).
 */
const LANE_LINES: Record<number, { image: (colour: string) => string; height: number }> = {
  1: { image: colour => `linear-gradient(${colour}, ${colour})`, height: 2 },
  2: { image: colour => `repeating-linear-gradient(90deg, ${colour} 0 6px, transparent 6px 9px)`, height: 2 },
  3: { image: colour => `repeating-linear-gradient(90deg, ${colour} 0 2px, transparent 2px 4px)`, height: 2 },
  4: { image: colour => `linear-gradient(${colour} 0 1px, transparent 1px 2px, ${colour} 2px 3px)`, height: 3 },
};

const laneLine = (lane: number) => LANE_LINES[lane] ?? LANE_LINES[MAX_LANES];

/** The line style of a lane in words, for the legend (meaning never depends on colour alone). */
export const LANE_STYLE_WORDS: Record<number, string> = { 1: "solid", 2: "dashed", 3: "dotted", 4: "double" };

/** Underline lanes as stacked background lines: lane 1 sits closest to the text. */
export function laneStyle(lanes: readonly number[]): CSSProperties {
  if (!lanes.length) return {};
  return {
    backgroundImage: lanes.map(lane => laneLine(lane).image(`var(--lane-${lane}-line)`)).join(", "),
    backgroundSize: lanes.map(lane => `100% ${laneLine(lane).height}px`).join(", "),
    backgroundPosition: lanes.map(lane => `0 calc(100% - ${(MAX_LANES - lane) * 4}px)`).join(", "),
  };
}

/** The colour key of a person: a short sample of their lane's underline, next to their name. */
export function LaneKey({ people, personId }: { people: readonly ConsolidationPersonView[]; personId: string }): JSX.Element {
  const lane = laneOf(people, personId);
  return <span className="cons-lane-key" data-lane={lane} aria-hidden="true"
    style={{ backgroundImage: laneLine(lane).image(`var(--lane-${lane}-line)`), backgroundSize: `100% ${laneLine(lane).height}px` }} />;
}

interface Piece {
  start: number;
  end: number;
  lanes: number[];
  groupIds: string[];
  kept: boolean;
  added: boolean;
}

function piecesOf(text: string, groups: readonly ConsolidationGroupView[], people: readonly ConsolidationPersonView[], added: readonly AddedFinding[]): Piece[] {
  const length = Array.from(text).length;
  const marks: { start: number; end: number; lane?: number; groupId?: string; kept?: boolean; added?: boolean }[] = [];
  for (const group of groups) {
    const kept = group.state !== "open" && group.state !== "leave_out";
    for (const member of group.members) for (const [start, end] of member.spans) {
      marks.push({ start, end, lane: laneOf(people, member.person_id), groupId: group.group_id, kept });
    }
  }
  for (const finding of added) for (const [start, end] of finding.spans) marks.push({ start, end, added: true });
  const bounds = new Set<number>([0, length]);
  for (const mark of marks) { bounds.add(Math.max(0, Math.min(length, mark.start))); bounds.add(Math.max(0, Math.min(length, mark.end))); }
  const sorted = [...bounds].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  for (let index = 0; index + 1 < sorted.length; index++) {
    const start = sorted[index], end = sorted[index + 1];
    if (end <= start) continue;
    const covering = marks.filter(mark => mark.start <= start && mark.end >= end);
    const lanes = [...new Set(covering.flatMap(mark => mark.lane ? [mark.lane] : []))].sort((a, b) => a - b);
    const groupIds = [...new Set(covering.flatMap(mark => mark.groupId ? [mark.groupId] : []))];
    pieces.push({ start, end, lanes, groupIds, kept: covering.some(mark => mark.kept), added: covering.some(mark => mark.added) });
  }
  return pieces;
}

/** Codepoint offset of a DOM position inside the text (each piece carries its start in `data-start`). */
function offsetOf(node: Node | null, offset: number): number | null {
  if (!node) return null;
  const element = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element)?.closest<HTMLElement>("[data-start]");
  if (!element) return null;
  const base = Number(element.dataset.start);
  if (node.nodeType !== Node.TEXT_NODE) return offset === 0 ? base : base + Array.from(element.textContent ?? "").length;
  return base + Array.from((node.textContent ?? "").slice(0, offset)).length;
}

function isOffScreen(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  const frame = element.closest<HTMLElement>(".cons-text-scroll")?.getBoundingClientRect();
  const top = Math.max(0, frame?.top ?? 0), bottom = Math.min(window.innerHeight, frame?.bottom ?? window.innerHeight);
  return box.bottom < top || box.top > bottom;
}

export function TextPane({ text, groups, people, selectedGroupId, onSelectGroup, added = [], onTextSelection, toolbar, reducedMotion = false }: TextPaneProps): JSX.Element {
  const pieces = useMemo(() => piecesOf(text, groups, people, added), [text, groups, people, added]);
  const chars = useMemo(() => Array.from(text), [text]);
  const root = useRef<HTMLDivElement>(null);
  const lanes = useMemo(() => lanesOf(people), [people]);

  // The selected group scrolls into view only when it is off-screen; instantly under reduced motion (X18).
  useLayoutEffect(() => {
    if (!selectedGroupId) return;
    const first = root.current?.querySelector<HTMLElement>(".cons-selected");
    if (first && isOffScreen(first)) first.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  }, [selectedGroupId, reducedMotion]);

  const readSelection = () => {
    if (!onTextSelection) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !root.current) { onTextSelection(null); return; }
    const range = selection.getRangeAt(0);
    if (!root.current.contains(range.startContainer) || !root.current.contains(range.endContainer)) { onTextSelection(null); return; }
    const a = offsetOf(range.startContainer, range.startOffset), b = offsetOf(range.endContainer, range.endOffset);
    if (a === null || b === null || a === b) { onTextSelection(null); return; }
    let start = Math.min(a, b), end = Math.max(a, b);
    // Trim surrounding white space of the marked passage.
    while (start < end && /\s/u.test(chars[start])) start++;
    while (end > start && /\s/u.test(chars[end - 1])) end--;
    onTextSelection(end > start ? { start, end } : null);
  };

  return <section className="cons-text" aria-label="Clinical text">
    {toolbar && <div className="cons-text-toolbar">{toolbar}</div>}
    <div className="cons-text-scroll">
      <div ref={root} className="cons-text-body" onMouseUp={readSelection} onKeyUp={readSelection}>
        {pieces.map(piece => {
          const value = chars.slice(piece.start, piece.end).join("");
          if (!piece.groupIds.length && !piece.added) return <span key={piece.start} data-start={piece.start}>{value}</span>;
          const selected = !!selectedGroupId && piece.groupIds.includes(selectedGroupId);
          const className = ["cons-mark", piece.kept && "cons-kept", piece.added && "cons-added", selected && "cons-selected"].filter(Boolean).join(" ");
          const target = selected ? selectedGroupId! : piece.groupIds[0];
          return <span key={piece.start} data-start={piece.start} className={className} style={laneStyle(piece.lanes)}
            data-lanes={piece.lanes.join(" ") || undefined}
            onClick={target ? () => { if (window.getSelection()?.isCollapsed !== false) onSelectGroup(target); } : undefined}>{value}</span>;
        })}
      </div>
    </div>
    <ul className="cons-legend" aria-label="Legend">
      {lanes.map(lane => <li key={lane.lane}><span className="cons-legend-swatch" style={laneStyle([lane.lane])} aria-hidden="true" />
        <span>Line {lane.lane} ({LANE_STYLE_WORDS[lane.lane]}): {laneLegend(lane)}</span></li>)}
      <li><span className="cons-legend-swatch cons-kept" aria-hidden="true" /><span>Shaded: kept</span></li>
      <li><span className="cons-legend-swatch cons-selected" aria-hidden="true" /><span>Framed: selected group</span></li>
    </ul>
  </section>;
}
