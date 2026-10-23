/** The comparison table of one group (spec §3, mockup variant B): people as columns, fields as rows. */
import type { ConsolidationGroupView, ConsolidationMemberView, ConsolidationPersonView } from "../api/client";
import { AxisValue } from "../ui/AxisValue";
import { IconBot, IconCheck, IconWarning } from "../ui/icons";
import { type ComparisonRow, peopleOf } from "./groupModel";
import { personName } from "./lanes";
import { LaneKey } from "./TextPane";

const TOOL_PROPOSAL = "From a tool proposal";

export interface ComparisonTableProps {
  /** The group name (text excerpt) for the caption. */
  name: string;
  group: ConsolidationGroupView;
  people: readonly ConsolidationPersonView[];
  rows: readonly ComparisonRow[];
  /** Resolved or read-only: values only, no take buttons and no "Whole finding" row. */
  readOnly?: boolean;
  /** Saving: the buttons stay focusable but do nothing. */
  busy?: boolean;
  onChoose: (rowId: string, value: string) => void;
  onTake: (member: ConsolidationMemberView) => void;
}

export function ComparisonTable({ name, group, people, rows, readOnly = false, busy = false, onChoose, onTake }: ComparisonTableProps): JSX.Element {
  const members = group.members;
  const names = peopleOf(people, members);
  return <table className="cons-compare">
    <caption className="visually-hidden">Comparison of {name}</caption>
    <thead><tr><td />{members.map((member, index) => <th key={member.input_id} scope="col">
      <LaneKey people={people} personId={member.person_id} />{personName(names[index].label)}
      {member.from_tool_proposal && <span className="cons-bot" role="img" aria-label={TOOL_PROPOSAL} title={TOOL_PROPOSAL}><IconBot /></span>}
    </th>)}</tr></thead>
    <tbody>{rows.filter(row => !readOnly || row.kind !== "whole").map(row => <tr key={row.id} className={row.conflict && !readOnly ? "cons-row--conflict" : undefined}>
      <th scope="row">
        {row.conflict && !readOnly && <><IconWarning className="cons-conflict-mark" /><span className="visually-hidden">Conflict: </span></>}
        {row.label}
      </th>
      {row.agreed !== null || row.info !== null
        ? <td colSpan={members.length} className="cons-agreed">{row.agreed ?? `${row.cells[0].display} ${row.info}`}</td>
        : row.cells.map((cell, index) => <td key={cell.inputId}>
          {row.kind === "whole"
            ? <button type="button" className="btn btn-secondary btn-sm" aria-pressed={cell.chosen} aria-disabled={busy || undefined}
              onClick={() => { if (!busy) onTake(members[index]); }}>{cell.display}</button>
            : <span className="cons-value">
              {row.kind === "axis" ? <AxisValue value={cell.value} /> : cell.display}
              {row.conflict && !readOnly && <button type="button" className="cons-take" aria-pressed={cell.chosen} aria-disabled={busy || undefined}
                aria-label={`Take ${cell.display} from ${personName(names[index].label)} for ${row.label}`}
                onClick={() => { if (!busy) onChoose(row.id, cell.value); }}><IconCheck /></button>}
            </span>}
        </td>)}
    </tr>)}</tbody>
  </table>;
}
