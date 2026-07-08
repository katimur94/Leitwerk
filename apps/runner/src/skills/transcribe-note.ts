// Sprachnotiz → Markdown-Transkript (lokal via Whisper, KEIN KI-Provider).
import { transcribeNoteContextSchema } from "@leitwerk/shared";
import { transcribeAudio } from "../connectors/whisper";
import { resultHash } from "../util/hash";
import type { Skill, SkillDeps } from "./types";

export const transcribeNoteSkill: Skill = {
  type: "transcribe_note",
  schemaDescription: '{"transcript": "<Text>"}',

  buildPrompt() {
    return null; // reiner Lokal-Job (Whisper), kein KI-Aufruf
  },

  parse() {
    throw new Error("transcribe_note läuft über execute()");
  },

  async execute(ctx, deps: SkillDeps) {
    const parsed = transcribeNoteContextSchema.parse(ctx);
    const bytes = await deps.broker.mailDownload(parsed.audio_storage_path, "audio");
    const { transcript } = await transcribeAudio(bytes, "notiz.webm");
    const result = { transcript };
    return { result, resultHash: resultHash(result) };
  },
};
