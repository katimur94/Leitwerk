// Terminvorschlag (Etappe 5, MASTERPLAN §4 K): 3 freie Slots aus dem Kalender
// als Antwort-Entwurf auf eine Mail („passt Ihnen Mittwoch?“).
import { suggestSlotsContextSchema, suggestSlotsResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const suggestSlotsSkill: Skill = {
  type: "suggest_slots",
  schemaDescription:
    '{"subject": "<Re: …>", "body_html": "<Antwort mit den Slots>", "to_addrs": [{"email": "…"}], "slots": [{"starts_at": "<ISO>", "ends_at": "<ISO>", "label": "<Mi 15.07. 14:00>"}]}',

  buildPrompt(ctx) {
    const parsed = suggestSlotsContextSchema.parse(ctx);
    const signature = parsed.signature_html ?? "";
    const slots = parsed.free_slots
      .slice(0, 3)
      .map((s) => `- ${s.label} (${s.starts_at} – ${s.ends_at})`)
      .join("\n");
    return [
      "Du bist Leitwerk und entwirfst eine kurze Terminvorschlags-Antwort.",
      "Biete GENAU die unten gelisteten freien Slots an (keine erfinden), freundlich und deutsch.",
      "",
      `Betreff des Threads: ${parsed.thread.subject}`,
      `Antwort an: ${parsed.thread.reply_to.email}`,
      "",
      "Freie Slots:",
      slots || "(keine)",
      "",
      signature ? `Hänge EXAKT diese Signatur ans Ende von body_html an:\n${signature}` : "",
      "Übernimm die Slots unverändert ins Feld \"slots\".",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown drumherum, keine Code-Zäune:",
      this.schemaDescription,
    ]
      .filter(Boolean)
      .join("\n");
  },

  parse(raw) {
    const result = suggestSlotsResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
