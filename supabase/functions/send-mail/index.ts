// send-mail — versendet fällige Entwürfe über die Gmail-API (MASTERPLAN §4 B, U).
// Zwei Aufrufwege:
//   {draftId}     mit Nutzer-JWT: sendet EINEN fälligen Entwurf (30s-Undo:
//                 die PWA plant status='scheduled' + send_after und ruft nach
//                 Ablauf hier an; Undo = Status zurück auf 'draft')
//   {mode:'due'}  mit Service-Role-Key (pg_cron + pg_net): sendet alle fälligen
//                 Entwürfe — Fallback, falls der Browser geschlossen wurde,
//                 und Vollzugsweg für die Stufe-3-Halte-Zone (status='holding').
// send_after wird SERVERSEITIG erzwungen — vor Ablauf wird nie gesendet.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import { accessTokenForAccount } from "../_shared/google.ts";

interface Address {
  name?: string;
  email: string;
}

interface DraftRow {
  id: string;
  org_id: string;
  account_id: string;
  thread_id: string | null;
  status: string;
  send_after: string | null;
  to_addrs: Address[];
  cc_addrs: Address[];
  subject: string | null;
  body_html: string | null;
  attachments: Array<{ storage_path: string; filename: string; mime_type?: string }>;
  created_by: string | null;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** RFC-2047-Encoding für Nicht-ASCII-Header (Betreff, Namen). */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${b64(new TextEncoder().encode(value))}?=`;
}

function formatAddr(a: Address): string {
  return a.name ? `${encodeHeader(a.name)} <${a.email}>` : a.email;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function buildMime(
  db: SupabaseClient,
  draft: DraftRow,
  fromEmail: string,
  replyHeaders: { inReplyTo?: string; references?: string },
): Promise<string> {
  const html = draft.body_html ?? "";
  const text = htmlToText(html);
  const altBoundary = `alt_${crypto.randomUUID().replaceAll("-", "")}`;
  const mixedBoundary = `mix_${crypto.randomUUID().replaceAll("-", "")}`;

  const headers = [
    `From: ${fromEmail}`,
    `To: ${draft.to_addrs.map(formatAddr).join(", ")}`,
    draft.cc_addrs.length ? `Cc: ${draft.cc_addrs.map(formatAddr).join(", ")}` : null,
    `Subject: ${encodeHeader(draft.subject ?? "")}`,
    replyHeaders.inReplyTo ? `In-Reply-To: ${replyHeaders.inReplyTo}` : null,
    replyHeaders.references ? `References: ${replyHeaders.references}` : null,
    "MIME-Version: 1.0",
  ].filter(Boolean) as string[];

  const alternative = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(new TextEncoder().encode(text)),
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(new TextEncoder().encode(html)),
    `--${altBoundary}--`,
  ].join("\r\n");

  if (draft.attachments.length === 0) {
    return [...headers, alternative].join("\r\n");
  }

  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    alternative,
  ];
  for (const attachment of draft.attachments) {
    const { data, error } = await db.storage
      .from("attachments")
      .download(attachment.storage_path);
    if (error || !data) {
      throw new Error(`Anhang nicht lesbar: ${attachment.filename}`);
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.mime_type ?? "application/octet-stream"}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      b64(bytes),
    );
  }
  parts.push(`--${mixedBoundary}--`);
  return parts.join("\r\n");
}

/** Einen fälligen Entwurf senden; wirft bei Fehlern. */
async function sendDraft(db: SupabaseClient, draft: DraftRow): Promise<string> {
  const { data: account } = await db
    .from("mail_accounts")
    .select("id, org_id, email_address, vault_secret_id, provider")
    .eq("id", draft.account_id)
    .maybeSingle();
  if (!account) throw new Error("Mail-Konto nicht gefunden");
  if (account.provider !== "gmail") throw new Error("Nur Gmail wird in Phase 1 unterstützt");

  const { accessToken } = await accessTokenForAccount(db, account);

  // Reply-Kontext: Gmail-threadId + RFC-Message-ID der letzten Nachricht
  let providerThreadId: string | null = null;
  const replyHeaders: { inReplyTo?: string; references?: string } = {};
  if (draft.thread_id) {
    const { data: thread } = await db
      .from("mail_threads")
      .select("provider_thread_id")
      .eq("id", draft.thread_id)
      .maybeSingle();
    providerThreadId = thread?.provider_thread_id ?? null;
    const { data: lastMsg } = await db
      .from("mail_messages")
      .select("rfc822_message_id")
      .eq("thread_id", draft.thread_id)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastMsg?.rfc822_message_id) {
      replyHeaders.inReplyTo = lastMsg.rfc822_message_id;
      replyHeaders.references = lastMsg.rfc822_message_id;
    }
  }

  const mime = await buildMime(db, draft, account.email_address, replyHeaders);
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: b64url(new TextEncoder().encode(mime)),
        ...(providerThreadId ? { threadId: providerThreadId } : {}),
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gmail-Versand fehlgeschlagen (${res.status}): ${await res.text()}`);
  }
  const sent = (await res.json()) as { id: string; threadId: string };

  // Thread sicherstellen (neue Konversation → neuer Gmail-Thread)
  let threadId = draft.thread_id;
  if (!threadId) {
    const { data: thread, error } = await db
      .from("mail_threads")
      .upsert(
        {
          org_id: draft.org_id,
          account_id: draft.account_id,
          provider_thread_id: sent.threadId,
          subject: draft.subject,
          participants: draft.to_addrs,
          is_unread: false,
        },
        { onConflict: "account_id,provider_thread_id" },
      )
      .select("id")
      .single();
    if (error || !thread) throw new Error(`Thread-Anlage: ${error?.message}`);
    threadId = thread.id;
  }

  // Outbound-Message ablegen — Trigger on_mail_sent_message pflegt
  // Timeline + Regel-Engine ('mail_sent'); der Gmail-Sync dedupliziert
  // über (account_id, provider_msg_id).
  const { data: message, error: msgError } = await db
    .from("mail_messages")
    .upsert(
      {
        org_id: draft.org_id,
        thread_id: threadId,
        account_id: draft.account_id,
        provider_msg_id: sent.id,
        direction: "outbound",
        from_addr: { email: account.email_address },
        to_addrs: draft.to_addrs,
        cc_addrs: draft.cc_addrs,
        sent_at: new Date().toISOString(),
        subject: draft.subject,
        body_text: htmlToText(draft.body_html ?? ""),
        body_html: draft.body_html,
        has_attachments: draft.attachments.length > 0,
        is_read: true,
      },
      { onConflict: "account_id,provider_msg_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (msgError) throw new Error(msgError.message);

  await db
    .from("mail_drafts")
    .update({ status: "sent", sent_message_id: message?.id ?? null, thread_id: threadId })
    .eq("id", draft.id);

  await db.from("audit_log").insert({
    org_id: draft.org_id,
    actor_type: draft.created_by ? "user" : "system",
    actor_id: draft.created_by,
    action: "mail.sent",
    entity_type: "mail_draft",
    entity_id: draft.id,
  });

  return sent.id;
}

const DUE_STATUSES = ["scheduled", "holding"];

async function loadDueDraft(db: SupabaseClient, draftId: string): Promise<DraftRow | null> {
  const { data } = await db
    .from("mail_drafts")
    .select("id, org_id, account_id, thread_id, status, send_after, to_addrs, cc_addrs, subject, body_html, attachments, created_by")
    .eq("id", draftId)
    .maybeSingle();
  return (data as DraftRow) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const db = serviceClient();
  const body = await req.json().catch(() => ({}));
  const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  try {
    // ---- Cron-/Service-Pfad: alle fälligen Entwürfe senden ----
    if (body.mode === "due") {
      if (auth !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
        return json({ error: "Nur mit Service-Role-Key aufrufbar" }, 403);
      }
      const { data: due } = await db
        .from("mail_drafts")
        .select("id, org_id, account_id, thread_id, status, send_after, to_addrs, cc_addrs, subject, body_html, attachments, created_by")
        .in("status", DUE_STATUSES)
        .lte("send_after", new Date().toISOString())
        .limit(20);
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const draft of (due ?? []) as DraftRow[]) {
        try {
          await sendDraft(db, draft);
          results.push({ id: draft.id, ok: true });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await db.from("mail_drafts").update({ status: "draft" }).eq("id", draft.id);
          results.push({ id: draft.id, ok: false, error: message });
        }
      }
      return json({ processed: results.length, results });
    }

    // ---- Nutzer-Pfad: einen konkreten Entwurf senden ----
    const { data: userData } = await db.auth.getUser(auth);
    if (!userData?.user) return json({ error: "Nicht angemeldet" }, 401);

    const draftId = String(body.draftId ?? "");
    if (!draftId) return json({ error: "draftId ist Pflicht" }, 400);
    const draft = await loadDueDraft(db, draftId);
    if (!draft) return json({ error: "Entwurf nicht gefunden" }, 404);

    const { data: member } = await db
      .from("org_members")
      .select("role")
      .eq("org_id", draft.org_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!member || member.role === "viewer") {
      return json({ error: "Keine Berechtigung" }, 403);
    }

    if (!DUE_STATUSES.includes(draft.status)) {
      return json({ error: `Entwurf ist nicht sendebereit (Status: ${draft.status})` }, 409);
    }
    // 30s-Undo / Halte-Zone: send_after wird serverseitig erzwungen.
    if (draft.send_after && draft.send_after > new Date().toISOString()) {
      return json(
        { error: "Sende-Verzögerung läuft noch — Rückholen ist weiterhin möglich.", code: "not_due" },
        425,
      );
    }

    const providerMsgId = await sendDraft(db, draft);
    return json({ ok: true, providerMsgId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
