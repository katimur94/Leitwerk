import type { HTMLAttributes } from "react";
import { cn } from "../cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger";

const toneVars: Record<BadgeTone, string> = {
  neutral: "var(--lw-ink-soft)",
  success: "var(--lw-success)",
  warning: "var(--lw-warning)",
  danger: "var(--lw-danger)",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, style, ...rest }: BadgeProps) {
  const color = toneVars[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
        className,
      )}
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        ...style,
      }}
      {...rest}
    />
  );
}

export interface AiBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Konfidenz 0–1; ohne Wert nur "Vorschlag". */
  confidence?: number;
  label?: string;
}

/**
 * Violetter Pill für ALLES, was von der KI kommt (DESIGN.md, eiserne Regel).
 * Violett wird nirgendwo sonst verwendet.
 */
export function AiBadge({
  confidence,
  label = "Vorschlag",
  className,
  style,
  ...rest
}: AiBadgeProps) {
  const text =
    confidence !== undefined
      ? `${label} · ${Math.round(confidence * 100)} %`
      : label;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
        className,
      )}
      style={{
        color: "var(--lw-ai)",
        backgroundColor: "color-mix(in srgb, var(--lw-ai) 12%, transparent)",
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: "var(--lw-ai)" }}
      />
      {text}
    </span>
  );
}
