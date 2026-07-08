// Etappe 3 — Finanzen: Job-Kontexte/-Ergebnisse und Row-Typen.
import { z } from "zod";
import { mailAddressSchema } from "./mail";

// ---------- extract_invoice ----------

export const extractInvoiceContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("extract_invoice"),
  locale: z.string().default("de-DE"),
  today: z.string(),
  message: z.object({
    subject: z.string().default(""),
    from: mailAddressSchema,
    body_excerpt: z.string().default(""),
  }),
  attachments: z
    .array(
      z.object({
        id: z.string().uuid(),
        filename: z.string(),
        mime_type: z.string().nullable().default(null),
        storage_path: z.string().nullable().default(null),
      }),
    )
    .default([]),
});
export type ExtractInvoiceContext = z.infer<typeof extractInvoiceContextSchema>;

export const extractInvoiceResultSchema = z.object({
  found: z.boolean(),
  invoice_number: z.string().optional(),
  invoice_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  net_amount: z.number().nullable().optional(),
  vat_amount: z.number().nullable().optional(),
  gross_amount: z.number().nullable().optional(),
  currency: z.string().optional(),
  iban: z.string().nullable().optional(),
  payment_reference: z.string().nullable().optional(),
  issuer_name: z.string().optional(),
  format_detected: z.enum(["zugferd", "xrechnung", "pdf_text", "mail_text"]).optional(),
  is_einvoice: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ExtractInvoiceResult = z.infer<typeof extractInvoiceResultSchema>;

// ---------- draft_dunning ----------

export const draftDunningContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("draft_dunning"),
  locale: z.string().default("de-DE"),
  level: z.number().int().min(1).max(3),
  fee: z.number().default(0),
  invoice: z.object({
    invoice_number: z.string(),
    invoice_date: z.string().nullable().default(null),
    due_date: z.string().nullable().default(null),
    gross_amount: z.number(),
    currency: z.string().default("EUR"),
    recipient_name: z.string().default(""),
  }),
  org: z.object({
    legal_name: z.string().default(""),
    iban: z.string().nullable().default(null),
    bank_name: z.string().nullable().default(null),
  }),
});
export type DraftDunningContext = z.infer<typeof draftDunningContextSchema>;

export const draftDunningResultSchema = z.object({
  subject: z.string().min(3),
  body_html: z.string().min(20),
});
export type DraftDunningResult = z.infer<typeof draftDunningResultSchema>;

// ---------- Row-Typen ----------

export interface InvoiceInRow {
  id: string;
  org_id: string;
  case_id: string | null;
  company_id: string | null;
  source: "mail" | "upload" | "manual";
  status: "captured" | "review" | "approved" | "paid" | "rejected";
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  currency: string;
  iban: string | null;
  payment_reference: string | null;
  extraction_confidence: number | null;
  format_detected: string | null;
  is_einvoice: boolean;
  duplicate_of: string | null;
  created_at: string;
}

export interface InvoiceOutRow {
  id: string;
  org_id: string;
  case_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  quote_id: string | null;
  invoice_number: string;
  status:
    | "draft"
    | "approved"
    | "sent"
    | "partially_paid"
    | "paid"
    | "overdue"
    | "cancelled";
  invoice_date: string;
  due_date: string | null;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  currency: string;
  payment_terms: string | null;
  buyer_reference: string | null;
  pdf_storage_path: string | null;
  xml_storage_path: string | null;
  paid_amount: number;
  created_at: string;
}

export interface InvoiceItemRow {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  net_total: number;
}

export interface QuoteRow {
  id: string;
  org_id: string;
  case_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  quote_number: string;
  status: "draft" | "sent" | "followed_up" | "accepted" | "rejected" | "expired";
  quote_date: string;
  valid_until: string | null;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  created_at: string;
}

export interface QuoteItemRow {
  id: string;
  quote_id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  net_total: number;
}

export interface DunningRunRow {
  id: string;
  org_id: string;
  invoice_id: string;
  level: number;
  draft_id: string | null;
  fee: number;
  status: "proposed" | "approved" | "sent" | "skipped";
  proposed_by: "ai" | "user";
  sent_at: string | null;
  created_at: string;
}
