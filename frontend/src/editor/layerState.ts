import type { LayerDefinition, TaskScope } from "../api/client";

export interface LayerSelection {
  activeLayerId: string | null;
  activeTypeId: string | null;
  visibleLayerIds: string[];
}

/**
 * Initialize layer selection and visibility according to task scope and preferences.
 * For single-layer packages, automatically selects the layer and its default type without extra user steps.
 */
export function initLayerSelection(
  layers: LayerDefinition[],
  scope: TaskScope,
  saved?: Partial<LayerSelection>
): LayerSelection {
  const accessibleLayerIds = new Set([
    ...scope.editable_layer_ids,
    ...scope.reference_layer_ids,
  ]);
  const accessibleLayers = layers.filter((l) =>
    accessibleLayerIds.has(l.layer_id)
  );

  let visibleLayerIds: string[];
  if (saved?.visibleLayerIds && saved.visibleLayerIds.length > 0) {
    visibleLayerIds = saved.visibleLayerIds.filter((id) =>
      accessibleLayerIds.has(id)
    );
  } else {
    visibleLayerIds = accessibleLayers
      .filter((l) => l.default_visible !== false)
      .map((l) => l.layer_id);
    if (visibleLayerIds.length === 0 && accessibleLayers.length > 0) {
      visibleLayerIds = accessibleLayers.map((l) => l.layer_id);
    }
  }

  let activeLayerId: string | null = null;
  let activeTypeId: string | null = null;

  if (scope.editable_layer_ids.length === 1) {
    activeLayerId = scope.editable_layer_ids[0];
  } else if (
    saved?.activeLayerId &&
    scope.editable_layer_ids.includes(saved.activeLayerId)
  ) {
    activeLayerId = saved.activeLayerId;
  } else if (scope.editable_layer_ids.length > 0) {
    activeLayerId = scope.editable_layer_ids[0];
  }

  if (activeLayerId) {
    const layer = accessibleLayers.find((l) => l.layer_id === activeLayerId);
    if (
      saved?.activeTypeId &&
      layer?.annotation_types.some((t) => t.type_id === saved.activeTypeId)
    ) {
      activeTypeId = saved.activeTypeId;
    } else if (layer) {
      activeTypeId =
        layer.default_type_id ?? layer.annotation_types[0]?.type_id ?? null;
    }

    if (!visibleLayerIds.includes(activeLayerId)) {
      visibleLayerIds = [...visibleLayerIds, activeLayerId];
    }
  }

  return {
    activeLayerId,
    activeTypeId,
    visibleLayerIds,
  };
}

/**
 * Toggle visibility of a layer.
 * Hiding the currently active layer resets activeLayerId and activeTypeId to null,
 * requiring explicit user selection before new annotations can be made.
 */
export function toggleLayerVisibility(
  selection: LayerSelection,
  layerId: string
): LayerSelection {
  const isVisible = selection.visibleLayerIds.includes(layerId);
  if (isVisible) {
    const nextVisible = selection.visibleLayerIds.filter((id) => id !== layerId);
    if (selection.activeLayerId === layerId) {
      return {
        activeLayerId: null,
        activeTypeId: null,
        visibleLayerIds: nextVisible,
      };
    }
    return {
      ...selection,
      visibleLayerIds: nextVisible,
    };
  } else {
    return {
      ...selection,
      visibleLayerIds: [...selection.visibleLayerIds, layerId],
    };
  }
}

/**
 * Switch active layer.
 * Reference layers cannot be activated.
 * Activating a hidden layer automatically reveals it.
 */
export function setActiveLayer(
  selection: LayerSelection,
  layers: LayerDefinition[],
  scope: TaskScope,
  layerId: string
): LayerSelection {
  if (!scope.editable_layer_ids.includes(layerId)) {
    throw new Error(
      `Layer '${layerId}' is not editable and cannot be selected as active layer.`
    );
  }

  const layer = layers.find((l) => l.layer_id === layerId);
  if (!layer) {
    throw new Error(`Layer '${layerId}' not found in accessible layer definitions.`);
  }

  const defaultType =
    layer.default_type_id ?? layer.annotation_types[0]?.type_id ?? null;
  let nextVisible = selection.visibleLayerIds;
  if (!nextVisible.includes(layerId)) {
    nextVisible = [...nextVisible, layerId];
  }

  return {
    activeLayerId: layerId,
    activeTypeId: defaultType,
    visibleLayerIds: nextVisible,
  };
}

/**
 * Switch active type within the active layer.
 */
export function setActiveType(
  selection: LayerSelection,
  layers: LayerDefinition[],
  typeId: string
): LayerSelection {
  if (!selection.activeLayerId) {
    throw new Error("No active layer selected.");
  }

  const layer = layers.find((l) => l.layer_id === selection.activeLayerId);
  if (!layer) {
    throw new Error(`Active layer '${selection.activeLayerId}' not found.`);
  }

  const typeDef = layer.annotation_types.find((t) => t.type_id === typeId);

  if (!typeDef) {
    throw new Error(
      `Type '${typeId}' is not valid for layer '${selection.activeLayerId}'.`
    );
  }

  return {
    ...selection,
    activeTypeId: typeId,
  };
}
