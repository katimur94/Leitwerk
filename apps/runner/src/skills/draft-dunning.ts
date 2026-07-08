// Skill draft_dunning: KI-Mahnentwurf pro Stufe (MASTERPLAN §4 F).
// Versand IMMER erst nach Freigabe (dunning_runs status='proposed' → UI).
import { draftDunningContextSchema, draftDunningResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

const LEVEL_TONE: Record<number, string> = {
  1: "freundliche Zahlungserinnerung (vielleicht ist die Rechnung nur untergegangen)",
  2: "bestimmte 1. Mahnung (klare Zahlungsfrist von 7 Tagen setzen)",
  3: "letzte Mahnung (Fristsetzung + Hinweis auf weitere Schritte, sachlich, ohne Drohkulisse)",
};

export const draftDunningSkill: Skill = {
  type: "draft_dunning",

  schemaDescription:
    '{"subject": "<Betreff>", "body_html": "<Mahntext als einfaches HTML (p, br)>"}',

  buildPrompt(ctx) {
    const parsed = draftDunningContextSchema.parse(ctx);
    return [
      "Du bist Leitwerk und formulierst im Namen des Nutzers eine",
      `${LEVEL_TONE[parsed.level] ?? "Mahnung"}.`,
      "Deutsch, professionell, respektvoll — der Kunde soll Kunde bleiben.",
      "",
      `Rechnung: ${parsed.invoice.invoice_number}`,
      `Rechnungsdatum: ${parsed.invoice.invoice_date ?? "—"}`,
      `Fällig seit: ${parsed.invoice.due_date ?? "—"}`,
      `Offener Betrag: ${parsed.invoice.gross_amount.toFixed(2)} ${parsed.invoice.currency}`,
      parsed.fee > 0 ? `Mahngebühr dieser Stufe: ${parsed.fee.toFixed(2)} ${parsed.invoice.currency}` : "",
      `Empfänger: ${parsed.invoice.recipient_name || "—"}`,
      `Absender: ${parsed.org.legal_name}`,
      parsed.org.iban ? `Bankverbindung: ${parsed.org.iban} (${parsed.org.bank_name ?? ""})` : "",
      "",
      "Nenne Rechnungsnummer, Betrag und eine konkrete neue Zahlungsfrist.",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ]
      .filter(Boolean)
      .join("\n");
  },

  parse(raw, _ctx) {
    const result = draftDunningResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
