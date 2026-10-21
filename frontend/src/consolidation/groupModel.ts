/**
 * Decision rows of one consolidation group (acceptance fixes spec "WP-E Grouping", X6, X7): one row per differing
 * axis, one for the text span and one for the note; a "Term differs" group first asks for the term and then shows
 * that term's own rows. A group resolves when every row has a choice.
 */
import type { ConsolidationGroupView, ConsolidationMemberView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import { axisLabel, namesOf, quoted, valueWords } from "./consolidationText";
import { personName } from "./lanes";

export type RowKind = "axis" | "span" | "note";

export interface ChoiceOption {
  key: string;
  label: string;
  /** The member whose span or note this option takes. */
  inputId: string;
  value: string | null;
  people: ConsolidationPersonView[];
}

export interface ChoiceRow {
  id: string;
  kind: RowKind;
  axis?: string;
  label: string;
  options: ChoiceOption[];
}

export interface TermOption {
  termId: string;
  label: string;
  inputId: string;
  people: ConsolidationPersonView[];
}

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

/** Distinct terms in member order. */
export function termOptions(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[]): TermOption[] {
  const terms: TermOption[] = [];
  for (const member of group.members) {
    const existing = terms.find(term => term.termId === member.term_id);
    if (existing) { existing.people.push(personOf(people, member.person_id)); continue; }
    terms.push({ termId: member.term_id, label: termLabel(member), inputId: member.input_id, people: [personOf(people, member.person_id)] });
  }
  return terms;
}

/** "Hypotonia (HP:0001252)"; the code alone when the label is the code. */
export function termLabel(member: Pick<ConsolidationMemberView, "term_id" | "term_label">): string {
  return member.term_label && member.term_label !== member.term_id ? `${member.term_label} (${member.term_id})` : member.term_id;
}

/** Card title: "Hypotonia" or "Ataxia / Gait disturbance". */
export function groupTitle(group: ConsolidationGroupView): string {
  const labels: string[] = [];
  for (const member of group.members) {
    const label = member.term_label || member.term_id;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join(" / ");
}

/** The members a decision row compares: all, or those of the chosen term. */
export function activeMembers(group: ConsolidationGroupView, term?: string | null): ConsolidationMemberView[] {
  return term ? group.members.filter(member => member.term_id === term) : group.members;
}

const spanKey = (member: ConsolidationMemberView) => JSON.stringify([member.spans, member.cues]);
const noteOf = (member: ConsolidationMemberView) => member.note?.trim() ? member.note.trim() : null;

function distinct<T>(members: readonly ConsolidationMemberView[], keyOf: (member: ConsolidationMemberView) => string,
  build: (member: ConsolidationMemberView, holders: ConsolidationMemberView[]) => T): T[] {
  const order: string[] = [];
  const holders = new Map<string, ConsolidationMemberView[]>();
  for (const member of members) {
    const key = keyOf(member);
    if (!holders.has(key)) { order.push(key); holders.set(key, []); }
    holders.get(key)!.push(member);
  }
  return order.length > 1 ? order.map(key => build(holders.get(key)![0], holders.get(key)!)) : [];
}

/**
 * The decision rows of a group. A "Term differs" group has none until a term is chosen; then the rows compare
 * the members of that term only.
 */
export function rowsOf(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[], text: string, term?: string | null): ChoiceRow[] {
  if (needsTerm(group) && !term) return [];
  const members = activeMembers(group, term);
  const total = members.length;
  const rows: ChoiceRow[] = [];
  const axes: string[] = [];
  for (const member of members) for (const axis of Object.keys(member.axes)) if (!axes.includes(axis)) axes.push(axis);
  for (const axis of axes) {
    const options = distinct(members, member => member.axes[axis] ?? "", (first, holders) => {
      const value = first.axes[axis] ?? null;
      const majority = !term && value !== null && group.majority[axis] === value ? ` (${holders.length} of ${total})` : "";
      const holding = peopleOf(people, holders);
      return { key: value ?? "", label: `${valueWords(value)} · ${namesOf(holding)}${majority}`, inputId: first.input_id, value, people: holding };
    });
    if (options.length) rows.push({ id: `axis:${axis}`, kind: "axis", axis, label: axisLabel(axis), options });
  }
  const spans = distinct(members, spanKey, (first, holders) => {
    const holding = peopleOf(people, holders);
    const words = first.spans.length ? quoted(passage(text, first.spans)) : "No text span";
    return { key: spanKey(first), label: `${words} · ${namesOf(holding)}`, inputId: first.input_id, value: spanKey(first), people: holding };
  });
  if (spans.length) rows.push({ id: "span", kind: "span", label: "Text", options: spans });
  const notes = distinct(members, member => noteOf(member) ?? "", (first, holders) => {
    const holding = peopleOf(people, holders);
    const note = noteOf(first);
    return { key: note ?? "", label: `${note ? quoted(note) : "No note"} · ${namesOf(holding)}`, inputId: first.input_id, value: note, people: holding };
  });
  // "No note" is always a choice (a person's note or none; "both" needs backend support).
  if (notes.length && !notes.some(option => option.key === "")) notes.push({ key: "", label: "No note", inputId: members[0].input_id, value: null, people: [] });
  if (notes.length) rows.push({ id: "note", kind: "note", label: "Note", options: notes });
  return rows;
}

export type Choices = Readonly<Record<string, string>>;

export const allChosen = (rows: readonly ChoiceRow[], choices: Choices) =>
  rows.every(row => row.options.some(option => option.key === choices[row.id]));

/** The `choose` payload of a fully answered group. */
export function choosePayload(group: ConsolidationGroupView, rows: readonly ChoiceRow[], choices: Choices, term?: string | null): NonNullable<ConsolidationResolvePayload["choice"]> {
  const members = activeMembers(group, term);
  const picked = (id: string) => rows.find(row => row.id === id)?.options.find(option => option.key === choices[id]);
  const span = picked("span");
  const base = span?.inputId ?? (term ? members[0].input_id : group.keep_input_id);
  const axes: Record<string, string> = {};
  for (const row of rows) {
    const option = picked(row.id);
    if (row.kind === "axis" && row.axis && option && option.value !== null) axes[row.axis] = option.value;
  }
  const note = picked("note");
  return {
    term_id: term ?? members[0].term_id,
    span_from_input_id: base,
    axes,
    ...(note ? { note_from_input_id: note.value === null ? null : note.inputId } : {}),
  };
}

/** What the decision kept, for the collapsed line: "absent (Tom Reis)". */
export function choiceSummary(rows: readonly ChoiceRow[], choices: Choices, term?: TermOption | null): string {
  const parts: string[] = [];
  if (term) parts.push(`${term.label} (${namesOf(term.people)})`);
  for (const row of rows) {
    const option = row.options.find(value => value.key === choices[row.id]);
    if (!option) continue;
    const what = row.kind === "axis" ? valueWords(option.value) : row.kind === "span" ? option.label.split(" · ")[0] : option.value ? "their note" : "no note";
    parts.push(option.people.length ? `${what} (${namesOf(option.people)})` : what);
  }
  return parts.join(", ");
}

/** The collapsed line of a resolved group when no choice of this session is remembered. */
export function stateSummary(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[]): string {
  switch (group.state) {
    case "auto": return "kept automatically";
    case "leave_out": return "left out";
    case "keep_both": return "kept both";
    case "keep": {
      if (!hasKind(group, "partial")) return "kept";
      const keep = group.members.find(member => member.input_id === group.keep_input_id) ?? group.members[0];
      return `kept from ${personName(personOf(people, keep.person_id).label)}`;
    }
    case "choose": return "decided";
    default: return "open";
  }
}
