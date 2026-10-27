/** English copy of the consolidation view (acceptance fixes spec "WP-E Frontend", X12, X14, U14). */
import type { ConsolidationGroupView, ConsolidationPersonView, ConsolidationView } from "../api/client";
import type { PathSegment } from "../ui/StagePath";
import { dayMonth } from "../documents/textCard/cardModel";
import { personName } from "./lanes";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "Luc Martin, Ana Weber" (display names only). */
export function namesOf(people: readonly Pick<ConsolidationPersonView, "label">[]): string {
  return people.map(person => personName(person.label)).join(", ");
}

/** Header: "Consolidate case-107 de v2"; read-only "Consolidation of case-107 de v2". */
export function headerTitle(view: Pick<ConsolidationView, "case_id" | "language" | "document_version">, readOnly = false): string {
  return `${readOnly ? "Consolidation of" : "Consolidate"} ${view.case_id} ${view.language} v${view.document_version}`;
}

/** Finalization step on the text path, from the round and final state like the Documents table (X-8): accepted, then
 *  submitted (the lead accepts it), else the open groups. */
export function finalizationState(open: number, total: number, submitted: boolean, acceptedAt?: string | null, lead = false): Pick<PathSegment, "state" | "tone"> {
  if (acceptedAt) { const day = dayMonth(acceptedAt); return { state: day ? `accepted ${day}` : "accepted", tone: "done" }; }
  if (submitted) return lead ? { state: "ready to accept", tone: "now" } : { state: "submitted, waiting for the lead", tone: "later" };
  return { state: `consolidating, ${open} of ${total} groups open`, tone: "now" };
}

export const OVERLAPPING = "(overlapping, comes with the chosen finding)";

/** "2 fields to decide" / "1 field to decide"; "to decide" when nothing conflicts (Keep or Take). */
export const fieldsToDecide = (count: number) => count === 0 ? "to decide" : count === 1 ? "1 field to decide" : `${count} fields to decide`;

/** "Not in result" (M2 M-7f; was "Leave out"): the finding is not in the consolidated result. */
export const NOT_IN_RESULT = "not in result";

/** The state word of a group card: what is left to decide, or how it was resolved. */
export function groupStatus(group: Pick<ConsolidationGroupView, "state" | "attached_to">, conflicts: number): string {
  switch (group.state) {
    case "open": return fieldsToDecide(conflicts);
    case "auto": return "agreed";
    case "leave_out": return group.attached_to ? "attached" : NOT_IN_RESULT;
    default: return "decided";
  }
}

/** "Luc Martin, Ana Weber marked this. Tom Reis has nothing here." */
export function partialText(present: readonly ConsolidationPersonView[], absent: readonly ConsolidationPersonView[]): string {
  const missing = absent.length === 1 ? "has nothing here" : "have nothing here";
  return `${namesOf(present)} marked this. ${namesOf(absent)} ${missing}.`;
}

/** "Keep Luc Martin's finding" for one person, "Keep the finding" for several. */
export function keepLabel(present: readonly ConsolidationPersonView[]): string {
  return present.length === 1 ? `Keep ${personName(present[0].label)}'s finding` : "Keep the finding";
}

export const READ_ONLY_REASONS: Readonly<Record<string, string>> = {
  input_withdrawn: "A submission used here was withdrawn. The consolidation is read-only until the lead decides.",
  not_assigned: "This consolidation is no longer assigned to you. It is read-only.",
};

/** The read-only banner, by state: accepted, submitted (the lead accepts it; the consolidator waits), else the reason. */
export function readOnlyText(view: Pick<ConsolidationView, "read_only_reason" | "accepted_at" | "consolidator">, lead: boolean): string {
  if (view.accepted_at) { const day = dayMonth(view.accepted_at); return `Accepted by the lead${day ? ` on ${day}` : ""}. Read-only.`; }
  if (view.read_only_reason === "submitted") return lead
    ? `Submitted by ${view.consolidator ? personName(view.consolidator) : "the consolidator"}. Read-only; accept it in Documents.`
    : "Submitted. Waiting for the lead.";
  return READ_ONLY_REASONS[view.read_only_reason ?? ""] ?? "This consolidation is read-only.";
}

/** After submitting: a lead accepts their own consolidation in Documents. */
export function submittedText(lead: boolean): string {
  return lead ? "Consolidation submitted. Accept the result in Documents." : "Consolidation submitted. The lead then accepts the result.";
}

/** Heading of the findings added outside the groups. */
export function addedHeading(own: boolean, addedBy: string | null | undefined): string {
  if (own) return "Added by you";
  return addedBy ? `Added by ${personName(addedBy)}` : "Added findings";
}

/** A modifier term as a finding (S18): allowed, as some name a finding (Stillbirth); otherwise it is attached or left out. */
export function standaloneWarning(present: readonly ConsolidationPersonView[], term: string): string {
  return `${namesOf(present)} used the modifier term ${term} as a finding. Keep it only if it names the finding itself; otherwise attach it to a finding.`;
}

export const REOPEN_EDITED_WARNING = "Reopening drops your edit from the editor.";

/** Summary before submitting: "8 groups, 7 findings, 1 not in result"; findings added outside the groups count as findings. */
export function summaryText(groups: readonly ConsolidationGroupView[], added = 0): string {
  const findings = groups.filter(group => group.state !== "open" && group.state !== "leave_out").length + added;
  const leftOut = groups.filter(group => group.state === "leave_out").length;
  return `${plural(groups.length, "group", "groups")}, ${plural(findings, "finding", "findings")}, ${leftOut} ${NOT_IN_RESULT}`;
}

/** R-3: the open group's result repeats a term another group already keeps. */
export function duplicateTermHint(term: string, others: readonly string[]): string {
  return `${term} is already in the result (${others.map(quoted).join(", ")}). Keep adds a second ${term} finding.`;
}

/** R-3: terms the result holds more than once, in the submit summary. */
export function duplicatesText(terms: readonly string[]): string | null {
  return terms.length ? `More than one finding with the same term: ${terms.join(", ")}.` : null;
}

export const SUBMIT_LABEL = "Submit consolidation";

export function submitReason(open: number): string {
  return open === 1 ? "Resolve the open group first." : `Resolve the ${open} open groups first.`;
}

/** Axis row label: "assertion" → "Assertion". */
export function axisLabel(axis: string): string {
  const words = axis.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Quoted passage: “muskuläre Hypotonie”. */
export function quoted(text: string): string {
  return `“${text}”`;
}

/** "Severe “schwere”"; just "Recurrent" when the quote repeats the label, ignoring case. Spaces count: they tell
 *  variants that differ by segments only apart ("Severe “ schwere”"). */
export function labelWithQuote(label: string, quote: string | null): string {
  return quote && quote.toLowerCase() !== label.toLowerCase() ? `${label} ${quoted(quote)}` : label;
}
