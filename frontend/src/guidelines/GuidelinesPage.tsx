import { useEffect, useId, useState } from "react";
import { api, type GuidelineListing, type GuidelineSummary } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { routeHref, type Route } from "../app/router";
import { InlineMessage } from "../ui";
import { formatGuidelineDay, GuidelineReader } from "./GuidelineReader";
import "./guidelines.css";

export interface GuidelinesPageProps {
  projectKey: string;
  /** Chosen version (`#/projects/{key}/guidelines/v{n}`); absent: the version in force. */
  version?: number;
  /** Leads and system admins also see "Seen by n of m task members" per version. */
  canManage: boolean;
  onNavigate: (route: Route) => void;
}

/**
 * Read-only guidelines page for every project member: the current (or chosen) version and the
 * list of all versions. Withdrawn versions are listed by number and date only, without text.
 */
export function GuidelinesPage(props: GuidelinesPageProps): JSX.Element {
  return <GuidelinesView key={props.projectKey} {...props} />;
}

function GuidelinesView({ projectKey, version, canManage, onNavigate }: GuidelinesPageProps): JSX.Element {
  const headingId = useId();
  const versionsId = useId();
  const [listing, setListing] = useState<GuidelineListing | null>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    void api.listGuidelines(projectKey).then(next => { if (active) setListing(next); }).catch((failure: unknown) => { if (active) setError(failure); });
    return () => { active = false; };
  }, [projectKey]);

  const current = listing?.current?.version ?? null;
  const shown = version ?? current;
  const versionLink = (item: GuidelineSummary) => {
    const route: Route = { name: "projectGuidelines", key: projectKey, version: item.version };
    return <a href={routeHref(route)} aria-current={item.version === shown ? "page" : undefined} onClick={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onNavigate(route);
    }}>v{item.version}</a>;
  };
  const facts = (item: GuidelineSummary): string => [
    `Published ${formatGuidelineDay(item.created_at)}`,
    item.change_note,
    item.version === current ? "current" : null,
    canManage && item.reach ? `Seen by ${item.reach.opened} of ${item.reach.members} task members` : null,
  ].filter(Boolean).map(part => `, ${part}`).join("");

  return <section className="guidelines-settings" aria-labelledby={headingId}>
    <h1 id={headingId}>Project guidelines</h1>
    {error !== undefined ? <ErrorNotice error={error} />
      : listing === null ? <InlineMessage tone="info">Loading guidelines…</InlineMessage>
      : listing.versions.length === 0 ? <p className="guidelines-empty">This project has no guidelines yet.</p>
      : <>
        {version === undefined && current === null && <p className="guidelines-empty">No guideline is in force.</p>}
        {shown !== null && <GuidelineReader projectKey={projectKey} version={shown} currentVersion={current} />}
        <div className="guidelines-versions">
          <h2 id={versionsId}>Versions</h2>
          <ul aria-labelledby={versionsId}>
            {listing.versions.map(item => <li key={item.version}>
              {item.withdrawn ? `v${item.version}, Withdrawn ${formatGuidelineDay(item.withdrawn.at)}` : <>{versionLink(item)}{facts(item)}</>}
            </li>)}
          </ul>
        </div>
      </>}
  </section>;
}
