// Vertragsdaten-Extraktion (Etappe 6): Eckdaten aus dem Vertragsdokument.
import { extractContractContextSchema, extractContractResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const extractContractSkill: Skill = {
  type: "extract_contract",
  schemaDescription:
    '{"title": "<Titel>", "category": "miete|leasing|versicherung|software|wartung|telekom|energie|sonstiges", "amount": <Zahl|null>, "billing_cycle": "monthly|quarterly|yearly|once|null", "notice_period_months": <int|null>, "notice_deadline": "<ISO|null>", "ends_on": "<ISO|null>", "confidence": <0.0-1.0>}',

  buildPrompt(ctx) {
    const parsed = extractContractContextSchema.parse(ctx);
    return [
      "Du bist Leitwerk und extrahierst die Eckdaten eines Vertrags aus dem Text.",
      `Heute ist ${parsed.today}. Relativfristen in konkrete Daten (ISO) umrechnen.`,
      "Unbekannte Felder: null. Der Nutzer bestätigt anschließend.",
      "",
      "Vertragstext (gekürzt):",
      "---",
      parsed.document_text.slice(0, 6000) || "(leer)",
      "---",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw) {
    const result = extractContractResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
