import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../cn";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-[var(--lw-radius-md)] border border-lw-border bg-lw-surface px-3",
        "text-[14px] text-lw-ink placeholder:text-lw-ink-faint",
        "transition-colors duration-150",
        "focus:border-transparent focus:outline-none focus:ring-2 focus:ring-lw-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );
});

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-lw-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-lw-danger">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-lw-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}
