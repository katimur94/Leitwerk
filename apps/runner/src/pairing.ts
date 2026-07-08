import { randomInt } from "node:crypto";
import { hostname } from "node:os";
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
} from "@leitwerk/shared";
import { BrokerClient } from "./broker";
import { configPath, saveConfig, type RunnerConfig } from "./config";
import { runCli } from "./providers/run-cli";
import type { ProviderKind } from "./providers";
import { log } from "./util/log";
import { VERSION } from "./version";

function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** Geführtes Setup: prüft, welcher KI-Provider lokal verfügbar ist. */
async function detectProvider(): Promise<ProviderKind> {
  try {
    await runCli(
      process.env.LEITWERK_CLAUDE_BIN ?? "claude",
      ["--version"],
      "",
      15,
    );
    log.info("Claude CLI gefunden ✓ (Provider: claude_cli)");
    return "claude_cli";
  } catch {
    if (process.env.ANTHROPIC_API_KEY) {
      log.info("Claude CLI nicht gefunden, aber ANTHROPIC_API_KEY gesetzt (Provider: anthropic_api)");
      return "anthropic_api";
    }
    log.warn("Claude CLI nicht gefunden. So richtest du sie ein:");
    log.warn("  npm i -g @anthropic-ai/claude-code   und dann:   claude login");
    log.warn("Pairing läuft trotzdem weiter — Provider bleibt claude_cli.");
    return "claude_cli";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * init-Flow (MASTERPLAN §2.2): Runner zeigt Pairing-Code, Nutzer gibt ihn
 * in der PWA ein (Einstellungen → Runner), Runner pollt /pair bis der Code
 * eingelöst wurde, speichert dann Token + IDs lokal.
 */
export async function runInit(functionsUrl: string): Promise<void> {
  const provider = await detectProvider();
  const code = generatePairingCode();
  const broker = new BrokerClient(functionsUrl);

  console.log("");
  console.log("  ┌──────────────────────────────────────────────┐");
  console.log("  │  Leitwerk Runner-Pairing                     │");
  console.log("  │                                              │");
  console.log(`  │  Dein Pairing-Code:   ${code.slice(0, 4)}-${code.slice(4)}              │`);
  console.log("  │                                              │");
  console.log("  │  Öffne die Leitwerk-PWA:                     │");
  console.log("  │  Einstellungen → Runner → „Runner verbinden“ │");
  console.log("  │  und gib den Code dort ein.                  │");
  console.log("  │                                              │");
  console.log("  │  Der Code ist 10 Minuten gültig.             │");
  console.log("  └──────────────────────────────────────────────┘");
  console.log("");

  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const response = await broker.pair({
      code,
      name: hostname(),
      provider,
      version: VERSION,
    });
    if (response.status === "paired") {
      const config: RunnerConfig = {
        functionsUrl,
        runnerId: response.runnerId,
        runnerToken: response.runnerToken,
        orgId: response.orgId,
        provider,
      };
      saveConfig(config);
      log.info("Pairing erfolgreich ✓");
      log.info(`Konfiguration gespeichert: ${configPath()}`);
      log.info("Starte den Runner jetzt mit:  leitwerk-runner start");
      return;
    }
    await sleep(3_000);
  }
  throw new Error(
    "Pairing-Code abgelaufen (10 Minuten). Starte `leitwerk-runner init` erneut.",
  );
}
