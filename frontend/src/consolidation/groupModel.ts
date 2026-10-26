/**
 * The comparison table of one consolidation group (spec §3, mockup variant B): one column per member, one row for the
 * term, each axis, the text, the note and the whole finding. Only conflicting rows need a choice (the term when terms
 * differ, an axis in `differing_axes`, the text only when the spans genuinely conflict, backend
 * `agreement.spans_conflict`; never the note). The group always resolves to exactly one finding, spelled out by the
 * result line. Choices are keyed by row id ("term", an axis id, "text"); "whole" remembers the member taken with
 * "Take … finding" (its span, evidence and note come with it); "modifiers" holds the pressed modifier toggle ids
 * (modifierSets.ts), joined by spaces. A conflicting Modifiers row is never resolved by a check: the group resolves
 * with "Keep" (DN-11).
 */
import type { ConsolidationGroupView, ConsolidationMemberView, ConsolidationModifierView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import { axisOptionLabel } from "../editor/axisLabels";
import { sentenceBounds } from "../editor/modifiers";
import { axisLabel, labelWithQuote, OVERLAPPING, quoted } from "./consolidationText";
import { personName } from "./lanes";
import { chosenModifiers, modifierChoices, modifierKey, modifierText, NO_MODIFIERS, otherTextChosen, press, setText, setWarnings, toggleName, type MemberSet, type ModifierView } from "./modifierSets";

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

export type RowKind = "term" | "axis" | "text" | "modifiers" | "note" | "whole";
/** One ✓ toggle of a member's modifier (or "No modifiers") in the Modifiers row. */
export interface ModifierToggleCell {
  /** Toggle id (modifierSets `modifierKey`) or `NO_MODIFIERS`. */
  id: string;
  /** "Severe “schwere”", "Severe (no text)", "No modifiers". */
  label: string;
  /** "(2 of 3)" or null. */
  majority: string | null;
  cohort: boolean;
  pressed: boolean;
  /** Another variant of this term is pressed. */
  otherText: boolean;
  /** "Take Severe “schwere” from Ana Weber for Modifiers (2 of 3)". */
  name: string;
}
export interface ComparisonCell { inputId: string; value: string; display: string; chosen: boolean; toggles?: ModifierToggleCell[] }
export interface ComparisonRow {
  kind: RowKind;
  /** "term", axis id, "text", "note", "whole". */
  id: string;
  label: string;
  /** People disagree and a choice is needed. */
  conflict: boolean;
  /** "Patient (all agree)" when everyone agrees ("Patient" in a one-person group), else null. */
  agreed: string | null;
  /** Text without conflict: "(overlapping, comes with the chosen finding)". */
  info: string | null;
  cells: ComparisonCell[];
  /** "Two severities" / "Two onsets" for the chosen (or agreed) modifiers. */
  warnings?: string[];
}

/** " (all agree)" only when there is someone to agree with. */
export const allAgree = (members: readonly ConsolidationMemberView[]) => members.length > 1 ? " (all agree)" : "";
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
      agreed: !conflict && same && info === null && kind !== "whole" ? `${cells[0].display}${allAgree(members)}` : null };
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
  const modifiers = modifiersRow(group, people, text, choices);
  if (modifiers) rows.push(modifiers);
  // Notes are information, never a decision: the kept finding keeps its own note.
  if (members.some(noteOf)) rows.push(row("note", "note", "Note", false, noteOf, noteOf));
  // "Take X's finding" resolves at once, so it is hidden when only the modifiers conflict (DN-11).
  if (members.length > 1 && (otherConflicts(group) || !modifiersConflict(group))) rows.push(row("whole", "whole", "Whole finding", false, member => member.input_id,
    member => `Take ${firstName(names[members.indexOf(member)].label)}'s finding`));
  return rows;
}

const viewOf = (modifier: ConsolidationModifierView): ModifierView => ({ ...modifier, exclusive_class: modifier.exclusive_class ?? null });

/** The members' modifier sets for modifierSets.ts. */
export function memberSets(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[] = []): MemberSet[] {
  const names = peopleOf(people, group.members);
  return group.members.map((member, index) => ({ inputId: member.input_id, personId: member.person_id,
    personName: personName(names[index].label), modifiers: (member.modifiers ?? []).map(viewOf) }));
}

/** The group shows a Modifiers row: some member has modifiers. */
export const hasModifiers = (group: ConsolidationGroupView) => group.members.some(member => !!member.modifiers?.length);
export const modifiersConflict = (group: ConsolidationGroupView) => hasModifiers(group) && hasKind(group, "modifiers_differ");
const otherConflicts = (group: ConsolidationGroupView) => needsTerm(group) || group.differing_axes.length > 0 || !!group.span_conflict;
/** A person marked a modifier term as a finding (S18). */
export const isStandalone = (group: ConsolidationGroupView) => hasKind(group, "modifier_as_finding");

/** Pressed modifier toggle ids of the choices. */
export const modifierSelection = (choices: Choices): Set<string> => new Set(choices.modifiers ? choices.modifiers.split(" ") : []);
const withSelection = (choices: Choices, selection: ReadonlySet<string>): Choices => {
  const { modifiers: _old, ...rest } = choices;
  return selection.size ? { ...rest, modifiers: [...selection].join(" ") } : rest;
};

/** Terms some member linked to a text: their spanless variants read "Severe (no text)". */
const linkedTerms = (sets: readonly MemberSet[]) =>
  new Set(sets.flatMap(set => set.modifiers.filter(modifier => modifier.segments.length).map(modifier => modifier.term_id)));

function modifiersRow(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[], text: string, choices: Choices): ComparisonRow | null {
  if (!hasModifiers(group)) return null;
  const sets = memberSets(group, people);
  const options = modifierChoices(sets);
  const selection = modifierSelection(choices);
  const other = otherTextChosen(selection, options);
  const linked = linkedTerms(sets);
  const conflict = modifiersConflict(group);
  const cells = sets.map(set => {
    const own = options.toggles.filter(toggle => toggle.inputIds.includes(set.inputId));
    const toggles: ModifierToggleCell[] = own.length ? own.map(toggle => {
      const label = modifierText(toggle.modifier, text, linked);
      return { id: toggle.id, label, majority: toggle.majority, cohort: toggle.modifier.kind === "cohort", pressed: selection.has(toggle.id),
        otherText: other.has(toggle.id), name: toggleName(label, set.personName, toggle.majority) };
    }) : [{ id: NO_MODIFIERS, label: "No modifiers", majority: options.none?.majority ?? null, cohort: false, pressed: selection.has(NO_MODIFIERS),
      otherText: false, name: toggleName("No modifiers", set.personName, options.none?.majority ?? null) }];
    return { inputId: set.inputId, value: toggles.map(toggle => toggle.id).join(" "), toggles,
      display: own.length ? setText(own.map(toggle => toggle.modifier), text, linked) : "No modifiers", chosen: toggles.some(toggle => toggle.pressed) };
  });
  const same = cells.every(cell => cell.value === cells[0].value);
  const shown = conflict ? chosenModifiers(selection, options) ?? [] : sets[0].modifiers;
  return { kind: "modifiers", id: "modifiers", label: "Modifiers", conflict, info: null, cells,
    agreed: !conflict && same ? `${cells[0].display}${allAgree(group.members)}` : null, warnings: setWarnings(shown) };
}

/** Choices after a check in a row: a modifier toggle presses or releases (modifierSets `press`), any other row takes
 *  the value. A check by hand drops the member of an earlier "Take … finding". */
export function choose(group: ConsolidationGroupView, choices: Choices, rowId: string, value: string): Choices {
  const { whole: _taken, ...rest } = choices;
  if (rowId !== "modifiers") return { ...rest, [rowId]: value };
  return withSelection(rest, press(modifierSelection(rest), value, modifierChoices(memberSets(group))));
}

/** Every conflicting row has a choice ("Other term…" may choose a term no member holds). */
export const choicesComplete = (rows: readonly ComparisonRow[], choices: Choices) =>
  rows.every(row => !row.conflict || choices[row.id] !== undefined);

/** Choices taking every row from one member ("Take Ali's finding"). */
export function takeFinding(group: ConsolidationGroupView, member: ConsolidationMemberView): Record<string, string> {
  const choices: Record<string, string> = { whole: member.input_id, term: member.term_id, text: member.input_id };
  for (const axis of axesOf(group)) choices[axis] = member.axes[axis] ?? "";
  if (hasModifiers(group)) choices.modifiers = member.modifiers?.length ? member.modifiers.map(modifierKey).join(" ") : NO_MODIFIERS;
  return choices;
}

/** One comma-separated part of the result line; `axis` holds the raw value of an axis part (shown as `AxisValue`). */
export interface ResultPart { text: string; axis?: string | null }

export interface ResultText {
  /** "Hypotonia (HP:0001252), Absent, Patient, Current". */
  finding: string;
  parts?: ResultPart[];
  saved: string;
  notTaken: string | null;
}

/** The result's modifiers: the pressed ones when the row conflicts (null: not chosen yet), else the base member's. */
function resultModifiers(group: ConsolidationGroupView, choices: Choices, base?: ConsolidationMemberView): ModifierView[] | null {
  if (modifiersConflict(group)) return chosenModifiers(modifierSelection(choices), modifierChoices(memberSets(group)));
  return ((base ?? group.members[0]).modifiers ?? []).map(viewOf);
}

/**
 * "Result: 1 finding, Hypotonia (HP:0001252), assertion not chosen yet, Patient, Current" and, when other terms exist,
 * "Not taken: Axial hypotonia (Ali)". With a Modifiers row it ends in ", modifiers: Severe “schwere”", ", no modifiers"
 * or ", modifiers not chosen yet" (DN-5).
 */
export function resultLine(group: ConsolidationGroupView, people: readonly ConsolidationPersonView[], text: string, choices: Choices,
  other?: OtherTerm | null): ResultText {
  const termId = choices.term ?? defaultTerm(group);
  const holder = group.members.find(member => member.term_id === termId);
  const parts: ResultPart[] = [{ text: holder ? termLabel(holder) : other?.termId === termId ? `${other.label} (${other.termId})` : termId }];
  const axisPart = (value: string | null | undefined): ResultPart => ({ text: axisOptionLabel(value), axis: value || null });
  for (const axis of axesOf(group)) {
    if (!group.differing_axes.includes(axis)) parts.push(axisPart(group.members[0].axes[axis]));
    else parts.push(choices[axis] === undefined ? { text: `${axisLabel(axis)} not chosen yet` } : axisPart(choices[axis]));
  }
  if (group.span_conflict && choices.text === undefined) parts.push({ text: "text not chosen yet" });
  if (hasModifiers(group)) {
    const chosen = resultModifiers(group, choices, group.members.find(member => member.input_id === group.keep_input_id));
    parts.push({ text: chosen === null ? "modifiers not chosen yet" : chosen.length
      ? `modifiers: ${setText(chosen, text, linkedTerms(memberSets(group)))}` : "no modifiers" });
  }
  const finding = parts.map(part => part.text).join(", ");
  const names = peopleOf(people, group.members);
  const others = new Map<string, string[]>();
  group.members.forEach((member, index) => {
    if (member.term_id === termId) return;
    const label = member.term_label || member.term_id;
    others.set(label, [...(others.get(label) ?? []), firstName(names[index].label)]);
  });
  return {
    finding,
    parts,
    saved: `Result: 1 finding, ${finding}`,
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
  // With a Modifiers row every `choose` sends the explicit list (the pressed ones, else the base member's).
  const modifiersOf = (base?: ConsolidationMemberView) => {
    if (!hasModifiers(group)) return {};
    const chosen = resultModifiers(group, choices, base) ?? [];
    return { modifiers: chosen.map(modifier => ({ term_id: modifier.term_id, segments: modifier.segments.map(([start, end]) => ({ start, end })) })) };
  };
  if (!otherConflicts(group) && !modifiersConflict(group)) {
    // "Take X's finding" with nothing conflicting: X's span, evidence and note, not the default member's.
    return taken ? { action: "choose", choice: { term_id: taken.term_id, span_from_input_id: taken.input_id, axes: {}, ...modifiersOf(taken) } } : { action: "keep" };
  }
  const termId = choices.term ?? defaultTerm(group);
  const base = (group.span_conflict ? group.members.find(member => member.input_id === choices.text) : undefined)
    ?? (taken?.term_id === termId ? taken : undefined)
    ?? group.members.find(member => member.term_id === termId);
  return { action: "choose", choice: {
    term_id: termId, span_from_input_id: base?.input_id ?? group.keep_input_id,
    axes: Object.fromEntries(group.differing_axes.map(axis => [axis, choices[axis] || null])),
    ...modifiersOf(base),
  } };
}

export interface AttachCandidate { groupId: string; annotationId: string; label: string }

/** Resolved findings of the round in the standalone modifier's sentence, nearest first (S18). */
export function attachCandidates(group: ConsolidationGroupView, groups: readonly ConsolidationGroupView[], text: string): AttachCandidate[] {
  const at = group.start;
  if (at === null) return [];
  const [from, to] = sentenceBounds(text, at);
  const layerId = group.members[0]?.layer_id;
  return groups
    .filter(other => other.group_id !== group.group_id && other.state !== "open" && other.state !== "leave_out"
      && other.annotation_ids.some(id => id.startsWith("cons-")) && other.members[0]?.layer_id === layerId
      && other.start !== null && other.start >= from && other.start < to)
    .sort((a, b) => Math.abs(a.start! - at) - Math.abs(b.start! - at))
    .map(other => {
      const base = other.members.find(member => member.input_id === other.keep_input_id) ?? other.members[0];
      return { groupId: other.group_id, annotationId: other.annotation_ids.find(id => id.startsWith("cons-"))!, label: `${termLabel(base)}, ${quoted(groupName(other, text))}` };
    });
}

/** "Severe “schwere”": the term a person marked as a finding, with its text. */
export function standaloneText(group: ConsolidationGroupView, text: string): string {
  const base = group.members.find(member => member.input_id === group.keep_input_id) ?? group.members[0];
  const label = base.term_label || base.term_id;
  return base.spans.length ? labelWithQuote(label, passage(text, base.spans)) : label;
}
