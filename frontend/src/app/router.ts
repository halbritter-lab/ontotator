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
  /** Exact case ID (unlike the `q` search). */
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
  /** Assigned person (pseudonym): non-revoked work of any task, open or submitted. */
  assignee?: string;
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
  /** Tool proposal facet (`with` | `without`; spec 2026-10-23 §2b), comma-joined (OR). */
  proposals?: string;
  /** Row of the open row panel as `<case>:<language>`; the legacy `open=` parameter maps to it. */
  panel?: string;
  /** Activity filter of the row panel (`review` | `annotation` | `final`); `stage` is the table's stage filter. */
  panel_stage?: string;
  /** Tab of the row panel (`activity` | `versions` | `details` | `history`); absent means Activity. */
  panel_tab?: string;
  page?: string;
}

/** Activity filters of the row panel (route `panel_stage`). */
export type PanelStage = "review" | "annotation" | "final";
export const PANEL_STAGES: readonly PanelStage[] = ["review", "annotation", "final"];
/** Tabs of the row panel (route `panel_tab`). */
export type PanelTab = "activity" | "details" | "history";
export const PANEL_TABS: readonly PanelTab[] = ["activity", "details", "history"];

/** Layer keys of the text view (`show`, `compare_show`): `text` | `proposals` | `submission:<id>` | `own:<id>` | `final:<id>`. */
export const isLayerKey = (value: string): boolean => /^(?:text|proposals|(?:submission|own|final):.+)$/.test(value);

/** Options for in-app navigation; `replace` rewrites the current history entry. */
export interface NavigateOptions { replace?: boolean }

export const DOCUMENT_FIELDS = [
  "language", "status", "q", "select", "origin", "translation_status", "case", "decision", "final",
  "segment", "step", "stage", "owner", "assignee", "plan", "paused", "sort", "page",
  "review_state", "annotation_state", "final_state", "waiting_on", "flags", "proposals", "panel", "panel_stage", "panel_tab",
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

/**
 * Project settings tabs (M2 M-8a, order B6-1); each one has its own address (`…/settings/{section}`), and
 * `…/settings` opens the first tab, General. The addresses of the earlier sections stay as aliases.
 */
export type SettingsSection = "people" | "workflow" | "annotation" | "guidelines" | "general" | "ontology";
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ["general", "annotation", "workflow", "guidelines", "people", "ontology"];
export const DEFAULT_SETTINGS_SECTION: SettingsSection = "general";
const SETTINGS_ALIASES: Readonly<Record<string, SettingsSection>> = {
  members: "people", rules: "annotation", defaults: "annotation", guideline: "guidelines", profile: "ontology",
};
const settingsSectionOf = (value: string): SettingsSection | undefined =>
  (SETTINGS_SECTIONS as readonly string[]).includes(value) ? value as SettingsSection : SETTINGS_ALIASES[value];

/** Status tabs of My tasks (route `status`); absent means All. */
export type TaskStatusTab = "todo" | "paused" | "submitted" | "all";
export const TASK_STATUS_TABS: readonly TaskStatusTab[] = ["todo", "paused", "submitted", "all"];
export const isTaskStatusTab = (value: string): value is TaskStatusTab => (TASK_STATUS_TABS as readonly string[]).includes(value);

export type Route =
  /** `status` absent means All; an explicit `all` is kept so a reload never triggers the landing redirect. */
  | { name: "tasks"; project?: string; status?: TaskStatusTab }
  /** `view: "editor"` opens the editor of a consolidation task instead of the consolidation view (acceptance fixes WP-E). */
  | { name: "task"; assignmentId: number; view?: "editor" }
  | { name: "me" }
  | { name: "adminUsers" }
  | { name: "adminOntologies" }
  | { name: "adminReports" }
  | { name: "projectNew" }
  /** Every project of the user (F8); the landing of a lead when no last-used project is accessible. */
  | { name: "projects" }
  | { name: "projectSettings"; key: string; section?: SettingsSection }
  | ({ name: "projectDocuments"; key: string } & ProjectDocumentsQuery)
  /** `show` / `compare_show`: layer keys of the text view (`isLayerKey`); unknown values are dropped. */
  | { name: "projectCase"; key: string; caseId: string; variant?: string; annotations?: string; compare?: string; show?: string; compare_show?: string; documents?: ProjectDocumentsQuery }
  | { name: "projectProgress"; key: string }
  | { name: "projectExport"; key: string }
  /** Read-only guidelines page; without `version` the version in force. */
  | { name: "projectGuidelines"; key: string; version?: number }
  | { name: "projectProblemReport"; key: string; reportId: string; action?: "resume"; section?: "decide"; documents?: ProjectDocumentsQuery }
  /** Consolidation view of one round (acceptance fixes WP-E); `group` scrolls to a finding group. */
  | { name: "projectConsolidation"; key: string; roundId: string; group?: string; documents?: ProjectDocumentsQuery }
  /** The bundled user handbook (docs/handbook); without `chapter` its README. `section` is a heading id to scroll to. */
  | { name: "help"; chapter?: string; section?: string }
  | { name: "notFound"; hash: string };

/** Every "My tasks" link: an explicit All, so a reload or a new tab never runs the last-used landing. */
export const MY_TASKS: Route = { name: "tasks", status: "all" };

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
      const status = params.get("status");
      return { name: "tasks", ...(project === null ? {} : { project }), ...(status !== null && isTaskStatusTab(status) ? { status } : {}) };
    }
    switch (path) {
      case "#/me": return { name: "me" };
      case "#/admin/users": return { name: "adminUsers" };
      case "#/admin/ontologies": return { name: "adminOntologies" };
      case "#/admin/reports": return { name: "adminReports" };
      case "#/projects": return { name: "projects" };
      case "#/projects/new": return { name: "projectNew" };
    }
    const help = /^#\/help(?:\/([A-Za-z0-9_-]+))?$/.exec(path);
    if (help) {
      const section = params.get("section");
      return { name: "help", ...(help[1] && help[1] !== "README" ? { chapter: help[1] } : {}), ...(section ? { section } : {}) };
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
      const documents = readDocumentsQuery(params, "documents_");
      return { name: "projectConsolidation", key: decodeURIComponent(consolidation[1]), roundId: decodeURIComponent(consolidation[2]),
        ...(group ? { group } : {}), ...(Object.keys(documents).length ? { documents } : {}) };
    }
    const caseRoute = /^#\/projects\/([^/]+)\/cases\/([^/]+)$/.exec(path);
    if (caseRoute) {
      const optional: { variant?: string; annotations?: string; compare?: string; show?: string; compare_show?: string } = {};
      for (const field of ["variant", "annotations", "compare"] as const) {
        const value = params.get(field);
        if (value !== null) optional[field] = value;
      }
      for (const field of ["show", "compare_show"] as const) {
        const value = params.get(field);
        if (value !== null && isLayerKey(value)) optional[field] = value;
      }
      const documents = readDocumentsQuery(params, "documents_");
      return { name: "projectCase", key: decodeURIComponent(caseRoute[1]), caseId: decodeURIComponent(caseRoute[2]), ...optional,
        ...(Object.keys(documents).length ? { documents } : {}) };
    }
    const settings = /^#\/projects\/([^/]+)\/settings(?:\/([a-z]+))?$/.exec(path);
    if (settings) {
      const key = decodeURIComponent(settings[1]);
      if (settings[2] === undefined) return { name: "projectSettings", key };
      const section = settingsSectionOf(settings[2]);
      return section ? { name: "projectSettings", key, section } : notFound;
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
    case "tasks": return `#/${querySuffix([["project", route.project], ["status", route.status]])}`;
    case "task":
      if (!Number.isSafeInteger(route.assignmentId) || route.assignmentId <= 0) {
        throw new RangeError("Assignment ID must be a positive safe integer");
      }
      return `#/tasks/${route.assignmentId}${querySuffix([["view", route.view]])}`;
    case "me": return "#/me";
    case "adminUsers": return "#/admin/users";
    case "adminOntologies": return "#/admin/ontologies";
    case "adminReports": return "#/admin/reports";
    case "projectNew": return "#/projects/new";
    case "projects": return "#/projects";
    case "projectSettings": return `#/projects/${encodeURIComponent(route.key)}/settings${route.section && route.section !== DEFAULT_SETTINGS_SECTION ? `/${route.section}` : ""}`;
    case "projectDocuments":
      return `#/projects/${encodeURIComponent(route.key)}/documents${querySuffix(documentsEntries(route))}`;
    case "projectCase": return `#/projects/${encodeURIComponent(route.key)}/cases/${encodeURIComponent(route.caseId)}${querySuffix([
      ["variant", route.variant], ["annotations", route.annotations], ["compare", route.compare], ["show", route.show], ["compare_show", route.compare_show],
      ...documentsEntries(route.documents, "documents_"),
    ])}`;
    case "projectProgress": return `#/projects/${encodeURIComponent(route.key)}/progress`;
    case "projectExport": return `#/projects/${encodeURIComponent(route.key)}/export`;
    case "projectGuidelines": return `#/projects/${encodeURIComponent(route.key)}/guidelines${route.version === undefined ? "" : `/v${route.version}`}`;
    case "projectProblemReport": return `#/projects/${encodeURIComponent(route.key)}/problem-reports/${encodeURIComponent(route.reportId)}${querySuffix([
      ["action", route.action], ["section", route.section], ...documentsEntries(route.documents, "documents_"),
    ])}`;
    case "projectConsolidation": return `#/projects/${encodeURIComponent(route.key)}/consolidations/${encodeURIComponent(route.roundId)}${querySuffix([["group", route.group], ...documentsEntries(route.documents, "documents_")])}`;
    case "help": return `#/help${route.chapter && route.chapter !== "README" ? `/${route.chapter}` : ""}${querySuffix([["section", route.section]])}`;
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
