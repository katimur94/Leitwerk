// Standard-Provider: Claude CLI mit dem Max-Abo des Nutzers (BYO-KI).
// Aufruf: claude -p --output-format json  (Prompt via stdin)
import { runCli } from "./run-cli";
import type { AiProvider, CompleteOptions } from "./types";

interface ClaudeCliOutput {
  is_error?: boolean;
  result?: unknown;
}

/** Parst die JSON-Hülle von `claude -p --output-format json`. */
export function parseClaudeCliOutput(stdout: string): string {
  let parsed: ClaudeCliOutput;
  try {
    parsed = JSON.parse(stdout) as ClaudeCliOutput;
  } catch {
    throw new Error(
      `Unerwartete Claude-CLI-Ausgabe (kein JSON): ${stdout.trim().slice(0, 200)}`,
    );
  }
  if (parsed.is_error) {
    throw new Error(`Claude CLI meldet Fehler: ${String(parsed.result ?? "unbekannt")}`);
  }
  if (typeof parsed.result !== "string" || !parsed.result) {
    throw new Error("Claude-CLI-Ausgabe enthält kein result-Feld");
  }
  return parsed.result;
}

export class ClaudeCliProvider implements AiProvider {
  readonly name = "claude_cli";

  constructor(
    private readonly command = process.env.LEITWERK_CLAUDE_BIN ?? "claude",
  ) {}

  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const stdout = await runCli(
      this.command,
      ["-p", "--output-format", "json"],
      prompt,
      opts?.maxRuntimeSec ?? 300,
    );
    return parseClaudeCliOutput(stdout);
  }
}
