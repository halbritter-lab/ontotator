/**
 * Finding groups of the consolidation view (spec §3): one list in text order, agreed (automatically kept) groups in
 * the same list, marked "agreed". Exactly one group is expanded.
 */
import type { ConsolidationAnnotatePayload, ConsolidationGroupView, ConsolidationPersonView, ConsolidationResolvePayload } from "../api/client";
import type { WorkspaceView } from "../app/CaseScreen";
import { GroupCard } from "./GroupCard";
import type { GroupOutcome } from "./useConsolidation";

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
  onSelect: (groupId: string) => void;
  /** A cross-link hint selects (and focuses) another group. */
  onSelectGroup?: (groupId: string) => void;
  onResolve: (group: ConsolidationGroupView, payload: ConsolidationResolvePayload, summary: string) => Promise<boolean>;
  onAnnotate: (group: ConsolidationGroupView, payload: ConsolidationAnnotatePayload) => Promise<boolean>;
  onReopen: (group: ConsolidationGroupView) => Promise<boolean>;
  onDismissOutcome: (groupId: string) => void;
  onEditInEditor?: () => void;
  toggleRef: (groupId: string) => (element: HTMLButtonElement | null) => void;
}

/** Groups by the position of their text; groups without a span last. */
export const textOrder = (groups: readonly ConsolidationGroupView[]): ConsolidationGroupView[] =>
  [...groups].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));

export function GroupList(props: GroupListProps): JSX.Element {
  const { groups, selected } = props;
  const card = (group: ConsolidationGroupView) => <GroupCard key={group.group_id} group={group} people={props.people} text={props.text}
    expanded={selected === group.group_id} readOnly={props.readOnly} busy={props.busy === group.group_id} outcome={props.outcomes[group.group_id]}
    narrow={props.narrow} workspace={props.workspace} summary={props.summaries.get(group.group_id)}
    onExpand={() => props.onSelect(group.group_id)}
    onResolve={(payload, summary) => props.onResolve(group, payload, summary)}
    onAnnotate={payload => props.onAnnotate(group, payload)}
    onReopen={() => props.onReopen(group)}
    onDismissOutcome={() => props.onDismissOutcome(group.group_id)}
    onEditInEditor={props.onEditInEditor}
    groups={groups} onSelectGroup={props.onSelectGroup ?? props.onSelect}
    toggleRef={props.toggleRef(group.group_id)} />;
  return <div className="cons-groups">
    {groups.length > 0 && <ul className="cons-group-list" aria-label="Groups">{textOrder(groups).map(card)}</ul>}
    {!groups.length && <p className="cons-muted">Nobody marked a finding in this text.</p>}
  </div>;
}
