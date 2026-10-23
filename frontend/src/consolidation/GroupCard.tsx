/**
 * One finding group of the consolidation view (spec §3, mockup variant B). Collapsed: one line with the conflict mark,
 * the group name (the text excerpt) and its state ("2 fields to decide", "agreed", "decided"). Expanded: the
 * comparison table (columns = people, rows = term, axes, text, note, whole finding; a check button takes a value in a
 * conflicting row), the result line that always spells out the one finding, "+ note", "Guidelines unclear here" and
 * the actions. The last missing choice resolves the group; a group without conflicts resolves with "Keep".
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ConsolidationAnnotatePayload, ConsolidationGroupView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import type { WorkspaceView } from "../app/CaseScreen";
import { axisOptionLabel } from "../editor/axisLabels";
import { Button, Checkbox, InlineConfirm, Select, Textarea } from "../ui";
import { IconWarning } from "../ui/icons";
import { ComparisonTable } from "./ComparisonTable";
import { axisLabel, groupStatus, keepLabel, partialText, REOPEN_EDITED_WARNING } from "./consolidationText";
import { absentPeople, choicesComplete, comparisonRows, groupName, hasKind, needsTerm, presentPeople, resolvePayload, resultLine, takeFinding, type Choices, type OtherTerm } from "./groupModel";
import { ResultLine } from "./ResultLine";
import { TermPicker } from "./TermPicker";
import type { GroupOutcome } from "./useConsolidation";

export interface GroupCardProps {
  group: ConsolidationGroupView;
  people: readonly ConsolidationPersonView[];
  text: string;
  expanded: boolean;
  readOnly: boolean;
  busy: boolean;
  outcome?: GroupOutcome;
  /** Below 700 px: a text snippet of the passage in the card. */
  narrow?: boolean;
  /** The editor view (layers, axes); without it "Edit values…" and "Other term…" are not offered. */
  workspace?: WorkspaceView | null;
  /** What this session's decision kept ("Hypotonia (HP:0001252), Absent, Patient, Current"). */
  summary?: string;
  onExpand: () => void;
  onResolve: (payload: ConsolidationResolvePayload, summary: string) => Promise<boolean>;
  onAnnotate: (payload: ConsolidationAnnotatePayload) => Promise<boolean>;
  onReopen: () => Promise<boolean>;
  onDismissOutcome: () => void;
  onEditInEditor?: () => void;
  toggleRef?: (element: HTMLButtonElement | null) => void;
}

const SNIPPET_CONTEXT = 40;

/** "…context passage context…" around the group's passage. */
function Snippet({ group, text }: { group: ConsolidationGroupView; text: string }): JSX.Element | null {
  const spans = group.members.flatMap(member => member.spans);
  if (!spans.length) return null;
  const chars = Array.from(text);
  const start = Math.min(...spans.map(([value]) => value)), end = Math.max(...spans.map(([, value]) => value));
  const from = Math.max(0, start - SNIPPET_CONTEXT), to = Math.min(chars.length, end + SNIPPET_CONTEXT);
  return <p className="cons-snippet">{from > 0 && "…"}{chars.slice(from, start).join("")}
    <mark className="cons-snippet-mark">{chars.slice(start, end).join("")}</mark>{chars.slice(end, to).join("")}{to < chars.length && "…"}</p>;
}

/** "Edit values…": every axis of the finding's type, starting from the kept member's values. */
function EditValues({ group, workspace, busy, onKeep, onCancel }: { group: ConsolidationGroupView; workspace: WorkspaceView; busy: boolean; onKeep: (axes: Record<string, string>) => void; onCancel: () => void }): JSX.Element {
  const base = group.members.find(member => member.input_id === group.keep_input_id) ?? group.members[0];
  const type = workspace.layers?.find(layer => layer.layer_id === base.layer_id)?.annotation_types.find(value => value.type_id === base.type_id);
  const axes = type?.axes ?? Object.keys(base.axes).map(id => ({ id, label: axisLabel(id), options: [base.axes[id]], allow_empty: false }));
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...base.axes }));
  const id = useId();
  return <div className="cons-edit-values" role="group" aria-label="Edit values">
    {axes.map(axis => <Select key={axis.id} id={`${id}-${axis.id}`} label={axis.label} value={values[axis.id] ?? ""}
      onChange={event => setValues(current => ({ ...current, [axis.id]: event.target.value }))}>
      {!values[axis.id] && <option value="">Not specified</option>}
      {axis.options.map(option => <option key={option} value={option}>{axisOptionLabel(option)}</option>)}
    </Select>)}
    <div className="cons-actions">
      <Button variant="primary" loading={busy} onClick={() => onKeep(Object.fromEntries(Object.entries(values).filter(([, value]) => !!value)))}>Keep with these values</Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}

export function GroupCard(props: GroupCardProps): JSX.Element {
  const { group, people, text, expanded, readOnly, busy, outcome, narrow, workspace } = props;
  const [otherTerm, setOtherTerm] = useState<OtherTerm | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [note, setNote] = useState(group.note ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [flag, setFlag] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const otherTermRef = useRef<HTMLButtonElement>(null);
  const noteId = useId();
  const open = group.state === "open";
  // A reopened group starts over: old choices would resolve it with the first check.
  useEffect(() => { if (open) { setChoices({}); setOtherTerm(null); } }, [open]);
  const name = groupName(group, text);
  const present = presentPeople(group, people), absent = absentPeople(group, people);
  const partial = hasKind(group, "partial");
  const rows = useMemo(() => comparisonRows(group, people, text, choices), [group, people, text, choices]);
  const line = resultLine(group, people, choices, otherTerm);
  const conflicts = rows.filter(row => row.conflict).length;
  const inputIds = group.members.map(member => member.input_id);
  const status = groupStatus(group, conflicts);
  const extras = () => ({ ...(note.trim() ? { note: note.trim() } : {}), ...(flag ? { guidelines_unclear: true } : {}) });

  const resolve = (payload: Omit<ConsolidationResolvePayload, "input_ids">, summary: string) =>
    void props.onResolve({ input_ids: inputIds, ...payload, ...extras() }, summary);
  // The last missing choice resolves the group with the finding the result line spells out.
  const settle = (next: Choices, other: OtherTerm | null = otherTerm) => {
    setChoices(next);
    if (conflicts && choicesComplete(comparisonRows(group, people, text, next), next)) {
      resolve(resolvePayload(group, next), resultLine(group, people, next, other).finding);
    }
  };
  // Choosing a value by hand drops the member of an earlier "Take … finding".
  const onChoose = (rowId: string, value: string) => {
    const { whole: _taken, ...rest } = choices;
    settle({ ...rest, [rowId]: value });
  };
  const editValues = (axes: Record<string, string>) => {
    const base = group.members.find(member => member.input_id === group.keep_input_id) ?? group.members[0];
    resolve({ action: "choose", choice: { term_id: base.term_id, span_from_input_id: base.input_id, axes } },
      Object.values(axes).map(axisOptionLabel).join(", ") || "decided");
    setEditing(false);
  };
  const reopen = () => { if (group.edited) setConfirmReopen(true); else void props.onReopen(); };

  const header = <h2 className="cons-group-heading">
    <button ref={props.toggleRef} type="button" className="cons-group-toggle" aria-expanded={expanded} onClick={props.onExpand}>
      {open && conflicts > 0 && <span className="cons-conflict"><IconWarning /><span className="visually-hidden">Conflict</span></span>}
      <span className="cons-group-title">{name}</span>{" "}
      <span className={open ? "cons-group-state" : "cons-group-done"}>{status}{!open && props.summary ? `: ${props.summary}` : ""}</span>
      {group.edited && <>{" "}<span className="cons-tag">edited in editor</span></>}
      {group.guidelines_unclear && <>{" "}<span className="cons-tag">flagged</span></>}
    </button>
  </h2>;

  const outcomeBlock = outcome?.kind === "conflict"
    ? <InlineConfirm title="Decision not saved" message="" confirmLabel="Save" onConfirm={() => undefined} onCancel={props.onDismissOutcome} outcome={outcome}
      conflictMessage="This consolidation changed elsewhere (another tab, a reopened submission, a new text version or a new assignment). Nothing was saved. Review the current state." />
    : outcome?.kind === "error" ? <div className="cons-failure" role="alert">
      <p>Could not save. Nothing changed.</p>
      <Button onClick={outcome.onRetry} loading={busy}>Retry</Button>
    </div> : null;

  const noteAndFlag = (resolved: boolean) => <div className="cons-note-flag">
    {noteOpen ? <div className="cons-note">
      <Textarea id={noteId} label="Note for the lead" value={note} onChange={event => setNote(event.target.value)} rows={2} />
      {resolved && <div className="cons-actions">
        <Button size="sm" loading={busy} onClick={() => { void props.onAnnotate({ input_ids: inputIds, note: note.trim() || null, guidelines_unclear: group.guidelines_unclear }).then(ok => { if (ok) setNoteOpen(false); }); }}>Save note</Button>
        <Button size="sm" onClick={() => { setNote(group.note ?? ""); setNoteOpen(false); }}>Cancel</Button>
      </div>}
    </div> : <Button size="sm" onClick={() => setNoteOpen(true)}>{resolved && group.note ? "Edit note" : "+ note"}</Button>}
    <Checkbox id={`${noteId}-flag`} label="Guidelines unclear here" checked={resolved ? group.guidelines_unclear : flag}
      onChange={event => {
        if (!resolved) { setFlag(event.target.checked); return; }
        void props.onAnnotate({ input_ids: inputIds, guidelines_unclear: event.target.checked });
      }} />
  </div>;

  const table = (tableReadOnly: boolean) => <ComparisonTable name={name} group={group} people={people} rows={rows} readOnly={tableReadOnly}
    busy={busy} onChoose={onChoose} onTake={member => settle(takeFinding(group, member))} />;

  const openBody = <>
    {partial && <p className="cons-partial">{partialText(present, absent)}</p>}
    {table(readOnly)}
    {!readOnly && <>
      <ResultLine line={line} />
      {/* Note and flag go with the decision, so they come before the choices (the last choice resolves). */}
      {noteAndFlag(false)}
      {editing && workspace ? <EditValues group={group} workspace={workspace} busy={busy} onKeep={editValues} onCancel={() => setEditing(false)} />
        : <div className="cons-actions">
          {!conflicts && <Button variant="primary" loading={busy}
            onClick={() => resolve(resolvePayload(group, choices), line.finding)}>{partial ? keepLabel(present) : "Keep"}</Button>}
          <Button aria-disabled={busy || undefined} onClick={() => { if (!busy) resolve({ action: "leave_out" }, "left out"); }}>Leave out</Button>
          {!conflicts && workspace && <Button onClick={() => setEditing(true)}>Edit values…</Button>}
          {(!conflicts || needsTerm(group)) && workspace && <Button ref={otherTermRef} aria-expanded={picking} onClick={() => setPicking(true)}>Other term…</Button>}
          {props.onEditInEditor && <Button onClick={props.onEditInEditor}>Edit in editor…</Button>}
        </div>}
      {workspace && <TermPicker open={picking} anchorRef={otherTermRef} label="Other term" workspace={workspace} layerId={group.members[0].layer_id}
        onClose={() => setPicking(false)} onPick={candidate => {
          if (busy) return;
          setPicking(false);
          if (!needsTerm(group)) {
            resolve({ action: "choose", choice: { term_id: candidate.term_id, span_from_input_id: group.keep_input_id, axes: {} } },
              `${candidate.label} (${candidate.term_id})`);
            return;
          }
          // Another term replaces the members' terms; the other conflicting fields still need their choice.
          const other = { termId: candidate.term_id, label: candidate.label };
          setOtherTerm(other);
          settle({ ...choices, term: candidate.term_id }, other);
        }} />}
    </>}
  </>;

  const resolvedBody = <>
    {group.note && !noteOpen && <p className="cons-note-text">Note: {group.note}</p>}
    {readOnly && group.guidelines_unclear && <p className="cons-note-text">Flagged: guidelines unclear</p>}
    {table(true)}
    {!readOnly && <>
      {confirmReopen ? <InlineConfirm title="Reopen this group?" message={REOPEN_EDITED_WARNING} confirmLabel="Reopen" busy={busy}
        onCancel={() => setConfirmReopen(false)} onConfirm={() => { void props.onReopen().then(() => setConfirmReopen(false)); }} />
        : <div className="cons-actions">
          <Button size="sm" loading={busy} onClick={reopen}>Change</Button>
          {props.onEditInEditor && <Button size="sm" onClick={props.onEditInEditor}>Edit in editor…</Button>}
        </div>}
      {noteAndFlag(true)}
    </>}
  </>;

  return <li className={["cons-group", expanded && "cons-group-expanded", !open && "cons-group-resolved", group.state === "auto" && "cons-group-agreed"].filter(Boolean).join(" ")} data-group={group.group_id}>
    <div className="cons-group-line">
      {header}
      {!expanded && !open && !readOnly && <Button size="sm" className="cons-change" loading={busy}
        aria-label={`Change, ${name}`} onClick={reopen}>Change</Button>}
    </div>
    {!expanded && confirmReopen && <InlineConfirm title="Reopen this group?" message={REOPEN_EDITED_WARNING} confirmLabel="Reopen" busy={busy}
      onCancel={() => setConfirmReopen(false)} onConfirm={() => { void props.onReopen().then(() => setConfirmReopen(false)); }} />}
    {narrow && <Snippet group={group} text={text} />}
    {expanded && <div className="cons-group-body">
      {open ? openBody : resolvedBody}
      {outcomeBlock}
    </div>}
    {!expanded && outcomeBlock}
  </li>;
}
