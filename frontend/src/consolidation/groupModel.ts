/**
 * Decision rows of one consolidation group (acceptance fixes spec "WP-E Grouping", X6, X7). Only relevant
 * differences are asked (2026-10-22): one row for the term when terms differ, one per differing axis (compared
 * across all members, also across terms, so choosing a term never settles a value), and one for the text only when
 * the spans genuinely conflict (`group.span_conflict`, backend `agreement.spans_conflict`). Overlapping spans with
 * small shifts and differing notes are no decision: span, evidence and note come with the finding the result is
 * based on (the chosen term's first member, "Take … finding" or the default member). "Keep both" keeps one finding
 * per term; terms whose own members differ (`group.term_parts`) then get their own rows. A group resolves when every
 * row has a choice; "Take … finding" fills every row from one member.
 */
import type { ConsolidationGroupView, ConsolidationMemberView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import { axisLabel, namesOf, quoted, valueWords } from "./consolidationText";
import { personName } from "./lanes";

export type RowKind = "term" | "axis" | "span";

export interface ChoiceOption {
  key: string;
  label: string;
  /** The member whose span or note this option takes. */
  inputId: string;
  /** Every member holding this option (empty for "No note" and an "Other term…" term). */
  inputIds: string[];
  value: string | null;
  people: ConsolidationPersonView[];
}

/** A term found with "Other term…": an extra option of the term row. */
export interface OtherTerm {
  termId: string;
  label: string;
}

export interface ChoiceRow {
  id: string;
  kind: RowKind;
  axis?: string;
  /** "Keep both": the term whose members this row compares. */
  term?: string;
  label: string;
  options: ChoiceOption[];
}

/** Term row option and choice key of "Keep both". */
export const KEEP_BOTH = "__keep_both";
/** Choice key remembering the member taken with "Take … finding" (its span and note come with it). */
export const TAKEN_FROM = "__from";

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

const spanKey = (member: ConsolidationMemberView) => JSON.stringify(member.spans);
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

const TERM_ROW = "term";
const idsOf = (members: readonly ConsolidationMemberView[]) => members.map(member => member.input_id);

function axisRows(members: readonly ConsolidationMemberView[], people: readonly ConsolidationPersonView[], majority: Readonly<Record<string, string>>,
  prefix = "", labelPrefix = "", term?: string): ChoiceRow[] {
  const total = members.length;
  const axes: string[] = [];
  for (const member of members) for (const axis of Object.keys(member.axes)) if (!axes.includes(axis)) axes.push(axis);
  const rows: ChoiceRow[] = [];
  for (const axis of axes) {
    const options = distinct(members, member => member.axes[axis] ?? "", (first, holders) => {
      const value = first.axes[axis] ?? null;
      const label = value !== null && majority[axis] === value && holders.length * 2 > total ? ` (${holders.length} of ${total})` : "";
      const holding = peopleOf(people, holders);
      return { key: value ?? "", label: `${valueWords(value)} · ${namesOf(holding)}${label}`, inputId: first.input_id,
        inputIds: idsOf(holders), value, people: holding };
    });
    if (options.length) rows.push({ id: `${prefix}axis:${axis}`, kind: "axis", axis, term, label: `${labelPrefix}${axisLabel(axis)}`, options });
  }
  return rows;
}

function spanRow(members: readonly ConsolidationMemberView[], people: readonly ConsolidationPersonView[], text: string,
  prefix = "", labelPrefix = "", term?: string): ChoiceRow[] {
  const spans = distinct(members, spanKey, (first, holders) => {
    const holding = peopleOf(people, holders);
    const words = first.spans.length ? quoted(passage(text, first.spans)) : "No text span";
    return { key: spanKey(first), label: `${words} · ${namesOf(holding)}`, inputId: first.input_id, inputIds: idsOf(holders),
      value: spanKey(first), people: holding };
  });
  return spans.length ? [{ id: `${prefix}span`, kind: "span", term, label: `${labelPrefix}Text`, options: spans }] : [];
}

/** Whether "Keep both" asks per-term rows (a term's own members differ). */
export const keepBothAsks = (group: ConsolidationGroupView) => Object.keys(group.term_parts ?? {}).length > 0;

/**
 * The decision rows of a group. The term row (with "Keep both" unless partial), a row per axis differing among all
 * members and, only for conflicting spans, the text row. With "Keep both" chosen (`keepBoth`), the term row is
 * followed by the rows of every term whose own members differ ("Ataxia · Assertion"), instead of the group's rows.
 * `other` adds a term found with "Other term…" to the term row.
 */
export function rowsOf(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[], text: string, other?: OtherTerm | null,
  keepBoth = false): ChoiceRow[] {
  const members = group.members;
  const rows: ChoiceRow[] = [];
  if (needsTerm(group)) {
    const terms = termOptions(group, people);
    const options: ChoiceOption[] = terms.map(term => ({
      key: term.termId, label: `${term.label} · ${namesOf(term.people)}`, inputId: term.inputId,
      inputIds: idsOf(members.filter(member => member.term_id === term.termId)), value: term.termId, people: term.people,
    }));
    if (other && !options.some(option => option.key === other.termId)) {
      options.push({ key: other.termId, label: `${other.label} (${other.termId}) · other term`, inputId: group.keep_input_id,
        inputIds: [], value: other.termId, people: [] });
    }
    if (!hasKind(group, "partial")) {
      options.push({ key: KEEP_BOTH, label: "Keep both", inputId: group.keep_input_id, inputIds: [], value: null, people: [] });
    }
    rows.push({ id: TERM_ROW, kind: "term", label: "Term", options });
    if (keepBoth) {
      for (const term of terms) {
        const part = group.term_parts?.[term.termId];
        if (!part) continue;
        const own = members.filter(member => member.term_id === term.termId);
        const prefix = `both:${term.termId}:`, label = `${term.label.replace(/ \(.*\)$/, "")} · `;
        rows.push(...axisRows(own, people, {}, prefix, label, term.termId).filter(row => row.axis && part.differing_axes.includes(row.axis)));
        if (part.span_conflict) rows.push(...spanRow(own, people, text, prefix, label, term.termId));
      }
      return rows;
    }
  }
  rows.push(...axisRows(members, people, group.majority));
  if (group.span_conflict) rows.push(...spanRow(members, people, text));
  return rows;
}

export type Choices = Readonly<Record<string, string>>;

export const allChosen = (rows: readonly ChoiceRow[], choices: Choices) =>
  rows.every(row => row.options.some(option => option.key === choices[row.id]));

/** Whether the choices pick "Keep both". */
export const keepsBoth = (choices: Choices) => choices[TERM_ROW] === KEEP_BOTH;

/** The choices that take every row from one member ("Take Tom Reis's finding"); its span and note come with it. */
export function takeOverChoices(rows: readonly ChoiceRow[], member: ConsolidationMemberView): Record<string, string> {
  const choices: Record<string, string> = { [TAKEN_FROM]: member.input_id };
  for (const row of rows) {
    const option = row.options.find(value => value.inputIds.includes(member.input_id));
    if (option) choices[row.id] = option.key;
  }
  return choices;
}

/**
 * What taking one member's finding adopts, spelled out: the term, every value, the text when spans conflict and the
 * note it carries ("Ataxia (HP:0001251) · absent · patient · current").
 */
export function takeOverWords(member: ConsolidationMemberView, rows: readonly ChoiceRow[], text: string): string {
  const parts = [termLabel(member), ...Object.values(member.axes).map(valueWords)];
  if (rows.some(row => row.kind === "span")) parts.push(member.spans.length ? quoted(passage(text, member.spans)) : "No text span");
  const note = noteOf(member);
  if (note) parts.push(`note ${quoted(note)}`);
  return parts.join(" · ");
}

type ResolveChoice = NonNullable<ConsolidationResolvePayload["choice"]>;

/** The axis values and the span member chosen in `rows` (those of one term with "Keep both"). */
function chosenParts(rows: readonly ChoiceRow[], choices: Choices) {
  const picked = (row: ChoiceRow) => row.options.find(option => option.key === choices[row.id]);
  const axes: Record<string, string> = {};
  let span: ChoiceOption | undefined;
  for (const row of rows) {
    const option = picked(row);
    if (row.kind === "axis" && row.axis && option && option.value !== null) axes[row.axis] = option.value;
    if (row.kind === "span") span = option;
  }
  return { axes, span };
}

/**
 * The `choose` payload of a fully answered group; it names every differing axis. Span, evidence and note come from
 * the chosen text's member when the text was asked, else from the member taken with "Take … finding" (when it holds
 * the chosen term), else from the chosen term's first member, else from the default member. The note is never asked.
 */
export function choosePayload(group: ConsolidationGroupView, rows: readonly ChoiceRow[], choices: Choices): ResolveChoice {
  const termRow = rows.find(row => row.id === TERM_ROW);
  const term = termRow?.options.find(option => option.key === choices[TERM_ROW]);
  const { axes, span } = chosenParts(rows.filter(row => row.kind !== "term"), choices);
  const taken = group.members.find(member => member.input_id === choices[TAKEN_FROM]);
  const termId = term?.value ?? group.members[0].term_id;
  const base = span?.inputId
    ?? (taken && (!term || taken.term_id === termId) ? taken.input_id : undefined)
    ?? (term && term.inputIds.length ? term.inputId : group.keep_input_id);
  return { term_id: termId, span_from_input_id: base, axes };
}

/** The `term_choices` of "Keep both": one per term whose own members differ, from that term's rows. */
export function keepBothChoices(group: ConsolidationGroupView, rows: readonly ChoiceRow[], choices: Choices): ResolveChoice[] {
  return Object.keys(group.term_parts ?? {}).map(termId => {
    const { axes, span } = chosenParts(rows.filter(row => row.term === termId), choices);
    const first = group.members.find(member => member.term_id === termId)!;
    return { term_id: termId, span_from_input_id: span?.inputId ?? first.input_id, axes };
  });
}

/** The resolve payload (without ids, note and flag) of a fully answered group. */
export function resolvePayload(group: ConsolidationGroupView, rows: readonly ChoiceRow[], choices: Choices): Omit<ConsolidationResolvePayload, "input_ids"> {
  if (keepsBoth(choices)) {
    const termChoices = keepBothChoices(group, rows, choices);
    return termChoices.length ? { action: "keep_both", term_choices: termChoices } : { action: "keep_both" };
  }
  return { action: "choose", choice: choosePayload(group, rows, choices) };
}

/** What the decision kept, for the collapsed line: "Ataxia (HP:0001251) (Luc Martin), absent (Tom Reis)". */
export function choiceSummary(rows: readonly ChoiceRow[], choices: Choices): string {
  const parts: string[] = [];
  for (const row of rows) {
    const option = row.options.find(value => value.key === choices[row.id]);
    if (!option) continue;
    if (option.key === KEEP_BOTH) { parts.push("kept both"); continue; }
    const what = row.kind === "axis" ? valueWords(option.value) : option.label.split(" · ")[0];
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
