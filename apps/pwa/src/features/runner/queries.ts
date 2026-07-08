import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  JOB_PRIORITY,
  type AgentJobRow,
  type QuietHours,
  type RunnerRow,
} from "@leitwerk/shared";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

/** Heartbeat älter als 3 Minuten gilt als offline (analog release_stale_jobs). */
export function isRunnerOnline(runner: RunnerRow): boolean {
  if (runner.status !== "online" || !runner.last_heartbeat) return false;
  return Date.now() - Date.parse(runner.last_heartbeat) < 3 * 60_000;
}

/** Zwei-Stufen-Pairing (Migration 017): wartet auf Bestätigung in der PWA. */
export function isPendingApproval(runner: RunnerRow): boolean {
  return runner.status === "pending_approval";
}

export function useRunners() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["runners", orgId],
    enabled: !!orgId,
    // Fallback-Polling — primär hält Realtime die Liste aktuell
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("runners")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as RunnerRow[];
    },
  });
}

export function useEchoJobs() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["jobs", orgId],
    enabled: !!orgId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_jobs")
        .select("*")
        .eq("org_id", orgId!)
        .eq("job_type", "echo")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as AgentJobRow[];
    },
  });
}

/** Pairing-Code (vom Runner angezeigt) für die eigene Org registrieren. */
export function useCreatePairingCode() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  return useMutation({
    mutationFn: async (rawCode: string) => {
      if (!orgId || !userId) throw new Error("Keine aktive Organisation");
      const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length !== 8) {
        throw new Error("Der Pairing-Code hat 8 Zeichen (Bindestrich optional).");
      }
      const { error } = await supabase
        .from("runner_pairing_codes")
        .insert({ user_id: userId, org_id: orgId, code });
      if (error) throw new Error(error.message);
      return code;
    },
  });
}

/** Runner freigeben (RPC approve_runner, nur Owner/Admin — Migration 017). */
export function useApproveRunner() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runnerId: string) => {
      const { error } = await supabase.rpc("approve_runner", {
        p_runner_id: runnerId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["runners", orgId] }),
  });
}

/** Runner ablehnen/deaktivieren (RPC reject_runner — Token wird unbrauchbar). */
export function useRejectRunner() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runnerId: string) => {
      const { error } = await supabase.rpc("reject_runner", {
        p_runner_id: runnerId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["runners", orgId] }),
  });
}

export interface RunnerLimitsUpdate {
  runnerId: string;
  max_jobs_per_hour: number;
  daily_job_limit: number;
  quiet_hours: QuietHours | null;
}

/**
 * Abo-Schutz-Einstellungen (Migration 017): Der Client darf auf runners
 * nur name/max_jobs_per_hour/daily_job_limit/quiet_hours ändern
 * (Spalten-Grants); Status/Token laufen über Broker bzw. RPCs.
 */
export function useUpdateRunnerLimits() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ runnerId, ...fields }: RunnerLimitsUpdate) => {
      const { error } = await supabase
        .from("runners")
        .update(fields)
        .eq("id", runnerId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["runners", orgId] }),
  });
}

export function useCreateEchoJob() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      if (!orgId || !userId) throw new Error("Keine aktive Organisation");
      const { error } = await supabase.from("agent_jobs").insert({
        org_id: orgId,
        created_by: userId,
        job_type: "echo",
        priority: JOB_PRIORITY.high, // interaktiv: Nutzer wartet auf die Antwort
        payload: { text },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["jobs", orgId] }),
  });
}
