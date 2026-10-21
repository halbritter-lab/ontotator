import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { ProjectSummary } from "../api/client";
import { Button, IconCheck, IconChevronRight, TextInput } from "../ui";
import { routeHref, type Route } from "./router";

/** The search field only appears when the list is too long to scan. */
export const PROJECT_SEARCH_THRESHOLD = 6;

export function projectDestination(project: ProjectSummary): Route {
  return project.can_manage
    ? { name: "projectDocuments", key: project.project_key }
    : { name: "tasks", project: project.project_key };
}

export interface ProjectPickerProps {
  projects: ProjectSummary[];
  current?: ProjectSummary;
  route: Route;
  onNavigate: (route: Route) => void;
  onChoose: (projectKey: string) => void;
}

/** Disclosure (not a menu): a button and a panel of real project links. */
export function ProjectPicker({ projects, current, route, onNavigate, onChoose }: ProjectPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const showSearch = projects.length > PROJECT_SEARCH_THRESHOLD;
  const query = search.toLocaleLowerCase();
  const matches = projects.filter(item => `${item.name} ${item.project_key}`.toLocaleLowerCase().includes(query));
  const dismiss = () => { setOpen(false); setSearch(""); };
  const close = () => { dismiss(); trigger.current?.focus(); };
  const routeKey = JSON.stringify(route);
  useEffect(() => { dismiss(); }, [routeKey]);
  useEffect(() => {
    if (!open) return;
    if (showSearch) searchField.current?.focus();
    const outside = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, showSearch]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !event.currentTarget.contains(next)) dismiss();
  };
  const choose = (event: MouseEvent<HTMLAnchorElement>, item: ProjectSummary) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onChoose(item.project_key);
    onNavigate(projectDestination(item));
    close();
  };
  return <div ref={wrapper} className="shell-project-selector" onKeyDown={onKeyDown} onBlur={onBlur}>
    <Button ref={trigger} variant="quiet" size="sm" className="shell-project-trigger"
      aria-expanded={open} aria-controls="shell-project-panel"
      aria-label={current ? `Current project: ${current.name}` : "Choose project"}
      onClick={() => { if (open) dismiss(); else setOpen(true); }}>
      {current ? current.name : "Choose project"}
      <span className="shell-project-chevron" aria-hidden="true"><IconChevronRight /></span>
    </Button>
    <div id="shell-project-panel" className="shell-project-menu" hidden={!open}>
      {showSearch && <TextInput ref={searchField} id="shell-project-search" type="search" label="Find project" value={search} onChange={event => setSearch(event.target.value)} />}
      <ul className="shell-project-list" aria-label="Projects">
        {matches.map(item => {
          const isCurrent = item.project_key === current?.project_key;
          const opens = item.can_manage ? "opens Documents" : "opens My tasks";
          return <li key={item.project_key}>
            <a className="shell-project-link" href={routeHref(projectDestination(item))} aria-current={isCurrent ? "true" : undefined} onClick={event => choose(event, item)}>
              <span className="shell-project-name">{item.name}</span>
              <span className="shell-project-meta">{item.name === item.project_key ? opens : `${item.project_key} · ${opens}`}</span>
              {isCurrent && <span className="shell-project-current"><span aria-hidden="true"><IconCheck /></span> Current</span>}
            </a>
          </li>;
        })}
      </ul>
      {!matches.length && <p role="status">No matching projects.</p>}
    </div>
  </div>;
}
