import {
  RUNNER_PENDING_APPROVAL_POLL_MS,
  RUNNER_POLL_INTERVAL_MS,
} from "@leitwerk/shared";
import { BrokerClient, BrokerHttpError } from "./broker";
import type { RunnerConfig } from "./config";
import { executeJob } from "./job-runner";
import { createProvider } from "./providers";
import { log } from "./util/log";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll-Loop: claim → execute → sofort weiter. Nach jedem Job wird direkt
 * erneut geclaimt — claim_next_job sortiert nach Priorität, dadurch kommen
 * interaktive Jobs (priority <= 2) vor Batch-Arbeit dran (Preemption an
 * Job-Grenzen). Leere Queue → Poll-Intervall.
 */
export async function runLoop(config: RunnerConfig): Promise<void> {
  const broker = new BrokerClient(config.functionsUrl, {
    runnerId: config.runnerId,
    runnerToken: config.runnerToken,
  });
  const provider = createProvider(config.provider);

  log.info(`Leitwerk-Runner gestartet (Provider: ${provider.name})`);
  log.info(`Broker: ${config.functionsUrl}/runner-broker`);

  let stopping = false;
  const stop = () => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info("Beende nach aktuellem Job … (nochmal Strg+C für sofortigen Abbruch)");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let consecutiveErrors = 0;
  let approvalHintShown = false;
  while (!stopping) {
    try {
      const job = await broker.claim();
      consecutiveErrors = 0;
      approvalHintShown = false;
      if (!job) {
        await sleep(RUNNER_POLL_INTERVAL_MS);
        continue;
      }
      log.info(
        `Job ${job.id} geclaimt (${job.job_type}, Priorität ${job.priority}, Versuch ${job.attempts}/${job.max_attempts})`,
      );
      await executeJob(job, { broker, provider });
    } catch (error) {
      // Zwei-Stufen-Pairing: noch nicht freigegeben → geduldig warten
      if (error instanceof BrokerHttpError && error.code === "pending_approval") {
        if (!approvalHintShown) {
          log.warn("Runner wartet auf Freigabe: PWA → Einstellungen → Runner → „Bestätigen“");
          approvalHintShown = true;
        }
        consecutiveErrors = 0;
        await sleep(RUNNER_PENDING_APPROVAL_POLL_MS);
        continue;
      }
      // Abgelehnt/deaktiviert → beenden, sonst hämmert der Runner sinnlos weiter
      if (error instanceof BrokerHttpError && error.code === "runner_disabled") {
        log.error("Runner wurde in der PWA deaktiviert. Neues Pairing: leitwerk-runner init");
        process.exitCode = 1;
        return;
      }
      consecutiveErrors += 1;
      const backoff = Math.min(60_000, RUNNER_POLL_INTERVAL_MS * consecutiveErrors);
      log.error(`Poll-Fehler: ${String(error)} — nächster Versuch in ${backoff / 1000}s`);
      await sleep(backoff);
    }
  }
  log.info("Runner beendet.");
}
