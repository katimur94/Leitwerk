/**
 * KI-Aufrufe laufen im Runner NUR über dieses Interface (CLAUDE.md Regel 7).
 * Kein direkter `claude`-Aufruf außerhalb der Adapter.
 */
export interface AiProvider {
  readonly name: string;
  /** Führt einen Prompt aus und liefert die rohe Textantwort. */
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}

export interface CompleteOptions {
  /** Harte Laufzeitgrenze in Sekunden (aus agent_jobs.max_runtime_sec). */
  maxRuntimeSec?: number;
}
