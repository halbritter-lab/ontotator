import { useId } from "react";
import type { DecisionBarView } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { IconWarning } from "../ui/icons";
import { decisionCategoryLabels, type DecisionCategory } from "./labels";
import { isPlainClick } from "./RowCells";

export interface DecisionBarProps {
  bar: DecisionBarView;
  query: ProjectDocumentsQuery;
  projectKey: string;
  /** Push navigation to a Documents route (plain left clicks only). */
  onNavigate: (route: Route) => void;
}

/** Filters a category or segment link keeps; everything else (case, open, select, page) is dropped. */
const KEPT_FILTERS = ["language", "status", "q", "origin", "translation_status"] as const;

const CATEGORY_COUNTS: Readonly<Record<DecisionCategory, keyof DecisionBarView>> = {
  "report-or-pause": "report_or_pause",
  "confirm-final": "confirm_final",
  translation: "translation",
  "missing-final": "missing_final",
};

type Segment = "all" | "decision" | "missing";

function documentsRoute(projectKey: string, query: ProjectDocumentsQuery, patch: ProjectDocumentsQuery): Route {
  const route: Route = { name: "projectDocuments", key: projectKey };
  const merged: ProjectDocumentsQuery = {};
  for (const name of KEPT_FILTERS) if (query[name] !== undefined) merged[name] = query[name];
  if (query.decision !== undefined) merged.decision = query.decision;
  if (query.final !== undefined) merged.final = query.final;
  Object.assign(merged, patch);
  for (const [name, value] of Object.entries(merged)) if (value !== undefined) Object.assign(route, { [name]: value });
  return route;
}

/**
 * "Needs your decision" bar: heading with the project-wide count, the segmented filter
 * All · Needs your decision (n) · No final result (m), per-category links while the decision
 * filter is active, and "k of n shown · Clear filters" when filters hide affected rows.
 * `decision` and `final` are mutually exclusive; every link drops `page`.
 */
export function DecisionBar({ bar, query, projectKey, onNavigate }: DecisionBarProps): JSX.Element {
  const headingId = useId();
  const active: Segment = query.decision !== undefined ? "decision" : query.final === "missing" ? "missing" : "all";
  const filtersActive = KEPT_FILTERS.some(name => query[name] !== undefined && query[name] !== "");

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

  // A category link is the current page; its segment stays marked as the current group.
  const categoryActive = query.decision !== undefined && query.decision !== "all";
  const segmentCurrent = (segment: Segment): boolean | "true" => (segment !== active ? false : segment === "decision" && categoryActive ? "true" : true);

  const segments: [Segment, string, ProjectDocumentsQuery][] = [
    ["all", "All", { decision: undefined, final: undefined }],
    ["decision", `Needs your decision (${bar.total})`, { decision: "all", final: undefined }],
    ["missing", `No final result (${bar.no_final})`, { decision: undefined, final: "missing" }],
  ];

  return (
    <section className="decision-bar" aria-labelledby={headingId}>
      <div className="decision-bar-summary">
        <h2 id={headingId} className="decision-bar-heading">Needs your decision</h2>
        {bar.total > 0 && (
          <span className="decision-bar-warning">
            <IconWarning />
            <span>{bar.total}</span>
            <span className="visually-hidden">{bar.total === 1 ? " row" : " rows"}</span>
          </span>
        )}
      </div>
      <nav className="decision-bar-segments" aria-label="Decision filter">
        <ul>
          {segments.map(([segment, label, patch]) => (
            <li key={segment}>{link(documentsRoute(projectKey, query, { ...patch, page: undefined }), label, segmentCurrent(segment), "decision-bar-segment")}</li>
          ))}
        </ul>
      </nav>
      {active === "decision" && (
        <nav className="decision-bar-categories" aria-label="Decision categories">
          <ul>
            {(Object.keys(decisionCategoryLabels) as DecisionCategory[]).map(category => (
              <li key={category}>
                {link(
                  documentsRoute(projectKey, query, { decision: category, final: undefined, page: undefined }),
                  `${decisionCategoryLabels[category]} (${bar[CATEGORY_COUNTS[category]]})`,
                  query.decision === category,
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
      {filtersActive && bar.shown < bar.total && (
        <p className="decision-bar-shown">
          {`${bar.shown} of ${bar.total} shown · `}
          {link(
            documentsRoute(projectKey, query, { language: undefined, status: undefined, q: undefined, origin: undefined, translation_status: undefined, page: undefined }),
            "Clear filters",
            false,
          )}
        </p>
      )}
    </section>
  );
}
