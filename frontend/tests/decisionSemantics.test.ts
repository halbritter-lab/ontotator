import { describe, expect, it } from "vitest";
import type { AnnotationSnapshot, Draft } from "../src/api/client";
import { defaultedResults, resultSnapshots } from "../src/editor/decisionSemantics";

const snap = (id: string, version = "v1", defaults: string[] = []): AnnotationSnapshot => ({
  schema_version: "ontocurator-annotation/v3", ontology_sha256: "ontology", layer_config_sha256: "layer",
  annotation: { document_id: "doc", annotation_id: id, layer_id: "hidden", type_id: "finding", term_id: "HP:0001252",
    axes_values: {}, axes_defaulted: defaults, evidence_refs: [],
    provenance: { actor: { actor_id: "curator", kind: "human" }, method: "manual", source_refs: [] } },
  version, evidence: [], document_id: "doc", text_sha256: "text", task_profile_sha256: "profile",
} as AnnotationSnapshot);
const ref = (s: AnnotationSnapshot) => ({ annotation_id: s.annotation.annotation_id, version: s.version });

describe("result selection", () => {
  it("selects authored, exact confirmed, changed and uncertain results once, including hidden layers", () => {
    const confirmed = snap("confirmed"); const older = snap("confirmed", "older");
    const rejected = snap("rejected"); const uncertain = snap("uncertain"); const pending = snap("pending");
    const changed = snap("changed"); const replacement = snap("replacement"); const authored = snap("authored");
    const abandoned = snap("abandoned"); abandoned.annotation.provenance.source_refs = ["pending:v1"];
    const draft = { annotations: [authored, replacement, abandoned, authored], decisions: [
      { target: ref(confirmed), outcome: "confirmed" }, { target: ref(rejected), outcome: "rejected" },
      { target: ref(uncertain), outcome: "uncertain" },
      { target: ref(changed), outcome: "changed", replacement: ref(replacement) },
    ] } as Draft;
    expect(resultSnapshots(draft, [older, confirmed, rejected, uncertain, pending, changed, confirmed]).map(ref))
      .toEqual([ref(authored), ref(replacement), ref(confirmed), ref(uncertain)]);
  });
  it("never substitutes another version for a missing exact replacement", () => {
    const current = snap("copy", "new"); current.annotation.provenance.source_refs = ["target:v1"];
    const draft = { annotations: [current], decisions: [{ target: { annotation_id: "target", version: "v1" },
      outcome: "changed", replacement: { annotation_id: "copy", version: "old" } }] } as Draft;
    expect(resultSnapshots(draft, [])).toEqual([]);
  });
  it("counts three defaulted axes on one exact annotation as one result", () => {
    const a = snap("one", "v1", ["assertion", "temporality", "experiencer"]);
    expect(defaultedResults([a, a, snap("two"), snap("one", "v2", ["assertion"])])).toEqual([a, snap("one", "v2", ["assertion"])]);
  });
});
