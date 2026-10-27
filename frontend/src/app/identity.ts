/**
 * Shared formatters for people and texts (spec "Identity (D1)" and "Text label").
 *
 * People: "Display name (ann-0004)", own items "Display name (ann-0002, you)";
 * without a display name (other people for non-lead callers, former members)
 * the pseudonym alone. The username is never part of these labels.
 *
 * Texts: "{case ID} {language}", with a version only where it matters.
 */

export interface PersonRef {
  pseudonym: string;
  display_name?: string | null;
  is_me?: boolean;
}

const DEFAULT_PERSON_FALLBACK = "—";

export function personLabel(person: PersonRef | null | undefined, options?: { fallback?: string }): string {
  if (!person) return options?.fallback ?? DEFAULT_PERSON_FALLBACK;
  const name = person.display_name?.trim();
  if (!name) return person.pseudonym;
  return person.is_me ? `${name} (${person.pseudonym}, you)` : `${name} (${person.pseudonym})`;
}

export function textLabel(
  text: { case_id: string; language: string; version?: number | null },
  options?: { withVersion?: boolean },
): string {
  const base = `${text.case_id} ${text.language}`;
  if (options?.withVersion && text.version != null) return `${base} v${text.version}`;
  return base;
}

/**
 * The one name of a task's text in headings, lists and the case select (R-11): "{case ID} {language}", from v2 on
 * with the version and "corrected" for a correction ("case-7 de v2 corrected"); never the internal document ID
 * unless nothing else is known.
 */
export function taskText(task: { case_id?: string | null; external_id?: string | null; document_id: string; language: string; version?: number | null; origin?: string | null }): string {
  const version = task.version ?? 1;
  const name = textLabel({ case_id: task.case_id ?? task.external_id ?? task.document_id, language: task.language, version }, { withVersion: version > 1 });
  return version > 1 && task.origin === "correction" ? `${name} corrected` : name;
}
