// Schreibstil-Profil aus gesendeten Mails (MASTERPLAN §4 S):
// Entwürfe sollen nach dem Nutzer klingen, nicht nach KI.
import {
  buildStyleProfileContextSchema,
  buildStyleProfileResultSchema,
} from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const buildStyleProfileSkill: Skill = {
  type: "build_style_profile",
  schemaDescription:
    '{"profile": {"greeting": "<typische Anrede>", "closing": "<typische Grußformel>", "tone": "<Tonalität, 1 Satz>", "avg_length": "kurz|mittel|lang", "phrases": ["<wiederkehrende Floskel>"], "language": "de"}, "sample_count": <int>}',

  buildPrompt(ctx) {
    const parsed = buildStyleProfileContextSchema.parse(ctx);
    if (parsed.sent_samples.length === 0) return null;
    return [
      "Du bist Leitwerk und analysierst den Schreibstil eines Nutzers",
      "anhand seiner gesendeten E-Mails (Auszüge unten).",
      "Beschreibe NUR beobachtbare Muster — keine Erfindungen.",
      "",
      "Gesendete Mails (Auszüge):",
      ...parsed.sent_samples.map((s, i) => `--- Mail ${i + 1} ---\n${s.slice(0, 600)}`),
      "---",
      "",
      `Setze sample_count auf ${parsed.sent_samples.length}.`,
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ].join("\n");
  },

  parse(raw, ctx) {
    if (raw === "") {
      const parsed = buildStyleProfileContextSchema.parse(ctx);
      const empty = {
        profile: { greeting: "", closing: "", tone: "", avg_length: "mittel", phrases: [], language: "de" },
        sample_count: 0,
      };
      return { result: empty, resultHash: resultHash({ ...empty, account: parsed.account_id }) };
    }
    const result = buildStyleProfileResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
