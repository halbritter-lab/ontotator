import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  type?: "button" | "submit";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", type = "button", loading = false, icon, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={["btn", `btn-${variant}`, size === "sm" && "btn-sm", className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || props["aria-busy"]}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : icon ? <span className="btn-leading-icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
});
