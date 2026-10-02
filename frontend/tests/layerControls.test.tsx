import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LayerControls } from "../src/editor/LayerControls";
import type { LayerDefinition, TaskScope } from "../src/api/client";
import type { LayerSelection } from "../src/editor/layerState";

describe("LayerControls Component", () => {
  const sampleLayers: LayerDefinition[] = [
    {
      layer_id: "phenotype",
      label: "Phänotyp",
      ontology_id: "hp",
      access: "editable",
      default_visible: true,
      default_type_id: "primary",
      annotation_types: [
        {
          type_id: "primary",
          label: "Primärphänotyp",
          evidence_policy: "optional",
          axes: [],
        },
        {
          type_id: "secondary",
          label: "Sekundärphänotyp",
          evidence_policy: "optional",
          axes: [],
        },
      ],
    },
    {
      layer_id: "disease",
      label: "Erkrankung",
      ontology_id: "mondo",
      access: "editable",
      default_visible: true,
      default_type_id: "default",
      annotation_types: [
        {
          type_id: "default",
          label: "Erkrankung",
          evidence_policy: "optional",
          axes: [],
        },
      ],
    },
    {
      layer_id: "reference",
      label: "Referenzbefunde",
      ontology_id: "hp",
      access: "reference",
      default_visible: true,
      default_type_id: "default",
      annotation_types: [
        {
          type_id: "default",
          label: "Vorbefund",
          evidence_policy: "optional",
          axes: [],
        },
      ],
    },
  ];

  const sampleScope: TaskScope = {
    scope_id: "scope-multi",
    mode: "assisted",
    editable_layer_ids: ["phenotype", "disease"],
    reference_layer_ids: ["reference"],
  };

  const sampleSelection: LayerSelection = {
    activeLayerId: "phenotype",
    activeTypeId: "primary",
    visibleLayerIds: ["phenotype", "disease", "reference"],
  };

  it("renders null for single-layer packages with single type (zero extra controls)", () => {
    const singleLayer: LayerDefinition[] = [
      {
        layer_id: "phenotype",
        label: "Phänotyp",
        ontology_id: "hp",
        access: "editable",
        default_visible: true,
        default_type_id: "default",
        annotation_types: [
          {
            type_id: "default",
            label: "Phänotyp",
            evidence_policy: "optional",
            axes: [],
          },
        ],
      },
    ];
    const singleScope: TaskScope = {
      scope_id: "scope-single",
      mode: "independent",
      editable_layer_ids: ["phenotype"],
      reference_layer_ids: [],
    };
    const singleSelection: LayerSelection = {
      activeLayerId: "phenotype",
      activeTypeId: "default",
      visibleLayerIds: ["phenotype"],
    };

    const { container } = render(
      <LayerControls
        layers={singleLayer}
        scope={singleScope}
        selection={singleSelection}
        checkedLayerIds={[]}
        onToggleVisibility={vi.fn()}
        onSetActiveLayer={vi.fn()}
        onSetActiveType={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders layer list when multiple accessible layers exist", () => {
    render(
      <LayerControls
        layers={sampleLayers}
        scope={sampleScope}
        selection={sampleSelection}
        checkedLayerIds={["disease"]}
        onToggleVisibility={vi.fn()}
        onSetActiveLayer={vi.fn()}
        onSetActiveType={vi.fn()}
      />
    );

    expect(screen.getByTestId("layer-controls")).toBeTruthy();
    expect(screen.getByText("Phänotyp")).toBeTruthy();
    expect(screen.getByText("Erkrankung")).toBeTruthy();
    expect(screen.getByText("Referenzbefunde")).toBeTruthy();
  });

  it("marks reference layers with text badge and prevents activation", () => {
    render(
      <LayerControls
        layers={sampleLayers}
        scope={sampleScope}
        selection={sampleSelection}
        checkedLayerIds={[]}
        onToggleVisibility={vi.fn()}
        onSetActiveLayer={vi.fn()}
        onSetActiveType={vi.fn()}
      />
    );

    // Reference badge exists
    expect(screen.getByText(/^Referenz$/)).toBeTruthy();

    // Reference layer activation radio/button is disabled or absent
    const refRadio = screen.queryByRole("radio", { name: /Referenzbefunde/ });
    if (refRadio) {
      expect((refRadio as HTMLInputElement).disabled).toBe(true);
    } else {
      expect(refRadio).toBeNull();
    }
  });

  it("triggers onToggleVisibility when visibility checkbox is changed", () => {
    const onToggle = vi.fn();
    render(
      <LayerControls
        layers={sampleLayers}
        scope={sampleScope}
        selection={sampleSelection}
        checkedLayerIds={[]}
        onToggleVisibility={onToggle}
        onSetActiveLayer={vi.fn()}
        onSetActiveType={vi.fn()}
      />
    );

    const visCheckbox = screen.getByRole("checkbox", { name: /Sichtbarkeit für Phänotyp/i });
    expect((visCheckbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(visCheckbox);
    expect(onToggle).toHaveBeenCalledWith("phenotype");
  });

  it("triggers onSetActiveLayer when selecting another editable layer", () => {
    const onSetActive = vi.fn();
    render(
      <LayerControls
        layers={sampleLayers}
        scope={sampleScope}
        selection={sampleSelection}
        checkedLayerIds={[]}
        onToggleVisibility={vi.fn()}
        onSetActiveLayer={onSetActive}
        onSetActiveType={vi.fn()}
      />
    );

    const diseaseRadio = screen.getByRole("radio", { name: /Erkrankung/i });
    fireEvent.click(diseaseRadio);
    expect(onSetActive).toHaveBeenCalledWith("disease");
  });

  it("renders type selector only when active layer has multiple types", () => {
    const onSetType = vi.fn();
    const { rerender } = render(
      <LayerControls
        layers={sampleLayers}
        scope={sampleScope}
        selection={sampleSelection} // activeLayerId: phenotype (2 types)
        checkedLayerIds={[]}
        onToggleVisibility={vi.fn()}
        onSetActiveLayer={vi.fn()}
        onSetActiveType={onSetType}
      />
    );

    // Phenotype has 2 types: primary, secondary
    const typeSelect = screen.getByRole("combobox", { name: /Annotationstyp/i });
    expect(typeSelect).toBeTruthy();
    fireEvent.change(typeSelect, { target: { value: "secondary" } });
    expect(onSetType).toHaveBeenCalledWith("secondary");

    // Switch selection to disease (1 type: default)
    rerender(
      <LayerControls
        layers={sampleLayers}
        scope={sampleScope}
        selection={{
          activeLayerId: "disease",
          activeTypeId: "default",
          visibleLayerIds: ["phenotype", "disease"],
        }}
        checkedLayerIds={[]}
        onToggleVisibility={vi.fn()}
        onSetActiveLayer={vi.fn()}
        onSetActiveType={onSetType}
      />
    );

    // Disease has only 1 type -> type selector should NOT be rendered
    expect(screen.queryByRole("combobox", { name: /Annotationstyp/i })).toBeNull();
  });

  it("displays layer checked status badge and allows active layer check action", () => {
    const onCheck = vi.fn();
    render(
      <LayerControls
        layers={sampleLayers}
        scope={sampleScope}
        selection={sampleSelection} // active: phenotype
        checkedLayerIds={["disease"]}
        onToggleVisibility={vi.fn()}
        onSetActiveLayer={vi.fn()}
        onSetActiveType={vi.fn()}
        onCheckLayer={onCheck}
      />
    );

    // Shows checked badge for disease
    expect(screen.getByTestId("badge-checked-disease")).toBeTruthy();

    // Phenotype is not checked yet; check button/checkbox for active layer exists
    const checkBtn = screen.getByRole("button", { name: /Phänotyp als geprüft markieren/i });
    fireEvent.click(checkBtn);
    expect(onCheck).toHaveBeenCalledWith("phenotype", true);
  });
});
