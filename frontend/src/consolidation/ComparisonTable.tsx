/** The comparison table of one group (spec §3, mockup variant B): people as columns, fields as rows. */
import type { ConsolidationGroupView, ConsolidationPersonView } from "../api/client";
import { AxisValue } from "../ui/AxisValue";
import { IconBot, IconCheck, IconWarning } from "../ui/icons";
import { allAgree, type ComparisonRow, type ModifierToggleCell, peopleOf } from "./groupModel";
import { personName } from "./lanes";
import { LaneKey } from "./TextPane";

const TOOL_PROPOSAL = "From a tool proposal";

export interface ComparisonTableProps {
  /** The group name (text excerpt) for the caption. */
  name: string;
  group: ConsolidationGroupView;
  people: readonly ConsolidationPersonView[];
  rows: readonly ComparisonRow[];
  /** Resolved or read-only: values only, no take buttons. */
  readOnly?: boolean;
  /** Saving: the buttons stay focusable but do nothing. */
  busy?: boolean;
  onChoose: (rowId: string, value: string) => void;
}

/** A member's modifiers, one line each; in a conflicting row each carries its ✓ toggle (DN-1). No "·" (DN-10). */
function ModifierList({ owner, toggles, interactive, busy, onPress }: { owner: string; toggles: readonly ModifierToggleCell[]; interactive: boolean;
  busy: boolean; onPress: (id: string) => void }): JSX.Element {
  return <ul className="cons-mod-list" aria-label={`Modifiers of ${owner}`}>{toggles.map(toggle => <li key={toggle.id}><span className="cons-value">
    <span>{toggle.label}{toggle.majority && ` ${toggle.majority}`}{toggle.cohort && <> <span className="cons-tag">Cohort term</span></>}
      {toggle.otherText && <> <span className="cons-muted">other text chosen</span></>}</span>
    {interactive && <button type="button" className="cons-take" aria-pressed={toggle.pressed} aria-disabled={busy || undefined} aria-label={toggle.name}
      onClick={() => { if (!busy) onPress(toggle.id); }}><IconCheck /></button>}
  </span></li>)}</ul>;
}

/** Every row is shown (M2 M-7e): rows to decide first and highlighted, then the rest; agreed rows muted, one value across. */
export function orderRows(rows: readonly ComparisonRow[]): ComparisonRow[] {
  const shown = rows.filter(row => row.kind !== "whole");
  return [...shown.filter(row => row.conflict), ...shown.filter(row => !row.conflict)];
}

export function ComparisonTable({ name, group, people, rows, readOnly = false, busy = false, onChoose }: ComparisonTableProps): JSX.Element {
  const members = group.members;
  const names = peopleOf(people, members);
  const line = (row: ComparisonRow) => <tr key={row.id}
    className={row.conflict && !readOnly ? "cons-row--conflict" : row.agreed !== null && members.length > 1 ? "cons-row--agreed" : undefined}>
      <th scope="row">
        {row.conflict && !readOnly && <><IconWarning className="cons-conflict-mark" /><span className="visually-hidden">Conflict: </span></>}
        {row.label}
        {row.warnings?.map(warning => <span key={warning} className="cons-row-warning"><IconWarning className="cons-conflict-mark" />{warning}</span>)}
      </th>
      {row.agreed !== null || row.info !== null
        ? <td colSpan={members.length} className="cons-agreed">{row.kind === "modifiers" && row.cells[0].toggles?.some(toggle => toggle.cohort)
          ? <>{row.cells[0].toggles.map((toggle, index) => <span key={toggle.id}>{index > 0 && ", "}{toggle.label}{toggle.cohort && <> <span className="cons-tag">Cohort term</span></>}</span>)}{allAgree(members)}</>
          : row.kind === "axis" && row.agreed !== null ? <><AxisValue value={row.cells[0].value || null} />{allAgree(members)}</>
          : row.agreed ?? `${row.cells[0].display} ${row.info}`}</td>
        : row.cells.map((cell, index) => <td key={cell.inputId}>
          {row.kind === "modifiers"
            ? <ModifierList owner={personName(names[index].label)} toggles={cell.toggles ?? []} interactive={row.conflict && !readOnly} busy={busy}
              onPress={id => onChoose(row.id, id)} />
            : <span className="cons-value">
              {row.kind === "axis" ? <AxisValue value={cell.value} /> : cell.display}
              {row.conflict && !readOnly && <button type="button" className="cons-take" aria-pressed={cell.chosen} aria-disabled={busy || undefined}
                aria-label={`Take ${cell.display} from ${personName(names[index].label)} for ${row.label}`}
                onClick={() => { if (!busy) onChoose(row.id, cell.value); }}><IconCheck /></button>}
            </span>}
        </td>)}
    </tr>;
  return <div className="cons-compare-scroll"><table className="cons-compare">
    <caption className="visually-hidden">Comparison of {name}</caption>
    <thead><tr><td />{members.map((member, index) => <th key={member.input_id} scope="col">
      <LaneKey people={people} personId={member.person_id} />{personName(names[index].label)}
      {member.from_tool_proposal && <span className="cons-bot" role="img" aria-label={TOOL_PROPOSAL} title={TOOL_PROPOSAL}><IconBot /></span>}
    </th>)}</tr></thead>
    <tbody>{orderRows(rows).map(line)}</tbody>
  </table></div>;
}
