/**
 * Person lanes of the consolidation text (acceptance fixes U12): one underline lane per person in a fixed
 * order, lane 1 closest to the text, at most 4 lanes; lane 4 combines every further person ("+n").
 */
import type { ConsolidationPersonView } from "../api/client";

export const MAX_LANES = 4;

export interface Lane {
  lane: number;
  /** The people drawn on this lane, in the view's order. */
  people: ConsolidationPersonView[];
  /** Short marker of a combined lane ("+2"); empty for a lane of one person. */
  extra: string;
}

/** The display name part of a person label: "Luc Martin (ann-0004)" → "Luc Martin"; a bare pseudonym stays. */
export function personName(label: string): string {
  const match = /^(.*\S)\s+\([^()]+\)$/.exec(label);
  return match ? match[1] : label;
}

/** The lane of a person (1..4); people beyond the fourth share lane 4. */
export function laneOf(people: readonly ConsolidationPersonView[], personId: string): number {
  const index = people.findIndex(person => person.person_id === personId);
  if (index < 0) return MAX_LANES;
  return Math.min(Math.max(1, people[index].lane || index + 1), MAX_LANES);
}

/** Lanes in order with their people; lane 4 lists every further person and carries "+n" when it holds several. */
export function lanesOf(people: readonly ConsolidationPersonView[]): Lane[] {
  const lanes = new Map<number, ConsolidationPersonView[]>();
  for (const person of people) {
    const lane = laneOf(people, person.person_id);
    lanes.set(lane, [...(lanes.get(lane) ?? []), person]);
  }
  return [...lanes.entries()].sort(([a], [b]) => a - b)
    .map(([lane, members]) => ({ lane, people: members, extra: members.length > 1 ? `+${members.length}` : "" }));
}

/** Legend line of one lane: "Luc Martin (ann-0004)" or "+2: Ana Weber (ann-0005), Bo Lind (ann-0006)". */
export function laneLegend(lane: Lane): string {
  const names = lane.people.map(person => person.label).join(", ");
  return lane.extra ? `${lane.extra}: ${names}` : names;
}
