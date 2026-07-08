// Etappe 6 — Komplett-Büro: Job-Kontexte + Ergebnisse (Zod) für Zeiterfassung,
// Zahlungsabgleich, Kontierung, Anrufe und Verträge.
import { z } from "zod";

// ---------- time_suggest (Zeitvorschläge aus Kalender/Vorgangsaktivität) ----------

export const timeSuggestContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("time_suggest"),
  locale: z.string().default("de-DE"),
  user_id: z.string().uuid(),
  for_date: z.string(),
  signals: z
    .array(z.object({ kind: z.string(), case_id: z.string().uuid().nullable().default(null), detail: z.string(), minutes: z.number().nullable().default(null) }))
    .default([]),
});
export type TimeSuggestContext = z.infer<typeof timeSuggestContextSchema>;

export const timeSuggestResultSchema = z.object({
  entries: z
    .array(
      z.object({
        case_id: z.string().uuid().nullable().default(null),
        work_date: z.string().nullable().default(null),
        minutes: z.number().int().min(1).max(1440),
        description: z.string().min(2),
        is_billable: z.boolean().default(false),
      }),
    )
    .max(10),
});
export type TimeSuggestResult = z.infer<typeof timeSuggestResultSchema>;

// ---------- payment_match (Bank-Umsatz ↔ Rechnung) ----------

export const paymentMatchContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("payment_match"),
  locale: z.string().default("de-DE"),
  transactions: z
    .array(
      z.object({
        transaction_id: z.string().uuid(),
        amount: z.number(),
        booked_on: z.string(),
        counterpart_name: z.string().default(""),
        purpose: z.string().default(""),
      }),
    )
    .default([]),
  open_invoices_out: z
    .array(z.object({ invoice_out_id: z.string().uuid(), number: z.string(), gross: z.number(), company: z.string().default("") }))
    .default([]),
  open_invoices_in: z
    .array(z.object({ invoice_in_id: z.string().uuid(), number: z.string(), gross: z.number(), issuer: z.string().default("") }))
    .default([]),
});
export type PaymentMatchContext = z.infer<typeof paymentMatchContextSchema>;

export const paymentMatchResultSchema = z.object({
  matches: z
    .array(
      z.object({
        transaction_id: z.string().uuid(),
        invoice_out_id: z.string().uuid().nullable().default(null),
        invoice_in_id: z.string().uuid().nullable().default(null),
        matched_amount: z.number(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(50),
});
export type PaymentMatchResult = z.infer<typeof paymentMatchResultSchema>;

// ---------- account_assign (Kontierungsvorschlag für Eingangsrechnungen) ----------

export const accountAssignContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("account_assign"),
  locale: z.string().default("de-DE"),
  invoice_in_id: z.string().uuid(),
  issuer: z.string().default(""),
  gross_amount: z.number().nullable().default(null),
  chart_of_accounts: z.enum(["SKR03", "SKR04"]).default("SKR03"),
  known_accounts: z.array(z.object({ account: z.string(), label: z.string() })).default([]),
});
export type AccountAssignContext = z.infer<typeof accountAssignContextSchema>;

export const accountAssignResultSchema = z.object({
  account: z.string(),
  label: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type AccountAssignResult = z.infer<typeof accountAssignResultSchema>;

// ---------- transcribe_call (Sprachnotiz/AB → Text, lokal via Whisper) ----------

export const transcribeCallContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("transcribe_call"),
  locale: z.string().default("de-DE"),
  call_id: z.string().uuid(),
  audio_storage_path: z.string(),
});
export type TranscribeCallContext = z.infer<typeof transcribeCallContextSchema>;

export const transcribeCallResultSchema = z.object({ transcript: z.string().min(1) });
export type TranscribeCallResult = z.infer<typeof transcribeCallResultSchema>;

// ---------- summarize_call (KI: Kurznotiz + Ergebnis + Follow-up) ----------

export const summarizeCallContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("summarize_call"),
  locale: z.string().default("de-DE"),
  call: z.object({
    call_id: z.string().uuid(),
    counterpart: z.string().default(""),
    case_number: z.string().nullable().default(null),
    transcript_excerpt: z.string().default(""),
  }),
});
export type SummarizeCallContext = z.infer<typeof summarizeCallContextSchema>;

export const summarizeCallResultSchema = z.object({
  summary: z.string().min(3),
  outcome: z.string().optional(),
  follow_up_title: z.string().nullable().default(null),
});
export type SummarizeCallResult = z.infer<typeof summarizeCallResultSchema>;

// ---------- extract_contract (Vertrags-Eckdaten aus Dokument-Text) ----------

export const extractContractContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("extract_contract"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  contract_id: z.string().uuid(),
  document_text: z.string().default(""),
});
export type ExtractContractContext = z.infer<typeof extractContractContextSchema>;

export const extractContractResultSchema = z.object({
  title: z.string().optional(),
  category: z.enum(["miete", "leasing", "versicherung", "software", "wartung", "telekom", "energie", "sonstiges"]).optional(),
  amount: z.number().nullable().default(null),
  billing_cycle: z.enum(["monthly", "quarterly", "yearly", "once"]).nullable().default(null),
  notice_period_months: z.number().int().nullable().default(null),
  notice_deadline: z.string().nullable().default(null),
  ends_on: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.8),
});
export type ExtractContractResult = z.infer<typeof extractContractResultSchema>;

// ---------- contract_watch (Kündigungsfristen-Wächter) ----------

export const contractWatchContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("contract_watch"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  contracts: z
    .array(
      z.object({
        contract_id: z.string().uuid(),
        title: z.string(),
        notice_deadline: z.string().nullable().default(null),
        days_until_deadline: z.number().nullable().default(null),
        yearly_cost: z.number().nullable().default(null),
      }),
    )
    .default([]),
});
export type ContractWatchContext = z.infer<typeof contractWatchContextSchema>;

export const contractWatchResultSchema = z.object({
  findings: z
    .array(
      z.object({
        contract_id: z.string().uuid(),
        severity: z.number().int().min(1).max(5),
        title: z.string().min(3),
        description: z.string().optional(),
        dedupe_key: z.string().min(3),
      }),
    )
    .max(30),
});
export type ContractWatchResult = z.infer<typeof contractWatchResultSchema>;

// ---------- Row-Typen für die PWA ----------

export interface TimeEntryRow {
  id: string;
  org_id: string;
  user_id: string;
  case_id: string | null;
  work_date: string;
  minutes: number;
  description: string | null;
  is_billable: boolean;
  hourly_rate: number | null;
  invoice_id: string | null;
  source: "manual" | "timer" | "ai_suggested";
  locked_at: string | null;
}

export interface BankTransactionRow {
  id: string;
  org_id: string;
  connection_id: string;
  booked_on: string;
  amount: number;
  counterpart_name: string | null;
  purpose: string | null;
  match_status: "unmatched" | "suggested" | "matched" | "ignored" | "manual";
}

export interface PaymentMatchRow {
  id: string;
  org_id: string;
  transaction_id: string;
  invoice_out_id: string | null;
  invoice_in_id: string | null;
  matched_amount: number;
  confidence: number | null;
  matched_by: "ai" | "user" | "rule";
  status: "suggested" | "confirmed" | "rejected";
}

export interface ContractRow {
  id: string;
  org_id: string;
  company_id: string | null;
  title: string;
  category: string | null;
  status: "active" | "notice_given" | "ended" | "draft";
  amount: number | null;
  billing_cycle: "monthly" | "quarterly" | "yearly" | "once" | null;
  yearly_cost: number | null;
  notice_deadline: string | null;
  ends_on: string | null;
  extraction_confidence: number | null;
}

export interface CallLogRow {
  id: string;
  org_id: string;
  contact_id: string | null;
  case_id: string | null;
  direction: "inbound" | "outbound" | "missed";
  phone_number: string | null;
  occurred_at: string;
  duration_sec: number | null;
  summary: string | null;
  transcript: string | null;
  outcome: string | null;
  source: "manual" | "voice_note" | "pbx" | "answering_machine";
}

export interface AbsenceRow {
  id: string;
  org_id: string;
  user_id: string;
  kind: "vacation" | "sick" | "unpaid" | "special" | "training" | "home_office";
  status: "requested" | "approved" | "rejected" | "cancelled";
  starts_on: string;
  ends_on: string;
  days_counted: number | null;
  note: string | null;
}

export interface ExportBatchRow {
  id: string;
  org_id: string;
  kind: "datev_extf" | "csv";
  period_start: string;
  period_end: string;
  status: "draft" | "generated" | "downloaded" | "sent_to_tax_advisor";
  file_storage_path: string | null;
  item_count: number;
  total_debit: number;
  total_credit: number;
}
