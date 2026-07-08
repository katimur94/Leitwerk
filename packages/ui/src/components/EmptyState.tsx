import type { ReactNode } from "react";
import { cn } from "../cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Nie leere weiße Fläche (DESIGN.md): ein Satz, eine Aktion. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="text-lw-ink-faint [&>svg]:h-10 [&>svg]:w-10 [&>svg]:stroke-[1.25]">
          {icon}
        </div>
      ) : null}
      <p className="text-[16px] font-semibold text-lw-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-[14px] text-lw-ink-soft">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
