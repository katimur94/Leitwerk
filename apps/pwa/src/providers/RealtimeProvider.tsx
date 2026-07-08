import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useSessionStore } from "../stores/session";

/**
 * Zentrale Realtime-Subscriptions (CLAUDE.md Konventionen):
 * agent_jobs + runners der eigenen Org, notifications des Nutzers.
 * Events invalidieren die passenden Queries — Views bleiben live.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!orgId || !userId) return;

    const channel = supabase
      .channel(`org-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_jobs",
          filter: `org_id=eq.${orgId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ["jobs", orgId] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "runners",
          filter: `org_id=eq.${orgId}`,
        },
        () =>
          void queryClient.invalidateQueries({ queryKey: ["runners", orgId] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () =>
          void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      )
      // Mail-Hub (Etappe 1): Threads/Nachrichten/Entwürfe live halten
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mail_threads",
          filter: `org_id=eq.${orgId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["mail_threads", orgId] });
          void queryClient.invalidateQueries({ queryKey: ["mail_thread"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mail_messages",
          filter: `org_id=eq.${orgId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ["mail_messages"] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mail_drafts",
          filter: `org_id=eq.${orgId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ["mail_drafts"] }),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, userId, queryClient]);

  return <>{children}</>;
}
