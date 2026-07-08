// send-mail — versendet freigegebene Entwürfe (30s-Rückholen via send_after).
// Implementierung folgt in Phase 1 (MASTERPLAN §4 B, U).
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({ error: "send-mail ist noch nicht implementiert (Phase 1)" }, 501);
});
