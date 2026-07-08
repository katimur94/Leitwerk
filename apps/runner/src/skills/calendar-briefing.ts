// Kontext-Briefing vor einem Termin (Etappe 5, MASTERPLAN §4 K):
// „Mit Herrn Meier offen: Angebot 2026-041, letzte Mail vor 9 Tagen …“.
import {
  calendarBriefingContextSchema,
  calendarBriefingResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const calendarBriefingSkill: Skill = {
  type: "calendar_briefing",
  schemaDescription: '{"briefing_md": "<kurzes Markdown-Briefing>"}',

  buildPrompt(ctx) {
    const parsed = calendarBriefingContextSchema.parse(ctx);
    return [
      "Du bist Leitwerk und schreibst ein kurzes Kontext-Briefing vor einem Termin.",
      "Fasse in 3–5 Sätzen zusammen, was für das Gespräch relevant ist — sachlich, deutsch.",
      "",
      `Heute ist ${parsed.today}.`,
      `Termin: ${parsed.event.title} am ${parsed.event.starts_at}`,
      parsed.event.location ? `Ort: ${parsed.event.location}` : "",
      parsed.event.case_number ? `Vorgang: ${parsed.event.case_number}` : "",
      `Teilnehmer: ${parsed.event.attendees.join(", ") || "—"}`,
      "",
      "Kontext:",
      ...parsed.context.map((c) => `- ${c.kind}: ${c.detail}`),
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown drumherum, keine Code-Zäune:",
      this.schemaDescription,
    ]
      .filter(Boolean)
      .join("\n");
  },

  parse(raw) {
    const result = calendarBriefingResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
