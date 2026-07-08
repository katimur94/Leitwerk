// Zahlungsabgleich (Etappe 6): Bank-Umsätze ↔ offene Rechnungen.
import { paymentMatchContextSchema, paymentMatchResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const paymentMatchSkill: Skill = {
  type: "payment_match",
  schemaDescription:
    '{"matches": [{"transaction_id": "<uuid>", "invoice_out_id": "<uuid|null>", "invoice_in_id": "<uuid|null>", "matched_amount": <Zahl>, "confidence": <0.0-1.0>}]}',

  buildPrompt(ctx) {
    const parsed = paymentMatchContextSchema.parse(ctx);
    if (parsed.transactions.length === 0) return null;
    return [
      "Du bist Leitwerk und ordnest Bank-Umsätze offenen Rechnungen zu.",
      "Ordne nur zu, wenn Betrag UND Bezug (Name/Verwendungszweck/Rechnungsnummer) passen.",
      "Positiver Betrag = Eingang (Ausgangsrechnung bezahlt), negativer = Ausgang (Eingangsrechnung).",
      "",
      "Umsätze:",
      ...parsed.transactions.map((t) => `- [${t.transaction_id}] ${t.amount} € am ${t.booked_on} | ${t.counterpart_name} | ${t.purpose}`),
      "",
      "Offene Ausgangsrechnungen:",
      ...parsed.open_invoices_out.map((i) => `- [${i.invoice_out_id}] ${i.number}: ${i.gross} € (${i.company})`),
      "Offene Eingangsrechnungen:",
      ...parsed.open_invoices_in.map((i) => `- [${i.invoice_in_id}] ${i.number}: ${i.gross} € (${i.issuer})`),
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, ctx) {
    if (raw === "") {
      const empty = { matches: [] };
      return { result: empty, resultHash: resultHash({ ...empty, job: (ctx as { jobId?: string }).jobId }) };
    }
    const result = paymentMatchResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
