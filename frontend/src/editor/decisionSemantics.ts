import type { AnnotationSnapshot, Draft } from "../api/client";

const identity = (ref: { annotation_id: string; version: string }) => JSON.stringify([ref.annotation_id, ref.version]);
const snapshotKey = (snapshot: AnnotationSnapshot) => identity({ annotation_id: snapshot.annotation.annotation_id, version: snapshot.version });

/** Results relevant to completion, including unresolved proposals before their export support lands. */
export function resultSnapshots(draft: Draft, proposals: AnnotationSnapshot[]): AnnotationSnapshot[] {
  const decisions = draft.decisions ?? [];
  const replacements = new Set(decisions.filter(d => d.outcome === "changed" && d.replacement).map(d => identity(d.replacement!)));
  const targets = new Set([
    ...proposals.map(p => `${p.annotation.annotation_id}:${p.version}`),
    ...decisions.map(d => `${d.target.annotation_id}:${d.target.version}`),
    ...(draft.targets?.targets ?? []).map(t => `${t.annotation_id}:${t.version}`),
  ]);
  const results = (draft.annotations ?? []).filter(s => replacements.has(snapshotKey(s)) ||
    !(s.annotation.provenance.source_refs ?? []).some(ref => targets.has(ref)));
  const byRef = new Map(proposals.map(s => [snapshotKey(s), s]));
  for (const decision of decisions) {
    if (decision.outcome === "confirmed" || decision.outcome === "uncertain") {
      const target = byRef.get(identity(decision.target));
      if (target) results.push(target);
    }
  }
  return unique(results);
}

function unique(snapshots: AnnotationSnapshot[]): AnnotationSnapshot[] {
  return [...new Map(snapshots.map(s => [snapshotKey(s), s])).values()];
}

/** Counts annotations rather than individual defaulted axes. */
export function defaultedResults(snapshots: AnnotationSnapshot[]): AnnotationSnapshot[] {
  return unique(snapshots.filter(s => (s.annotation.axes_defaulted ?? []).length > 0));
}
