import { useId } from "react";
import type { components } from "../api/generated";
import { Checkbox, InlineMessage } from "../ui";

type Settings = components["schemas"]["ProjectSettings"];
export interface HiddenAxisValuesFieldProps {
  profile: components["schemas"]["TaskProfile"];
  axisDefaults: Settings["axis_defaults"];
  value: NonNullable<Settings["hidden_axis_values"]>;
  onChange: (value: NonNullable<Settings["hidden_axis_values"]>) => void;
  disabled?: boolean;
}

const groupLabel = (label: string, id: string): string => label === id ? label : `${label} (${id})`;

export function HiddenAxisValuesField({ profile, axisDefaults, value, onChange, disabled = false }: HiddenAxisValuesFieldProps): JSX.Element {
  const fieldId = useId();
  const groups = profile.layers.map(layer => {
    const axes = new Map<string, { definition: components["schemas"]["AxisDefinition"]; options: Set<string> }>();
    for (const kind of layer.annotation_types) {
      for (const axis of kind.axes ?? []) {
        let entry = axes.get(axis.id);
        if (!entry) {
          entry = { definition: axis, options: new Set() };
          axes.set(axis.id, entry);
        }
        for (const option of axis.options) entry.options.add(option);
      }
    }
    return { layer, axes: [...axes.values()].filter(axis => axis.options.size > 0) };
  }).filter(group => group.axes.length > 0);

  return <fieldset disabled={disabled}>
    <legend>Hidden axis values</legend>
    {groups.length === 0 ? <InlineMessage tone="info">This profile has no axis values to hide.</InlineMessage> : groups.map(({ layer, axes }, layerIndex) =>
      <fieldset key={layer.layer_id}>
        <legend>{groupLabel(layer.label, layer.layer_id)}</legend>
        {axes.map(({ definition: axis, options }, axisIndex) => <fieldset key={axis.id}>
          <legend>{groupLabel(axis.label, axis.id)}</legend>
          {[...options].map((option, optionIndex) => {
            const isDefault = axisDefaults[layer.layer_id]?.[axis.id] === option;
            const hidden = value[layer.layer_id]?.[axis.id] ?? [];
            return <Checkbox key={option} id={`${fieldId}-${layerIndex}-${axisIndex}-${optionIndex}`} label={option}
              checked={hidden.includes(option)} disabled={disabled || isDefault}
              title={isDefault ? "The default value cannot be hidden" : undefined}
              onChange={event => {
                if (disabled || isDefault) return;
                const next = event.target.checked ? [...hidden, option] : hidden.filter(item => item !== option);
                onChange({ ...value, [layer.layer_id]: { ...value[layer.layer_id], [axis.id]: next } });
              }} />;
          })}
        </fieldset>)}
      </fieldset>
    )}
  </fieldset>;
}
