import React from "react";
import type { LayerDefinition, TaskScope } from "../api/client";
import type { LayerSelection } from "./layerState";

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
    <div
      className="layer-controls"
      data-testid="layer-controls"
      style={{
        padding: "12px 14px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>
        Schichten & Ontologien
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {layers.map((layer) => {
          const isRef = isReferenceLayer(layer.layer_id);
          const isEdit = isEditableLayer(layer.layer_id);
          const isVisible = selection.visibleLayerIds.includes(layer.layer_id);
          const isActive = selection.activeLayerId === layer.layer_id;
          const isChecked = checkedLayerIds.includes(layer.layer_id);

          const layerName = layer.label ?? (layer as any).name ?? layer.layer_id;

          return (
            <div
              key={layer.layer_id}
              className="layer-item"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                borderRadius: "var(--radius)",
                background: isActive ? "var(--bg-primary)" : "transparent",
                border: isActive ? "1px solid var(--border-color)" : "1px solid transparent",
              }}
            >
              {/* Left: Visibility toggle + Name + Badges */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer" }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Sichtbarkeit für ${layerName}`}
                    checked={isVisible}
                    onChange={() => onToggleVisibility(layer.layer_id)}
                    disabled={disabled}
                  />
                  <span style={{ fontWeight: isActive ? 600 : 400, fontSize: "0.85rem" }}>
                    {layerName}
                  </span>
                </label>

                {isRef && (
                  <span
                    className="badge"
                    style={{
                      background: "var(--border-color)",
                      color: "var(--text-muted)",
                      fontSize: "0.7rem",
                      padding: "2px 6px",
                    }}
                  >
                    Referenz
                  </span>
                )}

                {isChecked && (
                  <span
                    data-testid={`badge-checked-${layer.layer_id}`}
                    className="badge badge-success"
                    style={{ fontSize: "0.7rem", padding: "2px 6px" }}
                  >
                    ✓ geprüft
                  </span>
                )}
              </div>

              {/* Right: Active Selection */}
              <div>
                {isEdit ? (
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: "0.8rem",
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="active-layer-radio"
                      aria-label={`Aktive Schicht: ${layerName}`}
                      checked={isActive}
                      onChange={() => onSetActiveLayer(layer.layer_id)}
                      disabled={disabled}
                    />
                    <span>{isActive ? "Aktiv" : "Aktivieren"}</span>
                  </label>
                ) : (
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: "0.8rem",
                      cursor: "not-allowed",
                      opacity: 0.5,
                    }}
                  >
                    <input
                      type="radio"
                      name="active-layer-radio"
                      aria-label={`Aktive Schicht: ${layerName}`}
                      checked={false}
                      disabled={true}
                    />
                    <span>Gesperrt</span>
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Layer Details: Types & Check Action */}
      {activeLayer && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--border-color)" }}>
          {/* Annotation type selector if active layer has multiple types */}
          {activeLayer.annotation_types && activeLayer.annotation_types.length > 1 && (
            <div style={{ marginBottom: 8 }}>
              <label
                htmlFor="active-type-select"
                style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}
              >
                Annotationstyp für {activeLayer.label ?? (activeLayer as any).name ?? activeLayer.layer_id}
              </label>
              <select
                id="active-type-select"
                aria-label="Annotationstyp"
                className="form-select form-select-sm"
                value={selection.activeTypeId ?? ""}
                onChange={(e) => onSetActiveType(e.target.value)}
                disabled={disabled}
                style={{ fontSize: "0.8rem", padding: "4px 8px" }}
              >
                {activeLayer.annotation_types.map((typeDef) => (
                  <option key={typeDef.type_id} value={typeDef.type_id}>
                    {typeDef.label ?? (typeDef as any).name ?? typeDef.type_id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Check active layer action if editable and onCheckLayer provided */}
          {isEditableLayer(activeLayer.layer_id) && onCheckLayer && (
            <div style={{ marginTop: 6 }}>
              {(() => {
                const isChecked = checkedLayerIds.includes(activeLayer.layer_id);
                const activeName = activeLayer.label ?? (activeLayer as any).name ?? activeLayer.layer_id;
                return (
                  <button
                    type="button"
                    className={`btn btn-sm ${isChecked ? "btn-secondary" : "btn-primary"}`}
                    onClick={() => onCheckLayer(activeLayer.layer_id, !isChecked)}
                    disabled={disabled}
                    style={{ width: "100%", fontSize: "0.8rem", padding: "4px 8px" }}
                    aria-label={`${activeName} als geprüft markieren`}
                  >
                    {isChecked
                      ? `✓ ${activeName} geprüft (Zurücksetzen)`
                      : `${activeName} als geprüft markieren`}
                  </button>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
