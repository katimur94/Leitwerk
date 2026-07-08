// Lokaler Whisper-Adapter (Etappe 4, MASTERPLAN §4 M):
// Transkription läuft IMMER lokal beim Nutzer (whisper.cpp) — keine Cloud.
//
// Vertrag: LEITWERK_WHISPER_BIN zeigt auf ein Programm (bzw. einen kleinen
// Wrapper um whisper.cpp, siehe tutorials/06_runner_setup.md), das als
// Argument den Pfad zur Audiodatei bekommt und auf stdout JSON liefert:
//   {"transcript": "…", "segments": [{"speaker": null, "starts_sec": 0,
//     "ends_sec": 4.2, "content": "…"}]}
// Ohne konfiguriertes Binary schlägt der Job mit einer klaren Meldung fehl —
// es gibt bewusst KEINEN Cloud-Fallback.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface WhisperSegment {
  speaker: string | null;
  starts_sec: number | null;
  ends_sec: number | null;
  content: string;
}

export interface WhisperResult {
  transcript: string;
  segments: WhisperSegment[];
}

export async function transcribeAudio(
  bytes: Uint8Array,
  filename = "aufnahme.webm",
): Promise<WhisperResult> {
  const bin = process.env.LEITWERK_WHISPER_BIN;
  if (!bin) {
    throw new Error(
      "Whisper ist nicht konfiguriert (LEITWERK_WHISPER_BIN). " +
        "Siehe tutorials/06_runner_setup.md — Transkription läuft nur lokal.",
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "leitwerk-audio-"));
  const file = join(dir, filename.replace(/[^\w.\-]/g, "_"));
  writeFileSync(file, bytes);
  try {
    return await new Promise<WhisperResult>((resolve, reject) => {
      const child = spawn(bin, [file], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Whisper Exit ${code}: ${err.slice(0, 300)}`));
        }
        try {
          const parsed = JSON.parse(out) as Partial<WhisperResult>;
          if (typeof parsed.transcript !== "string" || !parsed.transcript.trim()) {
            throw new Error("transcript fehlt/leer");
          }
          resolve({
            transcript: parsed.transcript,
            segments: Array.isArray(parsed.segments)
              ? parsed.segments.map((s) => ({
                  speaker: s?.speaker ?? null,
                  starts_sec: typeof s?.starts_sec === "number" ? s.starts_sec : null,
                  ends_sec: typeof s?.ends_sec === "number" ? s.ends_sec : null,
                  content: String(s?.content ?? ""),
                }))
              : [],
          });
        } catch (error) {
          reject(new Error(`Whisper lieferte ungültiges JSON: ${String(error)}`));
        }
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
