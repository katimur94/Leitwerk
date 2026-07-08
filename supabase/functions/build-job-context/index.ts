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

    // P2: Verpflichtungen & Fristen → Aufgaben-Vorschläge
    case "extract_commitments": {
      const { data: message } = await db
        .from("mail_messages")
        .select("id, org_id, subject, from_addr, body_text, sent_at")
        .eq("id", String(job.payload.message_id ?? ""))
        .maybeSingle();
      if (!message || message.org_id !== job.org_id) return null;
      const { data: existing } = await db
        .from("tasks")
        .select("title")
        .eq("org_id", job.org_id)
        .eq("source_entity_id", message.id)
        .limit(20);
      return {
        jobId: job.id,
        jobType: "extract_commitments",
        locale: "de-DE",
        today: new Date().toISOString().slice(0, 10),
        message: {
          subject: message.subject ?? "",
          from: message.from_addr ?? { email: "" },
          body_excerpt: excerpt(message.body_text, 4000),
          sent_at: message.sent_at,
        },
        existing_tasks: (existing ?? []).map((t) => t.title),
      };
    }

    // P2: Nacht-Wächter — Signale einsammeln (datenminimiert)
    case "gap_scan": {
      const now = Date.now();
      const { data: staleCases } = await db
        .from("cases")
        .select("id, case_number, title, status, last_activity_at")
        .eq("org_id", job.org_id)
        .in("status", ["open", "waiting"])
        .is("deleted_at", null)
        .lt("last_activity_at", new Date(now - 5 * 86_400_000).toISOString())
        .order("last_activity_at", { ascending: true })
        .limit(15);
      const { data: unanswered } = await db
        .from("mail_threads")
        .select("id, subject, participants, last_message_at, urgency, is_unread")
        .eq("org_id", job.org_id)
        .eq("is_unread", true)
        .is("archived_at", null)
        .lt("last_message_at", new Date(now - 2 * 86_400_000).toISOString())
        .order("last_message_at", { ascending: true })
        .limit(15);
      const { count: overdueFollowups } = await db
        .from("followups")
        .select("id", { count: "exact", head: true })
        .eq("org_id", job.org_id)
        .eq("status", "waiting")
        .lt("expected_by", new Date().toISOString());
      const { count: overdueTasks } = await db
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("org_id", job.org_id)
        .in("status", ["open", "in_progress"])
        .lt("due_at", new Date().toISOString());
      const days = (iso: string | null) =>
        iso ? Math.floor((now - Date.parse(iso)) / 86_400_000) : 0;
      return {
        jobId: job.id,
        jobType: "gap_scan",
        locale: "de-DE",
        today: new Date().toISOString().slice(0, 10),
        stale_cases: (staleCases ?? []).map((c) => ({
          case_id: c.id,
          case_number: c.case_number,
          title: c.title,
          status: c.status,
          days_inactive: days(c.last_activity_at),
        })),
        unanswered_threads: (unanswered ?? []).map((t) => ({
          thread_id: t.id,
          subject: t.subject ?? "",
          from: ((t.participants as Addr[] | null) ?? [])[0]?.email ?? "",
          days_waiting: days(t.last_message_at),
          urgency: t.urgency,
        })),
        overdue_followups: overdueFollowups ?? 0,
        overdue_tasks: overdueTasks ?? 0,
      };
    }

    // P2: Morgen-Briefing — Kennzahlen + wichtigste Objekte
    case "morning_briefing": {
      const today = new Date().toISOString().slice(0, 10);
      const { data: org } = await db
        .from("orgs")
        .select("name")
        .eq("id", job.org_id)
        .maybeSingle();
      const { data: urgentThreads } = await db
        .from("mail_threads")
        .select("id, subject, urgency, is_unread")
        .eq("org_id", job.org_id)
        .eq("is_unread", true)
        .is("archived_at", null)
        .order("urgency", { ascending: true, nullsFirst: false })
        .limit(5);
      const { data: dueTasks } = await db
        .from("tasks")
        .select("id, title, due_at")
        .eq("org_id", job.org_id)
        .in("status", ["open", "in_progress"])
        .lte("due_at", `${today}T23:59:59Z`)
        .order("due_at", { ascending: true })
        .limit(5);
      const { data: findings } = await db
        .from("agent_findings")
        .select("id, title, severity")
        .eq("org_id", job.org_id)
        .eq("status", "open")
        .order("severity", { ascending: true })
        .limit(5);
      const { count: overdueFollowups } = await db
        .from("followups")
        .select("id", { count: "exact", head: true })
        .eq("org_id", job.org_id)
        .eq("status", "waiting")
        .lt("expected_by", new Date().toISOString());
      const { count: unreadCount } = await db
        .from("mail_threads")
        .select("id", { count: "exact", head: true })
        .eq("org_id", job.org_id)
        .eq("is_unread", true)
        .is("archived_at", null);
      return {
        jobId: job.id,
        jobType: "morning_briefing",
        locale: "de-DE",
        for_date: today,
        org_name: org?.name ?? "",
        stats: {
          unread_threads: unreadCount ?? 0,
          urgent_threads: (urgentThreads ?? []).filter((t) => (t.urgency ?? 5) <= 2).length,
          due_tasks: (dueTasks ?? []).length,
          overdue_followups: overdueFollowups ?? 0,
          open_findings: (findings ?? []).length,
        },
        top_items: [
          ...(urgentThreads ?? []).map((t) => ({
            entity_type: "mail_thread",
            entity_id: t.id,
            title: t.subject ?? "(kein Betreff)",
            detail: `ungelesen${t.urgency ? `, Dringlichkeit ${t.urgency}` : ""}`,
          })),
          ...(dueTasks ?? []).map((t) => ({
            entity_type: "task",
            entity_id: t.id,
            title: t.title,
            detail: `fällig ${t.due_at ?? ""}`,
          })),
          ...(findings ?? []).map((f) => ({
            entity_type: "agent_finding",
            entity_id: f.id,
            title: f.title,
            detail: `Severity ${f.severity}`,
          })),
        ].slice(0, 12),
      };
    }

    // P2: überfällige Follow-ups bewerten
    case "followup_check": {
      const { data: overdue } = await db
        .from("followups")
        .select("id, entity_id, expected_by")
        .eq("org_id", job.org_id)
        .eq("status", "waiting")
        .eq("entity_type", "mail_thread")
        .lt("expected_by", new Date().toISOString())
        .limit(20);
      // entity_id ist polymorph (kein FK) → Threads separat laden
      const threadIds = (overdue ?? []).map((f) => f.entity_id);
      const { data: threads } = threadIds.length
        ? await db
            .from("mail_threads")
            .select("id, subject, participants")
            .in("id", threadIds)
        : { data: [] };
      const threadById = new Map(
        (threads ?? []).map((t) => [t.id, t as { subject?: string; participants?: Addr[] }]),
      );
      return {
        jobId: job.id,
        jobType: "followup_check",
        locale: "de-DE",
        today: new Date().toISOString().slice(0, 10),
        overdue: (overdue ?? []).map((f) => {
          const thread = threadById.get(f.entity_id);
          return {
            followup_id: f.id,
            thread_id: f.entity_id,
            subject: thread?.subject ?? "",
            counterpart: thread?.participants?.[0]?.email ?? "",
            expected_by: f.expected_by,
            days_overdue: Math.max(
              0,
              Math.floor((Date.now() - Date.parse(f.expected_by)) / 86_400_000),
            ),
          };
        }),
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
