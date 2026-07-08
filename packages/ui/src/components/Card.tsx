import type { HTMLAttributes } from "react";
import { cn } from "../cn";

export function Card({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--lw-radius-lg)] border border-lw-border bg-lw-surface",
        "shadow-[var(--lw-shadow-1)]",
        className,
      )}
      {...rest}
    />
  );
}
