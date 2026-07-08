// Skill extract_commitments: Verpflichtungen & Fristen aus einer Mail
// → Aufgaben-Vorschläge (MASTERPLAN §4 B.3, I). Anwendung serverseitig.
import {
  extractCommitmentsContextSchema,
  extractCommitmentsResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const extractCommitmentsSkill: Skill = {
  type: "extract_commitments",

  schemaDescription:
    '{"commitments": [{"title": "<Aufgabe, imperativ, max. 80 Zeichen>", "due_at": "<ISO-Datum oder null>", "reason": "<Zitat/Begründung>", "confidence": <0.0-1.0>}]}',

  buildPrompt(ctx) {
    const { message, existing_tasks, today } = extractCommitmentsContextSchema.parse(ctx);
    return [
      "Du bist Leitwerk. Extrahiere aus der folgenden E-Mail konkrete",
      "Verpflichtungen, Zusagen und Fristen als Aufgaben für den Empfänger.",
      "",
      "Regeln:",
      "- NUR echte, umsetzbare Verpflichtungen (Rückruf, Unterlagen senden,",
      "  Angebot erstellen, Termin bestätigen). Keine Newsletter/Floskeln.",
      `- Fristen als ISO-Datum relativ zu heute (${today}); ohne Frist: null.`,
      "- Leere Liste ist eine gute Antwort, wenn nichts zu tun ist.",
      existing_tasks.length
        ? `- Diese Aufgaben existieren bereits (NICHT erneut vorschlagen): ${existing_tasks.join(" | ")}`
        : "",
      "",
      `Betreff: ${message.subject || "(kein Betreff)"}`,
      `Von: ${message.from.email}`,
      "Inhalt (gekürzt):",
      "---",
      message.body_excerpt || "(leer)",
      "---",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ]
      .filter(Boolean)
      .join("\n");
  },

  parse(raw, _ctx) {
    const result = extractCommitmentsResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
