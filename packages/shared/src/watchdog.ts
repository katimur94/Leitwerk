// Etappe 2 — Aufgaben-Compiler, Follow-up-Engine, Nacht-Wächter, Briefing:
// Job-Kontexte (build-job-context) und Ergebnisse (striktes Zod-Parsing).
import { z } from "zod";
import { mailAddressSchema } from "./mail";

// ---------- extract_commitments (Aufgaben-Compiler) ----------

export const extractCommitmentsContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("extract_commitments"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  message: z.object({
    subject: z.string().default(""),
    from: mailAddressSchema,
    body_excerpt: z.string().default(""),
    sent_at: z.string().nullable().default(null),
  }),
  /** Bereits existierende Aufgaben-Titel derselben Quelle (Dubletten vermeiden) */
  existing_tasks: z.array(z.string()).default([]),
});
export type ExtractCommitmentsContext = z.infer<typeof extractCommitmentsContextSchema>;

export const extractCommitmentsResultSchema = z.object({
  commitments: z
    .array(
      z.object({
        title: z.string().min(3),
        due_at: z.string().nullable().default(null),
        reason: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .max(10),
});
export type ExtractCommitmentsResult = z.infer<typeof extractCommitmentsResultSchema>;

// ---------- gap_scan (Nacht-Wächter) ----------

export const gapScanContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("gap_scan"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  stale_cases: z
    .array(
      z.object({
        case_id: z.string().uuid(),
        case_number: z.string(),
        title: z.string(),
        status: z.string(),
        days_inactive: z.number(),
      }),
    )
    .default([]),
  unanswered_threads: z
    .array(
      z.object({
        thread_id: z.string().uuid(),
        subject: z.string().default(""),
        from: z.string().default(""),
        days_waiting: z.number(),
        urgency: z.number().nullable().default(null),
      }),
    )
    .default([]),
  overdue_followups: z.number().default(0),
  overdue_tasks: z.number().default(0),
});
export type GapScanContext = z.infer<typeof gapScanContextSchema>;

export const gapScanResultSchema = z.object({
  findings: z
    .array(
      z.object({
        kind: z.enum(["gap", "contradiction", "stale", "risk", "opportunity"]),
        severity: z.number().int().min(1).max(5),
        title: z.string().min(3),
        description: z.string().optional(),
        dedupe_key: z.string().min(3),
        case_id: z.string().uuid().nullable().default(null),
        suggested_action: z.record(z.unknown()).optional(),
      }),
    )
    .max(20),
});
export type GapScanResult = z.infer<typeof gapScanResultSchema>;

// ---------- morning_briefing ----------

export const morningBriefingContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("morning_briefing"),
  locale: z.string().default("de-DE"),
  for_date: z.string(),
  org_name: z.string().default(""),
  stats: z.object({
    unread_threads: z.number().default(0),
    urgent_threads: z.number().default(0),
    due_tasks: z.number().default(0),
    overdue_followups: z.number().default(0),
    open_findings: z.number().default(0),
  }),
  top_items: z
    .array(
      z.object({
        entity_type: z.string(),
        entity_id: z.string().uuid(),
        title: z.string(),
        detail: z.string().default(""),
      }),
    )
    .default([]),
});
export type MorningBriefingContext = z.infer<typeof morningBriefingContextSchema>;

export const briefingItemSchema = z.object({
  title: z.string().min(3),
  detail: z.string().optional(),
  entity_type: z.string().nullable().default(null),
  entity_id: z.string().uuid().nullable().default(null),
  /** Deutscher CTA-Text, z. B. "Entwurf ansehen" */
  action: z.string().nullable().default(null),
});

export const morningBriefingResultSchema = z.object({
  content_md: z.string().min(10),
  items: z.array(briefingItemSchema).max(7),
});
export type MorningBriefingResult = z.infer<typeof morningBriefingResultSchema>;
export type BriefingItem = z.infer<typeof briefingItemSchema>;

// ---------- followup_check ----------

export const followupCheckContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("followup_check"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  overdue: z
    .array(
      z.object({
        followup_id: z.string().uuid(),
        thread_id: z.string().uuid(),
        subject: z.string().default(""),
        counterpart: z.string().default(""),
        expected_by: z.string(),
        days_overdue: z.number(),
      }),
    )
    .default([]),
});
export type FollowupCheckContext = z.infer<typeof followupCheckContextSchema>;

export const followupCheckResultSchema = z.object({
  followups: z
    .array(
      z.object({
        followup_id: z.string().uuid(),
        action: z.enum(["escalate", "wait"]),
        title: z.string().optional(),
        description: z.string().optional(),
        /** Anweisung für den automatischen Nachfass-Entwurf (draft_reply) */
        draft_instructions: z.string().optional(),
      }),
    )
    .max(20),
});
export type FollowupCheckResult = z.infer<typeof followupCheckResultSchema>;

// ---------- Row-Typen für die PWA ----------

export interface TaskRow {
  id: string;
  org_id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  due_at: string | null;
  assignee_id: string | null;
  created_by: string | null;
  source: "manual" | "mail_extract" | "meeting" | "watcher" | "automation";
  source_entity_type: string | null;
  source_entity_id: string | null;
  recurrence: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskChecklistItemRow {
  id: string;
  task_id: string;
  title: string;
  is_done: boolean;
  position: number;
}

export interface AgentFindingRow {
  id: string;
  org_id: string;
  case_id: string | null;
  kind: "gap" | "contradiction" | "stale" | "risk" | "opportunity";
  severity: number;
  title: string;
  description: string | null;
  suggested_action: Record<string, unknown> | null;
  entity_type: string | null;
  entity_id: string | null;
  status: "open" | "acknowledged" | "resolved" | "dismissed" | "snoozed";
  dedupe_key: string | null;
  created_at: string;
}

export interface BriefingRow {
  id: string;
  org_id: string;
  user_id: string | null;
  kind: "morning" | "weekly";
  for_date: string;
  content_md: string;
  items: BriefingItem[];
  read_at: string | null;
  created_at: string;
}

export interface FollowupRow {
  id: string;
  org_id: string;
  case_id: string | null;
  entity_type: "mail_thread" | "quote" | "invoice_out";
  entity_id: string;
  expected_by: string;
  reason: string | null;
  status: "waiting" | "answered" | "escalated" | "done" | "cancelled";
  answered_at: string | null;
  created_by: "ai" | "user";
  created_at: string;
}

export interface NotificationRow {
  id: string;
  org_id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface TrustStatsRow {
  automation_id: string;
  org_id: string;
  total_runs: number;
  correct_runs: number;
  last_50_correct: number;
  last_50_total: number;
  accuracy: number | null;
}

export interface AutomationRowFull {
  id: string;
  org_id: string;
  key: string;
  name: string;
  description: string | null;
  autonomy_level: number;
  hold_minutes: number;
  is_enabled: boolean;
  min_confidence: number;
  promote_threshold: number;
  promote_min_runs: number;
}
