import { forwardRef, type SelectHTMLAttributes } from "react";
import { Field, type FieldOwn } from "./Field";

export type SelectProps = FieldOwn & SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, hint, error, required, className, ...props }, ref,
) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <select {...props} ref={ref} className={["form-select", className].filter(Boolean).join(" ")} />
    </Field>
  );
});
