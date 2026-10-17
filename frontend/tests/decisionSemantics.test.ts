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

const draftOf = (mode: Draft["key"]["mode"], annotations: AnnotationSnapshot[],
  targets: Draft["targets"]["targets"] = [], decisions: NonNullable<Draft["decisions"]> = []): Draft => ({
  key: { project_key: "project", document_id: "doc", annotator_id: "curator", mode,
    scope_id: "scope", target_set_id: "targets" },
  targets: { target_set_id: "targets", targets }, revision: 0, annotations, decisions, evidence: [],
});

describe("result selection", () => {
  it("selects authored, exact confirmed, changed and uncertain results once, including hidden layers", () => {
    const confirmed = snap("confirmed"); const older = snap("confirmed", "older");
    const rejected = snap("rejected"); const uncertain = snap("uncertain"); const pending = snap("pending");
    const changed = snap("changed"); const replacement = snap("replacement"); const authored = snap("authored");
    const abandoned = snap("abandoned"); abandoned.annotation.provenance.source_refs = ["pending:v1"];
    const draft = draftOf("review", [authored, replacement, abandoned, authored],
      [ref(confirmed), ref(rejected), ref(uncertain), ref(changed), ref(pending)], [
        { decision_id: "confirm", reviewer_id: "curator", target: ref(confirmed), outcome: "confirmed" },
        { decision_id: "reject", reviewer_id: "curator", target: ref(rejected), outcome: "rejected" },
        { decision_id: "uncertain", reviewer_id: "curator", target: ref(uncertain), outcome: "uncertain" },
        { decision_id: "change", reviewer_id: "curator", target: ref(changed), outcome: "changed", replacement: ref(replacement) },
      ]);
    expect(resultSnapshots(draft, [older, confirmed, rejected, uncertain, pending, changed, confirmed]).map(ref))
      .toEqual([ref(authored), ref(replacement), ref(confirmed), ref(uncertain)]);
  });
  it("never substitutes another version for a missing exact replacement", () => {
    const current = snap("copy", "new"); current.annotation.provenance.source_refs = ["target:v1"];
    const target = { annotation_id: "target", version: "v1" };
    const draft = draftOf("review", [current], [target], [{ decision_id: "change", reviewer_id: "curator",
      target, outcome: "changed", replacement: { annotation_id: "copy", version: "old" } }]);
    expect(resultSnapshots(draft, [])).toEqual([]);
  });
  it.each(["independent", "assisted", "review"] as const)(
    "keeps a defaulted copy from a non-target proposal in %s results", (mode) => {
      const source = snap("non-target", "p1");
      const copy = snap("copy", "v1", ["assertion"]);
      copy.annotation.provenance.source_refs = ["non-target:p1"];
      const draft = draftOf(mode, [copy]);
      const results = resultSnapshots(draft, [source]);
      expect(results).toEqual([copy]);
      expect(defaultedResults(results)).toEqual([copy]);
    });

  it.each(["independent", "assisted"] as const)(
    "only excludes active-target adoption copies in review mode, retaining %s authored results", (mode) => {
      const source = snap("source", "p1");
      const copy = snap("copy", "v1", ["assertion"]);
      copy.annotation.provenance.source_refs = ["source:p1"];
      const draft = draftOf(mode, [copy], [ref(source)]);
      expect(resultSnapshots(draft, [source])).toEqual([copy]);
    });

  it("counts three defaulted axes on one exact annotation as one result", () => {
    const a = snap("one", "v1", ["assertion", "temporality", "experiencer"]);
    expect(defaultedResults([a, a, snap("two"), snap("one", "v2", ["assertion"])])).toEqual([a, snap("one", "v2", ["assertion"])]);
  });
});
