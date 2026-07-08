// Etappe 4 — Autonomie & Wissen: Job-Kontexte (build-job-context) und
// Ergebnisse (striktes Zod-Parsing) für Notizen, Wissen, Meetings,
// Stil-Profile, Embeddings und die semantische Suche.
import { z } from "zod";

// ---------- transcribe_note (Sprachnotiz → Markdown, lokal via Whisper) ----------

export const transcribeNoteContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("transcribe_note"),
  locale: z.string().default("de-DE"),
  note_id: z.string().uuid(),
  /** Pfad im Storage-Bucket 'audio' (Download über mail-sync /download) */
  audio_storage_path: z.string(),
});
export type TranscribeNoteContext = z.infer<typeof transcribeNoteContextSchema>;

export const transcribeNoteResultSchema = z.object({
  transcript: z.string().min(1),
});
export type TranscribeNoteResult = z.infer<typeof transcribeNoteResultSchema>;

// ---------- transcribe_meeting (whisper.cpp lokal, KEINE Cloud) ----------

export const transcribeMeetingContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("transcribe_meeting"),
  locale: z.string().default("de-DE"),
  meeting_id: z.string().uuid(),
  title: z.string().default(""),
  audio_storage_path: z.string(),
});
export type TranscribeMeetingContext = z.infer<typeof transcribeMeetingContextSchema>;

export const meetingSegmentSchema = z.object({
  speaker: z.string().nullable().default(null),
  starts_sec: z.number().nullable().default(null),
  ends_sec: z.number().nullable().default(null),
  content: z.string(),
});

export const transcribeMeetingResultSchema = z.object({
  transcript: z.string().min(1),
  segments: z.array(meetingSegmentSchema).max(500).default([]),
});
export type TranscribeMeetingResult = z.infer<typeof transcribeMeetingResultSchema>;

// ---------- summarize_meeting (KI: Protokoll + Entscheidungen + Aufgaben) ----------

export const summarizeMeetingContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("summarize_meeting"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  meeting: z.object({
    meeting_id: z.string().uuid(),
    title: z.string().default(""),
    held_at: z.string().nullable().default(null),
    case_number: z.string().nullable().default(null),
    transcript_excerpt: z.string().default(""),
  }),
});
export type SummarizeMeetingContext = z.infer<typeof summarizeMeetingContextSchema>;

export const summarizeMeetingResultSchema = z.object({
  protocol_md: z.string().min(10),
  decisions: z.array(z.string()).max(20).default([]),
  open_questions: z.array(z.string()).max(20).default([]),
  tasks: z
    .array(
      z.object({
        title: z.string().min(3),
        assignee_hint: z.string().nullable().optional(),
        due_at: z.string().nullable().default(null),
      }),
    )
    .max(15)
    .default([]),
});
export type SummarizeMeetingResult = z.infer<typeof summarizeMeetingResultSchema>;

// ---------- knowledge_distill (dauerhafte Fakten aus Mails/Meetings) ----------

export const knowledgeDistillContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("knowledge_distill"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  /** Quellen seit dem letzten Lauf: Mail-Auszüge + Meeting-Protokolle */
  sources: z
    .array(
      z.object({
        source_type: z.enum(["mail_message", "meeting", "note"]),
        source_id: z.string().uuid(),
        title: z.string().default(""),
        excerpt: z.string().default(""),
        counterpart: z.string().default(""),
      }),
    )
    .max(40)
    .default([]),
  /** Bereits bekannte Fakten (Dubletten vermeiden) */
  known_facts: z.array(z.string()).max(100).default([]),
});
export type KnowledgeDistillContext = z.infer<typeof knowledgeDistillContextSchema>;

export const knowledgeDistillResultSchema = z.object({
  facts: z
    .array(
      z.object({
        fact: z.string().min(10),
        category: z.enum(["kunde", "lieferant", "prozess", "behörde", "intern"]).optional(),
        company_name: z.string().optional(),
        source_type: z.enum(["mail_message", "meeting", "note"]).optional(),
        source_id: z.string().uuid().optional(),
        confidence: z.number().min(0).max(1).default(0.8),
      }),
    )
    .max(15),
});
export type KnowledgeDistillResult = z.infer<typeof knowledgeDistillResultSchema>;

// ---------- build_style_profile (Schreibstil aus gesendeten Mails) ----------

export const buildStyleProfileContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("build_style_profile"),
  locale: z.string().default("de-DE"),
  account_id: z.string().uuid(),
  /** Auszüge der letzten gesendeten Mails des Kontos */
  sent_samples: z.array(z.string()).max(30).default([]),
});
export type BuildStyleProfileContext = z.infer<typeof buildStyleProfileContextSchema>;

export const buildStyleProfileResultSchema = z.object({
  profile: z.object({
    greeting: z.string().default(""),
    closing: z.string().default(""),
    tone: z.string().default(""),
    avg_length: z.enum(["kurz", "mittel", "lang"]).default("mittel"),
    phrases: z.array(z.string()).max(10).default([]),
    language: z.string().default("de"),
  }),
  sample_count: z.number().int().min(0),
});
export type BuildStyleProfileResult = z.infer<typeof buildStyleProfileResultSchema>;

// ---------- embed_backlog (lokale Embeddings, 1024-dim) ----------

export const embedBacklogContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("embed_backlog"),
  locale: z.string().default("de-DE"),
  /** Noch nicht eingebettete Inhalte (serverseitig zugeschnitten) */
  pending: z
    .array(
      z.object({
        entity_type: z.enum([
          "mail_message",
          "document",
          "note",
          "knowledge_item",
          "meeting_segment",
          "case",
        ]),
        entity_id: z.string().uuid(),
        chunk_index: z.number().int().min(0).default(0),
        content: z.string(),
      }),
    )
    .max(64)
    .default([]),
});
export type EmbedBacklogContext = z.infer<typeof embedBacklogContextSchema>;

export const embedBacklogResultSchema = z.object({
  items: z
    .array(
      z.object({
        entity_type: z.string(),
        entity_id: z.string().uuid(),
        chunk_index: z.number().int().min(0),
        content: z.string(),
        embedding: z.array(z.number()).length(1024),
      }),
    )
    .max(64),
  model: z.string().default("unknown"),
});
export type EmbedBacklogResult = z.infer<typeof embedBacklogResultSchema>;

// ---------- semantic_search (interaktiv: Query-Embedding für search_combined) ----------

export const semanticSearchContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("semantic_search"),
  locale: z.string().default("de-DE"),
  query: z.string().min(1),
});
export type SemanticSearchContext = z.infer<typeof semanticSearchContextSchema>;

export const semanticSearchResultSchema = z.object({
  embedding: z.array(z.number()).length(1024),
  model: z.string().default("unknown"),
});
export type SemanticSearchResult = z.infer<typeof semanticSearchResultSchema>;

// ---------- Row-Typen für die PWA ----------

export interface NoteRow {
  id: string;
  org_id: string;
  case_id: string | null;
  contact_id: string | null;
  title: string | null;
  body_md: string;
  source: "manual" | "voice" | "ai";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeItemRow {
  id: string;
  org_id: string;
  fact: string;
  category: string | null;
  company_id: string | null;
  contact_id: string | null;
  source_type: string | null;
  source_id: string | null;
  confidence: number;
  status: "proposed" | "confirmed" | "rejected" | "outdated";
  confirmed_by: string | null;
  created_at: string;
}

export interface MeetingRow {
  id: string;
  org_id: string;
  case_id: string | null;
  title: string;
  held_at: string;
  audio_storage_path: string | null;
  transcript: string | null;
  transcript_done_at: string | null;
  protocol_md: string | null;
  decisions: string[];
  open_questions: string[];
  participants: string[];
  created_by: string | null;
  created_at: string;
}

export interface SearchResultRow {
  entity_type: string;
  entity_id: string;
  title: string;
  snippet: string;
  rank: number;
  via: "volltext" | "semantisch";
}

export interface StyleProfileRow {
  id: string;
  org_id: string;
  user_id: string;
  profile: {
    greeting?: string;
    closing?: string;
    tone?: string;
    avg_length?: string;
    phrases?: string[];
    language?: string;
  };
  sample_count: number;
  built_at: string | null;
}
