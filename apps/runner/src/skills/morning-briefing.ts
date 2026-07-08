// Skill morning_briefing: "Diese 5 Dinge brauchen dich heute" (MASTERPLAN §4 H).
import {
  morningBriefingContextSchema,
  morningBriefingResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const morningBriefingSkill: Skill = {
  type: "morning_briefing",

  schemaDescription:
    '{"content_md": "<kurzes Markdown-Briefing, Deutsch, max. 6 Sätze>", "items": [{"title": "<Punkt>", "detail": "<1 Satz>", "entity_type": "<mail_thread|task|agent_finding|case oder null>", "entity_id": "<uuid oder null>", "action": "<CTA, z. B. Entwurf ansehen>"}]}',

  buildPrompt(ctx) {
    const parsed = morningBriefingContextSchema.parse(ctx);
    const items = parsed.top_items
      .map((i) => `- [${i.entity_type}/${i.entity_id}] ${i.title}${i.detail ? ` — ${i.detail}` : ""}`)
      .join("\n");
    return [
      `Du bist Leitwerk und schreibst das Morgen-Briefing für ${parsed.for_date}`,
      `(Organisation: ${parsed.org_name || "—"}). Ton: klar, knapp, respektvoll,`,
      "keine Ausrufezeichen-Euphorie. Leitwerk spricht als 'Leitwerk', nie als 'Ich'.",
      "",
      "Kennzahlen:",
      `- Ungelesene Threads: ${parsed.stats.unread_threads} (davon dringend: ${parsed.stats.urgent_threads})`,
      `- Heute fällige Aufgaben: ${parsed.stats.due_tasks}`,
      `- Überfällige Follow-ups: ${parsed.stats.overdue_followups}`,
      `- Offene Wächter-Findings: ${parsed.stats.open_findings}`,
      "",
      "Wichtigste Objekte (für items, entity_type/entity_id ÜBERNEHMEN):",
      items || "(keine)",
      "",
      "Wähle die 3–5 wichtigsten Punkte als items (Priorität: Fristen > wartende",
      "Kunden > Findings). content_md fasst den Tag in wenigen Sätzen zusammen.",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown-Codeblock:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, _ctx) {
    const result = morningBriefingResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
