import { RUNNER_HEARTBEAT_INTERVAL_MS, type AgentJob } from "@leitwerk/shared";
import type { BrokerClient } from "./broker";
import type { AiProvider } from "./providers";
import { getSkill } from "./skills";
import { log } from "./util/log";

/**
 * Führt einen geclaimten Job aus: Kontext holen → Prompt bauen → Provider →
 * striktes Parsen (mit 1× Reparatur-Retry) → complete/fail über den Broker.
 * Idempotenz: das Ergebnis trägt immer einen result_hash (CLAUDE.md Regel 6).
 */
export async function executeJob(
  job: AgentJob,
  deps: { broker: BrokerClient; provider: AiProvider },
): Promise<void> {
  const { broker, provider } = deps;

  const heartbeat = setInterval(() => {
    broker.heartbeat(job.id).catch((e: unknown) => {
      log.warn(`Heartbeat für Job ${job.id} fehlgeschlagen: ${String(e)}`);
    });
  }, RUNNER_HEARTBEAT_INTERVAL_MS);
  // Erster Heartbeat sofort → Status claimed → running
  await broker.heartbeat(job.id).catch(() => undefined);

  try {
    const skill = getSkill(job.job_type);
    if (!skill) throw new Error(`Kein Skill für Job-Typ '${job.job_type}' registriert`);

    const context = await broker.buildContext(job.id);
    const prompt = skill.buildPrompt(context);

    let skillResult;
    if (prompt === null) {
      // Reiner Sync-Job ohne KI-Aufruf
      skillResult = skill.parse("", context);
    } else {
      const opts = { maxRuntimeSec: job.max_runtime_sec };
      const raw = await provider.complete(prompt, opts);
      try {
        skillResult = skill.parse(raw, context);
      } catch (parseError) {
        // Reparatur-Retry (1×): ungültiges JSON zurückspiegeln
        log.warn(
          `Job ${job.id}: Antwort ungültig (${String(parseError)}), starte Reparatur-Versuch`,
        );
        const repairPrompt = [
          prompt,
          "",
          "Deine vorherige Antwort war KEIN gültiges JSON im geforderten Format:",
          "---",
          raw.slice(0, 2000),
          "---",
          "Antworte jetzt AUSSCHLIESSLICH mit gültigem JSON im geforderten Format.",
        ].join("\n");
        const repaired = await provider.complete(repairPrompt, opts);
        skillResult = skill.parse(repaired, context);
      }
    }

    await broker.complete(job.id, skillResult.result, skillResult.resultHash);
    log.info(`Job ${job.id} (${job.job_type}) erledigt ✓`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Job ${job.id} (${job.job_type}) fehlgeschlagen: ${message}`);
    await broker
      .fail(job.id, message)
      .catch((e: unknown) => log.error(`fail() nicht meldbar: ${String(e)}`));
  } finally {
    clearInterval(heartbeat);
  }
}
