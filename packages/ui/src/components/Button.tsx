import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-lw-brand text-white hover:bg-lw-brand-hover",
  secondary:
    "border border-lw-border-strong bg-lw-surface text-lw-ink hover:bg-lw-surface-2",
  ghost: "text-lw-ink-soft hover:bg-lw-surface-2 hover:text-lw-ink",
  danger: "bg-lw-danger text-white hover:opacity-90",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-[var(--lw-radius-md)] font-medium",
          "transition-colors duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lw-accent",
          "disabled:pointer-events-none disabled:opacity-50",
          size === "md" ? "h-9 px-3.5 text-[14px]" : "h-8 px-3 text-[13px]",
          variantClasses[variant],
          className,
        )}
        {...rest}
      />
    );
  },
);
