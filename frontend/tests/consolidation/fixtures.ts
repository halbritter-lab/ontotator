/** The spec's 8-group example (4 match, 1 value, 1 span, 1 partial, 1 term) for the consolidation view tests. */
import type { ConsolidationGroupView, ConsolidationMemberView, ConsolidationPersonView, ConsolidationView } from "../../src/api/client";
import type { WorkspaceView } from "../../src/app/CaseScreen";

export const TEXT = "The patient had two seizures last week. No muscular hypotonia. Delayed development since age two. "
  + "Head circumference below the 3rd percentile. Unsteady gait. Normal hearing. Short stature. Recurrent fever.";

export function span(words: string, occurrence = 0): [number, number] {
  let index = -1;
  for (let n = 0; n <= occurrence; n++) index = TEXT.indexOf(words, index + 1);
  if (index < 0) throw new Error(`"${words}" not in the text`);
  return [index, index + words.length];
}

export const LUC: ConsolidationPersonView = { person_id: "ann-0004", label: "Luc Martin (ann-0004)", lane: 1 };
export const TOM: ConsolidationPersonView = { person_id: "ann-0007", label: "Tom Reis (ann-0007)", lane: 2 };
export const ANA: ConsolidationPersonView = { person_id: "ann-0005", label: "Ana Weber (ann-0005)", lane: 3 };

const AXES = { assertion: "present", experiencer: "patient", temporality: "current" };

export function member(inputId: string, person: ConsolidationPersonView, termId: string, termLabel: string, spans: [number, number][],
  extra: Partial<ConsolidationMemberView> = {}): ConsolidationMemberView {
  return {
    input_id: inputId, person_id: person.person_id, annotation_id: `a-${inputId}`, term_id: termId, term_label: termLabel,
    layer_id: "phenotype", type_id: "default", axes: { ...AXES }, spans, cues: [], note: null, from_tool_proposal: false, modifiers: [], ...extra,
  };
}

export function group(groupId: string, kinds: string[], members: ConsolidationMemberView[], extra: Partial<ConsolidationGroupView> = {}): ConsolidationGroupView {
  return {
    group_id: groupId, kinds, differing_axes: [], majority: {}, span_conflict: false, keep_input_id: members[0].input_id,
    start: members[0].spans[0]?.[0] ?? null, members, state: kinds.includes("match") ? "auto" : "open", edited: false,
    note: null, guidelines_unclear: false, annotation_ids: kinds.includes("match") ? [`cons-${groupId}`] : [], ...extra,
  };
}

const matched = (groupId: string, termId: string, label: string, words: string) =>
  group(groupId, ["match"], [member(`${groupId}-l`, LUC, termId, label, [span(words)]), member(`${groupId}-t`, TOM, termId, label, [span(words)])]);

/** The mockup's three-person group (variant B): Tom and Mia mark Hypotonia, Ali Axial hypotonia; Mia says absent. */
export const MIA: ConsolidationPersonView = { person_id: "ann-0008", label: "Mia Berg (ann-0008)", lane: 3 };
export const ALI: ConsolidationPersonView = { person_id: "ann-0009", label: "Ali Kaya (ann-0009)", lane: 4 };
export const THREE = [{ ...TOM, lane: 1 }, { ...MIA, lane: 2 }, { ...ALI, lane: 3 }];


export function hypotoniaThree(extra: Partial<ConsolidationGroupView> = {},
  memberExtra: Partial<Record<"tom" | "mia" | "ali", Partial<ConsolidationMemberView>>> = {}): ConsolidationGroupView {
  return group("g-three", ["term_differs", "values_differ"], [
    member("in-tom", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], memberExtra.tom),
    member("in-mia", MIA, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { axes: { ...AXES, assertion: "absent" }, ...memberExtra.mia }),
    member("in-ali", ALI, "HP:0008936", "Axial hypotonia", [span("muscular hypotonia")], memberExtra.ali),
  ], { differing_axes: ["assertion"], ...extra });
}

export function exampleGroups(): ConsolidationGroupView[] {
  return [
    matched("g-seiz", "HP:0001250", "Seizure", "seizures"),
    group("g-hypo", ["values_differ"], [
      member("in-hl", LUC, "HP:0001252", "Hypotonia", [span("muscular hypotonia")]),
      member("in-ht", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { axes: { ...AXES, assertion: "absent" } }),
    ], { differing_axes: ["assertion"] }),
    group("g-dd", ["span_differs"], [
      member("in-dl", LUC, "HP:0001263", "Global developmental delay", [span("Delayed development")]),
      member("in-dt", TOM, "HP:0001263", "Global developmental delay", [span("development")]),
    ]),
    group("g-micro", ["partial"], [member("in-ml", LUC, "HP:0000252", "Microcephaly", [span("below the 3rd percentile")])]),
    group("g-gait", ["term_differs"], [
      member("in-gl", LUC, "HP:0001251", "Ataxia", [span("Unsteady gait")]),
      member("in-gt", TOM, "HP:0001288", "Gait disturbance", [span("Unsteady gait")]),
    ]),
    matched("g-hear", "HP:0000365", "Hearing impairment", "Normal hearing"),
    matched("g-short", "HP:0004322", "Short stature", "Short stature"),
    matched("g-fever", "HP:0001954", "Recurrent fever", "Recurrent fever"),
  ];
}

export function exampleView(extra: Partial<ConsolidationView> = {}): ConsolidationView {
  return {
    round_id: "round-c", workspace_id: "ws-c", read_only: false, read_only_reason: null, case_id: "case-107", language: "de",
    document_version: 2, document_id: "doc-1", text: TEXT, people: [LUC, TOM], groups: exampleGroups(), added: [], added_by: null,
    workflow_revision: 5, draft_revision: 3, modifier_layer_ids: [], ...extra,
  };
}

/** The view with every open group decided as in the spec's summary example. */
export function decidedView(): ConsolidationView {
  const view = exampleView();
  const states: Record<string, Partial<ConsolidationGroupView>> = {
    "g-hypo": { state: "choose", note: "Negated in the text.", annotation_ids: ["cons-1"] },
    "g-dd": { state: "choose", guidelines_unclear: true, annotation_ids: ["cons-2"] },
    "g-micro": { state: "keep", annotation_ids: ["cons-3"] },
    "g-gait": { state: "leave_out" },
  };
  return { ...view, groups: view.groups.map(value => ({ ...value, ...states[value.group_id] })) };
}

export function withGroup(view: ConsolidationView, groupId: string, change: Partial<ConsolidationGroupView>): ConsolidationView {
  return { ...view, draft_revision: view.draft_revision + 1, groups: view.groups.map(value => value.group_id === groupId ? { ...value, ...change } : value) };
}

export function draft(revision: number, annotations: unknown[] = []) {
  return { key: workspaceKey, targets: { target_set_id: "t", targets: [] }, revision, annotations, evidence: [], decisions: [] } as never;
}

const workspaceKey = { project_key: "pkg-1", document_id: "doc-1", annotator_id: "ann-0009", mode: "review" as const, scope_id: "scope-default", target_set_id: "targets-c", round_id: "round-c" };

export const AXIS_DEFS = [
  { id: "assertion", label: "Assertion", options: ["present", "absent", "uncertain"], allow_empty: true },
  { id: "experiencer", label: "Experiencer", options: ["patient", "family_member"], allow_empty: true },
  { id: "temporality", label: "Temporality", options: ["current", "historical"], allow_empty: true },
];

export function workspaceView(): WorkspaceView {
  return {
    key: workspaceKey,
    document: { document_id: "doc-1", text: TEXT, language: "de", text_sha256: "text" },
    scope: { scope_id: "scope-default", mode: "review", editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
    layers: [{ layer_id: "phenotype", label: "Phenotype", ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "default",
      annotation_types: [{ type_id: "default", label: "Phenotype", evidence_policy: "optional", axes: AXIS_DEFS }] }],
    creation_defaults: { phenotype: { default: { assertion: "present", experiencer: "patient", temporality: "current" } } },
    draft: draft(3),
  } as unknown as WorkspaceView;
}

/** `window.matchMedia` answering width and reduced-motion queries. */
export function mockViewport(width: number, reducedMotion = false): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true, writable: true,
    value: (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query), max = /max-width:\s*(\d+)px/.exec(query);
      const matches = query.includes("prefers-reduced-motion") ? reducedMotion
        : min ? width >= Number(min[1]) : max ? width <= Number(max[1]) : false;
      return { matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false };
    },
  });
}

export function resetViewport(): void {
  delete (window as { matchMedia?: unknown }).matchMedia;
}

// Modifier scenarios (finding-modifiers spec, "Consolidation scenarios"): A = Ana Weber, B = Ben Roth, C = Cem Arslan.
export const MOD_TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie. Kein Fieber.";
/** Code point range of `words` in MOD_TEXT. */
export function modSpan(words: string): [number, number] {
  const index = MOD_TEXT.indexOf(words);
  if (index < 0) throw new Error(`"${words}" not in the text`);
  const start = Array.from(MOD_TEXT.slice(0, index)).length;
  return [start, start + Array.from(words).length];
}
export const BEN: ConsolidationPersonView = { person_id: "ann-0010", label: "Ben Roth (ann-0010)", lane: 2 };
export const CEM: ConsolidationPersonView = { person_id: "ann-0011", label: "Cem Arslan (ann-0011)", lane: 3 };
export const CHRIS: ConsolidationPersonView = { person_id: "ann-0012", label: "Chris Lee (ann-0012)", lane: 3 };
export const MOD_PEOPLE = [{ ...ANA, lane: 1 }, BEN, CEM];

type Modifier = ConsolidationMemberView["modifiers"][number];
const modifier = (term_id: string, term_label: string, extra: Partial<Modifier>, words?: string): Modifier =>
  ({ term_id, term_label, kind: "modifier", exclusive_class: null, segments: words ? [modSpan(words)] : [], ...extra });
export const severe = (words?: string) => modifier("HP:0012828", "Severe", { exclusive_class: "severity" }, words);
export const mild = (words?: string) => modifier("HP:0012825", "Mild", { exclusive_class: "severity" }, words);
export const recurrent = (words?: string) => modifier("HP:0031796", "Recurrent", {}, words);
export const frequent = (words?: string) => modifier("HP:0040282", "Frequent", { kind: "cohort" }, words);

/** Seizure on "Krampfanfälle", one member per person with the given modifiers. */
export function seizure(groupId: string, kinds: string[], sets: [ConsolidationPersonView, Modifier[], Partial<ConsolidationMemberView>?][],
  extra: Partial<ConsolidationGroupView> = {}): ConsolidationGroupView {
  return group(groupId, kinds, sets.map(([person, modifiers, more], index) =>
    member(`${groupId}-${index}`, person, "HP:0001250", "Seizure", [modSpan("Krampfanfälle")], { modifiers, ...more })), extra);
}
