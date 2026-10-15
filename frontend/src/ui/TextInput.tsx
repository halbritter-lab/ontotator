import { forwardRef, type InputHTMLAttributes } from "react";
import { Field, type FieldOwn } from "./Field";

export type TextInputProps = FieldOwn & InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { id, label, hint, error, required, className, ...props }, ref,
) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <input {...props} ref={ref} className={["form-control", className].filter(Boolean).join(" ")} />
    </Field>
  );
});
