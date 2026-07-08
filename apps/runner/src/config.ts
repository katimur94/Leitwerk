import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const runnerConfigSchema = z.object({
  /** Basis-URL der Edge Functions, z. B. http://127.0.0.1:54321/functions/v1 */
  functionsUrl: z.string().url(),
  runnerId: z.string().uuid(),
  runnerToken: z.string().min(20),
  orgId: z.string().uuid(),
  provider: z
    .enum(["claude_cli", "codex_cli", "anthropic_api"])
    .default("claude_cli"),
});
export type RunnerConfig = z.infer<typeof runnerConfigSchema>;

export function configDir(): string {
  return process.env.LEITWERK_CONFIG_DIR ?? join(homedir(), ".leitwerk-runner");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function loadConfig(): RunnerConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return runnerConfigSchema.parse(raw);
}

export function saveConfig(config: RunnerConfig): void {
  mkdirSync(configDir(), { recursive: true });
  const path = configPath();
  writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  try {
    chmodSync(path, 0o600); // Unix: nur Besitzer; unter Windows wirkungslos
  } catch {
    /* Windows */
  }
}
