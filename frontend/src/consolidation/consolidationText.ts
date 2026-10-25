/** English copy of the consolidation view (acceptance fixes spec "WP-E Frontend", X12, X14, U14). */
import type { ConsolidationGroupView, ConsolidationPersonView, ConsolidationView } from "../api/client";
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

/** Finalization state on the text path. */
export const finalizationState = (open: number, total: number) => `consolidating, ${open} of ${total} groups open`;

export const OVERLAPPING = "(overlapping, comes with the chosen finding)";

/** "2 fields to decide" / "1 field to decide"; "to decide" when nothing conflicts (Keep or Take). */
export const fieldsToDecide = (count: number) => count === 0 ? "to decide" : count === 1 ? "1 field to decide" : `${count} fields to decide`;

/** The state word of a group card: what is left to decide, or how it was resolved. */
export function groupStatus(group: Pick<ConsolidationGroupView, "state" | "attached_to">, conflicts: number): string {
  switch (group.state) {
    case "open": return fieldsToDecide(conflicts);
    case "auto": return "agreed";
    case "leave_out": return group.attached_to ? "attached" : "left out";
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
  submitted: "This consolidation was submitted. You see its final state.",
  input_withdrawn: "A submission used here was withdrawn. The consolidation is read-only until the lead decides.",
  not_assigned: "This consolidation is no longer assigned to you. It is read-only.",
};

/** After submitting: a lead accepts their own consolidation in Documents. */
export function submittedText(lead: boolean): string {
  return lead ? "Consolidation submitted. Accept the result in Documents." : "Consolidation submitted. The lead then accepts the result.";
}

/** Heading of the findings added outside the groups. */
export function addedHeading(own: boolean, addedBy: string | null | undefined): string {
  if (own) return "Added by you";
  return addedBy ? `Added by ${personName(addedBy)}` : "Added findings";
}

/** A standalone modifier finding (S18): "Ana Weber marked a modifier as a finding. Severe can only describe another finding." */
export function standaloneWarning(present: readonly ConsolidationPersonView[], term: string): string {
  return `${namesOf(present)} marked a modifier as a finding. ${term} can only describe another finding.`;
}

export const standaloneResult = (modifier: string) =>
  `Result: no finding of its own. ${modifier} goes to the finding you attach it to, or is left out.`;

export const NO_ATTACH_TARGET = "No resolved finding in this sentence yet.";

export const REOPEN_EDITED_WARNING = "Reopening drops your edit from the editor.";

/** Summary before submitting: "8 groups, 7 findings, 1 left out"; findings added outside the groups count as findings. */
export function summaryText(groups: readonly ConsolidationGroupView[], added = 0): string {
  const findings = groups.filter(group => group.state !== "open" && group.state !== "leave_out").length + added;
  const leftOut = groups.filter(group => group.state === "leave_out").length;
  return `${plural(groups.length, "group", "groups")}, ${plural(findings, "finding", "findings")}, ${leftOut} left out`;
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
