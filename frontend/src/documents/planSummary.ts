/**
 * Copy of the plan dialog (spec "Plan dialog for several cases (D19)", F5): the live "Will change"
 * line, the mode report and the line of the Undo toast after a save. Pure, so the dialog and the
 * selection bar quick actions word plan changes the same way.
 */
import { plural } from "../app/labels";
import type { TriState } from "../ui/TriStateButton";

/** Choices per language key ("source" = each case's source row). Missing cells are "keep". */
export type PlanChoices = Record<string, { review?: TriState; annotate?: TriState; annotation_mode?: "keep" | "proposals" | "scratch" | "project" }>;

export const SOURCE_KEY = "source";

/** "Source (en, fr)" for the source key, the language code otherwise. */
export function languageName(language: { key: string; source_languages?: readonly string[] }): string {
  if (language.key !== SOURCE_KEY) return language.key;
  return language.source_languages?.length ? `Source (${language.source_languages.join(", ")})` : "Source";
}

/** Source first, then the languages in alphabetical order. */
export const compareKeys = (a: string, b: string): number => (a === SOURCE_KEY ? -1 : b === SOURCE_KEY ? 1 : a.localeCompare(b));

const changed = (choice: PlanChoices[string] | undefined): boolean =>
  !!choice && ((choice.review ?? "keep") !== "keep" || (choice.annotate ?? "keep") !== "keep" || (choice.annotation_mode ?? "keep") !== "keep");

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
    if (choice.annotation_mode && choice.annotation_mode !== "keep") kept.annotation_mode = choice.annotation_mode;
    result[key] = kept;
  }
  return result;
}

/**
 * "{head}; {locked} kept their mode because the annotation has started; {n} have no tool proposals."
 * (parts with 0 omitted). Head: "20 texts" in the preview, "18 texts changed" in the toast.
 */
export function planReport(head: string, locked: number, noProposals: number): string {
  const parts = [head];
  if (locked) parts.push(`${locked} kept their mode because the annotation has started`);
  if (noProposals) parts.push(`${noProposals} have no tool proposals`);
  return `${parts.join("; ")}.`;
}

/** Quick choice of the plan dialog (M2 decision M-1): the two translation presets. */
export type PlanPreset = "review_and_annotate_translations" | "annotate_only";

export const PRESET_LABELS: Readonly<Record<PlanPreset, string>> = {
  review_and_annotate_translations: "Translation review and annotation",
  annotate_only: "Annotation only, no translation review",
};

/** Plan cells of a preset for the given languages; the source key is skipped (presets apply to translations only). */
export function presetChoices(preset: PlanPreset, languages: readonly string[]): PlanChoices {
  const cell: PlanChoices[string] = preset === "annotate_only"
    ? { review: "keep", annotate: "on", annotation_mode: "keep" }
    : { review: "on", annotate: "on", annotation_mode: "keep" };
  return Object.fromEntries(languages.filter(language => language !== SOURCE_KEY).map(language => [language, { ...cell }]));
}

/** Toast line after a quick action: "Plan saved for 20 cases, de: translation review and annotation". */
export function savedSummary(caseCount: number, choices: PlanChoices): string {
  const active = changedChoices(choices);
  const parts = Object.keys(active).sort(compareKeys).map(key => {
    const { review, annotate } = active[key];
    const on = review === "on" && annotate === "on" ? "translation review and annotation" : review === "on" ? "translation review" : annotate === "on" ? "annotate" : "";
    const off = [review === "off" && "translation review off", annotate === "off" && "annotate off"].filter(Boolean);
    return `${key}: ${[on, ...off].filter(Boolean).join(", ")}`;
  });
  return [`Plan saved for ${plural(caseCount, "case")}`, ...parts].join(", ");
}
