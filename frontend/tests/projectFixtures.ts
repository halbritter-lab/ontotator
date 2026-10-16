import type { CurrentUser, Member, OntologyInfo, ProjectSettings, TaskProfile } from "../src/api/client";
export const currentUser: CurrentUser = { username: "lead", display_name: "Lead", pseudonym: "ann-lead", is_system_admin: false, csrf_token: "token" };
export const profile: TaskProfile = {
  schema: "ontocurator-task-profile/v1", profile_id: "custom-profile", version: "1", default_layer_id: "findings",
  ontologies: [{ ontology_id: "HP", label: "HPO", release: "2026", sha256: "a".repeat(64), format: "obo-graph-json" }],
  layers: [{ layer_id: "findings", label: "Findings", ontology_id: "HP", access: "editable", default_visible: true, default_type_id: "phenotype", annotation_types: [
    { type_id: "phenotype", label: "Phenotype", evidence_policy: "optional", axes: [{ id: "assertion", label: "Assertion", options: ["absent", "present"], allow_empty: true }] },
    { type_id: "later", label: "Later type", evidence_policy: "optional", axes: [{ id: "certainty", label: "Certainty", options: ["certain", "uncertain"], allow_empty: true }] },
  ] }],
};
export const settings: ProjectSettings = { annotate_accepted_translations_only: true, project_key: "p/key", name: "Research", description: "Original", languages: ["de"], guideline_url: null, guideline_version: null, require_chosen_axes: false, adjudicator_not_annotator: false, contiguous_mentions_only: false, hidden_axis_values: {}, profile, locked: false, axis_defaults: { findings: { assertion: "present" } }, pins: [{ ontology_id: "HP", sha256: "a".repeat(64), allowed_roots: ["HP:1"], t1_profile: "hpo-phenotype", release: "2026" }] };
export const ontologies: OntologyInfo[] = [
  { ontology_id: "hp", release: "2026", sha256: "a".repeat(64), term_count: 3 },
  { ontology_id: "hp", release: "2027", sha256: "b".repeat(64), term_count: 4 },
  { ontology_id: "MONDO", release: "2026", sha256: "c".repeat(64), term_count: 4 },
];
export const members: Member[] = [
  { username: "alice", display_name: "Alice", pseudonym: "ann-1", languages: ["de"], roles: ["annotator"] },
  { username: "lead", display_name: "Lead", pseudonym: "ann-2", languages: ["en"], roles: ["lead"] },
];
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
