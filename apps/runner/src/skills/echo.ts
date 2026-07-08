// P0-Dummy-Skill: KI antwortet auf einen Testtext.
// Dient dem Ende-zu-Ende-Test PWA → Queue → Runner → KI → Ergebnis.
import { echoContextSchema, echoResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const echoSkill: Skill = {
  type: "echo",

  buildPrompt(ctx) {
    const { input } = echoContextSchema.parse(ctx);
    return [
      "Du bist Leitwerk, ein Büro-Betriebssystem. Dies ist ein Verbindungstest",
      "zwischen der Job-Queue und deinem KI-Provider.",
      "",
      `Antworte kurz (max. 2 Sätze) und freundlich auf Deutsch auf diesen Testtext: "${input.text}"`,
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Erklärung,",
      "keine Code-Zäune. Exakt dieses Format:",
      '{"reply": "<deine kurze Antwort>"}',
    ].join("\n");
  },

  parse(raw, _ctx) {
    const result = echoResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },
};
