import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { ProjectSummary } from "../api/client";
import { IconCheck, IconSortDown, Popover } from "../ui";
import { useShortcut } from "../ui/shortcuts";
import { roleLabels } from "./labels";
import { routeHref, type Route } from "./router";

/** The Projects page shows its search field only when the list is too long to scan. */
export const PROJECT_SEARCH_THRESHOLD = 6;

export function projectDestination(project: ProjectSummary): Route {
  return project.can_manage
    ? { name: "projectDocuments", key: project.project_key }
    : { name: "tasks", project: project.project_key };
}

const ROLE_ORDER = ["lead", "adjudicator", "annotator"] as const;

/** "Lead, Annotator": the user's roles in one project, lead first. */
export function projectRoles(project: ProjectSummary): string {
  return ROLE_ORDER.filter(role => project.roles.includes(role)).map(role => roleLabels[role]).join(", ");
}

export interface ProjectSwitcherProps {
  projects: ProjectSummary[];
  current?: ProjectSummary;
  route: Route;
  onNavigate: (route: Route) => void;
  onChoose: (projectKey: string) => void;
}

const plainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  !event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

/**
 * Project switcher at the top of the sidebar (spec F8): a button and a non-modal popover holding a
 * combobox "Find project" and a listbox of projects. Arrows move the active option and never navigate;
 * every option holds a real link so modified clicks keep browser behaviour.
 */
export function ProjectSwitcher({ projects, current, route, onNavigate, onChoose }: ProjectSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const needle = query.toLocaleLowerCase();
  const matches = projects.filter(item => `${item.name} ${item.project_key}`.toLocaleLowerCase().includes(needle));
  const activeIndex = matches.length ? Math.min(active, matches.length - 1) : -1;

  const close = () => { setOpen(false); setQuery(""); setActive(0); };
  const show = () => { setQuery(""); setActive(0); setOpen(true); };
  const routeKey = JSON.stringify(route);
  useEffect(() => { close(); }, [routeKey]);
  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  useShortcut("Alt+P", () => {
    const button = trigger.current;
    if (!button) return false;
    // In the reading shell the switcher lives in the closed "Sections" disclosure.
    const details = button.closest("details");
    if (details && !details.open) details.open = true;
    if (open) document.getElementById(`${id}-field`)?.focus();
    else show();
  }, { scope: "global", allowInInputs: true, group: "Navigation", description: "Switch project" });

  const choose = (item: ProjectSummary) => {
    onChoose(item.project_key);
    onNavigate(projectDestination(item));
    close();
    trigger.current?.focus();
  };
  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!matches.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.min(Math.max(activeIndex + step, 0), matches.length - 1));
      return;
    }
    if (event.key !== "Enter" || activeIndex < 0) return;
    event.preventDefault();
    const item = matches[activeIndex];
    if (event.ctrlKey || event.metaKey) window.open(routeHref(projectDestination(item)), "_blank", "noopener");
    else choose(item);
  };
  const name = current?.name ?? "Choose project";

  return <>
    <button ref={trigger} type="button" className="project-switcher"
      aria-label={current ? `Project: ${current.name}, switch project` : "Choose project"}
      aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Alt+P"
      onClick={() => { if (open) close(); else show(); }}>
      <span className="project-switcher__text">
        <span className="project-switcher__label">Project</span>
        <span className="project-switcher__name">{name}</span>
      </span>
      <span className="project-switcher__chevron" aria-hidden="true"><IconSortDown /></span>
    </button>
    <Popover open={open} anchorRef={trigger} label="Switch project" onClose={close} width={320} closeOnTabOut>
      <div className="project-switcher-panel">
        <label className="form-label" htmlFor={`${id}-field`}>Find project</label>
        <input id={`${id}-field`} className="form-control" type="text" role="combobox" autoComplete="off"
          aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onFieldKeyDown} />
        <ul id={listId} role="listbox" aria-label="Projects" className="project-switcher-list">
          {matches.map((item, index) => {
            const isCurrent = item.project_key === current?.project_key;
            const opens = item.can_manage ? "opens Documents" : "opens My tasks";
            const roles = projectRoles(item);
            return <li key={item.project_key} id={optionId(index)} role="option" aria-selected={index === activeIndex}
              className="project-switcher-option" onMouseEnter={() => setActive(index)}>
              <a tabIndex={-1} href={routeHref(projectDestination(item))} className="project-switcher-option__link"
                onClick={event => { if (!plainClick(event)) return; event.preventDefault(); choose(item); }}>
                <span className="project-switcher-option__name">{item.name}</span>
                <span className="project-switcher-option__meta">{[item.project_key, roles, opens].filter(Boolean).join(", ")}</span>
                {isCurrent && <span className="project-switcher-option__current"><span aria-hidden="true"><IconCheck /></span> Current</span>}
              </a>
            </li>;
          })}
        </ul>
        {/* Kept mounted so screen readers announce the text when it appears. */}
        <p role="status" className="project-switcher-empty">{matches.length ? "" : "No matching projects."}</p>
        <hr className="project-switcher-separator" />
        <a href={routeHref({ name: "projects" })} className="project-switcher-all"
          onClick={event => { if (!plainClick(event)) return; event.preventDefault(); onNavigate({ name: "projects" }); close(); }}>All projects</a>
      </div>
    </Popover>
  </>;
}
