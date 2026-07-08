import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomationRowFull, AutomationRunRow, TrustStatsRow } from "@leitwerk/shared";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

export interface AutomationWithStats extends AutomationRowFull {
  trust_stats: TrustStatsRow | null;
}

export function useAutomations() {
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

/** Autonomie-Stufe über die RPC mit serverseitigem Hochstufen-Gate. */
export function useSetAutonomyLevel() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ automationId, level }: { automationId: string; level: number }) => {
      const { error } = await supabase.rpc("set_autonomy_level", {
        p_automation: automationId,
        p_level: level,
      });
      if (error) throw new Error(error.message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["automations", orgId] }),
  });
}

export function useToggleAutomation() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ automationId, enabled }: { automationId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("automations")
        .update({ is_enabled: enabled })
        .eq("id", automationId);
      if (error) throw new Error(error.message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["automations", orgId] }),
  });
}

export interface HoldingRun extends AutomationRunRow {
  automations: { name: string; hold_minutes: number } | null;
}

/** Läufe in der Halte-Zone (Stufe 3) — global sichtbar, stoppbar. */
export function useHoldingRuns() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["holding_runs", orgId],
    enabled: !!orgId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("*, automations(name, hold_minutes)")
        .eq("org_id", orgId!)
        .eq("status", "holding")
        .order("hold_until", { ascending: true })
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as HoldingRun[];
    },
  });
}

export function useStopRun() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.rpc("stop_automation_run", { p_run: runId });
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["holding_runs", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["automations", orgId] });
    },
  });
}
