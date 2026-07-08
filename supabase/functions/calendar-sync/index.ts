// calendar-sync — Schnittstelle für den Runner-Connector gcal-sync (Etappe 5).
// Der Runner schreibt NIE direkt in die Datenbank (CLAUDE.md Regel 2):
//   POST /token   {accountId}          → kurzlebiges Calendar-Access-Token
//                                         (Refresh-Token bleibt im Vault)
//   POST /ingest  {accountId, events…} → calendar_events upserten,
//                                         Cursor (syncToken) + Status fortschreiben
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import { verifyRunner, type RunnerRow } from "../_shared/runner-auth.ts";
import { accessTokenForAccount } from "../_shared/google.ts";

interface CalendarAccountRow {
  id: string;
  org_id: string;
  calendar_ref: string;
  provider: string;
  vault_secret_id: string | null;
}

interface IngestEvent {
  provider_event_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  attendees: Array<{ name?: string; email: string }>;
  status: "confirmed" | "tentative" | "cancelled";
}

async function accountForRunner(
  db: SupabaseClient,
  runner: RunnerRow,
  accountId: string,
): Promise<CalendarAccountRow | null> {
  if (!accountId) return null;
  const { data } = await db
    .from("calendar_accounts")
    .select("id, org_id, calendar_ref, provider, vault_secret_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!data || data.org_id !== runner.org_id) return null;
  return data as CalendarAccountRow;
}

async function handleToken(db: SupabaseClient, runner: RunnerRow, req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const account = await accountForRunner(db, runner, String(body.accountId ?? ""));
  if (!account) return json({ error: "Kalender nicht gefunden" }, 404);
  const { accessToken, expiresIn } = await accessTokenForAccount(db, account);
  return json({ accessToken, expiresIn, calendarRef: account.calendar_ref });
}

async function handleIngest(db: SupabaseClient, runner: RunnerRow, req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const account = await accountForRunner(db, runner, String(body.accountId ?? ""));
  if (!account) return json({ error: "Kalender nicht gefunden" }, 404);

  const events: IngestEvent[] = Array.isArray(body.events) ? body.events.slice(0, 1000) : [];
  let upserted = 0;
  for (const ev of events) {
    if (!ev.provider_event_id || !ev.starts_at) continue;
    const { error } = await db
      .from("calendar_events")
      .upsert(
        {
          org_id: account.org_id,
          account_id: account.id,
          provider_event_id: ev.provider_event_id,
          title: ev.title ?? "(ohne Titel)",
          description: ev.description ?? null,
          location: ev.location ?? null,
          starts_at: ev.starts_at,
          ends_at: ev.ends_at ?? ev.starts_at,
          all_day: ev.all_day ?? false,
          attendees: ev.attendees ?? [],
          status: ev.status ?? "confirmed",
        },
        { onConflict: "account_id,provider_event_id" },
      );
    if (!error) upserted += 1;
  }

  await db
    .from("calendar_accounts")
    .update({
      sync_cursor: body.cursor ?? null,
      sync_state: body.syncState ?? "ok",
      last_sync_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  return json({ ok: true, events: upserted });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const db = serviceClient();
  try {
    const runner = await verifyRunner(db, req);
    if (!runner) return json({ error: "Runner-Authentifizierung fehlgeschlagen" }, 401);

    const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
    switch (action) {
      case "token":
        return await handleToken(db, runner, req);
      case "ingest":
        return await handleIngest(db, runner, req);
      default:
        return json({ error: `Unbekannte Aktion: ${action}` }, 404);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
