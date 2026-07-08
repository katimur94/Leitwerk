// Skill classify_email: Kategorie, Dringlichkeit, Konfidenz (MASTERPLAN §4 B.1).
import {
  classifyEmailContextSchema,
  classifyEmailResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const classifyEmailSkill: Skill = {
  type: "classify_email",

  schemaDescription:
    '{"category": "<eine der vorgegebenen Kategorien>", "urgency": <1-5>, "confidence": <0.0-1.0>, "reason": "<kurze Begründung>"}',

  buildPrompt(ctx) {
    const { categories, message, thread } = classifyEmailContextSchema.parse(ctx);
    return [
      "Du bist Leitwerk, ein Büro-Betriebssystem. Klassifiziere die folgende",
      "eingegangene E-Mail für ein deutsches Büro.",
      "",
      `Erlaubte Kategorien: ${categories.join(", ")}`,
      "Dringlichkeit: 1 = sofort reagieren … 5 = keine Eile.",
      "",
      `Betreff: ${message.subject || "(kein Betreff)"}`,
      `Von: ${message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}`,
      `Anhänge: ${message.has_attachments ? "ja" : "nein"}`,
      `Thread: "${thread.subject}" (${thread.message_count} Nachricht(en))`,
      "",
      "Inhalt (gekürzt):",
      "---",
      message.body_excerpt || "(leer)",
      "---",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, _ctx) {
    const result = classifyEmailResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
