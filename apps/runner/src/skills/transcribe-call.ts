// Anruf-Transkription (Etappe 6): Sprachnotiz/AB → Text, lokal via Whisper.
import { transcribeCallContextSchema } from "@leitwerk/shared";
import { transcribeAudio } from "../connectors/whisper";
import { resultHash } from "../util/hash";
import type { Skill, SkillDeps } from "./types";

export const transcribeCallSkill: Skill = {
  type: "transcribe_call",
  schemaDescription: '{"transcript": "<Text>"}',

  buildPrompt() {
    return null; // Lokal-Job (Whisper)
  },

  parse() {
    throw new Error("transcribe_call läuft über execute()");
  },

  async execute(ctx, deps: SkillDeps) {
    const parsed = transcribeCallContextSchema.parse(ctx);
    const bytes = await deps.broker.mailDownload(parsed.audio_storage_path, "audio");
    const { transcript } = await transcribeAudio(bytes, "anruf.webm");
    const result = { transcript };
    return { result, resultHash: resultHash(result) };
  },
};
