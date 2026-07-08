// Skill case_match: E-Mail-Thread → bestehender Vorgang, neuer Vorgang
// oder keine Zuordnung (MASTERPLAN §4 B.2, V). Das Gate (min_confidence,
// Vorschlag statt Zuordnung) erzwingt die Datenbank — nicht dieser Skill.
import { caseMatchContextSchema, caseMatchResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const caseMatchSkill: Skill = {
  type: "case_match",

  schemaDescription:
    '{"decision": "existing"|"new"|"none", "case_id": "<uuid, nur bei existing>", "title": "<Vorgangs-Titel, nur bei new>", "confidence": <0.0-1.0>, "reason": "<kurz>"}',

  buildPrompt(ctx) {
    const { thread, message, candidates } = caseMatchContextSchema.parse(ctx);
    const candidateList = candidates.length
      ? candidates
          .map(
            (c) =>
              `- case_id: ${c.case_id} | ${c.case_number} | "${c.title}" | Status: ${c.status}` +
              (c.company ? ` | Firma: ${c.company}` : "") +
              (c.reference ? ` | Referenz: ${c.reference}` : ""),
          )
          .join("\n")
      : "(keine offenen Vorgänge)";
    return [
      "Du bist Leitwerk, ein Büro-Betriebssystem. Ordne den folgenden",
      "E-Mail-Thread einem Vorgang (Akte) zu.",
      "",
      "Entscheidungsregeln:",
      '- "existing": Der Thread gehört eindeutig zu einem der Kandidaten',
      "  (Signale: Absender/Firma, Betreff-Kette, Aktenzeichen/Referenz, Beträge).",
      '- "new": Es ist erkennbar ein neues Anliegen mit eigenem Vorgang',
      "  (z. B. neue Anfrage, neuer Auftrag). Gib einen prägnanten deutschen Titel an.",
      '- "none": Kein Vorgang nötig (Newsletter, Spam, Belangloses).',
      "Sei konservativ: Im Zweifel lieber niedrige confidence.",
      "",
      `Thread-Betreff: ${thread.subject || "(kein Betreff)"}`,
      `Kategorie: ${thread.category ?? "unbekannt"}`,
      `Absender der letzten Nachricht: ${message.from.email}`,
      `Beteiligte: ${thread.participants.map((p) => p.email).join(", ") || "—"}`,
      "",
      "Letzte Nachricht (gekürzt):",
      "---",
      message.body_excerpt || thread.snippet || "(leer)",
      "---",
      "",
      "Offene Vorgänge (Kandidaten):",
      candidateList,
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, _ctx) {
    const result = caseMatchResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
