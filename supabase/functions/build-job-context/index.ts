// build-job-context — baut serverseitig den Kontext für KI-Jobs zusammen.
// Der Runner ist "dumm": er bekommt fertigen Kontext, baut daraus den Prompt
// (Skill.buildPrompt) und führt nur aus. Prompt-Logik bleibt so zentral
// versionierbar (MASTERPLAN §2.3) und der Kontext wird datenminimiert
// zugeschnitten (§6.3).
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import { verifyRunner } from "../_shared/runner-auth.ts";

interface JobRow {
  id: string;
  org_id: string;
  job_type: string;
  status: string;
  claimed_by: string | null;
  payload: Record<string, unknown>;
  context_hint: Record<string, unknown>;
}

const MAIL_CATEGORIES = [
  "anfrage",
  "auftrag",
  "rechnung",
  "termin",
  "mahnung",
  "newsletter",
  "spam_verdacht",
  "sonstiges",
];

interface Addr {
  name?: string;
  email: string;
}

function excerpt(text: string | null | undefined, max: number): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Letzte Nachrichten eines Threads, datenminimiert (§6.3). */
async function threadMessages(
  db: SupabaseClient,
  threadId: string,
  limit: number,
  charsPerMessage: number,
) {
  const { data } = await db
    .from("mail_messages")
    .select("direction, from_addr, sent_at, body_text, subject")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  return (data ?? []).reverse().map((m) => ({
    direction: m.direction as "inbound" | "outbound",
    from: (m.from_addr ?? { email: "" }) as Addr,
    sent_at: m.sent_at as string | null,
    body_excerpt: excerpt(m.body_text as string | null, charsPerMessage),
  }));
}

async function buildContext(
  db: SupabaseClient,
  job: JobRow,
): Promise<Record<string, unknown> | null> {
  switch (job.job_type) {
    // P0: Dummy-Job — KI beantwortet einen Testtext.
    case "echo":
      return {
        jobId: job.id,
        jobType: "echo",
        locale: "de-DE",
        input: { text: String(job.payload.text ?? "") },
      };

    // P1: Gmail-Sync (reiner Sync-Job, kein KI-Aufruf)
    case "sync_mail": {
      const { data: account } = await db
        .from("mail_accounts")
        .select("id, org_id, email_address, provider, sync_cursor")
        .eq("id", String(job.payload.account_id ?? ""))
        .maybeSingle();
      if (!account || account.org_id !== job.org_id) return null;
      return {
        jobId: job.id,
        jobType: "sync_mail",
        account: {
          id: account.id,
          email_address: account.email_address,
          provider: account.provider,
          sync_cursor: account.sync_cursor,
          initial_days: 90,
        },
      };
    }

    // P1: Kategorie + Dringlichkeit einer neuen Mail
    case "classify_email": {
      const { data: message } = await db
        .from("mail_messages")
        .select("id, org_id, thread_id, subject, from_addr, body_text, has_attachments, sent_at")
        .eq("id", String(job.payload.message_id ?? ""))
        .maybeSingle();
      if (!message || message.org_id !== job.org_id) return null;
      const { data: thread } = await db
        .from("mail_threads")
        .select("subject, message_count")
        .eq("id", message.thread_id)
        .maybeSingle();
      return {
        jobId: job.id,
        jobType: "classify_email",
        locale: "de-DE",
        categories: MAIL_CATEGORIES,
        message: {
          subject: message.subject ?? "",
          from: message.from_addr ?? { email: "" },
          body_excerpt: excerpt(message.body_text, 4000),
          has_attachments: message.has_attachments ?? false,
          sent_at: message.sent_at,
        },
        thread: {
          subject: thread?.subject ?? "",
          message_count: thread?.message_count ?? 1,
        },
      };
    }

    // P1: Zuordnung zu bestehendem Vorgang / Vorschlag "neu"
    case "case_match": {
      const { data: thread } = await db
        .from("mail_threads")
        .select("id, org_id, subject, participants, snippet, category")
        .eq("id", String(job.payload.thread_id ?? ""))
        .maybeSingle();
      if (!thread || thread.org_id !== job.org_id) return null;
      const { data: message } = await db
        .from("mail_messages")
        .select("from_addr, body_text")
        .eq("id", String(job.payload.message_id ?? ""))
        .maybeSingle();
      const { data: cases } = await db
        .from("cases")
        .select("id, case_number, title, status, reference, last_activity_at, companies(name)")
        .eq("org_id", job.org_id)
        .in("status", ["open", "waiting"])
        .is("deleted_at", null)
        .order("last_activity_at", { ascending: false })
        .limit(20);
      return {
        jobId: job.id,
        jobType: "case_match",
        locale: "de-DE",
        thread: {
          subject: thread.subject ?? "",
          participants: thread.participants ?? [],
          snippet: thread.snippet ?? "",
          category: thread.category,
        },
        message: {
          from: message?.from_addr ?? { email: "" },
          body_excerpt: excerpt(message?.body_text, 2000),
        },
        candidates: (cases ?? []).map((c) => ({
          case_id: c.id,
          case_number: c.case_number,
          title: c.title,
          status: c.status,
          company: (c.companies as { name?: string } | null)?.name ?? null,
          reference: c.reference,
          last_activity_at: c.last_activity_at,
        })),
      };
    }

    // P1: Antwortentwurf im Ton des Nutzers
    case "draft_reply": {
      const { data: thread } = await db
        .from("mail_threads")
        .select("id, org_id, account_id, subject")
        .eq("id", String(job.payload.thread_id ?? ""))
        .maybeSingle();
      if (!thread || thread.org_id !== job.org_id) return null;
      const messages = await threadMessages(db, thread.id, 10, 1500);
      const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
      const { data: account } = await db
        .from("mail_accounts")
        .select("email_address, display_name, signature_html, user_id")
        .eq("id", thread.account_id)
        .maybeSingle();
      const { data: style } = await db
        .from("ai_style_profiles")
        .select("profile")
        .eq("org_id", job.org_id)
        .eq("user_id", account?.user_id ?? "00000000-0000-0000-0000-000000000000")
        .maybeSingle();
      return {
        jobId: job.id,
        jobType: "draft_reply",
        locale: "de-DE",
        reply_to: lastInbound?.from ?? { email: "" },
        subject: thread.subject ?? "",
        messages,
        style_profile: style?.profile ?? {},
        signature_html: account?.signature_html ?? null,
        instructions: String(job.payload.instructions ?? ""),
        sender_name: account?.display_name ?? account?.email_address ?? "",
      };
    }

    // P1: Ein-Absatz-Zusammenfassung langer Threads
    case "thread_summary": {
      const { data: thread } = await db
        .from("mail_threads")
        .select("id, org_id, subject")
        .eq("id", String(job.payload.thread_id ?? ""))
        .maybeSingle();
      if (!thread || thread.org_id !== job.org_id) return null;
      return {
        jobId: job.id,
        jobType: "thread_summary",
        locale: "de-DE",
        subject: thread.subject ?? "",
        messages: await threadMessages(db, thread.id, 15, 1200),
      };
    }

    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const db = serviceClient();
  try {
    const runner = await verifyRunner(db, req);
    if (!runner) return json({ error: "Runner-Authentifizierung fehlgeschlagen" }, 401);

    const body = await req.json().catch(() => ({}));
    if (!body.jobId) return json({ error: "jobId ist Pflicht" }, 400);

    const { data: job, error } = await db
      .from("agent_jobs")
      .select("id, org_id, job_type, status, claimed_by, payload, context_hint")
      .eq("id", body.jobId)
      .maybeSingle();
    if (error || !job) return json({ error: "Job nicht gefunden" }, 404);

    // Kontext gibt es nur für den Runner, der den Job geclaimt hat.
    if (job.claimed_by !== runner.id || !["claimed", "running"].includes(job.status)) {
      return json({ error: "Job gehört nicht zu diesem Runner" }, 403);
    }

    const context = await buildContext(db, job as JobRow);
    if (!context) return json({ error: `Unbekannter Job-Typ: ${job.job_type}` }, 422);

    return json({ context });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
