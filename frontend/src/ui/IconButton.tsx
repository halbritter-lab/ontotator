import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "icon"> {
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, className, ...props }, ref,
) {
  return <Button {...props} ref={ref} className={["btn-icon", className].filter(Boolean).join(" ")} aria-label={label} title={label} icon={icon} />;
});
