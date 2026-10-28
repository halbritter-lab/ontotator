import type { CurrentUser, GuidelineDocument, GuidelineListing, GuidelineSummary, Member, OntologyInfo, ProjectSettings, RepinReport, TaskProfile } from "../src/api/client";
export const currentUser: CurrentUser = { username: "lead", display_name: "Lead", pseudonym: "ann-lead", is_system_admin: false, csrf_token: "token" };
export const profile: TaskProfile = {
  schema: "ontotator-task-profile/v1", profile_id: "custom-profile", version: "1", default_layer_id: "findings",
  ontologies: [{ ontology_id: "HP", label: "HPO", release: "2026", sha256: "a".repeat(64), format: "obo-graph-json" }],
  layers: [{ layer_id: "findings", label: "Findings", ontology_id: "HP", access: "editable", default_visible: true, default_type_id: "phenotype", annotation_types: [
    { type_id: "phenotype", label: "Phenotype", evidence_policy: "optional", axes: [{ id: "assertion", label: "Assertion", options: ["absent", "present"], allow_empty: true }] },
    { type_id: "later", label: "Later type", evidence_policy: "optional", axes: [{ id: "certainty", label: "Certainty", options: ["certain", "uncertain"], allow_empty: true }] },
  ] }],
};
export const settings: ProjectSettings = { annotation_policy_revision: 1, allow_spanless_findings: true, require_spanless_note: true, annotate_accepted_translations_only: true, project_key: "p/key", name: "Research", description: "Original", languages: ["de"], require_chosen_axes: false, adjudicator_not_annotator: false, contiguous_mentions_only: false, hidden_axis_values: {}, profile, locked: false, annotations_per_text: 1, import_plan: "review_and_annotate_translations", axis_defaults: { findings: { assertion: "present" } }, pins: [{ ontology_id: "HP", sha256: "a".repeat(64), allowed_roots: ["HP:1"], t1_profile: "hpo-phenotype", release: "2026" }] };
export const ontologies: OntologyInfo[] = [
  { ontology_id: "hp", release: "2026", sha256: "a".repeat(64), term_count: 3 },
  { ontology_id: "hp", release: "2027", sha256: "b".repeat(64), term_count: 4 },
  { ontology_id: "MONDO", release: "2026", sha256: "c".repeat(64), term_count: 4 },
];
export const members: Member[] = [
  { username: "alice", display_name: "Alice", pseudonym: "ann-1", languages: ["de"], roles: ["annotator"] },
  { username: "lead", display_name: "Lead", pseudonym: "ann-2", languages: ["en"], roles: ["lead"] },
];
/** A dry run of a release move (#81); by default one that touches no draft. */
export function repinReport(overrides: Partial<RepinReport> = {}): RepinReport {
  return {
    project_key: settings.project_key, locked: false, report_sha256: "f".repeat(64),
    changes: [{ ontology_id: "HP", from_sha256: "a".repeat(64), from_release: "2026", to_sha256: "b".repeat(64), to_release: "2027" }],
    rewrites: [], flagged: [], submitted: [], ...overrides,
  };
}
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

/** Guideline fixtures: dates fall in the current year so labels carry no year ("20 Oct, 14:02"). */
export const GUIDELINE_YEAR = new Date().getFullYear();
export const guidelineLead = { pseudonym: "ann-0002", display_name: "Jana Popp", is_me: false };
export function guidelineSummary(version: number, overrides: Partial<GuidelineSummary> = {}): GuidelineSummary {
  return {
    version, kind: "markdown", filename: `guide-v${version}.md`, size_bytes: 18 * 1024, sha256: String(version).repeat(64).slice(0, 64),
    change_note: `Change ${version}`, created_at: `${GUIDELINE_YEAR}-10-${String(10 + version).padStart(2, "0")}T14:02:00`, created_by: guidelineLead,
    withdrawn: null, reach: { notified: 1, opened: 4, members: 6 }, not_seen: null, ...overrides,
  };
}
/** A withdrawn summary as the server sends it: no file name, no change note. */
export function withdrawnGuideline(version: number, reason: string | null = null, overrides: Partial<GuidelineSummary> = {}): GuidelineSummary {
  return guidelineSummary(version, { filename: null, change_note: null, reach: null, withdrawn: { at: `${GUIDELINE_YEAR}-10-21T09:30:00`, by: guidelineLead, reason }, ...overrides });
}
/** Versions newest first; the current version is the newest unless it is withdrawn. */
export function guidelineListing(versions: GuidelineSummary[], overrides: Partial<GuidelineListing> = {}): GuidelineListing {
  const newest = versions[0];
  return { current: newest && !newest.withdrawn ? newest : null, latest_version: newest?.version ?? null, versions, my_latest_seen: null, ...overrides };
}
export function guidelineDocument(summary: GuidelineSummary, body: string | null = summary.withdrawn ? null : `# Guide v${summary.version}\n\nAnnotate negations.`): GuidelineDocument {
  return { ...summary, body };
}
