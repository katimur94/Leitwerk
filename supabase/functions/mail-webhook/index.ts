// mail-webhook — Gmail Pub/Sub Push-Benachrichtigungen (optional).
// Implementierung folgt in Phase 1 (MASTERPLAN §4 B).
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({ error: "mail-webhook ist noch nicht implementiert (Phase 1)" }, 501);
});
