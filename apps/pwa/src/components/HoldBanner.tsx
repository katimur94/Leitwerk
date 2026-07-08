import { useEffect, useState } from "react";
import { OctagonPause } from "lucide-react";
import { Button } from "@leitwerk/ui";
import { useHoldingRuns, useStopRun } from "../features/automations/queries";
import { t } from "../i18n/de";

function remainingLabel(holdUntil: string | null, now: number): string {
  if (!holdUntil) return "";
  const seconds = Math.max(0, Math.floor((Date.parse(holdUntil) - now) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Stufe-3-Halte-Zone (MASTERPLAN §4 U): autonome Aktionen sind vor der
 * Ausführung sichtbar und mit EINEM Klick stoppbar — violett, weil KI.
 */
export function HoldBanner() {
  const runs = useHoldingRuns();
  const stop = useStopRun();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if ((runs.data ?? []).length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runs.data]);

  if ((runs.data ?? []).length === 0) return null;

  return (
    <div className="flex flex-col gap-px" role="status">
      {(runs.data ?? []).map((run) => (
        <div
          key={run.id}
          className="flex items-center gap-3 px-4 py-2 text-[13px]"
          style={{ background: "color-mix(in srgb, var(--lw-ai) 12%, var(--lw-surface))" }}
        >
          <OctagonPause size={15} style={{ color: "var(--lw-ai)" }} />
          <span className="min-w-0 flex-1 truncate text-lw-ink">
            <strong style={{ color: "var(--lw-ai)" }}>
              {run.automations?.name ?? t("hold.automation")}:
            </strong>{" "}
            {run.action} — {t("hold.sendsIn")}{" "}
            <span className="tabular-nums">{remainingLabel(run.hold_until, now)}</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={stop.isPending}
            onClick={() => stop.mutate(run.id)}
          >
            {t("hold.stop")}
          </Button>
          {stop.isError ? (
            <span className="text-[12px] text-lw-danger">{stop.error.message}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
