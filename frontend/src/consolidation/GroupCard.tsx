/**
 * One finding group of the consolidation view (spec §3, mockup variant B). Collapsed: one line with the conflict mark,
 * the group name (the text excerpt) and its state ("2 fields to decide", "agreed", "decided"). Expanded: the
 * comparison table (columns = people, rows = term, axes, text, note, whole finding; a check button takes a value in a
 * conflicting row), the result line that always spells out the one finding, "+ note", "Guidelines unclear here" and
 * the actions. A choice only stages (the result line updates, "Not saved yet."); one "Keep" saves once every
 * conflicting row has a choice (M2 M-7d, as DN-11 for modifiers). Actions: Keep, "Not in result" and "More…" (Edit
 * values…, Other term…; M-7c); "Open in full editor" is in the screen header (M-7a). A resolved row has no button of
 * its own: the row expands, "Change" is inside (M-7b); the last decision offers "Undo" in its row (M-7g). A person's
 * modifier marked as a finding (S18) resolves only with "Attach to a finding…" or "Not in result" (DN-8).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ConsolidationAnnotatePayload, ConsolidationGroupView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import type { WorkspaceView } from "../app/CaseScreen";
import { axisOptionLabel } from "../editor/axisLabels";
import { COHORT_TAG, type TermInfo } from "../editor/modifiers";
import { ModifiersSection } from "../editor/ModifiersSection";
import { useTermLabels } from "../editor/useTermLabels";
import { Button, Checkbox, InlineConfirm, MenuButton, Select, Textarea } from "../ui";
import { IconWarning } from "../ui/icons";
import { ComparisonTable } from "./ComparisonTable";
import { axisLabel, groupStatus, labelWithQuote, keepLabel, namesOf, NO_ATTACH_TARGET, NOT_IN_RESULT, partialText, REOPEN_EDITED_WARNING, standaloneResult, standaloneWarning } from "./consolidationText";
import { absentPeople, attachCandidates, choicesComplete, choose, comparisonRows, groupName, hasKind, isStandalone, memberSets, needsTerm, presentPeople, resolvePayload, resultLine, standaloneText, type Choices, type OtherTerm } from "./groupModel";
import { crossLinks, setText, type ModifierView } from "./modifierSets";
import { ResultLine } from "./ResultLine";
import { TermPicker, useTermSearch } from "./TermPicker";
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
  /** The group reopens through an Undo: it starts from the choices of its last decision (F19), not empty. */
  restoring?: boolean;
  onDismissOutcome: () => void;
  /** This group holds the last decision: "Undo" in its row (M-7g), until the next action. */
  onUndo?: () => void;
  /** Every group of the round: cross-link hints and the targets of "Attach to a finding…". */
  groups?: readonly ConsolidationGroupView[];
  /** Selects another group (the cross-link hint). */
  onSelectGroup?: (groupId: string) => void;
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

/** The edited finding of "Edit values…": its axes and, on a modifier layer, its modifiers (`null`: not a modifier layer). */
export interface EditedValues { axes: Record<string, string>; modifiers: ModifierView[] | null }

/** Chips without "·" (DN-10): "Severe “schwere”", "Frequent Cohort term". */
const consolidationChip = (label: string, quote: string | null, role: TermInfo["role"]) =>
  [labelWithQuote(label, quote), role === "cohort" ? COHORT_TAG : null].filter(Boolean).join(" ");

/** "Edit values…": every axis of the finding's type and, on a modifier layer, its Modifiers, starting from the kept member's. */
function EditValues({ group, workspace, text, busy, onKeep, onCancel }: { group: ConsolidationGroupView; workspace: WorkspaceView; text: string; busy: boolean; onKeep: (values: EditedValues) => void; onCancel: () => void }): JSX.Element {
  const base = group.members.find(member => member.input_id === group.keep_input_id) ?? group.members[0];
  const type = workspace.layers?.find(layer => layer.layer_id === base.layer_id)?.annotation_types.find(value => value.type_id === base.type_id);
  const axes = type?.axes ?? Object.keys(base.axes).map(id => ({ id, label: axisLabel(id), options: [base.axes[id]], allow_empty: false }));
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...base.axes }));
  const withModifiers = !!workspace.modifier_layer_ids?.includes(base.layer_id);
  const [modifiers, setModifiers] = useState<ModifierView[]>(() => (base.modifiers ?? []).map(value => ({ ...value, exclusive_class: value.exclusive_class ?? null })));
  const search = useTermSearch(workspace, base.layer_id);
  const id = useId();
  // Added modifiers carry no exclusive class: look it up for "Two severities" / "Two onsets".
  const added = modifiers.filter(value => !base.modifiers?.some(held => held.term_id === value.term_id));
  const termLabels = useTermLabels(workspace.key.project_key, added.map(value => ({ layer_id: base.layer_id, term_id: value.term_id })));
  const [removed, setRemoved] = useState("");
  const termInfo = (termId: string): TermInfo | undefined => {
    const modifier = modifiers.find(value => value.term_id === termId);
    return modifier && { label: modifier.term_label || termId, role: modifier.kind,
      exclusiveClass: modifier.exclusive_class ?? termLabels.info(base.layer_id, termId)?.exclusiveClass ?? null };
  };
  const remove = (termId: string) => {
    const modifier = modifiers.find(value => value.term_id === termId);
    setModifiers(current => current.filter(value => value.term_id !== termId));
    setRemoved(`Removed ${modifier?.term_label || termId}.`);
    // The chip and its menu are gone: keep focus in the section.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".cons-edit-values [data-modifiers-section] .mod-add")?.focus());
  };
  return <div className="cons-edit-values" role="group" aria-label="Edit values">
    {axes.map(axis => <Select key={axis.id} id={`${id}-${axis.id}`} label={axis.label} value={values[axis.id] ?? ""}
      onChange={event => setValues(current => ({ ...current, [axis.id]: event.target.value }))}>
      {!values[axis.id] && <option value="">Not specified</option>}
      {axis.options.map(option => <option key={option} value={option}>{axisOptionLabel(option)}</option>)}
    </Select>)}
    {withModifiers && <ModifiersSection finding={base.term_label || base.term_id} text={text} termInfo={termInfo} chipText={consolidationChip}
      modifiers={modifiers.map(value => ({ term_id: value.term_id, segments: value.segments.map(([start, end]) => ({ start, end })) }))}
      onAdd={async (termId, label, role) => { setRemoved(""); setModifiers(current => current.some(value => value.term_id === termId) ? current
        : [...current, { term_id: termId, term_label: label, kind: role === "cohort" ? "cohort" : "modifier", exclusive_class: null, segments: [] }]); }}
      onRemove={remove}
      searchProps={search} />}
    {withModifiers && <p role="status" className="visually-hidden">{removed}</p>}
    <div className="cons-actions">
      <Button variant="primary" loading={busy} onClick={() => onKeep({ axes: Object.fromEntries(Object.entries(values).filter(([, value]) => !!value)),
        modifiers: withModifiers ? modifiers : null })}>Keep with these values</Button>
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
  const moreRef = useRef<HTMLSpanElement>(null);
  const noteId = useId();
  const open = group.state === "open";
  // The choices behind the last decision, for an Undo.
  const decided = useRef<{ choices: Choices; otherTerm: OtherTerm | null }>({ choices: {}, otherTerm: null });
  // A reopened group starts over (old choices would resolve it with the first check), unless an Undo restores them.
  useEffect(() => {
    if (!open) return;
    const start = props.restoring ? decided.current : { choices: {}, otherTerm: null };
    setChoices(start.choices); setOtherTerm(start.otherTerm);
  }, [open]);
  const name = groupName(group, text);
  const present = presentPeople(group, people), absent = absentPeople(group, people);
  const partial = hasKind(group, "partial");
  const rows = useMemo(() => comparisonRows(group, people, text, choices), [group, people, text, choices]);
  const line = resultLine(group, people, text, choices, otherTerm);
  const standalone = isStandalone(group);
  const conflicts = standalone ? 0 : rows.filter(row => row.conflict).length;
  const complete = !conflicts || choicesComplete(rows, choices);
  const staged = Object.keys(choices).length > 0 || otherTerm !== null;
  const allGroups = useMemo(() => props.groups ?? [group], [props.groups, group]);
  const links = useMemo(() => crossLinks(group.group_id, allGroups.map(value => ({ groupId: value.group_id,
    members: memberSets(value, people).map((set, index) => ({ ...set, termLabel: value.members[index].term_label || value.members[index].term_id })) })), text),
  [group.group_id, allGroups, people, text]);
  const inputIds = group.members.map(member => member.input_id);
  const status = groupStatus(group, conflicts);
  const extras = () => ({ ...(note.trim() ? { note: note.trim() } : {}), ...(flag ? { guidelines_unclear: true } : {}) });

  const resolve = (payload: Omit<ConsolidationResolvePayload, "input_ids">, summary: string, staged = { choices, otherTerm }) => {
    decided.current = staged;
    void props.onResolve({ input_ids: inputIds, ...payload, ...extras() }, summary);
  };
  // M-7d: a choice only stages; "Keep" saves the finding the result line spells out.
  const onChoose = (rowId: string, value: string) => setChoices(choose(group, choices, rowId, value));
  const editValues = ({ axes, modifiers }: EditedValues) => {
    const base = group.members.find(member => member.input_id === group.keep_input_id) ?? group.members[0];
    const sorted = modifiers && [...modifiers].sort((a, b) => a.term_label.localeCompare(b.term_label, undefined, { sensitivity: "base" }));
    const summary = [...Object.values(axes).map(axisOptionLabel), ...(sorted ? [sorted.length ? `modifiers: ${setText(sorted, text)}` : "no modifiers"] : [])];
    resolve({ action: "choose", choice: { term_id: base.term_id, span_from_input_id: base.input_id, axes,
      ...(sorted ? { modifiers: sorted.map(value => ({ term_id: value.term_id, segments: value.segments.map(([start, end]) => ({ start, end })) })) } : {}) } },
    summary.join(", ") || "decided");
    setEditing(false);
  };
  const reopen = () => { if (group.edited) setConfirmReopen(true); else void props.onReopen(); };

  const header = <h2 className="cons-group-heading">
    <button ref={props.toggleRef} type="button" className="cons-group-toggle" aria-expanded={expanded} onClick={props.onExpand}>
      {open && conflicts > 0 && <span className="cons-conflict"><IconWarning /><span className="visually-hidden">Conflict</span></span>}
      <span className="cons-group-title">{name}</span>{" "}
      <span className={open ? "cons-group-state" : "cons-group-done"}>{status}{!open && props.summary && props.summary !== status ? `: ${props.summary}` : ""}</span>
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

  // A standalone modifier has no axes and cannot be taken as a finding: its table keeps term, text and notes.
  // M-7d: no "Whole finding" shortcut row; a choice per row stages the same result.
  const tableRows = rows.filter(row => row.kind !== "whole" && !(standalone && row.kind === "axis"));
  const table = (tableReadOnly: boolean) => <ComparisonTable name={name} group={group} people={people} rows={tableRows} readOnly={tableReadOnly}
    busy={busy} onChoose={onChoose} />;

  const crossLinkHints = links.map(link => <p key={`${link.personId}-${link.groupId}-${link.termLabel}`} className="cons-muted cons-crosslink">
    <a href="#" onClick={event => { event.preventDefault(); props.onSelectGroup?.(link.groupId); }}>
      {`${link.personName} linked “${link.quote}” (${link.termLabel}) to ${link.findingLabel}.`}</a>
  </p>);

  const attachTargets = standalone ? attachCandidates(group, allGroups, text) : [];
  const modifier = standalone ? standaloneText(group, text) : "";
  const standaloneBody = <>
    <ResultLine line={{ saved: standaloneResult(modifier), notTaken: null }} />
    {noteAndFlag(false)}
    <div className="cons-actions">
      {attachTargets.length
        ? <MenuButton label="Attach to a finding…" buttonLabel="Attach to a finding…" items={attachTargets.map(target => ({ id: target.annotationId, label: target.label,
          onSelect: () => { if (!busy) resolve({ action: "leave_out", attach_to: target.annotationId }, `${modifier} to ${target.label}`); } }))} />
        : <><Button aria-disabled="true" aria-describedby={`${noteId}-attach`}>Attach to a finding…</Button>
          <span id={`${noteId}-attach`} className="cons-muted">{NO_ATTACH_TARGET}</span></>}
      <Button aria-disabled={busy || undefined} onClick={() => { if (!busy) resolve({ action: "leave_out" }, NOT_IN_RESULT); }}>Not in result</Button>
    </div>
  </>;
  // Modifiers attached to this group's finding from a standalone card (S18).
  const attached = allGroups.filter(value => value.attached_to && group.annotation_ids.includes(value.attached_to));

  const openBody = <>
    {partial && <p className="cons-partial">{partialText(present, absent)}</p>}
    {standalone && <p className="cons-partial"><IconWarning className="cons-conflict-mark" /><span className="visually-hidden">Warning: </span>
      {standaloneWarning(present, group.members[0].term_label || group.members[0].term_id)}</p>}
    {table(readOnly || standalone)}
    {!readOnly && !standalone && crossLinkHints}
    {!readOnly && standalone && standaloneBody}
    {!readOnly && !standalone && <>
      <ResultLine line={line} staged={staged} />
      {/* Note and flag go with the decision, so they come before Keep. */}
      {noteAndFlag(false)}
      {editing && workspace ? <EditValues group={group} workspace={workspace} text={text} busy={busy} onKeep={editValues} onCancel={() => setEditing(false)} />
        : <div className="cons-actions">
          <Button variant="primary" loading={busy} aria-disabled={!complete || undefined} aria-describedby={!complete ? `${noteId}-keep` : undefined}
            onClick={() => { if (complete && !busy) resolve(resolvePayload(group, choices), line.finding); }}>{partial && !conflicts ? keepLabel(present) : "Keep"}</Button>
          <Button aria-disabled={busy || undefined} onClick={() => { if (!busy) resolve({ action: "leave_out" }, NOT_IN_RESULT); }}>Not in result</Button>
          {workspace && (!conflicts || needsTerm(group)) && <span ref={moreRef} className="cons-more"><MenuButton label={`More actions, ${name}`} buttonLabel="More…" items={[
            ...(!conflicts ? [{ id: "edit-values", label: "Edit values…", onSelect: () => setEditing(true) }] : []),
            { id: "other-term", label: "Other term…", onSelect: () => setPicking(true) },
          ]} /></span>}
          {!complete && <span id={`${noteId}-keep`} className="cons-muted">Choose a value in each highlighted row first.</span>}
        </div>}
      {workspace && <TermPicker open={picking} anchorRef={moreRef} label="Other term" workspace={workspace} layerId={group.members[0].layer_id}
        onClose={() => { setPicking(false); moreRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }} onPick={candidate => {
          if (busy) return;
          setPicking(false);
          if (!needsTerm(group)) {
            resolve({ action: "choose", choice: { term_id: candidate.term_id, span_from_input_id: group.keep_input_id, axes: {} } },
              `${candidate.label} (${candidate.term_id})`);
            return;
          }
          // Another term replaces the members' terms (staged); the other conflicting fields still need their choice.
          setOtherTerm({ termId: candidate.term_id, label: candidate.label });
          setChoices({ ...choices, term: candidate.term_id });
        }} />}
    </>}
  </>;

  const resolvedBody = <>
    {group.note && !noteOpen && <p className="cons-note-text">Note: {group.note}</p>}
    {readOnly && group.guidelines_unclear && <p className="cons-note-text">Flagged: guidelines unclear</p>}
    {attached.map(value => <p key={value.group_id} className="cons-note-text">
      {`Attached modifier: ${standaloneText(value, text)} from ${namesOf(presentPeople(value, people))}`}</p>)}
    {table(true)}
    {!readOnly && <>
      {confirmReopen ? <InlineConfirm title="Reopen this group?" message={REOPEN_EDITED_WARNING} confirmLabel="Reopen" busy={busy}
        onCancel={() => setConfirmReopen(false)} onConfirm={() => { void props.onReopen().then(() => setConfirmReopen(false)); }} />
        : <div className="cons-actions">
          <Button size="sm" loading={busy} onClick={reopen}>Change</Button>
        </div>}
      {noteAndFlag(true)}
    </>}
  </>;

  return <li className={["cons-group", expanded && "cons-group-expanded", !open && "cons-group-resolved", group.state === "auto" && "cons-group-agreed"].filter(Boolean).join(" ")} data-group={group.group_id}>
    <div className="cons-group-line">
      {header}
      {props.onUndo && !open && !readOnly && <span className="cons-undo">
        <Button size="sm" variant="quiet" className="btn-link" loading={busy} aria-label={`Undo, ${name}`} aria-keyshortcuts="Control+Z Meta+Z"
          onClick={props.onUndo}>Undo</Button></span>}
    </div>
    {narrow && <Snippet group={group} text={text} />}
    {expanded && <div className="cons-group-body">
      {open ? openBody : resolvedBody}
      {outcomeBlock}
    </div>}
    {!expanded && outcomeBlock}
  </li>;
}
