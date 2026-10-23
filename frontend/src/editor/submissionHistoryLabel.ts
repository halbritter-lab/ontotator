/** Labels follow the existing displayed history order; IDs stay in technical details. */
export function submissionHistoryLabel(createdAt: string, ordinal: number): string {
  const date = new Date(createdAt);
  const timestamp = Number.isNaN(date.getTime()) ? "Date unavailable"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
  return `Submission ${ordinal}, ${timestamp}`;
}
