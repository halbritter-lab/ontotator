/**
 * Documents filters (documents overview V4, VD9, VD10, VD11): route ↔ server request, the facet
 * groups of the filter popover, the chips of active filters, "Clear all" and tab changes.
 * Repeatable route parameters are comma-joined (FD10); unknown values are dropped here (the
 * server refuses them with 422).
 */
import type { DecisionBarView, DocumentRowsQuery, DocumentRowsRequest } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import { originLabels, translationStatusLabels } from "../admin/variantMetadata";
import { decisionCategoryLabels, type DecisionCategory } from "./labels";
import { STEP_LABELS, stepLabel, type StepCode } from "./nextStepLabels";

/** Route parameters with a facet in the popover. */
export type FacetParam = "language" | "review_state" | "annotation_state" | "final_state" | "origin" | "plan" | "waiting_on";
export type Facets = NonNullable<DecisionBarView["facets"]>;

/** One checkbox of the popover; it sets every value of `values` in `param` (OR). */
export interface FacetOption { id: string; label: string; param: FacetParam; values: readonly string[] }
export interface FacetGroup { id: "language" | "review" | "annotation" | "final" | "origin" | "plan" | "waiting_on"; legend: string; options: readonly FacetOption[] }

export type TabId = "decision" | "assign" | "progress" | "done" | "all";
export const TABS: readonly (readonly [TabId, string, keyof DecisionBarView])[] = [
  ["decision", "Needs your decision", "needs_decision"],
  ["assign", "To assign", "to_assign"],
  ["progress", "In progress", "in_progress"],
  ["done", "Done", "done"],
  ["all", "All", "all"],
];

export const STATUS_OPTIONS: readonly (readonly [NonNullable<DocumentRowsQuery["status"]>, string])[] = [
  ["unassigned", "Unassigned"], ["open", "Open"], ["in_progress", "In progress"],
  ["submitted", "Submitted"], ["reopened", "Reopened"], ["held", "Paused"],
];
const TRANSLATION_STATUS_LABELS: Readonly<Record<string, string>> = { ...translationStatusLabels, accepted_without_review: "Accepted without review" };
export const PLAN_LABELS: Readonly<Record<string, string>> = {
  review: "Review", annotate: "Annotate", review_and_annotate: "Review and annotate", not_in_plan: "Not in plan", not_decided: "Not decided",
};
export const STAGE_LABELS: Readonly<Record<string, string>> = { translation_review: "Translation review", annotation: "Annotation", final: "Final result", done: "Done" };
/** Popover footer "Order" (VD10); the headers also set the descending `-case` and `-activity`. */
export const ORDER_OPTIONS: readonly (readonly ["case" | "import" | "activity", string])[] = [["case", "Case ID"], ["import", "Import order"], ["activity", "Last activity"]];
const SORT_VALUES: ReadonlySet<string> = new Set(["case", "-case", "import", "activity", "-activity"]);
const SEGMENTS: ReadonlySet<string> = new Set(["decision", "assign", "progress", "done"]);
const DECISIONS: ReadonlySet<string> = new Set(["all", "report-or-pause", "confirm-final", "translation", "missing-final"]);
const ORIGIN_LABELS: Readonly<Record<string, string>> = { machine_translation: "Machine translation", human_translation: "Human translation", correction: "Correction", native: "Source" };

const option = (param: FacetParam, label: string, ...values: string[]): FacetOption => ({ id: `${param}-${values[0]}`, label, param, values });

/** The static groups (Review, Annotation, Final, Origin, Plan) with their route values (spec "Filter popover"; one column each). */
export const FACET_GROUPS: readonly FacetGroup[] = [
  { id: "review", legend: "Review", options: [
    option("review_state", "Unassigned", "unassigned"),
    option("review_state", "Check failed", "check_failed"),
    option("review_state", "In progress", "in_progress", "re_review"),
    option("review_state", "Rejected / query", "rejected", "query"),
    option("review_state", "Not accepted", "not_accepted"),
    option("review_state", "Source changed", "source_changed"),
    option("review_state", "Accepted", "accepted"),
    option("review_state", "Not planned", "not_planned"),
  ] },
  { id: "annotation", legend: "Annotation", options: [
    option("annotation_state", "Unassigned", "unassigned", "partly_assigned"),
    option("annotation_state", "In progress", "in_progress", "in_review", "consolidating", "finishing_on_old"),
    option("annotation_state", "Paused", "paused"),
    option("annotation_state", "On old text", "old_text_open", "old_text_submitted"),
    option("annotation_state", "Submitted", "submitted"),
    option("annotation_state", "Not planned", "not_planned"),
  ] },
  { id: "final", legend: "Final", options: [
    option("final_state", "No final yet", "none", "after_annotation", "after_review", "choose"),
    option("final_state", "To confirm", "confirm", "old_text", "may_be_outdated"),
    option("final_state", "Final", "final"),
  ] },
  { id: "origin", legend: "Origin", options: Object.entries(ORIGIN_LABELS).map(([value, label]) => option("origin", label, value)) },
  { id: "plan", legend: "Plan", options: [
    option("plan", "Not in plan", "not_in_plan"),
    option("plan", "Not decided", "not_decided"),
  ] },
];

/** Every value the server accepts per stage facet (generated `DocumentRowFilters`); labels for the ones without a popover option. */
const STATE_VALUES: Readonly<Record<"review_state" | "annotation_state" | "final_state", Readonly<Record<string, string>>>> = {
  review_state: { source: "Source", undecided: "Not decided", paused: "Paused" },
  annotation_state: { undecided: "Not decided", after_review: "After review", blocked: "Blocked" },
  final_state: {},
};
const PARAM_PREFIX: Readonly<Record<FacetParam, string>> = {
  language: "Language", review_state: "Review", annotation_state: "Annotation", final_state: "Final", origin: "Origin", plan: "Plan", waiting_on: "Waiting on",
};

/** The values of a comma-joined route parameter, in order, without duplicates and empties. */
export function listOf(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map(item => item.trim()).filter(Boolean))];
}
const join = (values: readonly string[]): string | undefined => (values.length ? values.join(",") : undefined);

/** Known values of a stage facet: popover options plus the extra states. */
function stateKnown(param: "review_state" | "annotation_state" | "final_state", value: string): boolean {
  return Object.hasOwn(STATE_VALUES[param], value) || FACET_GROUPS.some(group => group.options.some(item => item.param === param && item.values.includes(value)));
}
const KNOWN: Readonly<Record<string, (value: string) => boolean>> = {
  language: () => true,
  waiting_on: () => true,
  origin: value => Object.hasOwn(originLabels, value),
  plan: value => Object.hasOwn(PLAN_LABELS, value),
  review_state: value => stateKnown("review_state", value),
  annotation_state: value => stateKnown("annotation_state", value),
  final_state: value => stateKnown("final_state", value),
  step: value => Object.hasOwn(STEP_LABELS, value),
  stage: value => Object.hasOwn(STAGE_LABELS, value),
};
const known = (param: string, value: string | undefined): string[] => listOf(value).filter(KNOWN[param]);

/**
 * Server request for the rows endpoint; unknown values are dropped. `segment` wins over `decision`;
 * a decision filter wins over every `final` filter (the API takes one of them). Repeatable
 * parameters go as one value or a list (sent as repeated parameters).
 */
export function rowsRequest(query: ProjectDocumentsQuery): DocumentRowsRequest {
  const result: Record<string, unknown> = {};
  for (const param of ["language", "origin", "step", "stage", "plan", "review_state", "annotation_state", "final_state", "waiting_on"] as const) {
    const values = known(param, query[param]);
    if (values.length) result[param] = values.length > 1 ? values : values[0];
  }
  if (STATUS_OPTIONS.some(([value]) => value === query.status)) result.status = query.status;
  if (query.q) result.q = query.q;
  if (query.translation_status && Object.hasOwn(TRANSLATION_STATUS_LABELS, query.translation_status)) result.translation_status = query.translation_status;
  if (query.segment && SEGMENTS.has(query.segment)) result.segment = query.segment;
  else if (query.decision && DECISIONS.has(query.decision)) result.decision = query.decision;
  if (result.decision === undefined && (query.final === "none" || query.final === "any" || query.final === "missing")) result.final = query.final;
  if (query.owner) result.owner = query.owner;
  if (query.paused === "yes" || query.paused === "no") result.paused = query.paused;
  if (query.sort && query.sort !== "case" && SORT_VALUES.has(query.sort)) result.sort = query.sort;
  if (query.case) result.case = query.case;
  const page = Number(query.page);
  if (Number.isInteger(page) && page > 1) result.page = page;
  return result as DocumentRowsRequest;
}

/** The active tab: `segment` wins; a legacy decision category belongs to "Needs your decision"; none is All (VD7). */
export function activeTab(query: ProjectDocumentsQuery): TabId {
  if (query.segment && SEGMENTS.has(query.segment)) return query.segment as TabId;
  return query.decision && DECISIONS.has(query.decision) ? "decision" : "all";
}

/** The tab's count (tab counts ignore facets and search). */
export function tabCount(bar: DecisionBarView, tab: TabId): number {
  return (bar[TABS.find(([id]) => id === tab)![2]] as number | undefined) ?? 0;
}

/** Route parameters "Clear all" removes: every filter and the search, not the tab (`segment`) or the order (`sort`). */
const FILTER_PARAMS = [
  "language", "review_state", "annotation_state", "final_state", "origin", "plan", "waiting_on",
  "decision", "step", "stage", "owner", "paused", "status", "translation_status", "final", "case", "q",
] as const satisfies readonly (keyof ProjectDocumentsQuery)[];

/** Some filter or the search is active (the "{k} of {n}" line and "Clear all" show). */
export function filtersActive(query: ProjectDocumentsQuery): boolean {
  return FILTER_PARAMS.some(param => query[param] !== undefined && query[param] !== "");
}

/** Patch for "Clear all": drops every filter, the search, paging and the selection; keeps tab, order and open rows. */
export function clearAllPatch(query: ProjectDocumentsQuery): ProjectDocumentsQuery {
  const patch: ProjectDocumentsQuery = Object.fromEntries(FILTER_PARAMS.map(param => [param, undefined]));
  // A decision category was the tab "Needs your decision"; the lead stays there.
  if (activeTab(query) === "decision" && query.segment === undefined) patch.segment = "decision";
  return { ...patch, page: undefined, select: undefined };
}

/** The Documents route of another tab: keeps facets, search and order; drops page, open, select and the panel. */
export function tabRoute(projectKey: string, query: ProjectDocumentsQuery, tab: TabId): Route {
  const route: Extract<Route, { name: "projectDocuments" }> = { name: "projectDocuments", key: projectKey };
  if (tab !== "all") route.segment = tab;
  for (const param of [...FILTER_PARAMS, "sort"] as const) {
    if (param === "decision") continue;
    const value = query[param];
    if (value !== undefined && value !== "") route[param] = value;
  }
  return route;
}

/** Display names of people by pseudonym (the waiting-on values); a value without a name shows as it is. */
export type PeopleNames = ReadonlyMap<string, string>;

/** Popover groups: Language and Waiting on from the facet counts and the route (checked values stay listed). */
export function facetGroups(facets: Facets, query: ProjectDocumentsQuery, sourceLanguages: ReadonlySet<string>, people: PeopleNames = new Map()): FacetGroup[] {
  const languages = [...new Set([...Object.keys(facets.language ?? {}), ...listOf(query.language)])].sort();
  const label = (value: string) => people.get(value) ?? value;
  const waiting = [...new Set([...Object.keys(facets.waiting_on ?? {}), ...listOf(query.waiting_on)])]
    .sort((a, b) => (a === "me" ? -1 : b === "me" ? 1 : label(a).localeCompare(label(b))));
  const groups: FacetGroup[] = [
    { id: "language", legend: "Language", options: languages.map(value => option("language", sourceLanguages.has(value) ? `${value} (source)` : value, value)) },
    ...FACET_GROUPS,
  ];
  if (waiting.length) groups.push({ id: "waiting_on", legend: "Waiting on", options: waiting.map(value => option("waiting_on", value === "me" ? "You" : people.get(value) ?? value, value)) });
  return groups;
}

/** The option is checked when one of its values is in the route. */
export function optionChecked(query: ProjectDocumentsQuery, item: FacetOption): boolean {
  const values = listOf(query[item.param]);
  return item.values.some(value => values.includes(value));
}

/** Rows per option (sum over its values; a row has one value per stage group). */
export function optionCount(facets: Facets, item: FacetOption): number {
  return item.values.reduce((sum, value) => sum + (facets[item.param]?.[value] ?? 0), 0);
}

/** Route patch that checks (adds every value) or unchecks (removes every value) an option. */
export function toggleOption(query: ProjectDocumentsQuery, item: FacetOption, on: boolean): ProjectDocumentsQuery {
  const values = listOf(query[item.param]).filter(value => !item.values.includes(value));
  return { [item.param]: join(on ? [...values, ...item.values] : values) };
}

/** An active filter as a removable chip; `patch` removes it. */
export interface Chip { id: string; label: string; patch: ProjectDocumentsQuery }

function facetChips(query: ProjectDocumentsQuery, param: FacetParam, people: PeopleNames): Chip[] {
  const values = known(param, query[param]);
  const chips: Chip[] = [];
  const done = new Set<string>();
  const options = FACET_GROUPS.flatMap(group => group.options).filter(item => item.param === param);
  for (const value of values) {
    if (done.has(value)) continue;
    const item = options.find(entry => entry.values.includes(value));
    const covered = item ? item.values.filter(entry => values.includes(entry)) : [value];
    for (const entry of covered) done.add(entry);
    const label = item?.label
      ?? (param === "waiting_on" ? (value === "me" ? "You" : people.get(value) ?? value)
        : param === "plan" ? PLAN_LABELS[value]
          : param === "origin" ? ORIGIN_LABELS[value]
            : param in STATE_VALUES ? STATE_VALUES[param as keyof typeof STATE_VALUES][value] : value);
    chips.push({ id: `${param}:${value}`, label: `${PARAM_PREFIX[param]}: ${label}`, patch: { [param]: join(values.filter(entry => !covered.includes(entry))) } });
  }
  return chips;
}

function listChips(query: ProjectDocumentsQuery, param: "step" | "stage", label: (value: string) => string): Chip[] {
  const values = known(param, query[param]);
  return values.map(value => ({ id: `${param}:${value}`, label: label(value), patch: { [param]: join(values.filter(entry => entry !== value)) } }));
}

/**
 * One chip per active value (spec "Chips"): the facets, then the FD11 link parameters without a
 * facet (step, stage, owner, paused, status, translation status, final, exact case) with their labels.
 * The search (`q`), the tab and the order have no chip.
 */
export function chipsOf(query: ProjectDocumentsQuery, people: PeopleNames = new Map()): Chip[] {
  const chips: Chip[] = [];
  for (const param of ["language", "review_state", "annotation_state", "final_state", "origin", "plan", "waiting_on"] as const) chips.push(...facetChips(query, param, people));
  if (query.segment === undefined && query.decision && Object.hasOwn(decisionCategoryLabels, query.decision)) {
    chips.push({ id: "decision", label: decisionCategoryLabels[query.decision as DecisionCategory], patch: { decision: undefined, segment: "decision" } });
  }
  chips.push(...listChips(query, "step", value => `Step: ${stepLabel(value as StepCode)}`));
  chips.push(...listChips(query, "stage", value => `Stage: ${STAGE_LABELS[value]}`));
  if (query.owner) chips.push({ id: "owner", label: `Owner: ${query.owner === "me" ? "You" : query.owner}`, patch: { owner: undefined } });
  if (query.paused === "yes" || query.paused === "no") chips.push({ id: "paused", label: query.paused === "yes" ? "Paused tasks" : "Not paused", patch: { paused: undefined } });
  const status = STATUS_OPTIONS.find(([value]) => value === query.status);
  if (status) chips.push({ id: "status", label: `Assignment status: ${status[1]}`, patch: { status: undefined } });
  if (query.translation_status && Object.hasOwn(TRANSLATION_STATUS_LABELS, query.translation_status)) {
    chips.push({ id: "translation_status", label: `Translation status: ${TRANSLATION_STATUS_LABELS[query.translation_status]}`, patch: { translation_status: undefined } });
  }
  const finalLabel = query.final === "none" ? "Final result: None" : query.final === "any" ? "Final result: Has a final result" : query.final === "missing" ? "Final result missing" : null;
  if (finalLabel && !(query.decision && query.segment === undefined && DECISIONS.has(query.decision))) chips.push({ id: "final", label: finalLabel, patch: { final: undefined } });
  if (query.case) chips.push({ id: "case", label: `Case ID: ${query.case}`, patch: { case: undefined } });
  return chips;
}
