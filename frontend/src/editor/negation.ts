/**
 * A finding is negated when its assertion axis (the standard clinical axis,
 * `domain/axes.py`) is "absent". The text marks it with a hatch.
 */
export function isNegated(annotation: { axes_values?: Record<string, string | null> | null }): boolean {
  return annotation.axes_values?.assertion === "absent";
}
