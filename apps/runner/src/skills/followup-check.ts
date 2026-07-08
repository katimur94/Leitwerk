// Skill followup_check: überfällige Follow-ups bewerten (MASTERPLAN §4 N).
// escalate → Finding + automatischer Nachfass-Entwurf (draft_reply-Job).
import {
  followupCheckContextSchema,
  followupCheckResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const followupCheckSkill: Skill = {
  type: "followup_check",

  schemaDescription:
    '{"followups": [{"followup_id": "<uuid>", "action": "escalate"|"wait", "title": "<Finding-Titel bei escalate>", "description": "<kurz>", "draft_instructions": "<Anweisung für den Nachfass-Entwurf>"}]}',

  buildPrompt(ctx) {
    const parsed = followupCheckContextSchema.parse(ctx);
    if (parsed.overdue.length === 0) {
      // Nichts zu bewerten → deterministisch ohne KI-Aufruf beantworten
      return null;
    }
    const list = parsed.overdue
      .map(
        (f) =>
          `- [${f.followup_id}] "${f.subject}" an ${f.counterpart}, erwartet bis ${f.expected_by} (${f.days_overdue} Tage überfällig)`,
      )
      .join("\n");
    return [
      "Du bist Leitwerk. Bewerte diese überfälligen Follow-ups (gesendete",
      `Mails ohne Antwort, Stand ${parsed.today}):`,
      "",
      list,
      "",
      "Entscheide je Follow-up:",
      "- 'escalate': nachfassen lohnt sich (Kunde/Geschäftlich relevant).",
      "  Gib draft_instructions für einen freundlichen, kurzen Nachfass-Entwurf an.",
      "- 'wait': noch warten (z. B. erst 1–2 Tage überfällig, unkritisch).",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, ctx) {
    // Kein Überfälliges → leeres Ergebnis (buildPrompt lieferte null)
    if (raw === "") {
      followupCheckContextSchema.parse(ctx);
      const result = { followups: [] };
      return { result, resultHash: resultHash(result) };
    }
    const result = followupCheckResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
