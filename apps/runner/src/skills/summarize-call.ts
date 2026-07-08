// Anruf-Zusammenfassung (Etappe 6): Kurznotiz + Ergebnis + optional Follow-up.
import { summarizeCallContextSchema, summarizeCallResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const summarizeCallSkill: Skill = {
  type: "summarize_call",
  schemaDescription:
    '{"summary": "<Kurznotiz>", "outcome": "<Ergebnis-Stichwort (optional)>", "follow_up_title": "<Aufgabe|null>"}',

  buildPrompt(ctx) {
    const parsed = summarizeCallContextSchema.parse(ctx);
    return [
      "Du bist Leitwerk und fasst ein Telefonat aus dem Transkript zusammen — knapp, deutsch.",
      "Wenn eine Aufgabe folgt (Rückruf, Angebot, Unterlagen), setze follow_up_title, sonst null.",
      "",
      `Gesprächspartner: ${parsed.call.counterpart}`,
      parsed.call.case_number ? `Vorgang: ${parsed.call.case_number}` : "",
      "Transkript (gekürzt):",
      "---",
      parsed.call.transcript_excerpt || "(leer)",
      "---",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ]
      .filter(Boolean)
      .join("\n");
  },

  parse(raw) {
    const result = summarizeCallResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
