import { Gauge } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { AutomationRowFull, TrustStatsRow } from "@leitwerk/shared";
import { Badge, Button, Card, EmptyState, SkeletonRows, TrustMeter } from "@leitwerk/ui";
import { t } from "../i18n/de";
import { supabase } from "../lib/supabase";
import { useSessionStore } from "../stores/session";

interface AutomationWithStats extends AutomationRowFull {
  trust_stats: TrustStatsRow | null;
}

function useAutomations() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["automations", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automations")
        .select("*, trust_stats(*)")
        .eq("org_id", orgId!)
        .order("key", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AutomationWithStats[];
    },
  });
}

/**
 * Automationen mit Trefferquote (TrustMeter). Der Autonomie-Regler (1–4)
 * mit Hochstufungs-Gate kommt in Etappe 4 — hier zählt die Transparenz:
 * Was läuft, wie treffsicher ist es (Feedback aus automation_runs.outcome).
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
              <li key={automation.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-lw-ink">{automation.name}</p>
                  <p className="text-[12px] text-lw-ink-faint">
                    {t("automations.level")} {automation.autonomy_level} ·{" "}
                    {automation.is_enabled ? t("automations.enabled") : t("automations.disabled")}
                  </p>
                </div>
                <Badge tone="neutral">{automation.key}</Badge>
                <TrustMeter
                  correct={automation.trust_stats?.last_50_correct ?? 0}
                  total={automation.trust_stats?.last_50_total ?? 0}
                  threshold={automation.promote_threshold}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[12px] text-lw-ink-faint">{t("automations.hint")}</p>
    </div>
  );
}
