import { axisOptionLabel } from "../editor/axisLabels";

const SLOTS: Readonly<Record<string, string>> = {
  present: "present", absent: "absent", uncertain: "uncertain",
  patient: "patient", family_member: "family", other: "other",
  current: "current", historical: "historical", future: "future",
};

/** An axis value as text on its fixed colour (spec §3 variant B); the word always stays. */
export function AxisValue({ value }: { value: string | null | undefined }): JSX.Element {
  const slot = (value && Object.hasOwn(SLOTS, value) && SLOTS[value]) || "neutral";
  return <span className={`axis-value axis-value--${slot}`}>{axisOptionLabel(value)}</span>;
}
