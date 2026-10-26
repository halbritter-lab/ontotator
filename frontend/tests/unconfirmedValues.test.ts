import { describe, expect, it } from "vitest";
import type { AnnotationSnapshot } from "../src/api/client";
import {
  UNCONFIRMED_REASONS, modifierWarningPairs, modifierWarnings, pairKey, rowPairs, sameSet, unconfirmedRows, valueCount,
  type UnconfirmedAxisDef, type UnconfirmedInput,
} from "../src/editor/unconfirmedValues";

const AXES: UnconfirmedAxisDef[] = [
  { id: "assertion", label: "Assertion", options: ["present", "absent"] },
  { id: "experiencer", label: "Experiencer", options: ["patient", "other"] },
  { id: "temporality", label: "Temporality", options: ["current", "past"] },
];
const snapshot = (id: string, values: Record<string, string | null>, defaulted: string[], layer = "phenotype"): AnnotationSnapshot => ({
  schema_version: "ontocurator-annotation/v3", version: "v1", document_id: "d", text_sha256: "t", ontology_sha256: "o", layer_config_sha256: "l",
  annotation: { annotation_id: id, document_id: "d", layer_id: layer, type_id: "default", term_id: `HP:${id}`,
    axes_values: values, axes_defaulted: defaulted, evidence_refs: [],
    provenance: { actor: { actor_id: "u", kind: "human" }, method: "manual" } },
  evidence: [],
} as unknown as AnnotationSnapshot);
const input = (snapshots: AnnotationSnapshot[], overrides: Partial<UnconfirmedInput> = {}): UnconfirmedInput => ({
  snapshots, axes: () => AXES, targetKeyOf: () => undefined, editableLayerIds: ["phenotype"],
  term: s => `Term ${s.annotation.annotation_id}`, quote: () => "quoted", evidenceId: () => "ev-1", ...overrides,
});
const allDefaults = { assertion: "present", experiencer: "patient", temporality: "current" };

describe("unconfirmedRows", () => {
  it("builds rows from empty and defaulted axes in type order and keeps snapshot order", () => {
    const rows = unconfirmedRows(input([
      snapshot("b", { ...allDefaults, temporality: null }, ["experiencer"]),
      snapshot("chosen", allDefaults, []),
      snapshot("a", allDefaults, ["temporality", "assertion", "experiencer"]),
    ]));
    expect(rows.map(row => row.annotationId)).toEqual(["b", "a"]);
    expect(rows[0].values.map(value => value.axisId)).toEqual(["experiencer", "temporality"]);
    expect(rows[1].values.map(value => value.axisId)).toEqual(["assertion", "experiencer", "temporality"]);
    expect(rows[1]).toEqual(expect.objectContaining({ term: "Term a", termId: "HP:a", quote: "quoted", listKey: "annotation:a", evidenceId: "ev-1",
      confirmableAxisIds: ["assertion", "experiencer", "temporality"], reason: null }));
    expect(rows[1].values.map(value => value.value)).toEqual(["present", "patient", "current"]);
    expect(rows[0].values.map(value => value.value)).toEqual(["patient", null]);
  });

  it("an empty-only row cannot be confirmed in one click", () => {
    const [row] = unconfirmedRows(input([snapshot("e", { assertion: "present", experiencer: "patient", temporality: "" }, [])]));
    expect(row.confirmableAxisIds).toEqual([]);
    expect(row.reason).toBe(UNCONFIRMED_REASONS.emptyOnly);
    expect(row.reason).toBe("Choose a value in the finding.");
  });

  it("a mixed row confirms only the defaulted non-empty axes", () => {
    const [row] = unconfirmedRows(input([snapshot("m", { assertion: "present", experiencer: null, temporality: "current" }, ["assertion", "experiencer"])]));
    expect(row.values.map(value => value.axisId)).toEqual(["assertion", "experiencer"]);
    expect(row.confirmableAxisIds).toEqual(["assertion"]);
    expect(row.reason).toBeNull();
  });

  it("a proposal keeps Go to only with its reason and the target key", () => {
    const [row] = unconfirmedRows(input([snapshot("p", allDefaults, ["assertion"])], { targetKeyOf: () => "target-key" }));
    expect(row.reason).toBe("Proposal values change only with Edit & Replace.");
    expect(row.confirmableAxisIds).toEqual([]);
    expect(row.targetKey).toBe("target-key");
    expect(row.listKey).toBe("target:target-key");
  });

  it("a finding on a layer outside the editable layers is read-only", () => {
    const [row] = unconfirmedRows(input([snapshot("r", allDefaults, ["assertion"], "disease")]));
    expect(row.reason).toBe("Read-only layer.");
    expect(row.confirmableAxisIds).toEqual([]);
  });

  it("a defaulted value no longer among the options is not confirmable", () => {
    const [row] = unconfirmedRows(input([snapshot("u", { ...allDefaults, temporality: "future" }, ["temporality"])]));
    expect(row.values.map(value => value.axisId)).toEqual(["temporality"]);
    expect(row.confirmableAxisIds).toEqual([]);
    expect(row.reason).toBe(UNCONFIRMED_REASONS.emptyOnly);
  });

  it("adds a server pair the client did not compute, creating the row if needed", () => {
    const rows = unconfirmedRows(input([snapshot("a", allDefaults, ["assertion"]), snapshot("b", allDefaults, [])], {
      serverPairs: [{ annotationId: "a", axis: "assertion" }, { annotationId: "a", axis: "custom" }, { annotationId: "b", axis: "temporality" }],
    }));
    expect(rows.map(row => row.annotationId)).toEqual(["a", "b"]);
    expect(rows[0].values.map(value => [value.axisId, value.axisLabel])).toEqual([["assertion", "Assertion"], ["custom", "custom"]]);
    expect(rows[0].confirmableAxisIds).toEqual(["assertion"]);
    expect(rows[1].values).toEqual([{ axisId: "temporality", axisLabel: "Temporality", value: "current", defaulted: false }]);
    expect(rows[1].confirmableAxisIds).toEqual([]);
    expect(rows[1].reason).toBe(UNCONFIRMED_REASONS.emptyOnly);
  });

  it("ignores server pairs of findings that are not listed", () => {
    expect(unconfirmedRows(input([snapshot("a", allDefaults, [])], { serverPairs: [{ annotationId: "gone", axis: "assertion" }] }))).toEqual([]);
  });
});

describe("rowPairs, sameSet and valueCount", () => {
  it("collects every (finding, axis) pair", () => {
    const rows = unconfirmedRows(input([
      snapshot("a", allDefaults, ["assertion", "experiencer"]),
      snapshot("b", { ...allDefaults, temporality: null }, []),
    ]));
    const pairs = rowPairs(rows);
    expect(pairs).toEqual(new Set([pairKey("a", "assertion"), pairKey("a", "experiencer"), pairKey("b", "temporality")]));
    expect(valueCount(rows)).toBe(3);
    expect(sameSet(pairs, new Set(pairs))).toBe(true);
    expect(sameSet(pairs, new Set([pairKey("a", "assertion")]))).toBe(false);
    expect(sameSet(new Set(["x"]), new Set(["y"]))).toBe(false);
    expect(sameSet(new Set(), new Set())).toBe(true);
  });
});

describe("modifierWarnings", () => {
  const INFO: Record<string, { label: string; role: "modifier" | "cohort"; exclusiveClass: "severity" | "onset" | null }> = {
    "HP:0012828": { label: "Severe", role: "modifier", exclusiveClass: "severity" },
    "HP:0012825": { label: "Mild", role: "modifier", exclusiveClass: "severity" },
    "HP:0040283": { label: "Frequent", role: "cohort", exclusiveClass: null },
    "HP:0031796": { label: "Recurrent", role: "modifier", exclusiveClass: null },
  };
  const info = (_snapshot: AnnotationSnapshot, termId: string) => INFO[termId];
  const withModifiers = (id: string, terms: string[]) => {
    const value = snapshot(id, {}, []);
    (value.annotation as { modifiers?: unknown }).modifiers = terms.map(term_id => ({ term_id }));
    return value;
  };

  it("mirrors the server: a cohort warning per Frequency modifier, then one per exclusive class with two", () => {
    const warnings = modifierWarnings([withModifiers("a", ["HP:0012828", "HP:0040283", "HP:0012825", "HP:0031796"]), withModifiers("b", ["HP:0012828"])], info);
    expect(warnings).toEqual([
      { annotationId: "a", kind: "cohort-modifier", key: "cohort:HP:0040283", labels: ["Frequent"] },
      { annotationId: "a", kind: "exclusive-modifiers", key: "exclusive:severity", labels: ["Mild", "Severe"], exclusiveClass: "severity" },
    ]);
    expect(modifierWarningPairs(warnings)).toEqual(new Set([pairKey("a", "cohort:HP:0040283"), pairKey("a", "exclusive:severity")]));
  });

  it("adds server pairs the client did not compute and ignores axis pairs", () => {
    const warnings = modifierWarnings([withModifiers("a", ["HP:0012828"])], info, [
      { annotationId: "a", axis: "assertion" }, { annotationId: "a", axis: "cohort:HP:0040283" }, { annotationId: "a", axis: "exclusive:onset" }]);
    expect(warnings).toEqual([
      { annotationId: "a", kind: "cohort-modifier", key: "cohort:HP:0040283", labels: ["Frequent"] },
      { annotationId: "a", kind: "exclusive-modifiers", key: "exclusive:onset", labels: [], exclusiveClass: "onset" },
    ]);
  });
});
