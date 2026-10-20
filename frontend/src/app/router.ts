import { useSyncExternalStore } from "react";

/** Returning false preserves the mounted page and its accepted route. */
export type RouteLeaveGuard = () => Promise<boolean>;

/** URL state shared by the documents filters and progress-page assign links.
 * Status stays a transport string; the documents page validates supported filters.
 */
export interface ProjectDocumentsQuery {
  language?: string;
  status?: string;
  q?: string;
  select?: string;
  origin?: string;
  translation_status?: string;
  /** Exact case ID (unlike the `q` prefix search). */
  case?: string;
  decision?: string;
  final?: string;
  /** Bar segment (`decision` | `assign` | `progress`); exclusive with `decision`. */
  segment?: string;
  /** Next-step code filter. */
  step?: string;
  /** Stage filter (`translation_review` | `annotation` | `final` | `done`). */
  stage?: string;
  /** Owner of the next step: `me` or a pseudonym. */
  owner?: string;
  /** Plan filter (`review` | `annotate` | `review_and_annotate` | `not_in_plan`). */
  plan?: string;
  /** Sort order (`case` | `import` | `activity`); absent means Case ID. */
  sort?: string;
  /** Expanded rows as `<case>:<language>`; repeatable in the URL. */
  open?: string[];
  page?: string;
}

/** Options for in-app navigation; `replace` rewrites the current history entry. */
export interface NavigateOptions { replace?: boolean }

const DOCUMENT_FIELDS = [
  "language", "status", "q", "select", "origin", "translation_status", "case", "decision", "final",
  "segment", "step", "stage", "owner", "plan", "sort", "page",
] as const;

function readDocumentsQuery(params: URLSearchParams, prefix = ""): ProjectDocumentsQuery {
  const result: ProjectDocumentsQuery = {};
  for (const field of DOCUMENT_FIELDS) {
    const value = params.get(`${prefix}${field}`);
    if (value !== null) result[field] = value;
  }
  const open = params.getAll(`${prefix}open`);
  if (open.length) result.open = open;
  return result;
}

function documentsEntries(query: ProjectDocumentsQuery | undefined, prefix = ""): [string, string][] {
  const entries: [string, string][] = [];
  if (!query) return entries;
  for (const field of DOCUMENT_FIELDS) {
    const value = query[field];
    if (value !== undefined) entries.push([`${prefix}${field}`, value]);
  }
  for (const value of query.open ?? []) entries.push([`${prefix}open`, value]);
  return entries;
}

/** Project settings sections; each one has its own address (`…/settings/{section}`). */
export type SettingsSection = "general" | "guideline" | "rules" | "workflow" | "defaults" | "profile" | "members";
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ["general", "guideline", "rules", "workflow", "defaults", "profile", "members"];
const isSettingsSection = (value: string): value is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(value);

export type Route =
  | { name: "tasks"; project?: string }
  | { name: "task"; assignmentId: number }
  | { name: "me" }
  | { name: "adminUsers" }
  | { name: "adminOntologies" }
  | { name: "projectNew" }
  | { name: "projectSettings"; key: string; section?: SettingsSection }
  | ({ name: "projectDocuments"; key: string } & ProjectDocumentsQuery)
  | { name: "projectCase"; key: string; caseId: string; variant?: string; annotations?: string; compare?: string; documents?: ProjectDocumentsQuery }
  | { name: "projectProgress"; key: string }
  | { name: "projectExport"; key: string }
  | { name: "projectProblemReport"; key: string; reportId: string; action?: "resume"; section?: "decide"; documents?: ProjectDocumentsQuery }
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
      return Number.isSafeInteger(assignmentId) ? { name: "task", assignmentId } : notFound;
    }
    const report = /^#\/projects\/([^/]+)\/problem-reports\/([^/]+)$/.exec(path);
    if (report) {
      const documents = readDocumentsQuery(params, "documents_");
      return { name: "projectProblemReport", key: decodeURIComponent(report[1]), reportId: decodeURIComponent(report[2]),
        ...(params.get("action") === "resume" ? { action: "resume" as const } : {}),
        ...(params.get("section") === "decide" ? { section: "decide" as const } : {}),
        ...(Object.keys(documents).length ? { documents } : {}) };
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
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case "tasks": return `#/${querySuffix([["project", route.project]])}`;
    case "task":
      if (!Number.isSafeInteger(route.assignmentId) || route.assignmentId <= 0) {
        throw new RangeError("Assignment ID must be a positive safe integer");
      }
      return `#/tasks/${route.assignmentId}`;
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
    case "projectProblemReport": return `#/projects/${encodeURIComponent(route.key)}/problem-reports/${encodeURIComponent(route.reportId)}${querySuffix([
      ["action", route.action], ["section", route.section], ...documentsEntries(route.documents, "documents_"),
    ])}`;
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
