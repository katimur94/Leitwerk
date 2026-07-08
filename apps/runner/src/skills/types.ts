// Job-Handler-Vertrag aus CLAUDE.md — jeder Job-Typ hat ein Modul
// unter src/skills/<job_type>.ts, das dieses Interface implementiert.
import type { SkillResult } from "@leitwerk/shared";

export interface Skill {
  /** Job-Typ, z. B. 'echo', 'classify_email', … */
  type: string;
  /**
   * Baut den Prompt aus dem serverseitig gelieferten Kontext.
   * null = kein KI-Aufruf nötig (reiner Sync-Job) → parse("", ctx).
   * Prompts verlangen IMMER reines JSON (kein Markdown).
   */
  buildPrompt(ctx: Record<string, unknown>): string | null;
  /** Striktes Zod-Parsing der KI-Antwort; wirft bei ungültigem Format. */
  parse(raw: string, ctx: Record<string, unknown>): SkillResult;
}
