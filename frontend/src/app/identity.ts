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
