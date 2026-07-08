import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalendarEventRow, ThreadCommentRow } from "@leitwerk/shared";
import { env } from "../../lib/env";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

export interface OrgMember {
  user_id: string;
  role: "owner" | "admin" | "member" | "viewer";
  display_name: string;
}

/** Aktive Mitglieder der Org (für Zuweisung + @Mentions). */
export function useOrgMembers() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["org_members", orgId],
    enabled: !!orgId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_members")
        .select("user_id, role, profiles(display_name)")
        .eq("org_id", orgId!)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      return (data ?? []).map((m) => ({
        user_id: m.user_id as string,
        role: m.role as OrgMember["role"],
        display_name:
          (m.profiles as { display_name?: string } | null)?.display_name ?? "Mitglied",
      }));
    },
  });
}

export function useAssignThread() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, assignee }: { threadId: string; assignee: string | null }) => {
      const { error } = await supabase.rpc("assign_thread", {
        p_thread: threadId,
        p_assignee: assignee,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mail_threads", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["mail_thread"] });
    },
  });
}

export function useThreadComments(threadId: string | undefined) {
  return useQuery({
    queryKey: ["thread_comments", threadId],
    enabled: !!threadId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("thread_comments")
        .select("*")
        .eq("thread_id", threadId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ThreadCommentRow[];
    },
  });
}

/** Kommentar mit @Mentions: erwähnte Namen → user_ids auflösen. */
export function useAddComment(threadId: string) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, mentions }: { body: string; mentions: string[] }) => {
      const { error } = await supabase.from("thread_comments").insert({
        org_id: orgId,
        thread_id: threadId,
        author_id: userId,
        body,
        mentions,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["thread_comments", threadId] }),
  });
}

// ---------- Kalender (Etappe 5) ----------

export function useCalendarEvents() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["calendar_events", orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const horizon = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("org_id", orgId!)
        .neq("status", "cancelled")
        .gte("starts_at", horizon)
        .order("starts_at", { ascending: true })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as CalendarEventRow[];
    },
  });
}

/** Wiederkehrende Aufgaben = Fristenkalender (MASTERPLAN §4 P). */
export function useRecurringTasks() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["recurring_tasks", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, due_at, recurrence, status")
        .eq("org_id", orgId!)
        .not("recurrence", "is", null)
        .order("due_at", { ascending: true })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{
        id: string;
        title: string;
        due_at: string | null;
        recurrence: Record<string, unknown> | null;
        status: string;
      }>;
    },
  });
}

/** Kompletter Org-Datenexport (Edge Function export-org, nur Owner/Admin). */
export function useExportOrg() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useMutation({
    mutationFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch(`${env.supabaseUrl}/functions/v1/export-org`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token}`,
          apikey: env.supabaseAnonKey,
        },
        body: JSON.stringify({ orgId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        storagePath?: string;
        signedUrl?: string;
        counts?: Record<string, number>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    },
  });
}

/** Terminvorschlag anfordern: suggest_slots-Job (Runner rechnet freie Slots). */
export function useRequestSlots() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      const { error } = await supabase.from("agent_jobs").insert({
        org_id: orgId,
        created_by: userId,
        job_type: "suggest_slots",
        priority: 2,
        payload: { thread_id: threadId },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs", orgId] }),
  });
}
