import type { components } from "../api/generated";
import { axisOptionLabel } from "../editor/axisLabels";
import { Button, InlineMessage } from "../ui";

type Settings = components["schemas"]["ProjectSettings"];
type HiddenValues = NonNullable<Settings["hidden_axis_values"]>;
export interface HiddenAxisValuesFieldProps {
  profile: components["schemas"]["TaskProfile"];
  axisDefaults: Settings["axis_defaults"];
  value: HiddenValues;
  onChange: (value: HiddenValues) => void;
  disabled?: boolean;
}

/** How many values are hidden ("Values annotators can choose (1 hidden)"). */
export const hiddenCount = (value: HiddenValues): number =>
  Object.values(value).reduce((total, axes) => total + Object.values(axes ?? {}).reduce((sum, hidden) => sum + (hidden?.length ?? 0), 0), 0);

/**
 * Settings › Annotation › Values annotators can choose (M2 M-8c, D7 B): one row of toggles per axis, pressed = shown.
 * A layer heading only when the profile has several layers; the default value cannot be hidden.
 */
export function HiddenAxisValuesField({ profile, axisDefaults, value, onChange, disabled = false }: HiddenAxisValuesFieldProps): JSX.Element {
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

  if (!groups.length) return <InlineMessage tone="info">This profile has no values to limit.</InlineMessage>;
  return <div className="axis-shown-values">
    {groups.map(({ layer, axes }) => <div key={layer.layer_id} role="group" aria-label={layer.label === layer.layer_id ? layer.label : `${layer.label} (${layer.layer_id})`} className="axis-shown-layer">
      {groups.length > 1 && <h4 className="settings-subheading">{layer.label}</h4>}
      {axes.map(({ definition: axis, options }) => <div key={axis.id} role="group" aria-label={axis.label} className="axis-shown-row">
        <span className="form-label">{axis.label}</span>
        {[...options].map(option => {
          const isDefault = axisDefaults[layer.layer_id]?.[axis.id] === option;
          const hidden = value[layer.layer_id]?.[axis.id] ?? [];
          const shown = !hidden.includes(option);
          return <Button key={option} size="sm" aria-pressed={shown} disabled={disabled || isDefault}
            className={shown ? undefined : "axis-shown-off"} title={isDefault ? "The default value cannot be hidden" : undefined}
            onClick={() => {
              if (disabled || isDefault) return;
              const next = shown ? [...hidden, option] : hidden.filter(item => item !== option);
              onChange({ ...value, [layer.layer_id]: { ...value[layer.layer_id], [axis.id]: next } });
            }}>{axisOptionLabel(option)}</Button>;
        })}
      </div>)}
    </div>)}
  </div>;
}
