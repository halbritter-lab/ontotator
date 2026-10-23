/**
 * Copy of the assign dialog (spec "Assign dialog", "Copy" › Assign many), pure.
 *
 * People are named by display name (pseudonym when there is none); the
 * summary sentences stay free of pronouns because gender is unknown.
 */
import type { BatchPersonView, BatchSkipView } from "../api/client";
import { textLabel, type PersonRef } from "../app/identity";

export type AssignTask = "translation_review" | "annotate";

const nouns: Record<AssignTask, [string, string]> = {
  translation_review: ["translation review", "translation reviews"],
  annotate: ["annotation", "annotations"],
};
const stepNames: Record<AssignTask, string> = { translation_review: "Translation review", annotate: "Annotation" };

export const taskNoun = (task: AssignTask, count: number): string => `${count} ${nouns[task][count === 1 ? 0 : 1]}`;
export const stepName = (task: AssignTask): string => stepNames[task];

/** "Translation review · de · 20 versions" */
export function stepLabel(task: AssignTask, language: string, versions: number): string {
  return `${stepNames[task]} · ${language} · ${versions} ${versions === 1 ? "version" : "versions"}`;
}

/** Display name, else pseudonym (sentences; tables use `personLabel`). */
export const personName = (person: PersonRef): string => person.display_name?.trim() || person.pseudonym;
const firstName = (person: PersonRef): string => person.display_name?.trim().split(/\s+/)[0] || person.pseudonym;

export function onePersonSummary({ person, gets, task, language, openBefore, openAfter }: { person: PersonRef; gets: number; task: AssignTask; language: string; openBefore: number; openAfter: number }): string {
  return `${personName(person)} gets ${taskNoun(task, gets)} (${language}). Open tasks: ${openBefore} → ${openAfter}.`;
}

/** "case-0101…0110": the last ID keeps only its trailing digits when the rest matches. */
export function caseRange(first: string, last: string): string {
  if (first === last) return first;
  const a = /^(.*?)(\d+)$/.exec(first); const b = /^(.*?)(\d+)$/.exec(last);
  if (a && b && a[1] === b[1]) return `${first}…${b[2]}`;
  return `${first}…${last}`;
}

export function splitSummary(people: readonly { person: PersonRef; first_case: string | null; last_case: string | null; gets: number }[]): string {
  const getting = people.filter(item => item.gets > 0 && item.first_case && item.last_case);
  const counts = new Map<string, number>();
  for (const item of getting) counts.set(firstName(item.person), (counts.get(firstName(item.person)) ?? 0) + 1);
  const name = (person: PersonRef) => (counts.get(firstName(person)) ?? 0) > 1 ? personName(person) : firstName(person);
  return `Cases in list order: ${getting.map(item => `${caseRange(item.first_case!, item.last_case!)} → ${name(item.person)}`).join(", ")}.`;
}

const skipOrder: BatchSkipView["reason"][] = ["waiting_for_review", "not_in_plan", "already_assigned", "step_differs", "discarded"];
export function skippedLines(skipped: readonly BatchSkipView[], language: string): string[] {
  return skipOrder.flatMap(reason => {
    const n = skipped.filter(item => item.reason === reason).length;
    if (!n) return [];
    switch (reason) {
      case "waiting_for_review": return [`${n} still in translation review: waiting for review, they join the next batch`];
      case "not_in_plan": return [`${n} not in plan for ${language}`];
      case "already_assigned": return [`${n} already assigned`];
      case "step_differs": return [`${n} at another step`];
      case "discarded": return [`${n} with the ${language} version discarded`];
    }
  });
}

export function needsPeopleMessage(n: number, task: AssignTask): string {
  if (task === "annotate") return `Choose at least ${n} annotators for ${n} annotations per text.`;
  return `Choose at least ${n} reviewers for ${n} translation reviews per text.`;
}

/** Why a member is muted, or null. `does_not_read` and already-assigned people stay selectable. */
export function memberReason(member: Pick<BatchPersonView, "unavailable" | "already_assigned" | "reads">, task: AssignTask, language: string): string | null {
  switch (member.unavailable) {
    case "inactive": return "Account inactive";
    case "role_missing": return "Not an annotator in this project";
    case "does_not_read": return member.reads.includes(language) ? "does not read the source language" : `does not read ${language}`;
  }
  if (member.already_assigned > 0) return `Already ${task === "annotate" ? "annotating" : "reviewing"} ${member.already_assigned} of these cases`;
  return null;
}

/** Only `role_missing` and `inactive` make a member unavailable (aria-disabled). */
export const memberUnavailable = (member: Pick<BatchPersonView, "unavailable">): boolean => member.unavailable === "role_missing" || member.unavailable === "inactive";

/** Targets that already hold some of their assignments: "case-0101 · de: 1 of 2 assigned". */
export function partlyAssignedLines(targets: readonly { case_id: string; language: string; remaining: number }[], perText: number): string[] {
  const partial = targets.filter(target => target.remaining > 0 && target.remaining < perText);
  if (partial.length <= 3) return partial.map(target => `${textLabel(target)}: ${perText - target.remaining} of ${perText} assigned`);
  const groups = new Map<number, number>();
  for (const target of partial) groups.set(perText - target.remaining, (groups.get(perText - target.remaining) ?? 0) + 1);
  return [...groups].sort(([a], [b]) => a - b).map(([assigned, n]) => `${n} versions: ${assigned} of ${perText} assigned`);
}

const joinNames = (names: readonly string[]): string => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** "20 translation reviews assigned to Ana Weber" / "… split between Ana Weber (10) and Ben Roth (10)". */
export function resultMessage(task: AssignTask, created: number, people: readonly { person: PersonRef; count: number }[], split: boolean): string {
  const getting = people.filter(item => item.count > 0);
  if (split && getting.length > 1) return `${taskNoun(task, created)} split between ${joinNames(getting.map(item => `${personName(item.person)} (${item.count})`))}`;
  return `${taskNoun(task, created)} assigned to ${joinNames(getting.map(item => personName(item.person)))}`;
}
