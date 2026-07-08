import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRuleRow, RuleAction, RuleCondition } from "@leitwerk/shared";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

export function useOrgRules() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["org_rules", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_rules")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as OrgRuleRow[];
    },
  });
}

export interface NewOrgRule {
  name: string;
  trigger_event: string;
  conditions: RuleCondition[];
  action: RuleAction;
}

export function useCreateRule() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rule: NewOrgRule) => {
      if (!orgId || !userId) throw new Error("Keine aktive Organisation");
      const { error } = await supabase.from("org_rules").insert({
        org_id: orgId,
        created_by: userId,
        ...rule,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["org_rules", orgId] }),
  });
}

export function useToggleRule() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { error } = await supabase
        .from("org_rules")
        .update({ is_enabled })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["org_rules", orgId] }),
  });
}

export function useDeleteRule() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("org_rules").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["org_rules", orgId] }),
  });
}
