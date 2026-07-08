// export-xrechnung — XRechnung 3.x XML (EN16931) + ZUGFeRD-PDF (PDF/A-3).
// Implementierung folgt in Phase 3 (MASTERPLAN §4 F, X).
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({ error: "export-xrechnung ist noch nicht implementiert (Phase 3)" }, 501);
});
