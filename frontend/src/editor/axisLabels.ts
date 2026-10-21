import type { AxisDefinition } from "./AnnotationPanel";

/** Profile labels and order are authoritative; known option wording is shared by every editor control. */
export function axisOptionLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not specified";
  const labels: Record<string, string> = {
    present: "Present", absent: "Absent", uncertain: "Uncertain", patient: "Patient",
    family_member: "Family member", other: "Other person", unknown: "Unknown", current: "Current", historical: "Historical", future: "Future",
  };
  if (typeof value !== "string") return String(value);
  if (Object.prototype.hasOwnProperty.call(labels, value)) return labels[value];
  // Profiles store options as identifiers ("clinically_suspected_only"); show them as words, never change other values.
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value)) {
    const words = value.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return value;
}

export function findingAxes(values: Record<string, unknown>, config?: readonly AxisDefinition[]) {
  const configured = config?.map(axis => ({ id: axis.id, label: axis.label, value: values[axis.id] })) ?? [];
  return [...configured, ...Object.entries(values).filter(([id]) => !config?.some(axis => axis.id === id))
    .map(([id, value]) => ({ id, label: id, value }))];
}
