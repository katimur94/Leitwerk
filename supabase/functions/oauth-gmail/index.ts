// oauth-gmail — Gmail-OAuth-Flow (Start + Callback), Refresh-Token → Vault.
// Implementierung folgt in Phase 1 (MASTERPLAN §4 B, tutorials/02_google_oauth.md).
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({ error: "oauth-gmail ist noch nicht implementiert (Phase 1)" }, 501);
});
