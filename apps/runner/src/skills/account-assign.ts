// Kontierungsvorschlag (Etappe 6): Aufwandskonto für eine Eingangsrechnung.
import { accountAssignContextSchema, accountAssignResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const accountAssignSkill: Skill = {
  type: "account_assign",
  schemaDescription: '{"account": "<Kontonummer>", "label": "<Bezeichnung>", "confidence": <0.0-1.0>}',

  buildPrompt(ctx) {
    const parsed = accountAssignContextSchema.parse(ctx);
    return [
      `Du bist Leitwerk und schlägst ein Aufwandskonto (${parsed.chart_of_accounts}) für eine Eingangsrechnung vor.`,
      "Der Steuerberater bestätigt final — schlage das plausibelste Standardkonto vor.",
      "",
      `Aussteller: ${parsed.issuer}`,
      `Bruttobetrag: ${parsed.gross_amount ?? "unbekannt"} €`,
      "Bekannte Konten:",
      ...parsed.known_accounts.map((a) => `- ${a.account}: ${a.label}`),
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw) {
    const result = accountAssignResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
