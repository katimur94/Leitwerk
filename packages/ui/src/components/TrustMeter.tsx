import { cn } from "../cn";

export interface TrustMeterProps {
  /** Korrekte Läufe im rollierenden Fenster */
  correct: number;
  /** Gesamt im rollierenden Fenster (z. B. letzte 50) */
  total: number;
  /** Schwelle (0–1), ab der Hochstufen angeboten wird */
  threshold?: number;
  className?: string;
}

/**
 * TrustMeter (DESIGN.md Kernkomponente 4): Fortschrittsring pro Automation
 * („49/50 korrekt“). Violett = KI-Kontext; Ring färbt sich erst ab der
 * Hochstufungs-Schwelle grün.
 */
export function TrustMeter({ correct, total, threshold = 0.95, className }: TrustMeterProps) {
  const ratio = total > 0 ? correct / total : 0;
  const size = 44;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color =
    total === 0
      ? "var(--lw-ink-faint)"
      : ratio >= threshold
        ? "var(--lw-success)"
        : "var(--lw-ai)";

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <svg width={size} height={size} role="img" aria-label={`${correct} von ${total} korrekt`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--lw-border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="54%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="fill-[var(--lw-ink)]"
          style={{ font: "600 11px Inter, system-ui", fontVariantNumeric: "tabular-nums" }}
        >
          {total > 0 ? `${Math.round(ratio * 100)}%` : "—"}
        </text>
      </svg>
      <span className="text-[12px] tabular-nums text-lw-ink-soft">
        {total > 0 ? `${correct}/${total} korrekt` : "noch keine Läufe"}
      </span>
    </div>
  );
}
