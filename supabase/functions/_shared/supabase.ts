import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Service-Role-Client — nur in Edge Functions verwenden.
 * Der Browser sieht diesen Schlüssel NIE (CLAUDE.md Regel 1).
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export type { SupabaseClient };
