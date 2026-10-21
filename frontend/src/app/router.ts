import { useSyncExternalStore } from "react";

/** Returning false preserves the mounted page and its accepted route. */
export type RouteLeaveGuard = () => Promise<boolean>;

/** URL state shared by the documents filters and progress-page assign links.
 * Status stays a transport string; the documents page validates supported filters.
 */
export interface ProjectDocumentsQuery {
  /** Language facet; several languages comma-joined (OR). */
  language?: string;
  status?: string;
  q?: string;
  select?: string;
  origin?: string;
  translation_status?: string;
  /** Exact case ID (unlike the `q` prefix search). */
  case?: string;
  decision?: string;
  /** Final result filter (`none` | `any`; legacy `missing`). */
  final?: string;
  /** Bar segment (`decision` | `assign` | `progress`); exclusive with `decision`. */
  segment?: string;
  /** Next-step code filter; several codes comma-joined (OR), as in Progress links. */
  step?: string;
  /** Stage filter (`translation_review` | `annotation` | `final` | `done`); comma-joined for several. */
  stage?: string;
  /** Owner of the next step: `me` or a pseudonym. */
  owner?: string;
  /** Plan filter (`review` | `annotate` | `review_and_annotate` | `not_in_plan`); comma-joined for several. */
  plan?: string;
  /** Rows with (`yes`) or without (`no`) a held annotate or review task. */
  paused?: string;
  /** Sort order (`case` | `-case` | `import` | `activity` | `-activity`); absent means Case ID. */
  sort?: string;
  /** Review stage facet (documents overview); several states comma-joined (OR). */
  review_state?: string;
  /** Annotation stage facet; several states comma-joined (OR). */
  annotation_state?: string;
  /** Final stage facet; several states comma-joined (OR). */
  final_state?: string;
  /** Waiting-on facet: `me` or pseudonyms, comma-joined (OR). */
  waiting_on?: string;
  /** Flag facet (`guidelines_unclear`: a finding flagged "guidelines unclear" in the submitted consolidation). */
  flags?: string;
  /** Row of the open row panel as `<case>:<language>`; the legacy `open=` parameter maps to it. */
  panel?: string;
  /** Activity filter of the row panel (`review` | `annotation` | `final`); `stage` is the table's stage filter. */
  panel_stage?: string;
  /** Tab of the row panel (`activity` | `versions` | `details`); absent means Activity. */
  panel_tab?: string;
  page?: string;
}

/** Activity filters of the row panel (route `panel_stage`). */
export type PanelStage = "review" | "annotation" | "final";
export const PANEL_STAGES: readonly PanelStage[] = ["review", "annotation", "final"];
/** Tabs of the row panel (route `panel_tab`). */
export type PanelTab = "activity" | "versions" | "details";
export const PANEL_TABS: readonly PanelTab[] = ["activity", "versions", "details"];

/** Options for in-app navigation; `replace` rewrites the current history entry. */
export interface NavigateOptions { replace?: boolean }

export const DOCUMENT_FIELDS = [
  "language", "status", "q", "select", "origin", "translation_status", "case", "decision", "final",
  "segment", "step", "stage", "owner", "plan", "paused", "sort", "page",
  "review_state", "annotation_state", "final_state", "waiting_on", "flags", "panel", "panel_stage", "panel_tab",
] as const;

function readDocumentsQuery(params: URLSearchParams, prefix = ""): ProjectDocumentsQuery {
  const result: ProjectDocumentsQuery = {};
  for (const field of DOCUMENT_FIELDS) {
    const value = params.get(`${prefix}${field}`);
    if (value !== null) result[field] = value;
  }
  // Legacy `open=` (expanded rows before the row panel): the first one opens the panel.
  const open = params.get(`${prefix}open`);
  if (open && result.panel === undefined) result.panel = open;
  return result;
}

function documentsEntries(query: ProjectDocumentsQuery | undefined, prefix = ""): [string, string][] {
  const entries: [string, string][] = [];
  if (!query) return entries;
  for (const field of DOCUMENT_FIELDS) {
    const value = query[field];
    if (value !== undefined) entries.push([`${prefix}${field}`, value]);
  }
  return entries;
}

/** Project settings sections; each one has its own address (`…/settings/{section}`). */
export type SettingsSection = "general" | "guideline" | "rules" | "workflow" | "defaults" | "profile" | "members";
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ["general", "guideline", "rules", "workflow", "defaults", "profile", "members"];
const isSettingsSection = (value: string): value is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(value);

export type Route =
  | { name: "tasks"; project?: string }
  /** `view: "editor"` opens the editor of a consolidation task instead of the consolidation view (acceptance fixes WP-E). */
  | { name: "task"; assignmentId: number; view?: "editor" }
  | { name: "me" }
  | { name: "adminUsers" }
  | { name: "adminOntologies" }
  | { name: "projectNew" }
  | { name: "projectSettings"; key: string; section?: SettingsSection }
  | ({ name: "projectDocuments"; key: string } & ProjectDocumentsQuery)
  | { name: "projectCase"; key: string; caseId: string; variant?: string; annotations?: string; compare?: string; documents?: ProjectDocumentsQuery }
  | { name: "projectProgress"; key: string }
  | { name: "projectExport"; key: string }
  /** Read-only guidelines page; without `version` the version in force. */
  | { name: "projectGuidelines"; key: string; version?: number }
  | { name: "projectProblemReport"; key: string; reportId: string; action?: "resume"; section?: "decide"; documents?: ProjectDocumentsQuery }
  /** Consolidation view of one round (acceptance fixes WP-E); `group` scrolls to a finding group. */
  | { name: "projectConsolidation"; key: string; roundId: string; group?: string }
  | { name: "notFound"; hash: string };

export function parseRoute(hash: string): Route {
  const notFound: Route = { name: "notFound", hash };
  if (hash === "") return { name: "tasks" };
  const queryStart = hash.indexOf("?");
  const path = queryStart === -1 ? hash : hash.slice(0, queryStart);
  const query = queryStart === -1 ? "" : hash.slice(queryStart + 1);

  try {
    // URLSearchParams repairs malformed escapes. Reject them instead of
    // silently navigating to a different project or document identifier.
    decodeURIComponent(path);
    decodeURIComponent(query.replace(/\+/g, " "));
    const params = new URLSearchParams(query);
    if (path === "#/") {
      const project = params.get("project");
      return project === null ? { name: "tasks" } : { name: "tasks", project };
    }
    switch (path) {
      case "#/me": return { name: "me" };
      case "#/admin/users": return { name: "adminUsers" };
      case "#/admin/ontologies": return { name: "adminOntologies" };
      case "#/projects/new": return { name: "projectNew" };
    }
    const task = /^#\/tasks\/([1-9]\d*)$/.exec(path);
    if (task) {
      const assignmentId = Number(task[1]);
      if (!Number.isSafeInteger(assignmentId)) return notFound;
      return params.get("view") === "editor" ? { name: "task", assignmentId, view: "editor" } : { name: "task", assignmentId };
    }
    const report = /^#\/projects\/([^/]+)\/problem-reports\/([^/]+)$/.exec(path);
    if (report) {
      const documents = readDocumentsQuery(params, "documents_");
      return { name: "projectProblemReport", key: decodeURIComponent(report[1]), reportId: decodeURIComponent(report[2]),
        ...(params.get("action") === "resume" ? { action: "resume" as const } : {}),
        ...(params.get("section") === "decide" ? { section: "decide" as const } : {}),
        ...(Object.keys(documents).length ? { documents } : {}) };
    }
    const consolidation = /^#\/projects\/([^/]+)\/consolidations\/([^/]+)$/.exec(path);
    if (consolidation) {
      const group = params.get("group");
      return { name: "projectConsolidation", key: decodeURIComponent(consolidation[1]), roundId: decodeURIComponent(consolidation[2]),
        ...(group ? { group } : {}) };
    }
    const caseRoute = /^#\/projects\/([^/]+)\/cases\/([^/]+)$/.exec(path);
    if (caseRoute) {
      const optional: { variant?: string; annotations?: string; compare?: string } = {};
      for (const field of ["variant", "annotations", "compare"] as const) {
        const value = params.get(field);
        if (value !== null) optional[field] = value;
      }
      const documents = readDocumentsQuery(params, "documents_");
      return { name: "projectCase", key: decodeURIComponent(caseRoute[1]), caseId: decodeURIComponent(caseRoute[2]), ...optional,
        ...(Object.keys(documents).length ? { documents } : {}) };
    }
    const settings = /^#\/projects\/([^/]+)\/settings(?:\/([a-z]+))?$/.exec(path);
    if (settings) {
      const key = decodeURIComponent(settings[1]);
      if (settings[2] === undefined) return { name: "projectSettings", key };
      return isSettingsSection(settings[2]) ? { name: "projectSettings", key, section: settings[2] } : notFound;
    }
    const guidelines = /^#\/projects\/([^/]+)\/guidelines(?:\/v([1-9]\d*))?$/.exec(path);
    if (guidelines) {
      const key = decodeURIComponent(guidelines[1]);
      if (guidelines[2] === undefined) return { name: "projectGuidelines", key };
      const version = Number(guidelines[2]);
      return Number.isSafeInteger(version) ? { name: "projectGuidelines", key, version } : notFound;
    }
    const project = /^#\/projects\/([^/]+)\/(documents|progress|export)$/.exec(path);
    if (!project) return notFound;
    const key = decodeURIComponent(project[1]);
    switch (project[2]) {
      case "progress": return { name: "projectProgress", key };
      case "export": return { name: "projectExport", key };
      case "documents": return { name: "projectDocuments", key, ...readDocumentsQuery(params) };
    }
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
  }
  return notFound;
}

function querySuffix(entries: [string, string | undefined][]): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined) params.append(key, value);
  }
  // Commas stay readable: multi-value filters are comma-joined (`step=resolve_rejected,resolve_queried`).
  const query = params.toString().replace(/%2C/gi, ",");
  return query ? `?${query}` : "";
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case "tasks": return `#/${querySuffix([["project", route.project]])}`;
    case "task":
      if (!Number.isSafeInteger(route.assignmentId) || route.assignmentId <= 0) {
        throw new RangeError("Assignment ID must be a positive safe integer");
      }
      return `#/tasks/${route.assignmentId}${querySuffix([["view", route.view]])}`;
    case "me": return "#/me";
    case "adminUsers": return "#/admin/users";
    case "adminOntologies": return "#/admin/ontologies";
    case "projectNew": return "#/projects/new";
    case "projectSettings": return `#/projects/${encodeURIComponent(route.key)}/settings${route.section && route.section !== "general" ? `/${route.section}` : ""}`;
    case "projectDocuments":
      return `#/projects/${encodeURIComponent(route.key)}/documents${querySuffix(documentsEntries(route))}`;
    case "projectCase": return `#/projects/${encodeURIComponent(route.key)}/cases/${encodeURIComponent(route.caseId)}${querySuffix([
      ["variant", route.variant], ["annotations", route.annotations], ["compare", route.compare],
      ...documentsEntries(route.documents, "documents_"),
    ])}`;
    case "projectProgress": return `#/projects/${encodeURIComponent(route.key)}/progress`;
    case "projectExport": return `#/projects/${encodeURIComponent(route.key)}/export`;
    case "projectGuidelines": return `#/projects/${encodeURIComponent(route.key)}/guidelines${route.version === undefined ? "" : `/v${route.version}`}`;
    case "projectProblemReport": return `#/projects/${encodeURIComponent(route.key)}/problem-reports/${encodeURIComponent(route.reportId)}${querySuffix([
      ["action", route.action], ["section", route.section], ...documentsEntries(route.documents, "documents_"),
    ])}`;
    case "projectConsolidation": return `#/projects/${encodeURIComponent(route.key)}/consolidations/${encodeURIComponent(route.roundId)}${querySuffix([["group", route.group]])}`;
    case "notFound": return route.hash;
  }
}

const subscribe = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};
const currentHash = () => window.location.hash;
const serverHash = () => "";

/** Observe the URL; the app shell owns any editor leave/flush guard. */
export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, currentHash, serverHash));
}

export function navigate(route: Route): void {
  window.location.hash = routeHref(route);
}
