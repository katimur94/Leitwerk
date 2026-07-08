/** Maximale Länge der zurückgespiegelten Fehl-Antwort im Reparatur-Prompt. */
export const REPAIR_RAW_MAX_CHARS = 2_000;

/**
 * Schlanker Reparatur-Prompt (Etappe 0.5): nur JSON-Schema-Beschreibung +
 * fehlerhafte Antwort (gekürzt auf 2000 Zeichen) — NICHT der komplette
 * Original-Prompt. Spart Tokens auf dem Max-Abo des Nutzers.
 */
export function buildRepairPrompt(schemaDescription: string, raw: string): string {
  return [
    "Deine vorherige Antwort war KEIN gültiges JSON im geforderten Format.",
    "",
    "Deine fehlerhafte Antwort (ggf. gekürzt):",
    "---",
    raw.slice(0, REPAIR_RAW_MAX_CHARS),
    "---",
    "",
    "Korrigiere sie. Antworte AUSSCHLIESSLICH mit reinem, gültigem JSON —",
    "kein Markdown, keine Code-Zäune, keine Erklärung. Exakt dieses Format:",
    schemaDescription,
  ].join("\n");
}
