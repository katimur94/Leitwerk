// Kündigungsfristen-Wächter (Etappe 6): Findings vor dem spätesten Kündigungstermin.
import { contractWatchContextSchema, contractWatchResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const contractWatchSkill: Skill = {
  type: "contract_watch",
  schemaDescription:
    '{"findings": [{"contract_id": "<uuid>", "severity": <1-5>, "title": "<Text>", "description": "<Text>", "dedupe_key": "<stabil>"}]}',

  buildPrompt(ctx) {
    const parsed = contractWatchContextSchema.parse(ctx);
    // Nur Verträge mit näher rückender Frist sind interessant.
    const relevant = parsed.contracts.filter(
      (c) => c.days_until_deadline != null && c.days_until_deadline <= 90,
    );
    if (relevant.length === 0) return null;
    return [
      "Du bist Leitwerk und warnst vor auslaufenden Kündigungsfristen.",
      "Erzeuge pro relevantem Vertrag ein Finding mit stabilem dedupe_key",
      "(Format: contract:<id>:<vorlauf>). Vorlaufstufen: 90/60/30 Tage.",
      "Severity: 30 Tage = 1, 60 Tage = 2, 90 Tage = 3.",
      "",
      `Heute ist ${parsed.today}.`,
      "Verträge:",
      ...relevant.map(
        (c) =>
          `- [${c.contract_id}] "${c.title}" — Kündigungsfrist bis ${c.notice_deadline} (in ${c.days_until_deadline} Tagen), Jahreskosten ${c.yearly_cost ?? "?"} €`,
      ),
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, ctx) {
    if (raw === "") {
      const empty = { findings: [] };
      return { result: empty, resultHash: resultHash({ ...empty, job: (ctx as { jobId?: string }).jobId }) };
    }
    const result = contractWatchResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
