/** English copy of the consolidation view (acceptance fixes spec "WP-E Frontend", X12, X14, U14). */
import type { ConsolidationGroupView, ConsolidationPersonView, ConsolidationView } from "../api/client";
import { personName } from "./lanes";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "Luc Martin, Ana Weber" (display names only). */
export function namesOf(people: readonly Pick<ConsolidationPersonView, "label">[]): string {
  return people.map(person => personName(person.label)).join(", ");
}

/** Header: "Consolidate case-107 · de v2 · Luc Martin, Tom Reis · 4 open". */
export function headerTitle(view: Pick<ConsolidationView, "case_id" | "language" | "document_version">): string {
  return `Consolidate ${view.case_id} · ${view.language} v${view.document_version}`;
}

export function headerDetail(view: Pick<ConsolidationView, "people">, open: number): string {
  const names = namesOf(view.people);
  return [names, open > 0 ? `${open} open` : "all groups decided"].filter(Boolean).join(" · ");
}

/** Banner of the automatic take-over (U14). */
export function autoBanner(count: number): string {
  return count === 1
    ? "1 finding matched and was kept automatically. Check it in the text."
    : `${count} findings matched and were kept automatically. Check them in the text.`;
}

export const KIND_LABELS: Readonly<Record<string, string>> = {
  match: "matched",
  values_differ: "value differs",
  span_differs: "text span differs",
  notes_differ: "note differs",
  term_differs: "term differs",
  partial: "marked by some",
};

/** "Luc Martin, Ana Weber marked this · Tom Reis has nothing here". */
export function partialText(present: readonly ConsolidationPersonView[], absent: readonly ConsolidationPersonView[]): string {
  const missing = absent.length === 1 ? "has nothing here" : "have nothing here";
  return `${namesOf(present)} marked this · ${namesOf(absent)} ${missing}`;
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

export const REOPEN_EDITED_WARNING = "Reopening drops your edit from the editor.";

/** Number of findings a resolved group yields. */
function findingsOf(group: ConsolidationGroupView): number {
  if (group.state === "leave_out" || group.state === "open") return 0;
  if (group.state === "keep_both") return Math.max(2, group.annotation_ids.length);
  return Math.max(1, group.annotation_ids.length);
}

/**
 * Summary before submitting (X12): "8 decisions → 7 findings: 4 kept automatically (all matched) · 2 decided ·
 * 1 kept from Luc Martin · 1 left out · 1 note · 1 flagged". Zero parts are left out.
 */
export function summaryText(groups: readonly ConsolidationGroupView[], people: readonly ConsolidationPersonView[]): string {
  const decided = groups.filter(group => group.state !== "open");
  const findings = decided.reduce((sum, group) => sum + findingsOf(group), 0);
  const auto = decided.filter(group => group.state === "auto").length;
  const keptFrom = new Map<string, number>();
  let chosen = 0;
  for (const group of decided) {
    if (group.state === "auto" || group.state === "leave_out") continue;
    if (group.state === "keep" && group.kinds.includes("partial")) {
      const keep = group.members.find(member => member.input_id === group.keep_input_id) ?? group.members[0];
      const person = people.find(value => value.person_id === keep?.person_id);
      const name = person ? personName(person.label) : keep?.person_id ?? "";
      keptFrom.set(name, (keptFrom.get(name) ?? 0) + 1);
    } else chosen += 1;
  }
  const leftOut = decided.filter(group => group.state === "leave_out").length;
  const notes = decided.filter(group => !!group.note?.trim()).length;
  const flagged = decided.filter(group => group.guidelines_unclear).length;
  const parts = [
    auto ? `${auto} kept automatically (all matched)` : "",
    chosen ? `${chosen} decided` : "",
    ...[...keptFrom].map(([name, count]) => `${count} kept from ${name}`),
    leftOut ? `${leftOut} left out` : "",
    notes ? plural(notes, "note", "notes") : "",
    flagged ? `${flagged} flagged` : "",
  ].filter(Boolean);
  const head = `${plural(decided.length, "decision", "decisions")} → ${plural(findings, "finding", "findings")}`;
  return parts.length ? `${head}: ${parts.join(" · ")}` : head;
}

/** Submit button while groups are open (X12). */
export function submitLabel(open: number): string {
  return open > 0 ? `Submit · ${open} open` : "Submit consolidation";
}

export function submitReason(open: number): string {
  return open === 1 ? "Resolve the open group first." : `Resolve the ${open} open groups first.`;
}

/** A spoken value: "clinically_suspected" → "clinically suspected". */
export function valueWords(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "not specified";
  return value.replace(/_/g, " ");
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
