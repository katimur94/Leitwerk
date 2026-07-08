import { useState } from "react";
import { Gauge } from "lucide-react";
import { Badge, Button, Card, EmptyState, SkeletonRows, TrustMeter } from "@leitwerk/ui";
import {
  useAutomations,
  useSetAutonomyLevel,
  useToggleAutomation,
  type AutomationWithStats,
} from "../features/automations/queries";
import { t } from "../i18n/de";

const LEVEL_LABELS: Record<number, string> = {
  1: "Stufe 1 — KI schlägt vor, du klickst",
  2: "Stufe 2 — KI bereitet vor, du gibst frei",
  3: "Stufe 3 — KI führt aus, Halte-Zone zum Stoppen",
  4: "Stufe 4 — KI führt autonom aus, meldet Ausnahmen",
};

function promoteEligible(a: AutomationWithStats): boolean {
  const total = a.trust_stats?.last_50_total ?? 0;
  const correct = a.trust_stats?.last_50_correct ?? 0;
  return total >= a.promote_min_runs && correct / Math.max(total, 1) >= a.promote_threshold;
}

function AutomationRow({ automation }: { automation: AutomationWithStats }) {
  const setLevel = useSetAutonomyLevel();
  const toggle = useToggleAutomation();
  const [error, setError] = useState<string | null>(null);
  const eligible = promoteEligible(automation);

  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-lw-ink">{automation.name}</p>
          <p className="text-[12px] text-lw-ink-faint">
            {LEVEL_LABELS[automation.autonomy_level]}
            {automation.autonomy_level >= 3 ? ` · Halte-Zone ${automation.hold_minutes} Min.` : ""}
          </p>
        </div>
        <Badge tone="neutral">{automation.key}</Badge>
        <TrustMeter
          correct={automation.trust_stats?.last_50_correct ?? 0}
          total={automation.trust_stats?.last_50_total ?? 0}
          threshold={automation.promote_threshold}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={toggle.isPending}
          onClick={() =>
            toggle.mutate({ automationId: automation.id, enabled: !automation.is_enabled })
          }
        >
          {automation.is_enabled ? t("automations.disable") : t("automations.enable")}
        </Button>
      </div>

      {/* Autonomie-Regler 1–4: Hochstufung prüft der Server (set_autonomy_level) */}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={4}
          step={1}
          value={automation.autonomy_level}
          aria-label={`Autonomie-Stufe für ${automation.name}`}
          className="w-48 accent-[var(--lw-accent)]"
          onChange={(e) => {
            setError(null);
            setLevel.mutate(
              { automationId: automation.id, level: Number(e.target.value) },
              { onError: (err) => setError(err.message) },
            );
          }}
        />
        <span className="text-[12px] tabular-nums text-lw-ink-soft">
          {automation.autonomy_level}/4
        </span>
        {!eligible && automation.autonomy_level < 3 ? (
          <span className="text-[12px] text-lw-ink-faint">
            {t("automations.gateHint")
              .replace("{quote}", String(Math.round(automation.promote_threshold * 100)))
              .replace("{runs}", String(automation.promote_min_runs))}
          </span>
        ) : null}
      </div>
      {error ? <p className="text-[12px] text-lw-danger">{error}</p> : null}
    </li>
  );
}

/**
 * Autonomie-Regler (MASTERPLAN §4 J): Hochstufen auf Stufe 3/4 gibt es erst
 * ab nachgewiesener Trefferquote — erzwungen in der DB, nicht nur hier.
 */
export function AutomationsSettings() {
  const automations = useAutomations();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("automations.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">{t("automations.subtitle")}</p>
      </header>

      <Card className="p-6">
        {automations.isPending ? (
          <SkeletonRows rows={4} />
        ) : automations.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[13px] text-lw-danger">
              {t("common.error")} ({automations.error.message})
            </p>
            <Button size="sm" variant="secondary" onClick={() => automations.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (automations.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Gauge />}
            title={t("automations.empty.title")}
            description={t("automations.empty.description")}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-lw-border">
            {(automations.data ?? []).map((automation) => (
              <AutomationRow key={automation.id} automation={automation} />
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[12px] text-lw-ink-faint">{t("automations.hint")}</p>
    </div>
  );
}
