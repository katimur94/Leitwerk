// Job-Handler-Vertrag aus CLAUDE.md — jeder Job-Typ hat ein Modul
// unter src/skills/<job_type>.ts, das dieses Interface implementiert.
import type { SkillResult } from "@leitwerk/shared";
import type { BrokerClient } from "../broker";

import type { AiProvider } from "../providers";

/** Abhängigkeiten für Connector-/Hybrid-Skills mit execute(). */
export interface SkillDeps {
  broker: BrokerClient;
  /** Für Hybrid-Skills (z. B. extract_invoice: erst Parser, dann KI) */
  provider: AiProvider;
}

export interface Skill {
  /** Job-Typ, z. B. 'echo', 'classify_email', … */
  type: string;
  /**
   * Kompakte Beschreibung des erwarteten JSON-Formats — wird beim
   * Reparatur-Retry gesendet (NICHT der komplette Original-Prompt,
   * Etappe 0.5: Token sparen).
   */
  schemaDescription: string;
  /**
   * Baut den Prompt aus dem serverseitig gelieferten Kontext.
   * null = kein KI-Aufruf nötig (reiner Sync-Job) → parse("", ctx).
   * Prompts verlangen IMMER reines JSON (kein Markdown).
   */
  buildPrompt(ctx: Record<string, unknown>): string | null;
  /** Striktes Zod-Parsing der KI-Antwort; wirft bei ungültigem Format. */
  parse(raw: string, ctx: Record<string, unknown>): SkillResult;
  /**
   * Nur für Connector-Skills (buildPrompt → null UND asynchrone Arbeit,
   * z. B. gmail-sync): führt den Job direkt aus. Netzwerk läuft
   * AUSSCHLIESSLICH über die Edge Functions (broker) und die vom Nutzer
   * verbundenen Konten (CLAUDE.md Regel 2, MASTERPLAN §6.2).
   */
  execute?(ctx: Record<string, unknown>, deps: SkillDeps): Promise<SkillResult>;
}
