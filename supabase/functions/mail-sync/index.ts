// mail-sync — Schnittstelle für den Runner-Connector gmail-sync.
// Der Runner schreibt NIE direkt in die Datenbank (CLAUDE.md Regel 2):
//   POST /token      {accountId}            → kurzlebiges Gmail-Access-Token
//                                             (Refresh-Token bleibt im Vault)
//   POST /ingest     {accountId, messages…} → Threads/Messages/Anhänge upserten,
//                                             Cursor + Sync-Status fortschreiben
//   POST /attachment ?accountId&filename&mime (Binary-Body)
//                                            → Blob in Bucket 'attachments'
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import { verifyRunner, type RunnerRow } from "../_shared/runner-auth.ts";
import { accessTokenForAccount } from "../_shared/google.ts";

interface MailAccountRow {
  id: string;
  org_id: string;
  provider: string;
  email_address: string;
  vault_secret_id: string | null;
}

async function accountForRunner(
  db: SupabaseClient,
  runner: RunnerRow,
  accountId: string,
): Promise<MailAccountRow | null> {
  if (!accountId) return null;
  const { data } = await db
    .from("mail_accounts")
    .select("id, org_id, provider, email_address, vault_secret_id")
    .eq("id", accountId)
    .maybeSingle();
  // Ein Runner darf nur Konten seiner eigenen Org anfassen.
  if (!data || data.org_id !== runner.org_id) return null;
  return data as MailAccountRow;
}

async function handleToken(
  db: SupabaseClient,
  runner: RunnerRow,
  req: Request,
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const account = await accountForRunner(db, runner, String(body.accountId ?? ""));
  if (!account) return json({ error: "Konto nicht gefunden" }, 404);
  const { accessToken, expiresIn } = await accessTokenForAccount(db, account);
  return json({ accessToken, expiresIn, emailAddress: account.email_address });
}

interface IngestMessage {
  provider_thread_id: string;
  provider_msg_id: string;
  rfc822_message_id?: string | null;
  direction: "inbound" | "outbound";
  from_addr: { name?: string; email: string };
  to_addrs?: unknown[];
  cc_addrs?: unknown[];
  sent_at?: string | null;
  subject?: string;
  body_text?: string;
  body_html?: string | null;
  is_read?: boolean;
  thread_subject?: string;
  labels?: string[];
  attachments?: Array<{
    filename: string;
    mime_type?: string | null;
    size_bytes?: number | null;
    storage_path?: string | null;
  }>;
}

async function handleIngest(
  db: SupabaseClient,
  runner: RunnerRow,
  req: Request,
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const account = await accountForRunner(db, runner, String(body.accountId ?? ""));
  if (!account) return json({ error: "Konto nicht gefunden" }, 404);

  const messages: IngestMessage[] = Array.isArray(body.messages)
    ? body.messages.slice(0, 200)
    : [];

  // 1) Threads sicherstellen (ein Batch: vorhandene laden, fehlende anlegen)
  const threadIds = [...new Set(messages.map((m) => m.provider_thread_id))];
  const threadMap = new Map<string, string>(); // provider_thread_id → uuid
  if (threadIds.length > 0) {
    const { data: existing } = await db
      .from("mail_threads")
      .select("id, provider_thread_id")
      .eq("account_id", account.id)
      .in("provider_thread_id", threadIds);
    for (const t of existing ?? []) threadMap.set(t.provider_thread_id, t.id);

    const missing = threadIds.filter((id) => !threadMap.has(id));
    if (missing.length > 0) {
      const rows = missing.map((providerThreadId) => {
        const first = messages.find((m) => m.provider_thread_id === providerThreadId)!;
        return {
          org_id: account.org_id,
          account_id: account.id,
          provider_thread_id: providerThreadId,
          subject: first.thread_subject || first.subject || null,
          participants: [first.from_addr, ...(first.to_addrs ?? [])].slice(0, 20),
          message_count: 0, // Trigger zählt pro Message hoch
          labels: first.labels ?? [],
        };
      });
      const { data: created, error } = await db
        .from("mail_threads")
        .upsert(rows, { onConflict: "account_id,provider_thread_id", ignoreDuplicates: false })
        .select("id, provider_thread_id");
      if (error) return json({ error: `Thread-Anlage: ${error.message}` }, 500);
      for (const t of created ?? []) threadMap.set(t.provider_thread_id, t.id);
    }
  }

  // 2) Messages idempotent einfügen (ON CONFLICT DO NOTHING über unique
  //    (account_id, provider_msg_id)); Trigger übernimmt Zähler/KI-Jobs/Regeln.
  const messageRows = messages
    .filter((m) => threadMap.has(m.provider_thread_id))
    .map((m) => ({
      org_id: account.org_id,
      thread_id: threadMap.get(m.provider_thread_id)!,
      account_id: account.id,
      provider_msg_id: m.provider_msg_id,
      rfc822_message_id: m.rfc822_message_id ?? null,
      direction: m.direction,
      from_addr: m.from_addr,
      to_addrs: m.to_addrs ?? [],
      cc_addrs: m.cc_addrs ?? [],
      sent_at: m.sent_at ?? null,
      subject: m.subject ?? null,
      body_text: m.body_text ?? null,
      body_html: m.body_html ?? null,
      has_attachments: (m.attachments ?? []).length > 0,
      is_read: m.is_read ?? false,
    }));

  let inserted: Array<{ id: string; provider_msg_id: string }> = [];
  if (messageRows.length > 0) {
    const { data, error } = await db
      .from("mail_messages")
      .upsert(messageRows, { onConflict: "account_id,provider_msg_id", ignoreDuplicates: true })
      .select("id, provider_msg_id");
    if (error) return json({ error: `Message-Ingest: ${error.message}` }, 500);
    inserted = data ?? [];
  }

  // 3) Anhangs-Metadaten für neu eingefügte Nachrichten
  const attachmentRows = inserted.flatMap((row) => {
    const source = messages.find((m) => m.provider_msg_id === row.provider_msg_id);
    return (source?.attachments ?? []).map((a) => ({
      org_id: account.org_id,
      message_id: row.id,
      filename: a.filename,
      mime_type: a.mime_type ?? null,
      size_bytes: a.size_bytes ?? null,
      storage_path: a.storage_path ?? null,
    }));
  });
  if (attachmentRows.length > 0) {
    const { error } = await db.from("mail_attachments").insert(attachmentRows);
    if (error) return json({ error: `Anhangs-Ingest: ${error.message}` }, 500);
  }

  // 4) Konto-Status fortschreiben
  const { error: accountError } = await db
    .from("mail_accounts")
    .update({
      sync_cursor: body.cursor ?? null,
      sync_state: body.syncState ?? "ok",
      last_sync_at: new Date().toISOString(),
      last_error: body.lastError ?? null,
    })
    .eq("id", account.id);
  if (accountError) return json({ error: accountError.message }, 500);

  return json({
    ok: true,
    threads: threadIds.length,
    messages: inserted.length,
    attachments: attachmentRows.length,
  });
}

async function handleAttachment(
  db: SupabaseClient,
  runner: RunnerRow,
  req: Request,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const account = await accountForRunner(db, runner, params.get("accountId") ?? "");
  if (!account) return json({ error: "Konto nicht gefunden" }, 404);

  const filename = (params.get("filename") ?? "anhang.bin").replace(/[^\w.\-äöüÄÖÜß ]/g, "_");
  const mime = params.get("mime") ?? "application/octet-stream";
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return json({ error: "Leerer Anhang" }, 400);
  if (bytes.length > 25 * 1024 * 1024) return json({ error: "Anhang größer als 25 MB" }, 413);

  const path = `org/${account.org_id}/${crypto.randomUUID()}/${filename}`;
  const { error } = await db.storage
    .from("attachments")
    .upload(path, bytes, { contentType: mime });
  if (error) return json({ error: `Storage-Upload: ${error.message}` }, 500);

  return json({ storagePath: path });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  const db = serviceClient();
  try {
    const runner = await verifyRunner(db, req);
    if (!runner) return json({ error: "Runner-Authentifizierung fehlgeschlagen" }, 401);

    switch (action) {
      case "token":
        return await handleToken(db, runner, req);
      case "ingest":
        return await handleIngest(db, runner, req);
      case "attachment":
        return await handleAttachment(db, runner, req);
      default:
        return json({ error: `Unbekannte Aktion: ${action}` }, 404);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
