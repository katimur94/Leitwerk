// Skill gap_scan: Nacht-Wächter (MASTERPLAN §4 L) — Lücken, Widersprüche,
// Liegengebliebenes. Ergebnis → agent_findings (dedupe_key serverseitig).
import { gapScanContextSchema, gapScanResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const gapScanSkill: Skill = {
  type: "gap_scan",

  schemaDescription:
    '{"findings": [{"kind": "gap"|"contradiction"|"stale"|"risk"|"opportunity", "severity": <1-5, 1=kritisch>, "title": "<kurz, Deutsch>", "description": "<1-2 Sätze>", "dedupe_key": "<stabiler Schlüssel, z. B. stale-case:V-2026-0001>", "case_id": "<uuid oder null>"}]}',

  buildPrompt(ctx) {
    const parsed = gapScanContextSchema.parse(ctx);
    const cases = parsed.stale_cases
      .map((c) => `- [${c.case_id}] ${c.case_number} "${c.title}" (${c.status}, ${c.days_inactive} Tage inaktiv)`)
      .join("\n");
    const threads = parsed.unanswered_threads
      .map((t) => `- [${t.thread_id}] "${t.subject}" von ${t.from} (${t.days_waiting} Tage unbeantwortet${t.urgency ? `, Dringlichkeit ${t.urgency}` : ""})`)
      .join("\n");
    return [
      "Du bist der Nacht-Wächter von Leitwerk. Prüfe die folgenden Signale",
      `einer Organisation (Stand ${parsed.today}) und erzeuge Findings.`,
      "",
      "Bewertung: severity 1 = kritisch (Kunde wartet lange, Frist gerissen),",
      "5 = Hinweis. dedupe_key MUSS stabil sein, damit dasselbe Finding nicht",
      "täglich neu erscheint (z. B. 'unanswered:<thread_id>').",
      "",
      "Inaktive Vorgänge:",
      cases || "(keine)",
      "",
      "Unbeantwortete eingegangene Mails:",
      threads || "(keine)",
      "",
      `Überfällige Follow-ups: ${parsed.overdue_followups}`,
      `Überfällige Aufgaben: ${parsed.overdue_tasks}`,
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, _ctx) {
    const result = gapScanResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
