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

/** "Translation review, de, 20 versions" */
export function stepLabel(task: AssignTask, language: string, versions: number): string {
  return `${stepNames[task]}, ${language}, ${versions} ${versions === 1 ? "version" : "versions"}`;
}

/** "Translation review de" (one step of the assign dialog's step list, issue 233). */
export const stepShortLabel = (task: AssignTask, language: string): string => `${stepNames[task]} ${language}`;

/** "translation review (de), annotation (en, fr)": the steps of a selection, reviews first. */
export function stepsOverview(steps: readonly { task: AssignTask; language: string }[]): string {
  return (["translation_review", "annotate"] as const).flatMap(task => {
    const languages = [...new Set(steps.filter(step => step.task === task).map(step => step.language))].sort();
    return languages.length ? [`${nouns[task][0]} (${languages.join(", ")})`] : [];
  }).join(", ");
}

const NAMED_LEFT = 6;
const someNames = (names: readonly string[]): string => names.length > NAMED_LEFT ? `${names.slice(0, NAMED_LEFT).join(", ")} and ${names.length - NAMED_LEFT} more` : names.join(", ");

/** The closing message (issue 218): "Left unassigned: annotation of case-0102 en", "Also skipped: case-0120". */
export function leftLines(open: readonly { task: AssignTask; texts: readonly string[] }[], skipped: readonly string[]): string[] {
  return [
    ...(open.length ? [`Left unassigned: ${open.map(item => `${nouns[item.task][0]} of ${someNames(item.texts)}`).join("; ")}`] : []),
    ...(skipped.length ? [`Also skipped: ${someNames([...new Set(skipped)])}`] : []),
  ];
}

/** Display name, else pseudonym (sentences; tables use `personLabel`). */
export const personName = (person: PersonRef): string => person.display_name?.trim() || person.pseudonym;

export function onePersonSummary({ person, gets, task, language, openBefore, openAfter }: { person: PersonRef; gets: number; task: AssignTask; language: string; openBefore: number; openAfter: number }): string {
  return `${personName(person)} gets ${taskNoun(task, gets)} (${language}). Open tasks: ${openBefore} → ${openAfter}.`;
}

const skipOrder: BatchSkipView["reason"][] = ["waiting_for_review", "not_in_plan", "already_assigned", "step_differs", "discarded", "no_proposals_on_version", "other_root_in_review"];
/** `task` names the work in the not-in-plan line: a case planned only in another language is skipped for this one (issue 195). */
export function skippedLines(skipped: readonly BatchSkipView[], language: string, task: AssignTask = "annotate"): string[] {
  return skipOrder.flatMap(reason => {
    const n = skipped.filter(item => item.reason === reason).length;
    if (!n) return [];
    switch (reason) {
      case "waiting_for_review": return [`${n} without a translation review under way: assign the review first`];
      case "not_in_plan": return [`${n} without ${nouns[task][0]} of ${language} in the plan (other languages are separate tasks)`];
      case "already_assigned": return [`${n} already assigned`];
      case "step_differs": return [`${n} at another step`];
      case "discarded": return [`${n} with the ${language} version discarded`];
      case "no_proposals_on_version": return [`${n} without tool proposals on the newest version: their annotation started from proposals`];
      case "other_root_in_review": return [`${n} accepted while a parallel translation is in review: assign once that review is accepted`];
    }
  });
}

/** Why a member is muted, or null. `does_not_read` and already-assigned people stay selectable. */
export function memberReason(member: Pick<BatchPersonView, "unavailable" | "already_assigned" | "reads">, task: AssignTask, language: string): string | null {
  switch (member.unavailable) {
    case "inactive": return "Account inactive";
    // Annotators also review translations (TASK_ROLES): the reason names the task.
    case "role_missing": return task === "annotate" ? "Cannot annotate in this project" : "Cannot review translations in this project";
    case "does_not_read": return member.reads.includes(language) ? "does not read the source language" : `does not read ${language}`;
  }
  if (member.already_assigned > 0) return `Already ${task === "annotate" ? "annotating" : "reviewing"} ${member.already_assigned} of these cases`;
  return null;
}

/** Only `role_missing` and `inactive` make a member unavailable (aria-disabled). */
export const memberUnavailable = (member: Pick<BatchPersonView, "unavailable">): boolean => member.unavailable === "role_missing" || member.unavailable === "inactive";

/** Targets that already hold some of their assignments: "case-0101, de: 1 of 2 assigned". */
export function partlyAssignedLines(targets: readonly { case_id: string; language: string; remaining: number }[], perText: number): string[] {
  const partial = targets.filter(target => target.remaining > 0 && target.remaining < perText);
  if (partial.length <= 3) return partial.map(target => `${textLabel(target)}: ${perText - target.remaining} assigned (limit ${perText})`);
  const groups = new Map<number, number>();
  for (const target of partial) groups.set(perText - target.remaining, (groups.get(perText - target.remaining) ?? 0) + 1);
  return [...groups].sort(([a], [b]) => a - b).map(([assigned, n]) => `${n} versions: ${assigned} assigned (limit ${perText})`);
}

const joinNames = (names: readonly string[]): string => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** "20 translation reviews assigned to Ana Weber" / "2 annotations assigned to Ana Weber and Ben Roth". */
export function resultMessage(task: AssignTask, created: number, people: readonly { person: PersonRef; count: number }[]): string {
  const getting = people.filter(item => item.count > 0);
  return `${taskNoun(task, created)} assigned to ${joinNames(getting.map(item => personName(item.person)))}`;
}
