/**
 * Finding groups of the consolidation view: the banner of automatically kept matches (U14; its list expanded by
 * default with up to 3 entries, else "Show"), then the other groups in reading order. Exactly one group is expanded.
 */
import { useId } from "react";
import type { ConsolidationAnnotatePayload, ConsolidationGroupView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import type { WorkspaceView } from "../app/CaseScreen";
import { Button } from "../ui";
import { autoBanner } from "./consolidationText";
import { GroupCard } from "./GroupCard";
import type { GroupOutcome } from "./useConsolidation";

export const AUTO_LIST_OPEN_MAX = 3;

export interface GroupListProps {
  groups: readonly ConsolidationGroupView[];
  people: readonly ConsolidationPersonView[];
  text: string;
  selected: string | null;
  readOnly: boolean;
  busy: string | null;
  outcomes: Readonly<Record<string, GroupOutcome>>;
  narrow: boolean;
  workspace: WorkspaceView | null;
  summaries: ReadonlyMap<string, string>;
  /** The automatic list is shown (controlled, so J/K and the route can open it). */
  autoListOpen: boolean;
  onAutoListOpen: (open: boolean) => void;
  onSelect: (groupId: string) => void;
  onResolve: (group: ConsolidationGroupView, payload: ConsolidationResolvePayload, summary: string) => Promise<boolean>;
  onAnnotate: (group: ConsolidationGroupView, payload: ConsolidationAnnotatePayload) => Promise<boolean>;
  onReopen: (group: ConsolidationGroupView) => Promise<boolean>;
  onDismissOutcome: (groupId: string) => void;
  onEditInEditor?: () => void;
  toggleRef: (groupId: string) => (element: HTMLButtonElement | null) => void;
}

/** Default state of the automatic list: open with up to 3 entries. */
export const autoListDefault = (groups: readonly ConsolidationGroupView[]) =>
  groups.filter(group => group.state === "auto").length <= AUTO_LIST_OPEN_MAX;

export function GroupList(props: GroupListProps): JSX.Element {
  const { groups, selected } = props;
  const listId = useId();
  const auto = groups.filter(group => group.state === "auto");
  const others = groups.filter(group => group.state !== "auto");
  const card = (group: ConsolidationGroupView) => <GroupCard key={group.group_id} group={group} people={props.people} text={props.text}
    expanded={selected === group.group_id} readOnly={props.readOnly} busy={props.busy === group.group_id} outcome={props.outcomes[group.group_id]}
    narrow={props.narrow} workspace={props.workspace} summary={props.summaries.get(group.group_id)}
    onExpand={() => props.onSelect(group.group_id)}
    onResolve={(payload, summary) => props.onResolve(group, payload, summary)}
    onAnnotate={payload => props.onAnnotate(group, payload)}
    onReopen={() => props.onReopen(group)}
    onDismissOutcome={() => props.onDismissOutcome(group.group_id)}
    onEditInEditor={props.onEditInEditor}
    toggleRef={props.toggleRef(group.group_id)} />;
  return <div className="cons-groups">
    {auto.length > 0 && <section className="cons-auto" aria-label="Kept automatically">
      <div className="cons-auto-banner">
        <p>{autoBanner(auto.length)}</p>
        <Button size="sm" variant="quiet" aria-expanded={props.autoListOpen} aria-controls={listId}
          onClick={() => props.onAutoListOpen(!props.autoListOpen)}>{props.autoListOpen ? "Hide" : "Show"}</Button>
      </div>
      <ul id={listId} className="cons-group-list" hidden={!props.autoListOpen}>{auto.map(card)}</ul>
    </section>}
    {others.length > 0 && <ul className="cons-group-list" aria-label="Groups to decide">{others.map(card)}</ul>}
    {!groups.length && <p className="cons-muted">Nobody marked a finding in this text.</p>}
  </div>;
}
