/** Term search popover of the consolidation view ("Add finding", "Other term…"): the editor's search panel. */
import { useMemo, useState, type RefObject } from "react";
import { api, type SearchCandidate } from "../api/client";
import type { WorkspaceView } from "../app/CaseScreen";
import { SearchPanel } from "../editor/SearchPanel";
import { SearchManager } from "../editor/searchState";
import { prefillHint } from "../editor/termSearch";
import { randomId } from "../editor/ids";
import { Popover } from "../ui";

export interface TermPickerProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  label: string;
  workspace: WorkspaceView;
  layerId: string;
  initialQuery?: string;
  onPick: (candidate: SearchCandidate, searchId?: string) => void;
  onClose: () => void;
}

export function TermPicker({ open, anchorRef, label, workspace, layerId, initialQuery, onPick, onClose }: TermPickerProps): JSX.Element | null {
  const manager = useMemo(() => new SearchManager(api), []);
  const [searchKey] = useState(() => `search-${randomId()}`);
  if (!open) return null;
  return <Popover open anchorRef={anchorRef} label={label} onClose={onClose} width={420}>
    <SearchPanel searchManager={manager} annotationId={searchKey} workspaceKey={workspace.key} layerId={layerId}
      initialQuery={initialQuery} autoFocus onEscape={onClose}
      languageHint={prefillHint(workspace.document.language, undefined) ?? undefined}
      onSelectCandidate={(candidate, searchId) => onPick(candidate, searchId)} />
  </Popover>;
}

/** The editable layer and type a new finding goes to: the groups' own layer when editable, else the first one. */
export function newFindingTarget(workspace: WorkspaceView, preferredLayer?: string): { layerId: string; typeId: string; axes: Record<string, string | null> } | null {
  const editable = workspace.scope.editable_layer_ids;
  const layers = (workspace.layers ?? []).filter(layer => editable.includes(layer.layer_id) && layer.annotation_types.length);
  const layer = layers.find(value => value.layer_id === preferredLayer) ?? layers[0];
  if (!layer) return null;
  const type = layer.annotation_types.find(value => value.type_id === layer.default_type_id) ?? layer.annotation_types[0];
  const defaults = workspace.creation_defaults?.[layer.layer_id]?.[type.type_id] ?? {};
  // Standard axes with the project's creation defaults (spec "Add finding").
  const axes: Record<string, string | null> = Object.fromEntries((type.axes ?? []).map(axis => [axis.id, null]));
  return { layerId: layer.layer_id, typeId: type.type_id, axes: { ...axes, ...defaults } };
}
