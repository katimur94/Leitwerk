// Etappe 5 — Team & Ausbau: Kalender-Sync, Termin-Briefing, Terminvorschläge,
// Wochenreport. Job-Kontexte (build-job-context) + Ergebnisse (Zod).
import { z } from "zod";
import { mailAddressSchema } from "./mail";

// ---------- sync_calendar (Connector, kein KI-Aufruf) ----------

export const syncCalendarContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("sync_calendar"),
  account: z.object({
    id: z.string().uuid(),
    calendar_ref: z.string(),
    provider: z.string().default("google"),
    sync_cursor: z.string().nullable().default(null),
    initial_days: z.number().default(30),
  }),
});
export type SyncCalendarContext = z.infer<typeof syncCalendarContextSchema>;

export const syncCalendarResultSchema = z.object({
  events: z.number(),
  cursor: z.string().nullable().default(null),
  mode: z.enum(["initial", "delta"]),
});
export type SyncCalendarResult = z.infer<typeof syncCalendarResultSchema>;

// ---------- calendar_briefing (Kontext-Briefing vor einem Termin) ----------

export const calendarBriefingContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("calendar_briefing"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  event: z.object({
    event_id: z.string().uuid(),
    title: z.string().default(""),
    starts_at: z.string(),
    location: z.string().nullable().default(null),
    attendees: z.array(z.string()).default([]),
    case_number: z.string().nullable().default(null),
  }),
  /** Kontext zu den Teilnehmern: offene Vorgänge, letzte Mails, offene Beträge */
  context: z
    .array(
      z.object({
        kind: z.string(),
        detail: z.string(),
      }),
    )
    .default([]),
});
export type CalendarBriefingContext = z.infer<typeof calendarBriefingContextSchema>;

export const calendarBriefingResultSchema = z.object({
  briefing_md: z.string().min(10),
});
export type CalendarBriefingResult = z.infer<typeof calendarBriefingResultSchema>;

// ---------- suggest_slots (3 freie Termine als Antwortentwurf) ----------

export const suggestSlotsContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("suggest_slots"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  thread: z.object({
    thread_id: z.string().uuid(),
    subject: z.string().default(""),
    reply_to: mailAddressSchema,
  }),
  /** Freie Slots, serverseitig aus dem Kalender berechnet (ISO-Paare) */
  free_slots: z
    .array(z.object({ starts_at: z.string(), ends_at: z.string(), label: z.string() }))
    .default([]),
  signature_html: z.string().nullable().default(null),
});
export type SuggestSlotsContext = z.infer<typeof suggestSlotsContextSchema>;

export const suggestSlotsResultSchema = z.object({
  subject: z.string(),
  body_html: z.string().optional(),
  to_addrs: z.array(mailAddressSchema).default([]),
  slots: z
    .array(z.object({ starts_at: z.string(), ends_at: z.string(), label: z.string() }))
    .max(5),
});
export type SuggestSlotsResult = z.infer<typeof suggestSlotsResultSchema>;

// ---------- weekly_report (Wochenrückblick, freitags) ----------

export const weeklyReportContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("weekly_report"),
  locale: z.string().default("de-DE"),
  for_date: z.string(),
  org_name: z.string().default(""),
  stats: z.object({
    mails_handled: z.number().default(0),
    tasks_done: z.number().default(0),
    tasks_open: z.number().default(0),
    invoices_sent: z.number().default(0),
    invoices_paid: z.number().default(0),
    pipeline_value_cents: z.number().default(0),
    ai_accuracy: z.number().nullable().default(null),
  }),
});
export type WeeklyReportContext = z.infer<typeof weeklyReportContextSchema>;

export const weeklyReportResultSchema = z.object({
  content_md: z.string().min(10),
  items: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string().optional(),
        entity_type: z.string().nullable().default(null),
        entity_id: z.string().uuid().nullable().default(null),
        action: z.string().nullable().default(null),
      }),
    )
    .max(7)
    .default([]),
});
export type WeeklyReportResult = z.infer<typeof weeklyReportResultSchema>;

// ---------- Row-Typen für die PWA ----------

export interface CalendarEventRow {
  id: string;
  org_id: string;
  account_id: string;
  provider_event_id: string | null;
  case_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  attendees: Array<{ name?: string; email: string }>;
  ai_briefing: string | null;
  ai_briefing_at: string | null;
  status: "confirmed" | "tentative" | "cancelled";
}

export interface CalendarAccountRow {
  id: string;
  org_id: string;
  user_id: string;
  provider: "google" | "ics";
  calendar_ref: string;
  sync_state: "pending" | "ok" | "error";
  last_sync_at: string | null;
}

export interface ThreadCommentRow {
  id: string;
  org_id: string;
  thread_id: string;
  author_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
}
