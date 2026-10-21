/**
 * One finding group of the consolidation view (acceptance fixes spec "WP-E Frontend > Groups", X6–X8, X14, U14).
 * Collapsed: one line ("Hypotonia ✓ absent (Tom Reis) · Change"). Expanded: the comparison table (columns =
 * people, differences marked by weight and the word "differs"), one row of choice chips per difference naming
 * the person, "+ note" and "Guidelines unclear here". A group resolves when every row has a choice.
 */
import { useId, useMemo, useRef, useState } from "react";
import type { ConsolidationAnnotatePayload, ConsolidationGroupView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import type { WorkspaceView } from "../app/CaseScreen";
import { Button, Checkbox, InlineConfirm, Select, Textarea } from "../ui";
import { axisLabel, KIND_LABELS, keepLabel, namesOf, partialText, quoted, REOPEN_EDITED_WARNING, valueWords } from "./consolidationText";
import { absentPeople, activeMembers, allChosen, choosePayload, choiceSummary, groupTitle, hasKind, needsTerm, passage, peopleOf, presentPeople, rowsOf, stateSummary, termLabel, termOptions, type ChoiceRow, type Choices } from "./groupModel";
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
  /** What this session's decision kept ("absent (Tom Reis)"). */
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

function Chip({ selected, label, onClick, disabled }: { selected: boolean; label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  return <button type="button" className="cons-chip" aria-pressed={selected} aria-disabled={disabled || undefined}
    onClick={() => { if (!disabled) onClick(); }}>{label}</button>;
}

function ChipRow({ row, choices, onChoose, disabled }: { row: ChoiceRow; choices: Choices; onChoose: (row: ChoiceRow, key: string) => void; disabled: boolean }): JSX.Element {
  const id = useId();
  return <div className="cons-choice-row" role="group" aria-labelledby={id}>
    <span id={id} className="cons-choice-label">{row.label}:</span>
    {row.options.map(option => <Chip key={option.key} selected={choices[row.id] === option.key} label={option.label}
      disabled={disabled} onClick={() => onChoose(row, option.key)} />)}
  </div>;
}

/** Comparison table: rows = term, text, differing axes, note; columns = people. */
function Comparison({ group, people, text }: { group: ConsolidationGroupView; people: readonly ConsolidationPersonView[]; text: string }): JSX.Element {
  const members = group.members;
  const holders = peopleOf(people, members);
  const axes: string[] = [];
  for (const member of members) for (const axis of Object.keys(member.axes)) if (!axes.includes(axis)) axes.push(axis);
  const differing = axes.filter(axis => new Set(members.map(member => member.axes[axis] ?? "")).size > 1);
  const same = axes.filter(axis => !differing.includes(axis));
  const notes = members.some(member => member.note?.trim());
  const rows: { label: string; differs: boolean; cells: string[] }[] = [
    { label: "Term", differs: hasKind(group, "term_differs"), cells: members.map(termLabel) },
    { label: "Text", differs: hasKind(group, "span_differs"), cells: members.map(member => member.spans.length ? quoted(passage(text, member.spans)) : "No text span") },
    ...differing.map(axis => ({ label: axisLabel(axis), differs: true, cells: members.map(member => valueWords(member.axes[axis])) })),
    ...(notes ? [{ label: "Note", differs: hasKind(group, "notes_differ"), cells: members.map(member => member.note?.trim() || "No note") }] : []),
  ];
  return <>
    <table className="cons-compare">
      <caption className="visually-hidden">Comparison of {groupTitle(group)}</caption>
      <thead><tr><td /> {holders.map((person, index) => <th key={`${person.person_id}-${index}`} scope="col">{person.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.label} className={row.differs ? "cons-differs" : undefined}>
        <th scope="row">{row.label}{row.differs && <span className="cons-differs-word"> · differs</span>}</th>
        {row.cells.map((cell, index) => <td key={index}>{cell}</td>)}
      </tr>)}</tbody>
    </table>
    {same.length > 0 && <p className="cons-muted">{differing.length ? "Other values match" : "All values match"} ({same.map(axis => valueWords(members[0].axes[axis])).join(" · ")}).</p>}
  </>;
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
      {axis.options.map(option => <option key={option} value={option}>{valueWords(option)}</option>)}
    </Select>)}
    <div className="cons-actions">
      <Button variant="primary" loading={busy} onClick={() => onKeep(Object.fromEntries(Object.entries(values).filter(([, value]) => !!value)))}>Keep with these values</Button>
      <Button variant="quiet" onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}

export function GroupCard(props: GroupCardProps): JSX.Element {
  const { group, people, text, expanded, readOnly, busy, outcome, narrow, workspace } = props;
  const [term, setTerm] = useState<string | null>(null);
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
  const title = groupTitle(group);
  const present = presentPeople(group, people), absent = absentPeople(group, people);
  const partial = hasKind(group, "partial");
  const matchOnly = group.kinds.length === 1 && group.kinds[0] === "match";
  const rows = useMemo(() => rowsOf(group, people, text, term), [group, people, text, term]);
  const terms = useMemo(() => termOptions(group, people), [group, people]);
  const inputIds = group.members.map(member => member.input_id);
  const kindWords = partial ? `only ${namesOf(present)}` : group.kinds.filter(kind => kind !== "partial").map(kind => KIND_LABELS[kind] ?? kind).join(", ");
  const summary = props.summary ?? stateSummary(group, people);
  const extras = () => ({ ...(note.trim() ? { note: note.trim() } : {}), ...(flag ? { guidelines_unclear: true } : {}) });

  const resolve = (payload: Omit<ConsolidationResolvePayload, "input_ids">, line: string) =>
    void props.onResolve({ input_ids: inputIds, ...payload, ...extras() }, line);
  const choose = (next: Choices, chosenTerm: string | null = term) => {
    const nextRows = rowsOf(group, people, text, chosenTerm);
    const option = terms.find(value => value.termId === chosenTerm) ?? null;
    resolve({ action: "choose", choice: choosePayload(group, nextRows, next, chosenTerm) }, choiceSummary(nextRows, next, option));
  };
  const onChoose = (row: ChoiceRow, key: string) => {
    const next = { ...choices, [row.id]: key };
    setChoices(next);
    if (!partial && allChosen(rows, next)) choose(next);
  };
  const onTerm = (termId: string) => {
    setTerm(termId); setChoices({});
    if (!partial && rowsOf(group, people, text, termId).length === 0) choose({}, termId);
  };
  const keep = () => {
    if (rows.length || term) { choose(choices); return; }
    resolve({ action: "keep" }, partial ? `kept from ${namesOf(present)}` : "kept");
  };
  const keepReady = allChosen(rows, choices) && (!needsTerm(group) || !!term || !partial);
  const editValues = (axes: Record<string, string>) => {
    const base = activeMembers(group, term)[0];
    const span = term ? base.input_id : group.keep_input_id;
    resolve({ action: "choose", choice: { term_id: term ?? base.term_id, span_from_input_id: span, axes } },
      Object.values(axes).map(valueWords).join(" · ") || "decided");
    setEditing(false);
  };
  const reopen = () => { if (group.edited) setConfirmReopen(true); else void props.onReopen(); };

  const header = <h2 className="cons-group-heading">
    <button ref={props.toggleRef} type="button" className="cons-group-toggle" aria-expanded={expanded} onClick={props.onExpand}>
      <span className="cons-group-title">{title}</span>
      {open ? <span className="cons-group-kind"> · {kindWords}</span> : <span className="cons-group-done"> ✓ {summary}</span>}
      {group.edited && <span className="cons-tag"> · edited in editor</span>}
      {group.guidelines_unclear && <span className="cons-tag"> · flagged</span>}
      {open && <span className="cons-group-state"> · open</span>}
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
        <Button size="sm" variant="quiet" onClick={() => { setNote(group.note ?? ""); setNoteOpen(false); }}>Cancel</Button>
      </div>}
    </div> : <Button size="sm" variant="quiet" onClick={() => setNoteOpen(true)}>{resolved && group.note ? "Edit note" : "+ note"}</Button>}
    <Checkbox id={`${noteId}-flag`} label="Guidelines unclear here" checked={resolved ? group.guidelines_unclear : flag}
      onChange={event => {
        if (!resolved) { setFlag(event.target.checked); return; }
        void props.onAnnotate({ input_ids: inputIds, guidelines_unclear: event.target.checked });
      }} />
  </div>;

  const openBody = <>
    {partial && <p className="cons-partial">{partialText(present, absent)}</p>}
    {(group.members.length > 1 || !partial) ? <Comparison group={group} people={people} text={text} />
      : <p className="cons-muted">{termLabel(group.members[0])} · {Object.values(group.members[0].axes).map(valueWords).join(" · ") || "no values"}</p>}
    {!readOnly && <>
      {needsTerm(group) && <div className="cons-choice-row" role="group" aria-label="Term">
        <span className="cons-choice-label">Term:</span>
        {terms.map(option => <Chip key={option.termId} selected={term === option.termId} disabled={busy}
          label={`${option.label} · ${namesOf(option.people)}`} onClick={() => onTerm(option.termId)} />)}
        {!partial && <Chip selected={false} disabled={busy} label="Keep both" onClick={() => resolve({ action: "keep_both" }, "kept both")} />}
      </div>}
      {rows.map(row => <ChipRow key={row.id} row={row} choices={choices} onChoose={onChoose} disabled={busy} />)}
      {editing && workspace ? <EditValues group={group} workspace={workspace} busy={busy} onKeep={editValues} onCancel={() => setEditing(false)} />
        : <div className="cons-actions">
          {(partial || matchOnly) && <Button variant={partial ? "primary" : "secondary"} loading={busy}
            aria-disabled={!keepReady || undefined} aria-describedby={!keepReady ? `${noteId}-keep-reason` : undefined}
            onClick={() => { if (keepReady) keep(); }}>{partial ? keepLabel(present) : "Keep"}</Button>}
          <Button variant="quiet" aria-disabled={busy || undefined} onClick={() => { if (!busy) resolve({ action: "leave_out" }, "left out"); }}>Leave out</Button>
          {(partial || matchOnly) && workspace && <Button variant="quiet" onClick={() => setEditing(true)}>Edit values…</Button>}
          {(matchOnly || needsTerm(group)) && workspace && <Button ref={otherTermRef} variant="quiet" aria-expanded={picking} onClick={() => setPicking(true)}>Other term…</Button>}
          {props.onEditInEditor && <Button variant="quiet" onClick={props.onEditInEditor}>Edit in editor…</Button>}
        </div>}
      {!keepReady && (partial || matchOnly) && <p id={`${noteId}-keep-reason`} className="action-reason">Choose one option in each row first.</p>}
      {noteAndFlag(false)}
      {workspace && <TermPicker open={picking} anchorRef={otherTermRef} label="Other term" workspace={workspace} layerId={group.members[0].layer_id}
        onClose={() => setPicking(false)} onPick={candidate => {
          setPicking(false);
          const base = activeMembers(group, term)[0];
          resolve({ action: "choose", choice: { term_id: candidate.term_id, span_from_input_id: term ? base.input_id : group.keep_input_id, axes: {} } },
            `${candidate.label} (${candidate.term_id})`);
        }} />}
    </>}
  </>;

  const resolvedBody = <>
    {group.note && !noteOpen && <p className="cons-note-text">Note: {group.note}</p>}
    {readOnly && group.guidelines_unclear && <p className="cons-note-text">Flagged: guidelines unclear</p>}
    <Comparison group={group} people={people} text={text} />
    {!readOnly && <>
      {confirmReopen ? <InlineConfirm title="Reopen this group?" message={REOPEN_EDITED_WARNING} confirmLabel="Reopen" busy={busy}
        onCancel={() => setConfirmReopen(false)} onConfirm={() => { void props.onReopen().then(() => setConfirmReopen(false)); }} />
        : <div className="cons-actions">
          <Button size="sm" loading={busy} onClick={reopen}>Change</Button>
          {props.onEditInEditor && <Button size="sm" variant="quiet" onClick={props.onEditInEditor}>Edit in editor…</Button>}
        </div>}
      {noteAndFlag(true)}
    </>}
  </>;

  return <li className={["cons-group", expanded && "cons-group-expanded", !open && "cons-group-resolved"].filter(Boolean).join(" ")} data-group={group.group_id}>
    <div className="cons-group-line">
      {header}
      {!expanded && !open && !readOnly && <Button size="sm" variant="quiet" className="cons-change" loading={busy}
        aria-label={`Change, ${title}`} onClick={reopen}>Change</Button>}
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
