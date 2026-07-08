// Wochenrückblick (Etappe 5, MASTERPLAN §4 W): freitags, briefings kind='weekly'.
import { weeklyReportContextSchema, weeklyReportResultSchema } from "@leitwerk/shared";
import { formatCents } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const weeklyReportSkill: Skill = {
  type: "weekly_report",
  schemaDescription:
    '{"content_md": "<Markdown-Wochenrückblick>", "items": [{"title": "<Punkt>", "detail": "<Detail>", "entity_type": "<typ|null>", "entity_id": "<uuid|null>", "action": "<CTA|null>"}]}',

  buildPrompt(ctx) {
    const parsed = weeklyReportContextSchema.parse(ctx);
    const s = parsed.stats;
    return [
      "Du bist Leitwerk und schreibst den Wochenrückblick für ein Büro — sachlich, motivierend, deutsch.",
      "",
      `Organisation: ${parsed.org_name}`,
      `Woche bis: ${parsed.for_date}`,
      "Kennzahlen:",
      `- Bearbeitete Mails: ${s.mails_handled}`,
      `- Erledigte Aufgaben: ${s.tasks_done} (offen: ${s.tasks_open})`,
      `- Rechnungen versendet: ${s.invoices_sent}, bezahlt: ${s.invoices_paid}`,
      `- Angebots-Pipeline: ${formatCents(s.pipeline_value_cents)}`,
      s.ai_accuracy != null ? `- KI-Trefferquote: ${Math.round(s.ai_accuracy * 100)} %` : "",
      "",
      "Fasse die Woche in 3–5 Sätzen zusammen (content_md) und liste bis zu 5 konkrete",
      "Punkte für die kommende Woche (items).",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown drumherum, keine Code-Zäune:",
      this.schemaDescription,
    ]
      .filter(Boolean)
      .join("\n");
  },

  parse(raw) {
    const result = weeklyReportResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
