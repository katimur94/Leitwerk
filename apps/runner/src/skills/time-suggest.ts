// Zeitvorschläge (Etappe 6): aus Kalender-/Vorgangs-Signalen Buchungs-Vorschläge.
import { timeSuggestContextSchema, timeSuggestResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const timeSuggestSkill: Skill = {
  type: "time_suggest",
  schemaDescription:
    '{"entries": [{"case_id": "<uuid|null>", "work_date": "<ISO|null>", "minutes": <int>, "description": "<Text>", "is_billable": true|false}]}',

  buildPrompt(ctx) {
    const parsed = timeSuggestContextSchema.parse(ctx);
    if (parsed.signals.length === 0) return null;
    return [
      "Du bist Leitwerk und schlägst Zeiterfassungs-Einträge für einen Arbeitstag vor.",
      "Nur plausible, konkrete Einträge — keine erfundenen Stunden.",
      "",
      `Datum: ${parsed.for_date}`,
      "Signale des Tages:",
      ...parsed.signals.map((s) => `- ${s.kind}${s.case_id ? ` [${s.case_id}]` : ""}: ${s.detail}${s.minutes ? ` (~${s.minutes} min)` : ""}`),
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, ctx) {
    if (raw === "") {
      const empty = { entries: [] };
      return { result: empty, resultHash: resultHash({ ...empty, job: (ctx as { jobId?: string }).jobId }) };
    }
    const result = timeSuggestResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
