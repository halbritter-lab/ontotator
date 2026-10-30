// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AnnotationSnapshot, Draft } from "../src/api/client";
import { canRestore, captureDeletedFinding, modifierRestoreCommands, restoreCommands } from "../src/editor/restoreFinding";

const snap = (id: string, overrides: Partial<AnnotationSnapshot["annotation"]> = {}): AnnotationSnapshot => ({
  schema_version: "ontotator-annotation/v3", version: `${id}-v1`, document_id: "doc", text_sha256: "t", ontology_sha256: "o", layer_config_sha256: "l",
  evidence: [],
  annotation: {
    annotation_id: id, document_id: "doc", layer_id: "phenotype", type_id: "default", term_id: "HP:0001250",
    axes_values: { assertion: "present", temporality: "current" }, axes_defaulted: ["temporality"],
    evidence_refs: [{ evidence_id: "ev-1", version: "e1" }, { evidence_id: "ev-2", version: "e2" }],
    provenance: { actor: { actor_id: "ann", kind: "human" }, method: "manual", source_refs: [] },
    ...overrides,
  },
} as AnnotationSnapshot);
const draftOf = (annotation: AnnotationSnapshot, decisions: unknown[] = []): Draft => ({
  key: {} as Draft["key"], revision: 3, annotations: [annotation], decisions: decisions as never, checked_layer_ids: [],
  evidence: [
    { version: "e1", document_id: "doc", text_sha256: "t", mention: { evidence_id: "ev-1", segments: [{ start: 0, end: 4 }], cue_segments: [] } },
    { version: "e2", document_id: "doc", text_sha256: "t", mention: { evidence_id: "ev-2", segments: [{ start: 10, end: 14 }, { start: 20, end: 22 }], cue_segments: [] } },
  ] as never,
} as unknown as Draft);

describe("restore a deleted finding (#150)", () => {
  it("recreates the finding with its ID, mentions, chosen values and note", () => {
    const deleted = captureDeletedFinding(draftOf(snap("a", { note: "Seen twice" })), "a")!;
    expect(canRestore(deleted)).toBe(true);
    expect(restoreCommands(deleted, ["assertion", "temporality"], () => false)).toEqual([
      { command: "create_annotation", annotation_id: "a", layer_id: "phenotype", type_id: "default", term_id: "HP:0001250",
        axes_values: { assertion: "present", temporality: "current" }, chosen_axis_ids: ["assertion"],
        segments: [{ start: 0, end: 4 }], evidence_id: "ev-1", note: "Seen twice", method: "manual" },
      { command: "attach_mention", annotation_id: "a", evidence_id: "ev-2", segments: [{ start: 10, end: 14 }, { start: 20, end: 22 }] },
    ]);
  });

  it("adopts again from a known proposal, never from a carried round input, and keeps a tool's actor", () => {
    const copy = snap("copy", { evidence_refs: [], provenance: { actor: { actor_id: "nlp", kind: "tool" }, method: "llm", source_refs: ["round-input:r1", "prop:p-v1"] } });
    const deleted = captureDeletedFinding(draftOf(copy), "copy")!;
    const [create] = restoreCommands(deleted, ["assertion"], (id, version) => id === "prop" && version === "p-v1");
    expect(create).toEqual(expect.objectContaining({ segments: [], source_annotation_id: "prop", source_version: "p-v1", actor_kind: "tool", actor_id: "nlp", method: "llm" }));
    expect(create).not.toHaveProperty("evidence_id");
    const [carried] = restoreCommands(deleted, ["assertion"], () => false);
    expect(carried).not.toHaveProperty("source_annotation_id");
  });

  it("captures the replacement decisions the delete removes; a consolidation's cannot be restored", () => {
    const decision = { decision_id: "d", target: { annotation_id: "prop", version: "p-v1" }, outcome: "changed", replacement: { annotation_id: "a", version: "a-v1" }, reviewer_id: "ann" };
    const other = { ...decision, decision_id: "o", replacement: { annotation_id: "b", version: "b-v1" } };
    const deleted = captureDeletedFinding(draftOf(snap("a"), [decision, other]), "a")!;
    expect(deleted.decisions.map(item => item.decision_id)).toEqual(["d"]);
    expect(canRestore(deleted)).toBe(true);
    const consolidated = captureDeletedFinding(draftOf(snap("a"), [{ ...decision, consolidation: { group: "g" } }]), "a")!;
    expect(canRestore(consolidated)).toBe(false);
    expect(captureDeletedFinding(draftOf(snap("a")), "missing")).toBeNull();
  });

  it("reconciles the modifiers an adopted copy starts with", () => {
    const wanted = [{ term_id: "HP:sev", segments: [{ start: 1, end: 2 }] }, { term_id: "HP:onset" }];
    const current = [{ term_id: "HP:sev" }, { term_id: "HP:extra" }];
    expect(modifierRestoreCommands("a", wanted, current)).toEqual([
      { command: "remove_modifier", annotation_id: "a", term_id: "HP:extra" },
      { command: "set_modifier_segments", annotation_id: "a", term_id: "HP:sev", segments: [{ start: 1, end: 2 }] },
      { command: "add_modifier", annotation_id: "a", term_id: "HP:onset" },
    ]);
    expect(modifierRestoreCommands("a", wanted, wanted)).toEqual([]);
  });
});
