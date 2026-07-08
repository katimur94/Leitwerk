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

    // P3: Rechnungsdaten aus Mail/Anhang extrahieren
    case "extract_invoice": {
      const { data: message } = await db
        .from("mail_messages")
        .select("id, org_id, subject, from_addr, body_text")
        .eq("id", String(job.payload.message_id ?? ""))
        .maybeSingle();
      if (!message || message.org_id !== job.org_id) return null;
      const { data: attachments } = await db
        .from("mail_attachments")
        .select("id, filename, mime_type, storage_path")
        .eq("message_id", message.id);
      return {
        jobId: job.id,
        jobType: "extract_invoice",
        locale: "de-DE",
        today: new Date().toISOString().slice(0, 10),
        message: {
          subject: message.subject ?? "",
          from: message.from_addr ?? { email: "" },
          body_excerpt: excerpt(message.body_text, 6000),
        },
        attachments: attachments ?? [],
      };
    }

    // P3: KI-Mahnentwurf pro Stufe (Versand erst nach Freigabe)
    case "draft_dunning": {
      const { data: invoice } = await db
        .from("invoices_out")
        .select("*, companies(name), contacts(first_name, last_name)")
        .eq("id", String(job.payload.invoice_id ?? ""))
        .maybeSingle();
      if (!invoice || invoice.org_id !== job.org_id) return null;
      const level = Number(job.payload.level ?? 1);
      const { data: profile } = await db
        .from("org_profile")
        .select("legal_name, iban, bank_name, dunning_fees")
        .eq("org_id", job.org_id)
        .maybeSingle();
      const company = invoice.companies as { name?: string } | null;
      const contact = invoice.contacts as { first_name?: string; last_name?: string } | null;
      const fees = (profile?.dunning_fees ?? {}) as Record<string, number>;
      return {
        jobId: job.id,
        jobType: "draft_dunning",
        locale: "de-DE",
        level,
        fee: Number(fees[String(level)] ?? 0),
        invoice: {
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date,
          due_date: invoice.due_date,
          gross_amount: Number(invoice.gross_amount),
          currency: invoice.currency,
          recipient_name:
            company?.name ??
            [contact?.first_name, contact?.last_name].filter(Boolean).join(" "),
        },
        org: {
          legal_name: profile?.legal_name ?? "",
          iban: profile?.iban ?? null,
          bank_name: profile?.bank_name ?? null,
        },
      };
    }

    // P4: Sprachnotiz transkribieren (lokal via Whisper)
    case "transcribe_note": {
      const { data: note } = await db
        .from("notes")
        .select("id, org_id")
        .eq("id", String(job.payload.note_id ?? ""))
        .maybeSingle();
      if (!note || note.org_id !== job.org_id) return null;
      const path = String(job.payload.audio_storage_path ?? "");
      if (!path.startsWith(`org/${job.org_id}/`)) return null;
      return {
        jobId: job.id,
        jobType: "transcribe_note",
        locale: "de-DE",
        note_id: note.id,
        audio_storage_path: path,
      };
    }

    // P4: Meeting-Audio transkribieren (lokal via whisper.cpp)
    case "transcribe_meeting": {
      const { data: meeting } = await db
        .from("meetings")
        .select("id, org_id, title, audio_storage_path")
        .eq("id", String(job.payload.meeting_id ?? ""))
        .maybeSingle();
      if (!meeting || meeting.org_id !== job.org_id || !meeting.audio_storage_path) return null;
      if (!String(meeting.audio_storage_path).startsWith(`org/${job.org_id}/`)) return null;
      return {
        jobId: job.id,
        jobType: "transcribe_meeting",
        locale: "de-DE",
        meeting_id: meeting.id,
        title: meeting.title ?? "",
        audio_storage_path: meeting.audio_storage_path,
      };
    }

    // P4: Protokoll + Entscheidungen + Aufgaben aus dem Transkript
    case "summarize_meeting": {
      const { data: meeting } = await db
        .from("meetings")
        .select("id, org_id, title, held_at, transcript, case_id, cases(case_number)")
        .eq("id", String(job.payload.meeting_id ?? ""))
        .maybeSingle();
      if (!meeting || meeting.org_id !== job.org_id || !meeting.transcript) return null;
      return {
        jobId: job.id,
        jobType: "summarize_meeting",
        locale: "de-DE",
        today: new Date().toISOString().slice(0, 10),
        meeting: {
          meeting_id: meeting.id,
          title: meeting.title ?? "",
          held_at: meeting.held_at,
          case_number: (meeting.cases as { case_number?: string } | null)?.case_number ?? null,
          transcript_excerpt: excerpt(meeting.transcript, 12000),
        },
      };
    }

    // P4: dauerhafte Fakten destillieren (Quellen der letzten 7 Tage)
    case "knowledge_distill": {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: messages } = await db
        .from("mail_messages")
        .select("id, subject, from_addr, body_text")
        .eq("org_id", job.org_id)
        .eq("direction", "inbound")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);
      const { data: meetings } = await db
        .from("meetings")
        .select("id, title, protocol_md")
        .eq("org_id", job.org_id)
        .not("protocol_md", "is", null)
        .gte("updated_at", since)
        .limit(10);
      const { data: known } = await db
        .from("knowledge_items")
        .select("fact")
        .eq("org_id", job.org_id)
        .neq("status", "rejected")
        .order("created_at", { ascending: false })
        .limit(100);
      return {
        jobId: job.id,
        jobType: "knowledge_distill",
        locale: "de-DE",
        today: new Date().toISOString().slice(0, 10),
        sources: [
          ...(messages ?? []).map((m) => ({
            source_type: "mail_message",
            source_id: m.id,
            title: m.subject ?? "",
            excerpt: excerpt(m.body_text, 800),
            counterpart: (m.from_addr as Addr | null)?.email ?? "",
          })),
          ...(meetings ?? []).map((m) => ({
            source_type: "meeting",
            source_id: m.id,
            title: m.title ?? "",
            excerpt: excerpt(m.protocol_md, 800),
            counterpart: "",
          })),
        ].slice(0, 40),
        known_facts: (known ?? []).map((k) => k.fact),
      };
    }

    // P4: Schreibstil aus den letzten gesendeten Mails
    case "build_style_profile": {
      const { data: account } = await db
        .from("mail_accounts")
        .select("id, org_id")
        .eq("id", String(job.payload.account_id ?? ""))
        .maybeSingle();
      if (!account || account.org_id !== job.org_id) return null;
      const { data: sent } = await db
        .from("mail_messages")
        .select("body_text")
        .eq("account_id", account.id)
        .eq("direction", "outbound")
        .order("sent_at", { ascending: false })
        .limit(20);
      return {
        jobId: job.id,
        jobType: "build_style_profile",
        locale: "de-DE",
        account_id: account.id,
        sent_samples: (sent ?? [])
          .map((m) => excerpt(m.body_text, 600))
          .filter((s) => s.length > 40),
      };
    }

    // P4: Embedding-Backlog — noch nicht eingebettete Inhalte (max. 64)
    case "embed_backlog": {
      const pending: Array<{
        entity_type: string;
        entity_id: string;
        chunk_index: number;
        content: string;
      }> = [];
      const { data: embedded } = await db
        .from("embeddings")
        .select("entity_type, entity_id")
        .eq("org_id", job.org_id)
        .limit(5000);
      const done = new Set((embedded ?? []).map((e) => `${e.entity_type}:${e.entity_id}`));
      const push = (type: string, id: string, content: string) => {
        if (pending.length >= 64 || !content.trim() || done.has(`${type}:${id}`)) return;
        pending.push({ entity_type: type, entity_id: id, chunk_index: 0, content: content.slice(0, 2000) });
      };
      const { data: messages } = await db
        .from("mail_messages")
        .select("id, subject, body_text")
        .eq("org_id", job.org_id)
        .order("created_at", { ascending: false })
        .limit(40);
      for (const m of messages ?? []) push("mail_message", m.id, `${m.subject ?? ""}\n${m.body_text ?? ""}`);
      const { data: notes } = await db
        .from("notes")
        .select("id, title, body_md")
        .eq("org_id", job.org_id)
        .order("created_at", { ascending: false })
        .limit(20);
      for (const n of notes ?? []) push("note", n.id, `${n.title ?? ""}\n${n.body_md ?? ""}`);
      const { data: knowledge } = await db
        .from("knowledge_items")
        .select("id, fact")
        .eq("org_id", job.org_id)
        .neq("status", "rejected")
        .limit(30);
      for (const k of knowledge ?? []) push("knowledge_item", k.id, k.fact);
      const { data: docs } = await db
        .from("documents")
        .select("id, title, ocr_text")
        .eq("org_id", job.org_id)
        .not("ocr_text", "is", null)
        .limit(20);
      for (const d of docs ?? []) push("document", d.id, `${d.title ?? ""}\n${d.ocr_text ?? ""}`);
      const { data: segments } = await db
        .from("meeting_segments")
        .select("id, content")
        .eq("org_id", job.org_id)
        .limit(30);
      for (const s of segments ?? []) push("meeting_segment", s.id, s.content ?? "");
      return {
        jobId: job.id,
        jobType: "embed_backlog",
        locale: "de-DE",
        pending,
      };
    }

    // P4: Query-Embedding für die kombinierte Suche (interaktiv)
    case "semantic_search":
      return {
        jobId: job.id,
        jobType: "semantic_search",
        locale: "de-DE",
        query: excerpt(String(job.payload.query ?? ""), 500),
      };

    // P5: Google-Calendar-Sync (Connector, kein KI-Aufruf)
    case "sync_calendar": {
      const { data: account } = await db
        .from("calendar_accounts")
        .select("id, org_id, calendar_ref, provider, sync_cursor")
        .eq("id", String(job.payload.account_id ?? ""))
        .maybeSingle();
      if (!account || account.org_id !== job.org_id) return null;
      return {
        jobId: job.id,
        jobType: "sync_calendar",
        account: {
          id: account.id,
          calendar_ref: account.calendar_ref,
          provider: account.provider,
          sync_cursor: account.sync_cursor,
          initial_days: 30,
        },
      };
    }

    // P5: Kontext-Briefing vor einem Termin
    case "calendar_briefing": {
      const { data: event } = await db
        .from("calendar_events")
        .select("id, org_id, title, starts_at, location, attendees, case_id, cases(case_number)")
        .eq("id", String(job.payload.event_id ?? ""))
        .maybeSingle();
      if (!event || event.org_id !== job.org_id) return null;
      const attendeeEmails = ((event.attendees as Array<{ email?: string }> | null) ?? [])
        .map((a) => a.email)
        .filter(Boolean) as string[];
      // Kontext: offene Vorgänge/Rechnungen zu den Teilnehmer-Domains (datenminimiert)
      const context: Array<{ kind: string; detail: string }> = [];
      if (event.case_id) {
        const { data: openInv } = await db
          .from("invoices_out")
          .select("invoice_number, gross_amount, status")
          .eq("org_id", job.org_id)
          .eq("case_id", event.case_id)
          .in("status", ["sent", "overdue", "partially_paid"])
          .limit(3);
        for (const inv of openInv ?? []) {
          context.push({
            kind: "Offene Rechnung",
            detail: `${inv.invoice_number}: ${inv.gross_amount} € (${inv.status})`,
          });
        }
      }
      for (const email of attendeeEmails.slice(0, 3)) {
        const { data: lastMsg } = await db
          .from("mail_messages")
          .select("subject, sent_at")
          .eq("org_id", job.org_id)
          .contains("from_addr", { email })
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastMsg) {
          context.push({ kind: `Letzte Mail von ${email}`, detail: `${lastMsg.subject ?? ""} (${lastMsg.sent_at ?? ""})` });
        }
      }
      return {
        jobId: job.id,
        jobType: "calendar_briefing",
        locale: "de-DE",
        today: new Date().toISOString().slice(0, 10),
        event: {
          event_id: event.id,
          title: event.title ?? "",
          starts_at: event.starts_at,
          location: event.location,
          attendees: attendeeEmails,
          case_number: (event.cases as { case_number?: string } | null)?.case_number ?? null,
        },
        context,
      };
    }

    // P5: Terminvorschlag — 3 freie Slots berechnen
    case "suggest_slots": {
      const { data: thread } = await db
        .from("mail_threads")
        .select("id, org_id, account_id, subject, participants")
        .eq("id", String(job.payload.thread_id ?? ""))
        .maybeSingle();
      if (!thread || thread.org_id !== job.org_id) return null;
      const { data: account } = await db
        .from("mail_accounts")
        .select("email_address, signature_html")
        .eq("id", thread.account_id)
        .maybeSingle();
      // Belegte Zeiten der nächsten 10 Tage laden
      const horizonStart = new Date();
      const horizonEnd = new Date(Date.now() + 10 * 86_400_000);
      const { data: busy } = await db
        .from("calendar_events")
        .select("starts_at, ends_at")
        .eq("org_id", job.org_id)
        .eq("status", "confirmed")
        .gte("starts_at", horizonStart.toISOString())
        .lte("starts_at", horizonEnd.toISOString());
      const busyRanges = (busy ?? []).map((b) => [Date.parse(b.starts_at), Date.parse(b.ends_at)]);
      const slots: Array<{ starts_at: string; ends_at: string; label: string }> = [];
      const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
      for (let day = 1; day <= 10 && slots.length < 3; day += 1) {
        const base = new Date(Date.now() + day * 86_400_000);
        if (base.getUTCDay() === 0 || base.getUTCDay() === 6) continue; // kein Wochenende
        for (const hour of [10, 14]) {
          if (slots.length >= 3) break;
          const start = new Date(base);
          start.setUTCHours(hour, 0, 0, 0);
          const end = new Date(start.getTime() + 60 * 60_000);
          const collides = busyRanges.some(([bs, be]) => start.getTime() < be && end.getTime() > bs);
          if (collides) continue;
          const label = `${dayNames[start.getUTCDay()]} ${String(start.getUTCDate()).padStart(2, "0")}.${String(start.getUTCMonth() + 1).padStart(2, "0")}. ${String(hour).padStart(2, "0")}:00`;
          slots.push({ starts_at: start.toISOString(), ends_at: end.toISOString(), label });
        }
      }
      const replyTo = ((thread.participants as Addr[] | null) ?? [])[0] ?? { email: "" };
      return {
        jobId: job.id,
        jobType: "suggest_slots",
        locale: "de-DE",
        today: new Date().toISOString().slice(0, 10),
        thread: { thread_id: thread.id, subject: thread.subject ?? "", reply_to: replyTo },
        free_slots: slots,
        signature_html: account?.signature_html ?? null,
      };
    }

    // P5: Wochenrückblick (freitags)
    case "weekly_report": {
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: org } = await db.from("orgs").select("name").eq("id", job.org_id).maybeSingle();
      const { count: mailsHandled } = await db
        .from("mail_messages")
        .select("id", { count: "exact", head: true })
        .eq("org_id", job.org_id)
        .gte("created_at", weekAgo);
      const { count: tasksDone } = await db
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("org_id", job.org_id)
        .eq("status", "done")
        .gte("completed_at", weekAgo);
      const { count: tasksOpen } = await db
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("org_id", job.org_id)
        .in("status", ["open", "in_progress"]);
      const { data: sentInv } = await db
        .from("invoices_out")
        .select("gross_amount, status, sent_at, paid_at")
        .eq("org_id", job.org_id);
      const invoicesSent = (sentInv ?? []).filter((i) => i.sent_at && i.sent_at >= weekAgo).length;
      const invoicesPaid = (sentInv ?? []).filter((i) => i.paid_at && i.paid_at >= weekAgo).length;
      const { data: quotes } = await db
        .from("quotes")
        .select("gross_amount, status")
        .eq("org_id", job.org_id)
        .in("status", ["sent", "followed_up"]);
      const pipelineCents = (quotes ?? []).reduce(
        (sum, q) => sum + Math.round((q.gross_amount ?? 0) * 100),
        0,
      );
      return {
        jobId: job.id,
        jobType: "weekly_report",
        locale: "de-DE",
        for_date: today,
        org_name: org?.name ?? "",
        stats: {
          mails_handled: mailsHandled ?? 0,
          tasks_done: tasksDone ?? 0,
          tasks_open: tasksOpen ?? 0,
          invoices_sent: invoicesSent,
          invoices_paid: invoicesPaid,
          pipeline_value_cents: pipelineCents,
          ai_accuracy: null,
        },
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
