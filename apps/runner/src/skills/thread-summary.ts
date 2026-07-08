// Skill thread_summary: Ein-Absatz-Zusammenfassung langer Threads (§4 B.5).
import {
  threadSummaryContextSchema,
  threadSummaryResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const threadSummarySkill: Skill = {
  type: "thread_summary",

  schemaDescription: '{"summary": "<ein Absatz Deutsch, max. 4 Sätze>"}',

  buildPrompt(ctx) {
    const { subject, messages } = threadSummaryContextSchema.parse(ctx);
    const conversation = messages
      .map(
        (m) =>
          `[${m.direction === "inbound" ? "EINGANG" : "AUSGANG"}] ${m.from.email} (${m.sent_at ?? "?"}):\n${m.body_excerpt}`,
      )
      .join("\n\n");
    return [
      "Du bist Leitwerk. Fasse den folgenden E-Mail-Thread in EINEM Absatz",
      "(max. 4 Sätze, Deutsch) zusammen: Worum geht es, was ist der aktuelle",
      "Stand, was ist der nächste offene Schritt und bei wem liegt er.",
      "",
      `Betreff: ${subject || "(kein Betreff)"}`,
      "",
      "Verlauf (gekürzt, chronologisch):",
      "---",
      conversation || "(leer)",
      "---",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, _ctx) {
    const result = threadSummaryResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
