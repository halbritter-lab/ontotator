import { cloneElement, type ReactElement, type ReactNode } from "react";

export interface FieldOwn {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

interface ControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
}

export interface FieldProps extends FieldOwn {
  required?: boolean;
  children: ReactElement<ControlProps>;
}

export function Field({ id, label, hint, error, required, children }: FieldProps) {
  const hasHint = hint != null && hint !== false && hint !== "";
  const hasError = !!error;
  const isRequired = required ?? children.props.required;
  const describedBy = [...new Set([
    ...(children.props["aria-describedby"]?.split(/\s+/).filter(Boolean) ?? []),
    ...(hasHint ? [`${id}-hint`] : []),
    ...(hasError ? [`${id}-error`] : []),
  ])].join(" ") || undefined;

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>{label}{isRequired && " (required)"}</label>
      {cloneElement(children, { id, required: isRequired, "aria-describedby": describedBy, "aria-invalid": hasError })}
      {hasHint && <div id={`${id}-hint`} className="field-hint">{hint}</div>}
      {hasError && <div id={`${id}-error`} className="field-hint field-hint-error" role="alert">{error}</div>}
    </div>
  );
}
