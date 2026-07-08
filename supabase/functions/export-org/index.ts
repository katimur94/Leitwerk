// export-org — kompletter Datenexport einer Organisation (MASTERPLAN §4 X):
// „kein Lock-in“. Sammelt alle org-scoped Tabellen als JSON-Snapshot und legt
// ihn im Bucket 'exports' ab (org/<org_id>/export/<ts>.json). Binärdateien
// (Anhänge, Audio, XML) sind per storage_path referenziert und liegen in ihren
// Buckets — der Betreiber kann sie mit dem Snapshot zusammen archivieren.
// Nur Owner/Admin. Viewer + Nicht-Mitglieder werden abgelehnt.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";

// org-scoped Tabellen, die in den Export wandern (Reihenfolge = Lesereihenfolge)
const EXPORT_TABLES = [
  "org_profile",
  "org_members",
  "number_ranges",
  "companies",
  "contacts",
  "cases",
  "case_events",
  "mail_accounts",
  "mail_threads",
  "mail_messages",
  "mail_attachments",
  "mail_drafts",
  "thread_comments",
  "tasks",
  "task_checklist_items",
  "calendar_accounts",
  "calendar_events",
  "invoices_in",
  "invoices_out",
  "invoice_items",
  "quotes",
  "quote_items",
  "dunning_runs",
  "documents",
  "notes",
  "knowledge_items",
  "meetings",
  "meeting_segments",
  "automations",
  "automation_runs",
  "agent_findings",
  "briefings",
  "followups",
  "org_rules",
];

async function requireOwnerAdmin(
  db: SupabaseClient,
  req: Request,
  orgId: string,
): Promise<boolean> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await db.auth.getUser(jwt);
  if (!data.user) return false;
  const { data: member } = await db
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .maybeSingle();
  return !!member && (member.role === "owner" || member.role === "admin");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const db = serviceClient();
  try {
    const body = await req.json().catch(() => ({}));
    const orgId = String(body.orgId ?? "");
    if (!orgId) return json({ error: "orgId ist Pflicht" }, 400);
    if (!(await requireOwnerAdmin(db, req, orgId))) {
      return json({ error: "Nur Owner/Admin dürfen exportieren" }, 403);
    }

    const snapshot: Record<string, unknown> = {
      exported_at: new Date().toISOString(),
      org_id: orgId,
      format: "leitwerk-export-v1",
    };
    const counts: Record<string, number> = {};
    for (const table of EXPORT_TABLES) {
      const { data, error } = await db.from(table).select("*").eq("org_id", orgId);
      if (error) continue; // Tabelle ohne org_id-Spalte o. Ä. → überspringen
      snapshot[table] = data ?? [];
      counts[table] = (data ?? []).length;
    }

    const path = `org/${orgId}/export/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const payload = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
    const { error: upErr } = await db.storage
      .from("exports")
      .upload(path, payload, { contentType: "application/json", upsert: true });
    if (upErr) return json({ error: `Upload fehlgeschlagen: ${upErr.message}` }, 500);

    const { data: signed } = await db.storage.from("exports").createSignedUrl(path, 3600);

    return json({ ok: true, storagePath: path, signedUrl: signed?.signedUrl ?? null, counts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
