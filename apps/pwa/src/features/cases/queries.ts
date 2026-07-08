import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaseEventRow, CaseRow, MailThreadRow } from "@leitwerk/shared";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

export type CaseFilter = "active" | "done" | "all";

export interface CaseListRow extends CaseRow {
  companies: { name: string } | null;
}

export function useCases(filter: CaseFilter) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["cases", orgId, filter],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = supabase
        .from("cases")
        .select("*, companies(name)")
        .eq("org_id", orgId!)
        .is("deleted_at", null)
        .order("last_activity_at", { ascending: false })
        .limit(100);
      if (filter === "active") query = query.in("status", ["open", "waiting"]);
      if (filter === "done") query = query.in("status", ["done", "archived"]);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as CaseListRow[];
    },
  });
}

export function useCase(caseId: string | undefined) {
  return useQuery({
    queryKey: ["case", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("*, companies(name)")
        .eq("id", caseId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Vorgang nicht gefunden");
      return data as CaseListRow;
    },
  });
}

export function useCaseEvents(caseId: string | undefined) {
  return useQuery({
    queryKey: ["case_events", caseId],
    enabled: !!caseId,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_events")
        .select("*")
        .eq("case_id", caseId!)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as CaseEventRow[];
    },
  });
}

export function useCaseThreads(caseId: string | undefined) {
  return useQuery({
    queryKey: ["case_threads", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mail_threads")
        .select("*")
        .eq("case_id", caseId!)
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as MailThreadRow[];
    },
  });
}

export function useCreateCase() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title: string): Promise<CaseRow> => {
      const { data, error } = await supabase.rpc("create_case", {
        p_org: orgId,
        p_title: title,
        p_source: "manual",
        p_created_by: userId,
      });
      if (error) throw new Error(error.message);
      return data as CaseRow;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cases", orgId] }),
  });
}

export function useUpdateCase() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      caseId,
      patch,
    }: {
      caseId: string;
      patch: Partial<Pick<CaseRow, "status" | "title" | "reference">>;
    }) => {
      const { error } = await supabase.from("cases").update(patch).eq("id", caseId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, { caseId }) => {
      void queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      void queryClient.invalidateQueries({ queryKey: ["cases", orgId] });
    },
  });
}
