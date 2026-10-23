/**
 * The comparison table of one consolidation group (spec §3, mockup variant B): one column per member, one row for the
 * term, each axis, the text, the note and the whole finding. Only conflicting rows need a choice (the term when terms
 * differ, an axis in `differing_axes`, the text only when the spans genuinely conflict, backend
 * `agreement.spans_conflict`; never the note). The group always resolves to exactly one finding, spelled out by the
 * result line. Choices are keyed by row id ("term", an axis id, "text"); "whole" remembers the member taken with
 * "Take … finding" (its span, evidence and note come with it).
 */
import type { ConsolidationGroupView, ConsolidationMemberView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import { axisOptionLabel } from "../editor/axisLabels";
import { axisLabel, OVERLAPPING, quoted } from "./consolidationText";
import { personName } from "./lanes";

/** A term found with "Other term…": the result's term instead of the members' terms. */
export interface OtherTerm {
  termId: string;
  label: string;
}

/** "" stands for an axis a person left empty (sent as null). */
export type Choices = Readonly<Record<string, string>>;

/** Text of the given codepoint ranges (the backend counts codepoints), joined by " … ". */
export function passage(text: string, spans: readonly (readonly [number, number])[]): string {
  const chars = Array.from(text);
  return spans.map(([start, end]) => chars.slice(start, end).join("")).join(" … ");
}

const personOf = (people: readonly ConsolidationPersonView[], personId: string): ConsolidationPersonView =>
  people.find(person => person.person_id === personId) ?? { person_id: personId, label: personId, lane: 4 };

export const peopleOf = (people: readonly ConsolidationPersonView[], members: readonly ConsolidationMemberView[]): ConsolidationPersonView[] =>
  members.map(member => personOf(people, member.person_id));

/** People who marked the group, in the view's order. */
export function presentPeople(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[]): ConsolidationPersonView[] {
  const ids = new Set(group.members.map(member => member.person_id));
  return people.filter(person => ids.has(person.person_id));
}

/** People with nothing in this group (the "partial" kind). */
export function absentPeople(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[]): ConsolidationPersonView[] {
  const ids = new Set(group.members.map(member => member.person_id));
  return people.filter(person => !ids.has(person.person_id));
}

export const hasKind = (group: ConsolidationGroupView, kind: string) => group.kinds.includes(kind);
export const needsTerm = (group: ConsolidationGroupView) => hasKind(group, "term_differs");

/** "Hypotonia (HP:0001252)"; the code alone when the label is the code. */
export function termLabel(member: Pick<ConsolidationMemberView, "term_id" | "term_label">): string {
  return member.term_label && member.term_label !== member.term_id ? `${member.term_label} (${member.term_id})` : member.term_id;
}

/** Card name: the text excerpt of the default member ("muscular hypotonia"); the terms when it has no span. */
export function groupName(group: ConsolidationGroupView, text: string): string {
  const base = group.members.find(member => member.input_id === group.keep_input_id) ?? group.members[0];
  if (base?.spans.length) return passage(text, base.spans);
  return [...new Set(group.members.map(member => member.term_label || member.term_id))].join(" / ");
}

export type RowKind = "term" | "axis" | "text" | "note" | "whole";
export interface ComparisonCell { inputId: string; value: string; display: string; chosen: boolean }
export interface ComparisonRow {
  kind: RowKind;
  /** "term", axis id, "text", "note", "whole". */
  id: string;
  label: string;
  /** People disagree and a choice is needed. */
  conflict: boolean;
  /** "Patient (all agree)" when everyone agrees, else null. */
  agreed: string | null;
  /** Text without conflict: "(overlapping, comes with the chosen finding)". */
  info: string | null;
  cells: ComparisonCell[];
}

const noteOf = (member: ConsolidationMemberView) => member.note?.trim() ?? "";
export const firstName = (label: string) => personName(label).split(" ")[0];

/** Axes of the group's members in first-seen order. */
function axesOf(group: ConsolidationGroupView): string[] {
  const axes: string[] = [];
  for (const member of group.members) for (const axis of Object.keys(member.axes)) if (!axes.includes(axis)) axes.push(axis);
  return axes;
}

/** The term held by most members (the first on a tie): the result's term until one is chosen. */
function defaultTerm(group: ConsolidationGroupView): string {
  const counts = new Map<string, number>();
  for (const member of group.members) counts.set(member.term_id, (counts.get(member.term_id) ?? 0) + 1);
  return [...counts].reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];
}

export function comparisonRows(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[], text: string,
  choices: Choices): ComparisonRow[] {
  const members = group.members;
  const row = (kind: RowKind, id: string, label: string, conflict: boolean, valueOf: (member: ConsolidationMemberView) => string,
    displayOf: (member: ConsolidationMemberView) => string, info: string | null = null): ComparisonRow => {
    const cells = members.map(member => ({ inputId: member.input_id, value: valueOf(member), display: displayOf(member),
      chosen: choices[id] === valueOf(member) }));
    const same = cells.every(cell => cell.value === cells[0].value);
    return { kind, id, label, conflict, info, cells,
      agreed: !conflict && same && info === null && kind !== "whole" ? `${cells[0].display} (all agree)` : null };
  };
  const names = peopleOf(people, members);
  const rows = [
    row("term", "term", "Term", needsTerm(group), member => member.term_id, member => member.term_label || member.term_id),
    ...axesOf(group).map(axis => row("axis", axis, axisLabel(axis), group.differing_axes.includes(axis),
      member => member.axes[axis] ?? "", member => axisOptionLabel(member.axes[axis]))),
    // Keyed by member: identical spans may differ in their note, which comes with the span.
    row("text", "text", "Text", !!group.span_conflict, member => member.input_id,
      member => member.spans.length ? quoted(passage(text, member.spans)) : "No text span", group.span_conflict ? null : OVERLAPPING),
  ];
  // Notes are information, never a decision: the kept finding keeps its own note.
  if (members.some(noteOf)) rows.push(row("note", "note", "Note", false, noteOf, noteOf));
  if (members.length > 1) rows.push(row("whole", "whole", "Whole finding", false, member => member.input_id,
    member => `Take ${firstName(names[members.indexOf(member)].label)}'s finding`));
  return rows;
}

/** Every conflicting row has a choice ("Other term…" may choose a term no member holds). */
export const choicesComplete = (rows: readonly ComparisonRow[], choices: Choices) =>
  rows.every(row => !row.conflict || choices[row.id] !== undefined);

/** Choices taking every row from one member ("Take Ali's finding"). */
export function takeFinding(group: ConsolidationGroupView, member: ConsolidationMemberView): Record<string, string> {
  const choices: Record<string, string> = { whole: member.input_id, term: member.term_id, text: member.input_id };
  for (const axis of axesOf(group)) choices[axis] = member.axes[axis] ?? "";
  return choices;
}

export interface ResultText {
  /** "Hypotonia (HP:0001252), Absent, Patient, Current". */
  finding: string;
  saved: string;
  notTaken: string | null;
}

/**
 * "Result: 1 finding, Hypotonia (HP:0001252), assertion not chosen yet, Patient, Current" and, when other terms exist,
 * "Not taken: Axial hypotonia (Ali)".
 */
export function resultLine(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[], choices: Choices,
  other?: OtherTerm | null): ResultText {
  const termId = choices.term ?? defaultTerm(group);
  const holder = group.members.find(member => member.term_id === termId);
  const parts = [holder ? termLabel(holder) : other?.termId === termId ? `${other.label} (${other.termId})` : termId];
  for (const axis of axesOf(group)) {
    if (!group.differing_axes.includes(axis)) parts.push(axisOptionLabel(group.members[0].axes[axis]));
    else parts.push(choices[axis] === undefined ? `${axisLabel(axis)} not chosen yet` : axisOptionLabel(choices[axis]));
  }
  if (group.span_conflict && choices.text === undefined) parts.push("text not chosen yet");
  const names = peopleOf(people, group.members);
  const others = new Map<string, string[]>();
  group.members.forEach((member, index) => {
    if (member.term_id === termId) return;
    const label = member.term_label || member.term_id;
    others.set(label, [...(others.get(label) ?? []), firstName(names[index].label)]);
  });
  return {
    finding: parts.join(", "),
    saved: `Result: 1 finding, ${parts.join(", ")}`,
    notTaken: others.size ? `Not taken: ${[...others].map(([label, who]) => `${label} (${who.join(", ")})`).join(", ")}` : null,
  };
}

/**
 * `keep` when nothing differs, else `choose` with the term, every differing axis and the member whose span, evidence
 * and note come with the finding: the chosen text's, else the taken member's (when it holds the term), else the
 * term's first member's, else the default member's (an "Other term…").
 */
export function resolvePayload(group: ConsolidationGroupView, choices: Choices): Omit<ConsolidationResolvePayload, "input_ids"> {
  const taken = group.members.find(member => member.input_id === choices.whole);
  if (!needsTerm(group) && !group.differing_axes.length && !group.span_conflict) {
    // "Take X's finding" with nothing conflicting: X's span, evidence and note, not the default member's.
    return taken ? { action: "choose", choice: { term_id: taken.term_id, span_from_input_id: taken.input_id, axes: {} } } : { action: "keep" };
  }
  const termId = choices.term ?? defaultTerm(group);
  const base = (group.span_conflict ? group.members.find(member => member.input_id === choices.text) : undefined)
    ?? (taken?.term_id === termId ? taken : undefined)
    ?? group.members.find(member => member.term_id === termId);
  return { action: "choose", choice: {
    term_id: termId, span_from_input_id: base?.input_id ?? group.keep_input_id,
    axes: Object.fromEntries(group.differing_axes.map(axis => [axis, choices[axis] || null])),
  } };
}
