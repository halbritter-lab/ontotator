import { forwardRef, type TextareaHTMLAttributes } from "react";
import { Field, type FieldOwn } from "./Field";

export type TextareaProps = FieldOwn & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { id, label, hint, error, required, className, ...props }, ref,
) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <textarea {...props} ref={ref} className={["form-control", className].filter(Boolean).join(" ")} />
    </Field>
  );
});
