import type { AxisDefinition } from "./AnnotationPanel";

/** Profile labels and order are authoritative; known option wording is shared by every editor control. */
export function axisOptionLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not specified";
  const labels: Record<string, string> = {
    present: "Present", absent: "Absent", uncertain: "Uncertain", patient: "Patient",
    family_member: "Family member", other: "Other person", unknown: "Unknown", current: "Current", historical: "Historical", future: "Future",
  };
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : String(value);
}

export function findingAxes(values: Record<string, unknown>, config?: readonly AxisDefinition[]) {
  const configured = config?.map(axis => ({ id: axis.id, label: axis.label, value: values[axis.id] })) ?? [];
  return [...configured, ...Object.entries(values).filter(([id]) => !config?.some(axis => axis.id === id))
    .map(([id, value]) => ({ id, label: id, value }))];
}
