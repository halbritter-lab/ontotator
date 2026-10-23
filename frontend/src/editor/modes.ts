/** Workspace modes in D2 words. `mode` is the server's workspace mode (`independent`, `review`, `proposal_check`). */

/** Modes with targets and decisions: consolidation (`review`) and annotation from proposals. */
export function isReviewLike(mode: string | null | undefined): boolean {
  return mode === "review" || mode === "proposal_check";
}

export function modeBadge(mode: string): { label: string; title?: string; className: string } {
  if (mode === "proposal_check") return { label: "Annotate from proposals", title: "You see the tool's proposals, never other people's work.", className: "badge-review" };
  if (mode === "review") return { label: "Consolidate", className: "badge-review" }; // consolidation rounds only (D1)
  return { label: "Annotate from scratch", title: "You see neither the tool's proposals nor other people's work.", className: "badge-independent" };
}

export function annotationTaskName(mode: "proposals" | "scratch" | null | undefined): string {
  return mode === "proposals" ? "Annotation, from proposals" : mode === "scratch" ? "Annotation, from scratch" : "Annotation";
}
