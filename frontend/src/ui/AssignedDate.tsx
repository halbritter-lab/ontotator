import { assignedText, assignedTitle } from "../app/assignedDate";

/** The assignment date of a task ("assigned yesterday", `capitalized`: "Assigned yesterday"); the full date and assigner on hover. */
export function AssignedDate({ at, by, now = new Date(), capitalized = false }: { at: string | null | undefined; by?: string | null; now?: Date; capitalized?: boolean }): JSX.Element | null {
  if (!at) return null;
  const text = assignedText(new Date(at), now);
  return <time dateTime={at} title={assignedTitle(new Date(at), by ?? null)}>{capitalized ? text.charAt(0).toUpperCase() + text.slice(1) : text}</time>;
}
