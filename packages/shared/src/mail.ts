// Etappe 1 — Mail-Hub: Job-Kontexte (von build-job-context geliefert),
// Job-Ergebnisse (striktes Zod-Parsing im Runner) und Mail-Row-Typen.
import { z } from "zod";

/** Kategorien aus 003_mail.sql (mail_threads.category). */
export const MAIL_CATEGORIES = [
  "anfrage",
  "auftrag",
  "rechnung",
  "termin",
  "mahnung",
  "newsletter",
  "spam_verdacht",
  "sonstiges",
] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const mailAddressSchema = z.object({
  name: z.string().optional().default(""),
  email: z.string(),
});
export type MailAddress = z.infer<typeof mailAddressSchema>;

// ---------- classify_email ----------

export const classifyEmailContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("classify_email"),
  locale: z.string().default("de-DE"),
  categories: z.array(z.string()).min(1),
  message: z.object({
    subject: z.string().default(""),
    from: mailAddressSchema,
    body_excerpt: z.string().default(""),
    has_attachments: z.boolean().default(false),
    sent_at: z.string().nullable().default(null),
  }),
  thread: z.object({
    subject: z.string().default(""),
    message_count: z.number().int().default(1),
  }),
});
export type ClassifyEmailContext = z.infer<typeof classifyEmailContextSchema>;

export const classifyEmailResultSchema = z.object({
  category: z.enum(MAIL_CATEGORIES),
  urgency: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});
export type ClassifyEmailResult = z.infer<typeof classifyEmailResultSchema>;

// ---------- case_match ----------

export const caseCandidateSchema = z.object({
  case_id: z.string().uuid(),
  case_number: z.string(),
  title: z.string(),
  status: z.string(),
  company: z.string().nullable().default(null),
  reference: z.string().nullable().default(null),
  last_activity_at: z.string().nullable().default(null),
});
export type CaseCandidate = z.infer<typeof caseCandidateSchema>;

export const caseMatchContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("case_match"),
  locale: z.string().default("de-DE"),
  thread: z.object({
    subject: z.string().default(""),
    participants: z.array(mailAddressSchema).default([]),
    snippet: z.string().default(""),
    category: z.string().nullable().default(null),
  }),
  message: z.object({
    from: mailAddressSchema,
    body_excerpt: z.string().default(""),
  }),
  candidates: z.array(caseCandidateSchema).default([]),
});
export type CaseMatchContext = z.infer<typeof caseMatchContextSchema>;

export const caseMatchResultSchema = z
  .object({
    decision: z.enum(["existing", "new", "none"]),
    case_id: z.string().uuid().optional(),
    title: z.string().optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  })
  .refine((r) => r.decision !== "existing" || !!r.case_id, {
    message: "decision='existing' braucht case_id",
  })
  .refine((r) => r.decision !== "new" || !!r.title, {
    message: "decision='new' braucht title",
  });
export type CaseMatchResult = z.infer<typeof caseMatchResultSchema>;

// ---------- draft_reply ----------

export const draftReplyContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("draft_reply"),
  locale: z.string().default("de-DE"),
  reply_to: mailAddressSchema,
  subject: z.string().default(""),
  /** Konversation, chronologisch, Texte gekürzt (Datenminimierung §6.3) */
  messages: z
    .array(
      z.object({
        direction: z.enum(["inbound", "outbound"]),
        from: mailAddressSchema,
        sent_at: z.string().nullable().default(null),
        body_excerpt: z.string().default(""),
      }),
    )
    .default([]),
  /** Gelernter Schreibstil (ai_style_profiles.profile), leer in P1 */
  style_profile: z.record(z.unknown()).default({}),
  signature_html: z.string().nullable().default(null),
  /** Optionale Nutzer-Anweisung ("kürzer", "Termin vorschlagen", …) */
  instructions: z.string().default(""),
  sender_name: z.string().default(""),
});
export type DraftReplyContext = z.infer<typeof draftReplyContextSchema>;

export const draftReplyResultSchema = z.object({
  subject: z.string().min(1),
  body_html: z.string().min(1),
  to_addrs: z.array(mailAddressSchema).min(1),
  confidence: z.number().min(0).max(1).optional(),
});
export type DraftReplyResult = z.infer<typeof draftReplyResultSchema>;

// ---------- thread_summary ----------

export const threadSummaryContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("thread_summary"),
  locale: z.string().default("de-DE"),
  subject: z.string().default(""),
  messages: z
    .array(
      z.object({
        direction: z.enum(["inbound", "outbound"]),
        from: mailAddressSchema,
        sent_at: z.string().nullable().default(null),
        body_excerpt: z.string().default(""),
      }),
    )
    .default([]),
});
export type ThreadSummaryContext = z.infer<typeof threadSummaryContextSchema>;

export const threadSummaryResultSchema = z.object({
  summary: z.string().min(1),
});
export type ThreadSummaryResult = z.infer<typeof threadSummaryResultSchema>;

// ---------- sync_mail (reiner Sync-Job, kein KI-Aufruf) ----------

export const syncMailContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("sync_mail"),
  account: z.object({
    id: z.string().uuid(),
    email_address: z.string(),
    provider: z.enum(["gmail", "imap"]),
    sync_cursor: z.string().nullable().default(null),
    /** Initial-Sync-Zeitraum in Tagen (MASTERPLAN: 90) */
    initial_days: z.number().int().default(90),
  }),
});
export type SyncMailContext = z.infer<typeof syncMailContextSchema>;

export const syncMailResultSchema = z.object({
  threads: z.number().int().min(0),
  messages: z.number().int().min(0),
  attachments: z.number().int().min(0).default(0),
  cursor: z.string().nullable().default(null),
  mode: z.enum(["initial", "delta"]),
});
export type SyncMailResult = z.infer<typeof syncMailResultSchema>;

// ---------- Ingest-Payload für die Edge Function mail-sync ----------

export const ingestMessageSchema = z.object({
  provider_thread_id: z.string(),
  provider_msg_id: z.string(),
  rfc822_message_id: z.string().nullable().default(null),
  direction: z.enum(["inbound", "outbound"]),
  from_addr: mailAddressSchema,
  to_addrs: z.array(mailAddressSchema).default([]),
  cc_addrs: z.array(mailAddressSchema).default([]),
  sent_at: z.string().nullable().default(null),
  subject: z.string().default(""),
  body_text: z.string().default(""),
  body_html: z.string().nullable().default(null),
  is_read: z.boolean().default(false),
  thread_subject: z.string().default(""),
  labels: z.array(z.string()).default([]),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        mime_type: z.string().nullable().default(null),
        size_bytes: z.number().int().nullable().default(null),
        /** Storage-Pfad, wenn der Runner den Blob bereits hochgeladen hat */
        storage_path: z.string().nullable().default(null),
      }),
    )
    .default([]),
});
export type IngestMessage = z.infer<typeof ingestMessageSchema>;

export const ingestRequestSchema = z.object({
  accountId: z.string().uuid(),
  messages: z.array(ingestMessageSchema).max(200),
  cursor: z.string().nullable().default(null),
  syncState: z.enum(["syncing", "ok", "error"]).default("ok"),
  lastError: z.string().nullable().default(null),
});
export type IngestRequest = z.infer<typeof ingestRequestSchema>;
