import { useState, type FormEvent } from "react";
import type { QuietHours, RunnerRow } from "@leitwerk/shared";
import { Button, Field, Input } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { useUpdateRunnerLimits } from "./queries";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Abo-Schutz pro Runner (Etappe 0.5): Stunden-/Tageslimit und Nachtfenster.
 * Interaktive Jobs (Priorität ≤ 2) laufen immer; Batch-Jobs (Priorität ≥ 8)
 * laufen NUR im Nachtfenster, wenn eines konfiguriert ist.
 */
export function RunnerLimitsForm({ runner }: { runner: RunnerRow }) {
  const update = useUpdateRunnerLimits();
  const [perHour, setPerHour] = useState(String(runner.max_jobs_per_hour));
  const [perDay, setPerDay] = useState(String(runner.daily_job_limit));
  const [quietEnabled, setQuietEnabled] = useState(runner.quiet_hours != null);
  const [quietStart, setQuietStart] = useState(runner.quiet_hours?.start ?? "22:00");
  const [quietEnd, setQuietEnd] = useState(runner.quiet_hours?.end ?? "06:00");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const hour = Number(perHour);
    const day = Number(perDay);
    if (!Number.isInteger(hour) || hour < 1 || !Number.isInteger(day) || day < 1) {
      setValidationError(t("runner.limits.invalidNumbers"));
      return;
    }
    if (quietEnabled && (!TIME_RE.test(quietStart) || !TIME_RE.test(quietEnd))) {
      setValidationError(t("runner.limits.invalidTimes"));
      return;
    }
    setValidationError(null);
    const quiet_hours: QuietHours | null = quietEnabled
      ? { start: quietStart, end: quietEnd }
      : null;
    update.mutate(
      {
        runnerId: runner.id,
        max_jobs_per_hour: hour,
        daily_job_limit: day,
        quiet_hours,
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 flex flex-col gap-3 rounded-[var(--lw-radius-md)] border border-lw-border bg-lw-surface-2 p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("runner.limits.perHour")} hint={t("runner.limits.perHourHint")}>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={perHour}
            onChange={(e) => setPerHour(e.target.value)}
          />
        </Field>
        <Field label={t("runner.limits.perDay")} hint={t("runner.limits.perDayHint")}>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={perDay}
            onChange={(e) => setPerDay(e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-lw-ink">
        <input
          type="checkbox"
          checked={quietEnabled}
          onChange={(e) => setQuietEnabled(e.target.checked)}
          className="h-4 w-4 accent-[var(--lw-accent)]"
        />
        {t("runner.limits.quietEnabled")}
      </label>

      {quietEnabled ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("runner.limits.quietStart")}>
            <Input
              type="time"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
            />
          </Field>
          <Field label={t("runner.limits.quietEnd")}>
            <Input
              type="time"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </Field>
        </div>
      ) : null}
      <p className="text-[12px] text-lw-ink-faint">{t("runner.limits.semantics")}</p>

      {validationError ? (
        <p className="text-[12px] text-lw-danger">{validationError}</p>
      ) : update.isError ? (
        <p className="text-[12px] text-lw-danger">
          {t("common.error")} ({update.error.message})
        </p>
      ) : saved ? (
        <p className="text-[12px]" style={{ color: "var(--lw-success)" }}>
          {t("runner.limits.saved")}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending ? t("common.loading") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
