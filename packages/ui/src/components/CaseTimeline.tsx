import type { ReactNode } from "react";
import { cn } from "../cn";

export interface TimelineItem {
  id: string | number;
  title: string;
  /** Zeit-/Kontextzeile unter dem Titel */
  meta?: string;
  icon?: ReactNode;
  /** KI-Herkunft → violetter Punkt (DESIGN.md, eiserne Regel) */
  aiOrigin?: boolean;
}

/**
 * CaseTimeline (DESIGN.md Kernkomponente 5): vertikale Timeline,
 * Icons pro Ereignistyp, KI-Einträge mit violettem Punkt.
 */
export function CaseTimeline({
  items,
  className,
}: {
  items: TimelineItem[];
  className?: string;
}) {
  return (
    <ol className={cn("relative flex flex-col", className)}>
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
          {index < items.length - 1 ? (
            <span
              aria-hidden
              className="absolute left-[7px] top-5 h-full w-px bg-lw-border"
            />
          ) : null}
          <span
            aria-hidden
            className="relative z-10 mt-1 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-2"
            style={{
              borderColor: item.aiOrigin ? "var(--lw-ai)" : "var(--lw-border-strong)",
              backgroundColor: item.aiOrigin
                ? "color-mix(in srgb, var(--lw-ai) 20%, var(--lw-surface))"
                : "var(--lw-surface)",
            }}
          >
            {item.aiOrigin ? (
              <span
                className="h-[5px] w-[5px] rounded-full"
                style={{ backgroundColor: "var(--lw-ai)" }}
              />
            ) : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[13px] text-lw-ink">
              {item.icon ? (
                <span className="text-lw-ink-faint [&>svg]:h-3.5 [&>svg]:w-3.5">
                  {item.icon}
                </span>
              ) : null}
              <span className="min-w-0 truncate">{item.title}</span>
            </p>
            {item.meta ? (
              <p className="text-[12px] text-lw-ink-faint">{item.meta}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
