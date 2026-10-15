import { forwardRef, type InputHTMLAttributes } from "react";
import { type FieldOwn } from "./Field";

export type CheckboxProps = Omit<FieldOwn, "error"> & InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { id, label, hint, required, className, "aria-describedby": describedBy, ...props }, ref,
) {
  const hasHint = hint != null && hint !== false && hint !== "";
  const description = [...new Set([
    ...(describedBy?.split(/\s+/).filter(Boolean) ?? []),
    ...(hasHint ? [`${id}-hint`] : []),
  ])].join(" ") || undefined;

  return (
    <div className="form-group">
      <label className="form-checkbox-row" htmlFor={id}>
        <input {...props} ref={ref} id={id} type="checkbox" required={required} aria-describedby={description} className={["form-checkbox", className].filter(Boolean).join(" ")} />
        <span>{label}{required && " (required)"}</span>
      </label>
      {hasHint && <div id={`${id}-hint`} className="field-hint">{hint}</div>}
    </div>
  );
});
