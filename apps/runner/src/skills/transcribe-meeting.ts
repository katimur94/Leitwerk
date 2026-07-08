// Meeting-Audio → Transkript + Segmente (lokal via whisper.cpp, keine Cloud).
import { transcribeMeetingContextSchema } from "@leitwerk/shared";
import { transcribeAudio } from "../connectors/whisper";
import { resultHash } from "../util/hash";
import { log } from "../util/log";
import type { Skill, SkillDeps } from "./types";

export const transcribeMeetingSkill: Skill = {
  type: "transcribe_meeting",
  schemaDescription:
    '{"transcript": "<Text>", "segments": [{"speaker": "<Name|null>", "starts_sec": <Zahl|null>, "ends_sec": <Zahl|null>, "content": "<Text>"}]}',

  buildPrompt() {
    return null; // reiner Lokal-Job (Whisper), kein KI-Aufruf
  },

  parse() {
    throw new Error("transcribe_meeting läuft über execute()");
  },

  async execute(ctx, deps: SkillDeps) {
    const parsed = transcribeMeetingContextSchema.parse(ctx);
    const bytes = await deps.broker.mailDownload(parsed.audio_storage_path, "audio");
    const { transcript, segments } = await transcribeAudio(bytes, "meeting.webm");
    log.info(`transcribe_meeting: ${transcript.length} Zeichen, ${segments.length} Segmente`);
    const result = { transcript, segments };
    return { result, resultHash: resultHash(result) };
  },
};
