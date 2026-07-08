// Institutionelles Wissen destillieren (MASTERPLAN §4 G): dauerhafte Fakten
// aus Mails/Meetings/Notizen — landen als 'proposed' im Review.
import {
  knowledgeDistillContextSchema,
  knowledgeDistillResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const knowledgeDistillSkill: Skill = {
  type: "knowledge_distill",
  schemaDescription:
    '{"facts": [{"fact": "<dauerhafter Fakt, ganzer Satz>", "category": "kunde|lieferant|prozess|behörde|intern", "company_name": "<Firma (optional)>", "source_type": "mail_message|meeting|note", "source_id": "<uuid>", "confidence": <0.0-1.0>}]}',

  buildPrompt(ctx) {
    const parsed = knowledgeDistillContextSchema.parse(ctx);
    if (parsed.sources.length === 0) return null; // nichts Neues → kein KI-Aufruf
    const sources = parsed.sources
      .map(
        (s) =>
          `- [${s.source_type}/${s.source_id}] "${s.title}" (${s.counterpart}): ${s.excerpt.slice(0, 400)}`,
      )
      .join("\n");
    return [
      "Du bist Leitwerk und destillierst DAUERHAFTES Firmenwissen aus Korrespondenz.",
      "Gesucht sind Fakten, die auch in 6 Monaten noch gelten",
      '(z. B. "Stadt Dortmund verlangt für Aufbrüche immer Formular B-12",',
      '"Firma ACME zahlt grundsätzlich erst nach 2. Erinnerung").',
      "KEINE Tagesereignisse, KEINE einmaligen Vorgänge, KEINE Vermutungen.",
      "",
      `Heute ist ${parsed.today}.`,
      "",
      "Quellen seit dem letzten Lauf:",
      sources,
      "",
      "Bereits bekannt (NICHT wiederholen):",
      parsed.known_facts.length ? parsed.known_facts.map((f) => `- ${f}`).join("\n") : "- (nichts)",
      "",
      "Wenn es keine neuen dauerhaften Fakten gibt: leere Liste.",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, ctx) {
    if (raw === "") {
      // buildPrompt → null (keine Quellen): leeres, idempotentes Ergebnis
      const empty = { facts: [] };
      return { result: empty, resultHash: resultHash({ ...empty, ctx: (ctx as { jobId?: string }).jobId }) };
    }
    const result = knowledgeDistillResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
