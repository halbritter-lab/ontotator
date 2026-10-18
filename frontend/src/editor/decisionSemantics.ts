import type { AnnotationSnapshot, Draft } from "../api/client";

const identity = (ref: { annotation_id: string; version: string }) => JSON.stringify([ref.annotation_id, ref.version]);
const snapshotKey = (snapshot: AnnotationSnapshot) => identity({ annotation_id: snapshot.annotation.annotation_id, version: snapshot.version });

/** Results relevant to completion, including unresolved proposals with reviewer flags. */
export function resultSnapshots(draft: Draft, proposals: AnnotationSnapshot[]): AnnotationSnapshot[] {
  const annotations = draft.annotations ?? [];
  if (draft.key.mode !== "review") return unique(annotations);
  const decisions = draft.decisions ?? [];
  const activeTargets = draft.targets?.targets ?? [];
  const results = annotations.filter(s => {
    const sourceRefs = s.annotation.provenance.source_refs ?? [];
    const linkedTargets = activeTargets.filter(t => sourceRefs.includes(`${t.annotation_id}:${t.version}`));
    return linkedTargets.length === 0 || decisions.some(d =>
      d.outcome === "changed" && d.replacement && identity(d.replacement) === snapshotKey(s) &&
      linkedTargets.some(t => identity(t) === identity(d.target)));
  });
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
