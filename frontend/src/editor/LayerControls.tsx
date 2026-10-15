import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import React from "react";
import type { LayerDefinition, TaskScope } from "../api/client";
import type { LayerSelection } from "./layerState";
import { IconCheck } from "../ui/icons";

export interface LayerControlsProps {
  layers: LayerDefinition[];
  scope: TaskScope;
  selection: LayerSelection;
  checkedLayerIds?: string[];
  onToggleVisibility: (layerId: string) => void;
  onSetActiveLayer: (layerId: string) => void;
  onSetActiveType: (typeId: string) => void;
  onCheckLayer?: (layerId: string, checked: boolean) => void;
  disabled?: boolean;
}

export const LayerControls: React.FC<LayerControlsProps> = ({
  layers,
  scope,
  selection,
  checkedLayerIds = [],
  onToggleVisibility,
  onSetActiveLayer,
  onSetActiveType,
  onCheckLayer,
  disabled = false,
}) => {
  // Requirement: Zero extra controls for single-layer packages
  if (layers.length <= 1) {
    return null;
  }

  const activeLayer = layers.find((l) => l.layer_id === selection.activeLayerId) ?? null;
  const isReferenceLayer = (layerId: string) => (scope.reference_layer_ids ?? []).includes(layerId);
  const isEditableLayer = (layerId: string) => (scope.editable_layer_ids ?? []).includes(layerId);

  return (
    <div className="layer-controls" data-testid="layer-controls">
      <div className="layer-controls__title">Layers & Ontologies</div>

      <div className="layer-list">
        {layers.map((layer) => {
          const isRef = isReferenceLayer(layer.layer_id);
          const isEdit = isEditableLayer(layer.layer_id);
          const isVisible = selection.visibleLayerIds.includes(layer.layer_id);
          const isActive = selection.activeLayerId === layer.layer_id;
          const isChecked = checkedLayerIds.includes(layer.layer_id);

          const layerName = layer.label ?? (layer as any).name ?? layer.layer_id;

          return (
            <div key={layer.layer_id} className={`layer-item${isActive ? " is-active" : ""}`}>
              {/* Left: Visibility toggle + Name + Badges */}
              <div className="layer-item__main">
                <label className="layer-item__name" aria-disabled={disabled || undefined}>
                  <input
                    type="checkbox"
                    aria-label={`Visibility for ${layerName}`}
                    checked={isVisible}
                    onChange={() => onToggleVisibility(layer.layer_id)}
                    disabled={disabled}
                  />
                  <span>{layerName}</span>
                </label>

                {isRef && <span className="badge layer-tag">Reference</span>}

                {isChecked && (
                  <span data-testid={`badge-checked-${layer.layer_id}`} className="badge layer-tag layer-tag--verified">
                    <IconCheck />
                    verified
                  </span>
                )}
              </div>

              {/* Right: Active Selection */}
              {isEdit ? (
                <label className="layer-item__active" aria-disabled={disabled || undefined}>
                  <input
                    type="radio"
                    name="active-layer-radio"
                    aria-label={`Active layer: ${layerName}`}
                    checked={isActive}
                    onChange={() => onSetActiveLayer(layer.layer_id)}
                    disabled={disabled}
                  />
                  <span>{isActive ? "Active" : "Activate"}</span>
                </label>
              ) : (
                <label className="layer-item__active layer-item__active--locked">
                  <input
                    type="radio"
                    name="active-layer-radio"
                    aria-label={`Active layer: ${layerName}`}
                    checked={false}
                    disabled={true}
                  />
                  <span>Locked</span>
                </label>
              )}
            </div>
          );
        })}
      </div>

      {/* Active Layer Details: Types & Check Action */}
      {activeLayer && (
        <div className="layer-controls__details">
          {/* Annotation type selector if active layer has multiple types */}
          {activeLayer.annotation_types && activeLayer.annotation_types.length > 1 && (
            <div className="layer-controls__type">
              <label htmlFor="active-type-select" className="layer-controls__label">
                Annotation type for {activeLayer.label ?? (activeLayer as any).name ?? activeLayer.layer_id}
              </label>
              <Select label={null}
                id="active-type-select"
                aria-label="Annotation type"
                className="form-select-sm"
                value={selection.activeTypeId ?? ""}
                onChange={(e) => onSetActiveType(e.target.value)}
                disabled={disabled}
              >
                {activeLayer.annotation_types.map((typeDef) => (
                  <option key={typeDef.type_id} value={typeDef.type_id}>
                    {typeDef.label ?? (typeDef as any).name ?? typeDef.type_id}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Check active layer action if editable and onCheckLayer provided */}
          {isEditableLayer(activeLayer.layer_id) && onCheckLayer && (() => {
            const isChecked = checkedLayerIds.includes(activeLayer.layer_id);
            const activeName = activeLayer.label ?? (activeLayer as any).name ?? activeLayer.layer_id;
            return (
              <Button
                type="button"
                className={`btn btn-sm btn-secondary layer-controls__verify${isChecked ? " is-checked" : ""}`}
                onClick={() => onCheckLayer(activeLayer.layer_id, !isChecked)}
                disabled={disabled}
                aria-label={`Mark ${activeName} as verified`}
              >
                {isChecked ? <><IconCheck />{activeName} verified (Reset)</> : `Mark ${activeName} as verified`}
              </Button>
            );
          })()}
        </div>
      )}
    </div>
  );
};
