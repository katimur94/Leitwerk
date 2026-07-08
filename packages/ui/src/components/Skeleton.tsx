import type { HTMLAttributes } from "react";
import { cn } from "../cn";

/** Loading-Zustand: Skeleton statt Spinner-Wüste (DESIGN.md). */
export function Skeleton({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-[var(--lw-radius-sm)] bg-lw-surface-2",
        className,
      )}
      {...rest}
    />
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
