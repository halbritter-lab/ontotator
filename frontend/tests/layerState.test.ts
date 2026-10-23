// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  initLayerSelection,
  setActiveLayer,
  setActiveType,
  toggleLayerVisibility,
  type LayerSelection,
} from "../src/editor/layerState";
import type { LayerDefinition, TaskScope } from "../src/api/client";

describe("layerState", () => {
  const hpoLayer: LayerDefinition = {
    layer_id: "hpo-layer",
    label: "HPO",
    ontology_id: "hp",
    access: "editable",
    default_visible: true,
    default_type_id: "phenotype",
    annotation_types: [
      {
        type_id: "phenotype",
        label: "Phenotype",
        axes: [],
        evidence_policy: "optional",
      },
    ],
  };

  const mondoLayer: LayerDefinition = {
    layer_id: "mondo-layer",
    label: "MONDO",
    ontology_id: "mondo",
    access: "editable",
    default_visible: true,
    default_type_id: "disease",
    annotation_types: [
      {
        type_id: "disease",
        label: "Disease",
        axes: [],
        evidence_policy: "optional",
      },
      {
        type_id: "suspected_disease",
        label: "Suspected Disease",
        axes: [],
        evidence_policy: "optional",
      },
    ],
  };

  const refLayer: LayerDefinition = {
    layer_id: "ref-layer",
    label: "Reference Source",
    ontology_id: "hp",
    access: "reference",
    default_visible: true,
    default_type_id: "ref_pheno",
    annotation_types: [
      {
        type_id: "ref_pheno",
        label: "Reference Phenotype",
        axes: [],
        evidence_policy: "optional",
      },
    ],
  };

  const singleScope: TaskScope = {
    scope_id: "scope-single",
    mode: "independent",
    editable_layer_ids: ["hpo-layer"],
    reference_layer_ids: [],
  };

  const multiScope: TaskScope = {
    scope_id: "scope-multi",
    mode: "independent",
    editable_layer_ids: ["hpo-layer", "mondo-layer"],
    reference_layer_ids: [],
  };

  const referenceScope: TaskScope = {
    scope_id: "scope-reference",
    mode: "review",
    editable_layer_ids: ["mondo-layer"],
    reference_layer_ids: ["ref-layer"],
  };

  describe("single-layer package (zero mandatory interaction)", () => {
    it("automatically selects the single editable layer and its default type without manual steps", () => {
      const selection = initLayerSelection([hpoLayer], singleScope);
      expect(selection.activeLayerId).toBe("hpo-layer");
      expect(selection.activeTypeId).toBe("phenotype");
      expect(selection.visibleLayerIds).toEqual(["hpo-layer"]);
    });
  });

  describe("multi-layer package", () => {
    it("initializes visible layers and selects the first editable layer by default", () => {
      const selection = initLayerSelection([hpoLayer, mondoLayer], multiScope);
      expect(selection.activeLayerId).toBe("hpo-layer");
      expect(selection.activeTypeId).toBe("phenotype");
      expect(selection.visibleLayerIds).toEqual(["hpo-layer", "mondo-layer"]);
    });

    it("switches active layer and updates active type to that layer's default type", () => {
      const initial = initLayerSelection([hpoLayer, mondoLayer], multiScope);
      const switched = setActiveLayer(initial, [hpoLayer, mondoLayer], multiScope, "mondo-layer");
      expect(switched.activeLayerId).toBe("mondo-layer");
      expect(switched.activeTypeId).toBe("disease");
    });

    it("switching type within the active layer updates activeTypeId", () => {
      const initial = initLayerSelection([hpoLayer, mondoLayer], multiScope);
      const mondoSelected = setActiveLayer(initial, [hpoLayer, mondoLayer], multiScope, "mondo-layer");
      const typeSwitched = setActiveType(mondoSelected, [hpoLayer, mondoLayer], "suspected_disease");
      expect(typeSwitched.activeTypeId).toBe("suspected_disease");
    });

    it("rejects activating a type not belonging to the active layer", () => {
      const initial = initLayerSelection([hpoLayer, mondoLayer], multiScope);
      expect(() => setActiveType(initial, [hpoLayer, mondoLayer], "disease")).toThrow();
    });

    it("rejects activating a reference layer", () => {
      const initial = initLayerSelection([mondoLayer, refLayer], referenceScope);
      expect(() => setActiveLayer(initial, [mondoLayer, refLayer], referenceScope, "ref-layer")).toThrow();
    });

    it("activating a hidden editable layer automatically makes it visible", () => {
      let selection: LayerSelection = {
        activeLayerId: "hpo-layer",
        activeTypeId: "phenotype",
        visibleLayerIds: ["hpo-layer"],
      };
      selection = setActiveLayer(selection, [hpoLayer, mondoLayer], multiScope, "mondo-layer");
      expect(selection.activeLayerId).toBe("mondo-layer");
      expect(selection.visibleLayerIds).toContain("mondo-layer");
    });

    it("hiding the currently active layer resets activeLayerId and activeTypeId to null without switching automatically", () => {
      const initial = initLayerSelection([hpoLayer, mondoLayer], multiScope);
      expect(initial.activeLayerId).toBe("hpo-layer");
      const hidden = toggleLayerVisibility(initial, "hpo-layer");
      expect(hidden.visibleLayerIds).not.toContain("hpo-layer");
      expect(hidden.activeLayerId).toBeNull();
      expect(hidden.activeTypeId).toBeNull();
    });

    it("hiding an inactive layer leaves activeLayerId and activeTypeId unchanged", () => {
      const initial = initLayerSelection([hpoLayer, mondoLayer], multiScope);
      expect(initial.activeLayerId).toBe("hpo-layer");
      const hidden = toggleLayerVisibility(initial, "mondo-layer");
      expect(hidden.visibleLayerIds).toEqual(["hpo-layer"]);
      expect(hidden.activeLayerId).toBe("hpo-layer");
      expect(hidden.activeTypeId).toBe("phenotype");
    });
  });
});
