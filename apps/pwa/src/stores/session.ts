import type { Session } from "@supabase/supabase-js";
import type { OrgRow, ProfileRow } from "@leitwerk/shared";
import { create } from "zustand";

interface SessionState {
  /** true bis der initiale Auth-/Kontext-Bootstrap durch ist */
  loading: boolean;
  session: Session | null;
  profile: ProfileRow | null;
  activeOrg: OrgRow | null;
  set: (partial: Partial<Omit<SessionState, "set">>) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  loading: true,
  session: null,
  profile: null,
  activeOrg: null,
  set: (partial) => set(partial),
}));
