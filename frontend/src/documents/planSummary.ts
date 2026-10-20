/**
 * Copy of the plan dialog (spec "Plan dialog for several cases (D19)"): the live "Will change"
 * summary and the line of the Undo toast after a save. Pure, so the dialog and the selection bar
 * quick actions word plan changes the same way.
 */
import { plural } from "../app/labels";
import type { TriState } from "../ui/TriStateButton";

/** Choices per language key ("source" = each case's source row). Missing cells are "keep". */
export type PlanChoices = Record<string, { review?: TriState; annotate?: TriState }>;

export interface PlanSummaryLanguage {
  key: string;
  source_languages?: readonly string[];
  cases_in_selection: number;
}

export const SOURCE_KEY = "source";

/** "Source (en, fr)" for the source key, the language code otherwise. */
export function languageName(language: { key: string; source_languages?: readonly string[] }): string {
  if (language.key !== SOURCE_KEY) return language.key;
  return language.source_languages?.length ? `Source (${language.source_languages.join(", ")})` : "Source";
}

/** Source first, then the languages in alphabetical order. */
export const compareKeys = (a: string, b: string): number => (a === SOURCE_KEY ? -1 : b === SOURCE_KEY ? 1 : a.localeCompare(b));

const changed = (choice: PlanChoices[string] | undefined): boolean => !!choice && ((choice.review ?? "keep") !== "keep" || (choice.annotate ?? "keep") !== "keep");

export function allKeep(choices: PlanChoices): boolean {
  return !Object.values(choices).some(changed);
}

/** Only the languages with at least one cell other than keep. */
export function changedChoices(choices: PlanChoices): PlanChoices {
  const result: PlanChoices = {};
  for (const [key, choice] of Object.entries(choices)) {
    if (!changed(choice)) continue;
    const kept: PlanChoices[string] = {};
    if (choice.review && choice.review !== "keep") kept.review = choice.review;
    if (choice.annotate && choice.annotate !== "keep") kept.annotate = choice.annotate;
    result[key] = kept;
  }
  return result;
}

function effect(review: TriState, annotate: TriState, ruleOn: boolean): string {
  if (review === "on" && annotate === "on") return ruleOn ? "review, then annotate after the review is accepted" : "review and annotate in parallel";
  if (review === "off" && annotate === "off") return "not in plan";
  const parts: string[] = [];
  if (review === "on") parts.push("review");
  if (annotate === "on") parts.push("annotate");
  if (review === "off") parts.push("review off");
  if (annotate === "off") parts.push("annotate off");
  return parts.join(", ");
}

function toAssignSentence(toAssign: Record<string, number>): string {
  const parts: string[] = [];
  const reviews = toAssign.translation_review ?? 0;
  const annotations = toAssign.annotate ?? 0;
  if (reviews) parts.push(plural(reviews, "translation review"));
  if (annotations) parts.push(plural(annotations, "annotation"));
  if (!parts.length) return "";
  const total = reviews + annotations;
  return `${parts.join(" and ")} ${total === 1 ? "becomes" : "become"} "to assign".`;
}

/**
 * "de in 20 cases → review, then annotate after the review is accepted. Nothing else changes.
 * 20 translation reviews and 20 annotations become "to assign"." — or "Nothing to change yet."
 */
export function describePlanChange(input: { choices: PlanChoices; languages: readonly PlanSummaryLanguage[]; toAssign?: Record<string, number>; ruleOn: boolean }): string {
  const active = changedChoices(input.choices);
  const keys = Object.keys(active).sort(compareKeys);
  if (!keys.length) return "Nothing to change yet.";
  const byKey = new Map(input.languages.map(language => [language.key, language]));
  const sentences = keys.map(key => {
    const language = byKey.get(key) ?? { key, cases_in_selection: 0 };
    const choice = active[key];
    return `${languageName(language)} in ${plural(language.cases_in_selection, "case")} → ${effect(choice.review ?? "keep", choice.annotate ?? "keep", input.ruleOn)}.`;
  });
  if (input.languages.some(language => !active[language.key])) sentences.push("Nothing else changes.");
  const assign = toAssignSentence(input.toAssign ?? {});
  if (assign) sentences.push(assign);
  return sentences.join(" ");
}

/** Toast line after a save: "Plan saved for 20 cases · de: review + annotate". */
export function savedSummary(caseCount: number, choices: PlanChoices): string {
  const active = changedChoices(choices);
  const parts = Object.keys(active).sort(compareKeys).map(key => {
    const { review, annotate } = active[key];
    const on = [review === "on" && "review", annotate === "on" && "annotate"].filter(Boolean).join(" + ");
    const off = [review === "off" && "review off", annotate === "off" && "annotate off"].filter(Boolean);
    return `${key}: ${[on, ...off].filter(Boolean).join(", ")}`;
  });
  return [`Plan saved for ${plural(caseCount, "case")}`, ...parts].join(" · ");
}
