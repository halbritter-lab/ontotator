import type { DecisionBarView } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { Button } from "../ui/Button";
import { decisionCategoryLabels, type DecisionCategory } from "./labels";
import { isPlainClick } from "./RowCells";

export interface DecisionBarProps {
  bar: DecisionBarView;
  query: ProjectDocumentsQuery;
  projectKey: string;
  /** Push navigation to a Documents route (plain left clicks only). */
  onNavigate: (route: Route) => void;
  /** Time of the shown counts ("Updated 10:42"). */
  updatedAt?: Date | null;
  onRefresh?: () => void;
  /** Show the quiet "Export final results…" link (the project has a final result). */
  exportFinals?: boolean;
}

/** Filters a segment or category link keeps; everything else (case, open, select, page) is dropped. */
export const BAR_KEPT_FILTERS = ["language", "status", "q", "origin", "translation_status", "step", "stage", "owner", "plan", "final", "sort"] as const;
/** Filters "Clear filters" removes (sort is an order, not a filter). */
const CLEARED_FILTERS = BAR_KEPT_FILTERS.filter(name => name !== "sort");

type Segment = "all" | "decision" | "assign" | "progress";
const SEGMENTS: readonly (readonly [Segment, string, keyof DecisionBarView])[] = [
  ["all", "All", "in_plan"],
  ["decision", "Needs your decision", "needs_decision"],
  ["assign", "To assign", "to_assign"],
  ["progress", "In progress", "in_progress"],
];

const updatedFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function documentsRoute(projectKey: string, query: ProjectDocumentsQuery, patch: ProjectDocumentsQuery): Route {
  const route: Route = { name: "projectDocuments", key: projectKey };
  const merged: ProjectDocumentsQuery = {};
  for (const name of BAR_KEPT_FILTERS) if (query[name] !== undefined && query[name] !== "") merged[name] = query[name];
  if (query.segment !== undefined) merged.segment = query.segment;
  if (query.decision !== undefined) merged.decision = query.decision;
  Object.assign(merged, patch);
  for (const [name, value] of Object.entries(merged)) if (value !== undefined) Object.assign(route, { [name]: value });
  return route;
}

/** The active segment: `segment` wins; a legacy or category `decision` belongs to "Needs your decision". */
export function activeSegment(query: ProjectDocumentsQuery): Segment {
  if (query.segment === "decision" || query.segment === "assign" || query.segment === "progress") return query.segment;
  return query.decision !== undefined && query.decision !== "" ? "decision" : "all";
}

/** n of "k of n shown": the active segment's count, or the active category's. */
export function activeCount(bar: DecisionBarView, query: ProjectDocumentsQuery): number {
  const segment = activeSegment(query);
  const category = query.segment === undefined && query.decision && query.decision !== "all" ? query.decision : null;
  if (category) return bar.decision_categories?.[category] ?? 0;
  return bar[SEGMENTS.find(([key]) => key === segment)![2]] as number;
}

/**
 * Bar (spec "Bar (D21)"): segments All · Needs your decision · To assign · In progress over rows
 * in the plan, decision categories under "Needs your decision", "k of n shown · Clear filters"
 * (n = the active segment's count), "Updated 10:42 · Refresh" and "Export final results…".
 * Segments are mutually exclusive; every link drops `page`.
 */
export function DecisionBar({ bar, query, projectKey, onNavigate, updatedAt, onRefresh, exportFinals = false }: DecisionBarProps): JSX.Element {
  const active = activeSegment(query);
  const filtersActive = CLEARED_FILTERS.some(name => query[name] !== undefined && query[name] !== "");
  const categoryActive = query.segment === undefined && query.decision !== undefined && query.decision !== "all";
  const total = activeCount(bar, query);

  const link = (route: Route, label: string, current: boolean | "true", className?: string) => (
    <a
      className={className}
      href={routeHref(route)}
      aria-current={current === "true" ? "true" : current ? "page" : undefined}
      onClick={event => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onNavigate(route);
      }}
    >
      {label}
    </a>
  );
  const segmentCurrent = (segment: Segment): boolean | "true" => (segment !== active ? false : segment === "decision" && categoryActive ? "true" : true);

  return (
    <section className="decision-bar" aria-label="Rows in the plan">
      <nav className="decision-bar-segments" aria-label="Segments">
        <ul>
          {SEGMENTS.map(([segment, label, field]) => (
            <li key={segment}>{link(
              documentsRoute(projectKey, query, { segment: segment === "all" ? undefined : segment, decision: undefined, page: undefined }),
              `${label} (${bar[field] as number})`, segmentCurrent(segment), "decision-bar-segment",
            )}</li>
          ))}
        </ul>
      </nav>
      <p className="decision-bar-meta">
        {updatedAt && <span>{`Updated ${updatedFormat.format(updatedAt)}`}</span>}
        {onRefresh && <Button size="sm" variant="quiet" onClick={onRefresh}>Refresh</Button>}
        {exportFinals && link({ name: "projectExport", key: projectKey }, "Export final results…", false, "decision-bar-export")}
      </p>
      {active === "decision" && (
        <nav className="decision-bar-categories" aria-label="Decision categories">
          <ul>
            {(Object.keys(decisionCategoryLabels) as DecisionCategory[]).map(category => (
              <li key={category}>
                {link(
                  documentsRoute(projectKey, query, { segment: undefined, decision: category, page: undefined }),
                  `${decisionCategoryLabels[category]} (${bar.decision_categories?.[category] ?? 0})`,
                  query.decision === category && query.segment === undefined,
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
      {filtersActive && bar.shown < total && (
        <p className="decision-bar-shown">
          {`${bar.shown} of ${total} shown · `}
          {link(
            documentsRoute(projectKey, query, { ...Object.fromEntries(CLEARED_FILTERS.map(name => [name, undefined])), page: undefined }),
            "Clear filters",
            false,
          )}
        </p>
      )}
    </section>
  );
}
