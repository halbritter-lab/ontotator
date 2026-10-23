import { assignedText, assignedTitle } from "../app/assignedDate";

/** The assignment date of a task ("assigned yesterday"); the full date and assigner on hover. */
export function AssignedDate({ at, by, now = new Date() }: { at: string | null | undefined; by?: string | null; now?: Date }): JSX.Element | null {
  return at ? <time dateTime={at} title={assignedTitle(new Date(at), by ?? null)}>{assignedText(new Date(at), now)}</time> : null;
}
