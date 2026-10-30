import { useId, useRef, useState } from "react";
import type { DecisionBarView } from "../api/client";
import { plural } from "../app/labels";
import type { ProjectDocumentsQuery } from "../app/router";
import { Button, IconSortDown, Popover, Select, useMediaQuery } from "../ui";
import { assigneeOptions, chipsOf, facetGroups, ORDER_OPTIONS, optionChecked, optionCount, toggleOption, type FacetOption, type PeopleNames } from "./filterModel";
import { LanguageFlag } from "../ui/LanguageTag";

export interface FilterPopoverProps {
  query: ProjectDocumentsQuery;
  /** Counts of the current page (`facets`, `shown`); null while the first page loads (counts "…"). */
  bar: DecisionBarView | null;
  /** Languages of source texts ("en (source)"). */
  sourceLanguages: ReadonlySet<string>;
  /** Applies a route patch at once (facets and order); the page drops paging and the selection. */
  onChange: (patch: ProjectDocumentsQuery) => void;
  onClearAll: () => void;
  /** Display names by pseudonym for the Waiting on group. */
  people?: PeopleNames;
  /** Pseudonyms of the project's members for "Assigned to". */
  members?: readonly string[];
  /** False while the project has no translation (U-4): no Translation review group. */
  translations?: boolean;
}

const matchText = (count: number) => `${plural(count, "text")} ${count === 1 ? "matches" : "match"}`;

/**
 * "Filter" button and its non-modal popover (spec "Filter popover", V4): the "Assigned to" picker, fieldsets Language,
 * Review, Annotation, Final, Origin, Plan and Waiting on, each checkbox with its count under the
 * current tab, search and the other groups. Checking applies at once and the popover stays open;
 * zero facets are collapsed behind "Show n empty filters" (a checked one stays); shown, they are muted and
 * checkable only while checked. Footer: Order (VD10) and "Clear all";
 * below 700 px a full-height sheet with "Show {n} texts".
 */
export function FilterPopover({ query, bar, sourceLanguages, onChange, onClearAll, people, members = [], translations = true }: FilterPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const narrow = useMediaQuery("(max-width: 699px)");
  const id = useId();
  const contentId = `documents-filter-${id.replace(/:/g, "")}`;
  const facets = bar?.facets ?? {};
  const active = chipsOf(query).length;
  const shown = bar?.shown ?? 0;
  const sort = query.sort ?? "case";
  const order = sort.replace(/^-/, "");

  const facet = (item: FacetOption) => {
    const checked = optionChecked(query, item);
    const count = bar ? optionCount(facets, item) : null;
    const unavailable = count === 0 && !checked;
    const inputId = `${contentId}-${item.id}`;
    return <label key={item.id} htmlFor={inputId} className={["documents-facet", count === 0 && "documents-facet--muted"].filter(Boolean).join(" ")}>
      <input id={inputId} type="checkbox" className="form-checkbox" checked={checked}
        aria-label={`${item.label}, ${count === null ? "counting" : plural(count, "text")}`} aria-disabled={unavailable || undefined}
        onChange={() => { if (!unavailable) onChange(toggleOption(query, item, !checked)); }} />
      <span className="documents-facet-label">{item.param === "language" && <LanguageFlag code={item.values[0]} />}{item.label}</span>
      <span className="documents-facet-count" aria-hidden="true">{count ?? "…"}</span>
    </label>;
  };

  // While counting (no bar) every option shows.
  const empty = (item: FacetOption) => bar != null && optionCount(facets, item) === 0 && !optionChecked(query, item);
  const allGroups = facetGroups(facets, query, sourceLanguages, people).filter(group => translations || group.id !== "review");
  const emptyCount = allGroups.reduce((sum, group) => sum + group.options.filter(empty).length, 0);
  const groups = showEmpty ? allGroups : allGroups.map(group => ({ ...group, options: group.options.filter(item => !empty(item)) })).filter(group => group.options.length > 0);

  const footer = <>
    <fieldset className="documents-filter-order">
      <legend>Order</legend>
      {ORDER_OPTIONS.map(([value, label]) => <label key={value} className="documents-filter-order-option">
        <input type="radio" name={`${contentId}-order`} value={value} checked={order === value}
          onChange={() => onChange({ sort: value === "case" ? undefined : value })} />
        {label}
      </label>)}
    </fieldset>
    <Button size="sm" onClick={onClearAll}>Clear all</Button>
    {narrow && <Button size="sm" variant="primary" onClick={() => setOpen(false)}>{`Show ${plural(shown, "text")}`}</Button>}
  </>;

  return <>
    <Button ref={anchor} aria-expanded={open} aria-controls={open ? contentId : undefined} aria-label={active > 0 ? `Filter, ${active} active` : "Filter"}
      onClick={() => setOpen(value => !value)}>
      Filter
      {active > 0 && <span className="documents-filter-active" aria-hidden="true">{active}</span>}
      <IconSortDown aria-hidden="true" />
    </Button>
    <Popover open={open} anchorRef={anchor} label="Filter" onClose={() => setOpen(false)} footer={footer}>
      <div id={contentId} className="documents-filter-groups">
        <div className="documents-filter-assignee">
          <Select id={`${contentId}-assignee`} label="Assigned to" value={query.assignee ?? ""} onChange={event => onChange({ assignee: event.currentTarget.value || undefined })}>
            <option value="">Anyone</option>
            {assigneeOptions(members, query, people).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        {groups.map(group => <fieldset key={group.id} className="documents-filter-group">
          <legend>{group.legend}</legend>
          {group.options.map(facet)}
        </fieldset>)}
        {emptyCount > 0 && <p className="documents-filter-empty">
          <Button size="sm" variant="quiet" className="btn-link" aria-expanded={showEmpty} onClick={() => setShowEmpty(value => !value)}>
            {showEmpty ? "Hide empty filters" : `Show ${plural(emptyCount, "empty filter")}`}</Button>
        </p>}
        <p className="visually-hidden" role="status" aria-live="polite">{bar ? matchText(shown) : ""}</p>
      </div>
    </Popover>
  </>;
}
