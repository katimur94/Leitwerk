/**
 * Extrahiert JSON aus einer KI-Antwort. Prompts verlangen zwar reines JSON,
 * aber Modelle liefern gelegentlich Markdown-Zäune oder Vorspann —
 * hier wird beides toleriert, alles andere wirft (→ Reparatur-Retry).
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Leere Antwort");

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    // Fallback: erstes { bis letztes } (Vorspann/Nachspann abschneiden)
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1));
    }
    throw new Error("Keine JSON-Struktur in der Antwort gefunden");
  }
}
