// Optionaler Fallback-Provider: Codex CLI (MASTERPLAN §2.3).
// Experimentell — Ausgabeformat wird als Rohtext übernommen.
import { runCli } from "./run-cli";
import type { AiProvider, CompleteOptions } from "./types";

export class CodexCliProvider implements AiProvider {
  readonly name = "codex_cli";

  constructor(
    private readonly command = process.env.LEITWERK_CODEX_BIN ?? "codex",
  ) {}

  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const stdout = await runCli(
      this.command,
      ["exec", "-"],
      prompt,
      opts?.maxRuntimeSec ?? 300,
    );
    const text = stdout.trim();
    if (!text) throw new Error("Codex CLI lieferte keine Ausgabe");
    return text;
  }
}
