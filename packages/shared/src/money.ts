// Geldbeträge: DB numeric, im Client als Cent-Integer rechnen,
// Anzeige via Intl.NumberFormat('de-DE') — CLAUDE.md Konventionen.

const eur = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

/** 123456 → "1.234,56 €" */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) throw new Error(`Ungültiger Betrag: ${cents}`);
  return eur.format(cents / 100);
}

/**
 * Deutsche Betragseingabe → Cent-Integer.
 * "1.234,56" → 123456 · "12" → 1200 · 12.5 (number) → 1250
 */
export function toCents(amount: string | number): number {
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) throw new Error(`Ungültiger Betrag: ${amount}`);
    return Math.round(amount * 100);
  }
  const normalized = amount
    .trim()
    .replace(/\s|€/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (normalized === "" || Number.isNaN(Number(normalized))) {
    throw new Error(`Ungültiger Betrag: "${amount}"`);
  }
  return Math.round(Number(normalized) * 100);
}
