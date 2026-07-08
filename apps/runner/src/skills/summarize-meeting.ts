// Meeting-Protokoll aus dem Transkript: Zusammenfassung, Entscheidungen,
// offene Fragen und konkrete Aufgaben (landen im Aufgabenmodul).
import {
  summarizeMeetingContextSchema,
  summarizeMeetingResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const summarizeMeetingSkill: Skill = {
  type: "summarize_meeting",
  schemaDescription:
    '{"protocol_md": "<Markdown-Protokoll>", "decisions": ["<Entscheidung>"], "open_questions": ["<Frage>"], "tasks": [{"title": "<Aufgabe>", "assignee_hint": "<Wer (optional)>", "due_at": "<ISO|null>"}]}',

  buildPrompt(ctx) {
    const parsed = summarizeMeetingContextSchema.parse(ctx);
    return [
      "Du bist Leitwerk und fasst ein Meeting zusammen (Protokollant).",
      "",
      `Heute ist ${parsed.today}.`,
      `Meeting: ${parsed.meeting.title || "(ohne Titel)"}`,
      parsed.meeting.case_number ? `Vorgang: ${parsed.meeting.case_number}` : "",
      "",
      "Transkript (gekürzt):",
      "---",
      parsed.meeting.transcript_excerpt || "(leer)",
      "---",
      "",
      "Erstelle:",
      "- protocol_md: strukturiertes Markdown-Protokoll (Themen, Ergebnisse, kurz und sachlich, deutsch)",
      "- decisions: getroffene Entscheidungen als kurze Sätze",
      "- open_questions: offene Fragen",
      "- tasks: konkrete Aufgaben mit klarem Titel (Verb + Objekt); due_at nur bei explizit genannter Frist",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown drumherum, keine Code-Zäune:",
      this.schemaDescription,
    ]
      .filter(Boolean)
      .join("\n");
  },

  parse(raw) {
    const result = summarizeMeetingResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
