import { useRef, type KeyboardEvent, type MouseEvent } from "react";

export interface TabItem {
  id: string;
  label: string;
  count: number;
  href: string;
  /** Filled `warning` count pill (e.g. "Needs your decision" with a count above 0). */
  emphasised?: boolean;
}
export interface TabsProps {
  /** Accessible name of the tablist, e.g. "Documents views". */
  label: string;
  tabs: TabItem[];
  active: string;
  /** ID of the `role="tabpanel"` element; label it with `aria-labelledby={tabId(panelId, active)}`. */
  panelId: string;
  onSelect: (id: string) => void;
}

/** ID of a tab element, for the panel's `aria-labelledby`. */
export const tabId = (panelId: string, id: string): string => `${panelId}-tab-${id}`;

/**
 * Link-driven tablist with manual activation: arrows, Home and End move focus only;
 * Enter, Space or a plain click selects. Modified clicks keep the native link (new tab or window).
 */
export function Tabs({ label, tabs, active, panelId, onSelect }: TabsProps): JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(tabs[index].id);
      return;
    }
    const target = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    list.current?.querySelectorAll<HTMLAnchorElement>("[role=tab]")[target]?.focus();
  };
  const onClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    onSelect(id);
  };
  return <div ref={list} role="tablist" aria-label={label} className="ui-tabs">
    {tabs.map((tab, index) => {
      const selected = tab.id === active;
      return <a key={tab.id} id={tabId(panelId, tab.id)} role="tab" href={tab.href} className="ui-tab"
        aria-selected={selected} aria-controls={panelId} tabIndex={selected ? 0 : -1} aria-label={`${tab.label}, ${tab.count}`}
        onKeyDown={(event) => onKeyDown(event, index)} onClick={(event) => onClick(event, tab.id)}>
        <span className="ui-tab-label">{tab.label}</span>
        <span className={["ui-tab-count", tab.emphasised && "ui-tab-count--emphasised"].filter(Boolean).join(" ")} aria-hidden="true">{tab.count}</span>
      </a>;
    })}
  </div>;
}
