import { useEffect, type ReactNode } from "react";
import type { OrgRow, ProfileRow } from "@leitwerk/shared";
import { supabase } from "../lib/supabase";
import { useSessionStore } from "../stores/session";

/** Lädt Profil + aktive Org für den angemeldeten Nutzer. */
async function loadContext(userId: string): Promise<{
  profile: ProfileRow | null;
  activeOrg: OrgRow | null;
}> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  let activeOrg: OrgRow | null = null;

  if (profile?.active_org_id) {
    const { data: org } = await supabase
      .from("orgs")
      .select("*")
      .eq("id", profile.active_org_id)
      .maybeSingle();
    activeOrg = (org as OrgRow | null) ?? null;
  }

  if (!activeOrg) {
    // Fallback: erste Mitgliedschaft nehmen und als aktiv markieren
    const { data: membership } = await supabase
      .from("org_members")
      .select("org_id, orgs(*)")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    const org = (membership?.orgs as unknown as OrgRow | null) ?? null;
    if (org) {
      activeOrg = org;
      await supabase
        .from("profiles")
        .update({ active_org_id: org.id })
        .eq("id", userId);
    }
  }

  return { profile: (profile as ProfileRow | null) ?? null, activeOrg };
}

/** Lädt den Kontext neu (z. B. nach Org-Anlage im Onboarding). */
export async function refreshSessionContext(): Promise<void> {
  const state = useSessionStore.getState();
  const userId = state.session?.user.id;
  if (!userId) return;
  const context = await loadContext(userId);
  state.set(context);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const set = useSessionStore((s) => s.set);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(sessionUserId: string | undefined) {
      if (!sessionUserId) {
        set({ profile: null, activeOrg: null, loading: false });
        return;
      }
      const context = await loadContext(sessionUserId);
      if (!cancelled) set({ ...context, loading: false });
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      set({ session: data.session });
      void bootstrap(data.session?.user.id);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (cancelled) return;
        set({ session });
        void bootstrap(session?.user.id);
      },
    );

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [set]);

  return <>{children}</>;
}
