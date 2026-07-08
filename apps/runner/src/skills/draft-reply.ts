// Skill draft_reply: Antwortentwurf im Ton des Nutzers (MASTERPLAN §4 B.4, S).
// Der Entwurf landet als mail_drafts source='ai' — gesendet wird NIE ohne
// Freigabe (Autonomie-Gates, CLAUDE.md Regel 4).
import { draftReplyContextSchema, draftReplyResultSchema } from "@leitwerk/shared";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import type { Skill } from "./types";

export const draftReplySkill: Skill = {
  type: "draft_reply",

  schemaDescription:
    '{"subject": "<Betreff, meist Re: …>", "body_html": "<Antwort als einfaches HTML (p, br, ul)>", "to_addrs": [{"name": "<optional>", "email": "<Adresse>"}], "confidence": <0.0-1.0>}',

  buildPrompt(ctx) {
    const parsed = draftReplyContextSchema.parse(ctx);
    const conversation = parsed.messages
      .map(
        (m) =>
          `[${m.direction === "inbound" ? "EINGANG" : "AUSGANG"}] ${m.from.email} (${m.sent_at ?? "?"}):\n${m.body_excerpt}`,
      )
      .join("\n\n");
    const styleHints = Object.keys(parsed.style_profile).length
      ? JSON.stringify(parsed.style_profile)
      : "(noch kein Stilprofil — neutral-professionell, knapp, freundlich)";
    return [
      "Du bist Leitwerk und entwirfst eine Antwort-E-Mail im Namen des Nutzers.",
      "Deutsch, professionell, kein Ausrufezeichen-Überschwang. Antworte inhaltlich",
      "auf die letzte eingegangene Nachricht; erfinde keine Fakten oder Zusagen.",
      "Wenn Informationen fehlen, formuliere eine präzise Rückfrage.",
      "",
      `Absender (Nutzer): ${parsed.sender_name || "(unbekannt)"}`,
      `Antwort an: ${parsed.reply_to.email}`,
      `Betreff des Threads: ${parsed.subject || "(kein Betreff)"}`,
      `Stilprofil: ${styleHints}`,
      parsed.instructions ? `Anweisung des Nutzers: ${parsed.instructions}` : "",
      parsed.signature_html
        ? "Hänge EXAKT diese Signatur ans Ende von body_html an:\n" + parsed.signature_html
        : "Ohne Signatur enden (nur Grußformel + Name).",
      "",
      "Bisheriger Verlauf (gekürzt, chronologisch):",
      "---",
      conversation || "(leer)",
      "---",
      "",
      "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
      this.schemaDescription,
    ]
      .filter(Boolean)
      .join("\n");
  },

  parse(raw, ctx) {
    const parsed = draftReplyResultSchema.parse(extractJson(raw));
    // Fallback: Empfänger immer auf die letzte Eingangs-Adresse zwingen,
    // falls die KI eine fremde Adresse halluziniert hat.
    const { reply_to } = draftReplyContextSchema.parse(ctx);
    const result =
      reply_to.email &&
      !parsed.to_addrs.some((a) => a.email.toLowerCase() === reply_to.email.toLowerCase())
        ? { ...parsed, to_addrs: [reply_to] }
        : parsed;
    return { result, resultHash: resultHash(result) };
  },
};
